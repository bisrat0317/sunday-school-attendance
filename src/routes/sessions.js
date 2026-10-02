const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/auditLogger');

// GET /api/sessions - List sessions with attendance summary (with optional pagination)
router.get('/', authenticateToken, async (req, res) => {
  const { category, page, limit } = req.query;

  try {
    let baseQuery = `
      FROM sessions s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN users enc ON s.assigned_encoder_id = enc.id
      LEFT JOIN (
        SELECT 
          session_id,
          COUNT(CASE WHEN status = 'present' THEN 1 END) AS present_count,
          COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent_count,
          COUNT(CASE WHEN status = 'permission' THEN 1 END) AS permission_count,
          COUNT(*) AS total_marked
        FROM attendance
        GROUP BY session_id
      ) att ON s.id = att.session_id
      WHERE 1=1
    `;
    const params = [];

    // If encoder, only show sessions assigned to this encoder (or unassigned/created by encoder)
    if (req.user.role === 'encoder') {
      baseQuery += " AND (s.assigned_encoder_id = ? OR (s.assigned_encoder_id IS NULL AND s.created_by = ?))";
      params.push(req.user.id, req.user.id);
    }

    if (category && category !== 'All') {
      baseQuery += " AND (s.category = ? OR s.category = 'All')";
      params.push(category);
    }

    let selectQuery = `
      SELECT 
        s.id,
        s.course_title,
        s.session_date,
        s.session_time,
        s.start_time,
        s.end_time,
        s.category,
        s.description,
        s.assigned_encoder_id,
        enc.full_name AS assigned_encoder_name,
        enc.username AS assigned_encoder_username,
        COALESCE(s.attendance_status, CASE WHEN COALESCE(att.total_marked, 0) > 0 THEN 'finalized' ELSE 'unrecorded' END) AS attendance_status,
        s.created_by,
        s.created_at,
        u.full_name AS created_by_name,
        COALESCE(att.present_count, 0) AS present_count,
        COALESCE(att.absent_count, 0) AS absent_count,
        COALESCE(att.permission_count, 0) AS permission_count,
        COALESCE(att.total_marked, 0) AS total_marked
      ${baseQuery}
      ORDER BY s.session_date DESC, s.session_time DESC
    `;

    if (limit && !isNaN(parseInt(limit, 10))) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10)));
      const offset = (pageNum - 1) * limitNum;
      
      const countParams = [...params];
      const [[{ total }]] = await pool.query(`SELECT COUNT(s.id) AS total ${baseQuery}`, countParams);
      
      selectQuery += ` LIMIT ${limitNum} OFFSET ${offset}`;
      const [sessions] = await pool.query(selectQuery, params);
      
      return res.json({
        sessions,
        total: parseInt(total, 10),
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(parseInt(total, 10) / limitNum)
      });
    }

    const [sessions] = await pool.query(selectQuery, params);
    res.json(sessions);
  } catch (error) {
    console.error('Fetch sessions error:', error);
    res.status(500).json({ message: `Error retrieving sessions: ${error.message}` });
  }
});

// GET /api/sessions/:id - Get single session
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [sessions] = await pool.query(`
      SELECT s.*, u.full_name AS created_by_name, enc.full_name AS assigned_encoder_name
      FROM sessions s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN users enc ON s.assigned_encoder_id = enc.id
      WHERE s.id = ?
    `, [id]);

    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const session = sessions[0];
    if (req.user.role === 'encoder') {
      if (session.assigned_encoder_id && session.assigned_encoder_id !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. You are not assigned to this session.' });
      }
    }

    res.json(session);
  } catch (error) {
    console.error('Fetch single session error:', error);
    res.status(500).json({ message: 'Error retrieving session' });
  }
});

