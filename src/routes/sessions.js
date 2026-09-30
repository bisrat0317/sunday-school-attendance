const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/sessions - List sessions with attendance summary
router.get('/', authenticateToken, async (req, res) => {
  const { category } = req.query;

  try {
    let query = `
      SELECT 
        s.id,
        s.course_title,
        s.session_date,
        s.session_time,
        s.category,
        s.description,
        s.created_by,
        s.created_at,
        u.full_name AS created_by_name,
        COALESCE(att.present_count, 0) AS present_count,
        COALESCE(att.absent_count, 0) AS absent_count,
        COALESCE(att.permission_count, 0) AS permission_count,
        COALESCE(att.total_marked, 0) AS total_marked
      FROM sessions s
      LEFT JOIN users u ON s.created_by = u.id
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

    if (category && category !== 'All') {
      query += " AND (s.category = ? OR s.category = 'All')";
      params.push(category);
    }

    query += ' ORDER BY s.session_date DESC, s.session_time DESC';

    const [sessions] = await pool.query(query, params);
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
      SELECT s.*, u.full_name AS created_by_name
      FROM sessions s
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.id = ?
    `, [id]);

    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    res.json(sessions[0]);
  } catch (error) {
    console.error('Fetch single session error:', error);
    res.status(500).json({ message: 'Error retrieving session' });
  }
});

// POST /api/sessions - Create new session (Encoder & Admin)
router.post('/', authenticateToken, async (req, res) => {
  const { course_title, session_date, session_time, start_time, end_time, category, description } = req.body;

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
      INSERT INTO sessions (course_title, session_date, session_time, start_time, end_time, category, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `, [
      course_title.trim(),
      sDate,
      sTime,
      sStart,
      sEnd,
      sCategory,
      (description || '').trim(),
      req.user.id
    ]);

    res.status(201).json({
      message: 'Session created successfully',
      sessionId: result.insertId
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ message: 'Error creating session' });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM sessions WHERE id = ?', [id]);
    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ message: 'Error deleting session' });
  }
});

module.exports = router;

