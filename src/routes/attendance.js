const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
const { logActivity } = require('../utils/auditLogger');

// GET /api/attendance/session/:sessionId - Get students and their attendance status for a session
router.get('/session/:sessionId', authenticateToken, async (req, res) => {
  const { sessionId } = req.params;

  try {
    // 1. Get session info
    const [sessions] = await pool.query('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }
    const session = sessions[0];

    // Check encoder assignment (support multiple encoders)
    if (req.user.role === 'encoder') {
      const [encRows] = await pool.query('SELECT user_id FROM session_encoders WHERE session_id = ?', [sessionId]);
      const encoderIds = encRows.map(r => r.user_id);
      if (session.assigned_encoder_id && !encoderIds.includes(session.assigned_encoder_id)) {
        encoderIds.push(session.assigned_encoder_id);
      }
      if (encoderIds.length > 0 && !encoderIds.includes(req.user.id)) {
        return res.status(403).json({ message: 'Access denied. You are not assigned to this session.' });
      }
    }

    // 2. Fetch all active students belonging to this category (or all active students if session.category === 'All')
    // Also join other sessions held on the same session_date where the student was marked present or permission
    let studentQuery = `
      SELECT 
        s.id AS student_id,
        s.first_name,
        s.father_name,
        s.mother_name,
        s.phone,
        s.emergency_contact,
        s.category,
        s.status AS student_status,
        a.id AS attendance_id,
        a.status AS attendance_status,
        a.remarks,
        a.timestamp AS marked_at,
        other_att.other_session_id,
        other_att.other_status,
        other_att.other_course_title,
        other_att.other_category
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id AND a.session_id = ?
      LEFT JOIN (
        SELECT DISTINCT ON (a2.student_id)
          a2.student_id,
          a2.session_id AS other_session_id,
          a2.status AS other_status,
          sess2.course_title AS other_course_title,
          sess2.category AS other_category
        FROM attendance a2
        JOIN sessions sess2 ON a2.session_id = sess2.id
        WHERE sess2.session_date = ?
          AND sess2.id != ?
          AND a2.status IN ('present', 'permission')
        ORDER BY a2.student_id, a2.id DESC
      ) other_att ON s.id = other_att.student_id
      WHERE s.status = 'active'
    `;
    const params = [sessionId, session.session_date, sessionId];

    if (session.category !== 'All') {
      studentQuery += ' AND (s.category = ? OR a.id IS NOT NULL)';
      params.push(session.category);
    }

    studentQuery += ' ORDER BY s.first_name ASC, s.father_name ASC';

    const [students] = await pool.query(studentQuery, params);

    let attStatus = session.attendance_status || 'unrecorded';
    const [[attMarkedCount]] = await pool.query('SELECT COUNT(*) AS total FROM attendance WHERE session_id = ?', [sessionId]);
    const totalMarked = parseInt(attMarkedCount?.total, 10) || 0;
    if (attStatus === 'unrecorded' && totalMarked > 0) {
      attStatus = 'finalized';
    }
    session.attendance_status = attStatus;

    const todayStr = new Date().toISOString().split('T')[0];
    const sessDateStr = new Date(session.session_date).toISOString().split('T')[0];
    const isFuture = sessDateStr > todayStr;

    const isPrivileged = ['admin', 'super_admin'].includes(req.user.role);
    const canEdit = !isFuture && (attStatus !== 'finalized' || isPrivileged);

    res.json({
      session,
      students,
      is_future: isFuture,
      can_edit: canEdit,
      attendance_status: attStatus
    });
  } catch (error) {
    console.error('Fetch attendance session error:', error);
    res.status(500).json({ message: 'Error retrieving attendance sheet' });
  }
});

// POST /api/attendance/session/:sessionId - Save or update attendance records (Draft or Finalized)
// Body: { records: [ { student_id: 1, status: 'present'|'absent'|'permission', remarks: '' } ], is_draft: true|false }
router.post('/session/:sessionId', authenticateToken, async (req, res) => {
  const { sessionId } = req.params;
  const { records, is_draft } = req.body;

  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ message: 'Records array is required' });
  }

  try {
    // 1. Fetch session to validate date and current finalized status
    const [sessions] = await pool.query('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }
    const session = sessions[0];

    // Check encoder assignment (support multiple encoders)
    if (req.user.role === 'encoder') {
      const [encRows] = await pool.query('SELECT user_id FROM session_encoders WHERE session_id = ?', [sessionId]);
      const encoderIds = encRows.map(r => r.user_id);
      if (session.assigned_encoder_id && !encoderIds.includes(session.assigned_encoder_id)) {
        encoderIds.push(session.assigned_encoder_id);
      }
      if (encoderIds.length > 0 && !encoderIds.includes(req.user.id)) {
        return res.status(403).json({ message: 'Access denied. You are not assigned to this session.' });
      }
    }

    // 2. Validate session date: Cannot take attendance for future sessions
    const todayStr = new Date().toISOString().split('T')[0];
    const sessDateStr = new Date(session.session_date).toISOString().split('T')[0];
    if (sessDateStr > todayStr) {
      return res.status(400).json({
        message: 'Attendance cannot be recorded before the session date (future session).'
      });
    }

    // 3. Validate finalized lock: If finalized, only admin and super_admin can edit
    let currentAttStatus = session.attendance_status;
    if (!currentAttStatus || currentAttStatus === 'unrecorded') {
      const [[markedRow]] = await pool.query('SELECT COUNT(*) AS total FROM attendance WHERE session_id = ?', [sessionId]);
      if (parseInt(markedRow?.total, 10) > 0) currentAttStatus = 'finalized';
    }

    if (currentAttStatus === 'finalized' && req.user.role === 'encoder') {
      return res.status(403).json({
        message: 'Attendance for this session has already been finalized and locked. Only Administrators can modify finalized attendance.'
      });
    }

    const isDraft = is_draft === true;
    const newStatus = isDraft ? 'draft' : 'finalized';

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const insertOrUpdateQuery = `
        INSERT INTO attendance (session_id, student_id, status, remarks, marked_by)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (session_id, student_id) DO UPDATE SET
          status = EXCLUDED.status,
          remarks = EXCLUDED.remarks,
          marked_by = EXCLUDED.marked_by,
          timestamp = CURRENT_TIMESTAMP
      `;

      for (const record of records) {
        if (['present', 'absent', 'permission'].includes(record.status)) {
          await conn.query(insertOrUpdateQuery, [
            sessionId,
            record.student_id,
            record.status,
            record.remarks || '',
            req.user.id
          ]);
        }
      }

      // Update session attendance status
      await conn.query('UPDATE sessions SET attendance_status = ? WHERE id = ?', [newStatus, sessionId]);

      await conn.commit();

      const sessTitle = `"${session.course_title}" (${session.category})`;
      const presentCnt = records.filter(r => r.status === 'present').length;
      const absentCnt = records.filter(r => r.status === 'absent').length;

      logActivity({
        userId: req.user.id,
        username: req.user.username,
        action: isDraft ? 'ATTENDANCE_DRAFT_SAVE' : 'ATTENDANCE_SAVE',
        details: `${isDraft ? 'Saved draft attendance' : 'Finalized attendance'} for ${sessTitle}: ${records.length} students marked (${presentCnt} present, ${absentCnt} absent)`,
        req
      });

      res.json({ 
        message: isDraft ? 'Attendance draft saved successfully' : 'Attendance records finalized and saved successfully',
        attendance_status: newStatus
      });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Save attendance error:', error);
    res.status(500).json({ message: error.message || 'Error saving attendance records' });
  } finally {
    conn.release();
  }
});

module.exports = router;

