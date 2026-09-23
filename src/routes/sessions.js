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
        s.*,
        u.full_name AS created_by_name,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN a.status = 'permission' THEN 1 END) AS permission_count,
        COUNT(a.id) AS total_marked
      FROM sessions s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN attendance a ON s.id = a.session_id
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'All') {
      query += ' AND (s.category = ? OR s.category = "All")';
      params.push(category);
    }

    query += ' GROUP BY s.id ORDER BY s.session_date DESC, s.session_time DESC';

    const [sessions] = await pool.query(query, params);
    res.json(sessions);
  } catch (error) {
    console.error('Fetch sessions error:', error);
    res.status(500).json({ message: 'Error retrieving sessions' });
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
  const { course_title, session_date, session_time, category, description } = req.body;

  if (!course_title || !session_date || !session_time || !category) {
    return res.status(400).json({ 
      message: 'Required fields: course_title, session_date, session_time, category' 
    });
  }

  try {
    const [result] = await pool.query(`
      INSERT INTO sessions (course_title, session_date, session_time, category, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      course_title.trim(),
      session_date,
      session_time.trim(),
      category.trim(),
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