// POST /api/sessions - Create new session (Admin & Super Admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { course_title, session_date, session_time, start_time, end_time, category, description, assigned_encoder_id } = req.body;

  if (!course_title || !session_date || (!session_time && !start_time) || !category) {
    return res.status(400).json({ 
      message: 'Required fields: course_title, session_date, category, start_time/end_time' 
    });
  }

  const sDate = session_date.trim();
  const sCategory = category.trim();
  let sStart = (start_time || '').trim();
  let sEnd = (end_time || '').trim();
  let sTime = (session_time || '').trim();
  const assignedEncoder = assigned_encoder_id ? parseInt(assigned_encoder_id, 10) : null;

  if (!sStart || !sEnd) {
    const parts = sTime.split('-');
    if (parts.length === 2) {
      sStart = parts[0].trim();
      sEnd = parts[1].trim();
    } else {
      sStart = sTime || '09:00';
      sEnd = sTime || '11:00';
    }
  }

  // Format 5-char HH:MM if needed
  if (sStart.length === 4 && sStart.includes(':')) sStart = '0' + sStart;
  if (sEnd.length === 4 && sEnd.includes(':')) sEnd = '0' + sEnd;

  if (!sTime) {
    sTime = `${sStart} - ${sEnd}`;
  }

  try {
    // True Time Interval Overlap Query:
    // Two intervals [S1, E1] and [S2, E2] overlap iff S1 < E2 AND E1 > S2
    const [existing] = await pool.query(`
      SELECT id, course_title, category, session_time, start_time, end_time FROM sessions 
      WHERE session_date = ? 
        AND (category = ? OR category = 'All' OR ? = 'All')
        AND COALESCE(start_time, session_time) < ? 
        AND COALESCE(end_time, session_time) > ?
      LIMIT 1
    `, [sDate, sCategory, sCategory, sEnd, sStart]);

    if (existing.length > 0) {
      const exTitle = existing[0].course_title;
      const exCat = existing[0].category;
      const exTime = existing[0].session_time || `${existing[0].start_time} - ${existing[0].end_time}`;
      return res.status(400).json({
        message: `Time Overlap Error: A session for category "${exCat}" already exists on ${sDate} from ${exTime} ("${exTitle}"). Overlapping time slots are not allowed.`
      });
    }

    const [result] = await pool.query(`
      INSERT INTO sessions (course_title, session_date, session_time, start_time, end_time, category, description, assigned_encoder_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `, [
      course_title.trim(),
      sDate,
      sTime,
      sStart,
      sEnd,
      sCategory,
      (description || '').trim(),
      assignedEncoder,
      req.user.id
    ]);

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'SESSION_CREATE',
      details: `Created session "${course_title.trim()}" for ${sCategory} on ${sDate} (${sTime})${assignedEncoder ? ` [Assigned Encoder ID: ${assignedEncoder}]` : ''}`,
      req
    });

    res.status(201).json({
      message: 'Session created successfully',
      sessionId: result.insertId
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ message: 'Error creating session' });
  }
});

// DELETE /api/sessions/:id - Delete session (Admin & Super Admin only; cannot delete if session has attendance unless Super Admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const [existing] = await pool.query('SELECT course_title, session_date, category FROM sessions WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Check if session has recorded attendance
    const [[attResult]] = await pool.query('SELECT COUNT(*) AS att_count FROM attendance WHERE session_id = ?', [id]);
    const attCount = parseInt(attResult?.att_count, 10) || 0;

    if (attCount > 0 && req.user.role !== 'super_admin') {
      return res.status(403).json({ 
        message: 'This session has recorded attendance data and cannot be deleted.' 
      });
    }

    const details = `Deleted session: "${existing[0].course_title}" (${existing[0].category}, ${existing[0].session_date})${attCount > 0 ? ` with ${attCount} attendance records removed` : ''}`;

    await pool.query('DELETE FROM sessions WHERE id = ?', [id]);

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'SESSION_DELETE',
      details,
      req
    });

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ message: 'Error deleting session' });
  }
});

module.exports = router;

