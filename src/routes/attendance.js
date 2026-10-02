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

    // 2. Fetch all active students belonging to this category (or all active students if session.category === 'All')
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
        a.timestamp AS marked_at
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id AND a.session_id = ?
      WHERE s.status = 'active'
    `;
    const params = [sessionId];

    if (session.category !== 'All') {
      studentQuery += ' AND (s.category = ? OR a.id IS NOT NULL)';
      params.push(session.category);
    }

    studentQuery += ' ORDER BY s.first_name ASC, s.father_name ASC';

    const [students] = await pool.query(studentQuery, params);

    res.json({
      session,
      students
    });
  } catch (error) {
    console.error('Fetch attendance session error:', error);
    res.status(500).json({ message: 'Error retrieving attendance sheet' });
  }
});

// POST /api/attendance/session/:sessionId - Save or update attendance records (Batch)
// Body: { records: [ { student_id: 1, status: 'present'|'absent'|'permission', remarks: '' } ] }
router.post('/session/:sessionId', authenticateToken, async (req, res) => {
  const { sessionId } = req.params;
  const { records } = req.body;

  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ message: 'Records array is required' });
  }

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

    await conn.commit();

    // Fetch session details for informative audit log
    const [sess] = await pool.query('SELECT course_title, category, session_date FROM sessions WHERE id = ?', [sessionId]);
    const sessTitle = sess[0] ? `"${sess[0].course_title}" (${sess[0].category})` : `Session ID ${sessionId}`;
    const presentCnt = records.filter(r => r.status === 'present').length;
    const absentCnt = records.filter(r => r.status === 'absent').length;

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'ATTENDANCE_SAVE',
      details: `Recorded attendance for ${sessTitle}: ${records.length} students marked (${presentCnt} present, ${absentCnt} absent)`,
      req
    });

    res.json({ message: 'Attendance records saved successfully' });
  } catch (error) {
    await conn.rollback();
    console.error('Save attendance error:', error);
    res.status(500).json({ message: 'Error saving attendance records' });
  } finally {
    conn.release();
  }
});

module.exports = router;

