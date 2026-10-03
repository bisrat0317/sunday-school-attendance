const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/auditLogger');

// GET /api/followups/student/:studentId - Get full follow-up history for a student
router.get('/student/:studentId', authenticateToken, async (req, res) => {
  const { studentId } = req.params;

  try {
    const [followups] = await pool.query(`
      SELECT 
        f.id,
        f.student_id,
        f.user_id,
        f.contact_date,
        f.contact_type,
        f.contacted_person,
        f.reason_category,
        f.notes,
        f.status,
        f.next_followup_date,
        f.created_at,
        u.full_name AS logged_by_name,
        u.username AS logged_by_username
      FROM pastoral_followups f
      LEFT JOIN users u ON f.user_id = u.id
      WHERE f.student_id = ?
      ORDER BY f.contact_date DESC, f.created_at DESC
    `, [studentId]);

    res.json(followups);
  } catch (error) {
    console.error('Fetch student follow-ups error:', error);
    res.status(500).json({ message: 'Error retrieving follow-up history' });
  }
});

// GET /api/followups/recent - Get latest pastoral follow-up activities
router.get('/recent', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [recent] = await pool.query(`
      SELECT 
        f.id,
        f.student_id,
        f.contact_date,
        f.contact_type,
        f.contacted_person,
        f.reason_category,
        f.notes,
        f.status,
        f.next_followup_date,
        f.created_at,
        s.first_name,
        s.father_name,
        s.category,
        s.phone,
        u.full_name AS logged_by_name
      FROM pastoral_followups f
      JOIN students s ON f.student_id = s.id
      LEFT JOIN users u ON f.user_id = u.id
      ORDER BY f.created_at DESC
      LIMIT 25
    `);

    res.json(recent);
  } catch (error) {
    console.error('Fetch recent follow-ups error:', error);
    res.status(500).json({ message: 'Error retrieving recent follow-ups' });
  }
});

// POST /api/followups - Create new pastoral follow-up log entry
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const {
    student_id,
    contact_date,
    contact_type,
    contacted_person,
    reason_category,
    notes,
    status,
    next_followup_date
  } = req.body;

  if (!student_id || !notes || notes.trim() === '') {
    return res.status(400).json({ message: 'Student ID and notes are required' });
  }

  try {
    // Verify student exists
    const [studentRows] = await pool.query('SELECT first_name, father_name, category FROM students WHERE id = ?', [student_id]);
    if (studentRows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }
    const student = studentRows[0];

    const cDate = contact_date ? contact_date : new Date().toISOString().split('T')[0];
    const cType = contact_type || 'phone_call';
    const cPerson = contacted_person || 'Parent';
    const rCategory = reason_category || '';
    const fStatus = status || 'contacted';
    const nextDate = next_followup_date ? next_followup_date : null;

    const [result] = await pool.query(`
      INSERT INTO pastoral_followups (
        student_id, user_id, contact_date, contact_type, contacted_person,
        reason_category, notes, status, next_followup_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `, [
      student_id,
      req.user.id,
      cDate,
      cType,
      cPerson,
      rCategory,
      notes.trim(),
      fStatus,
      nextDate
    ]);

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'PASTORAL_FOLLOWUP',
      details: `Logged follow-up for ${student.first_name} ${student.father_name} (${student.category}): Status -> ${fStatus}, Reason -> ${rCategory || 'N/A'}`,
      req
    });

    res.status(201).json({
      message: 'Pastoral follow-up logged successfully',
      followupId: result.insertId
    });
  } catch (error) {
    console.error('Create follow-up error:', error);
    res.status(500).json({ message: 'Error recording pastoral follow-up' });
  }
});

// PATCH /api/followups/:id/status - Update follow-up status (e.g. resolved, contacted)
router.patch('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  if (!status) {
    return res.status(400).json({ message: 'Status is required' });
  }

  try {
    if (notes) {
      await pool.query('UPDATE pastoral_followups SET status = ?, notes = ? WHERE id = ?', [status, notes.trim(), id]);
    } else {
      await pool.query('UPDATE pastoral_followups SET status = ? WHERE id = ?', [status, id]);
    }

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'FOLLOWUP_STATUS',
      details: `Updated follow-up ID ${id} status to ${status}`,
      req
    });

    res.json({ message: 'Follow-up status updated successfully' });
  } catch (error) {
    console.error('Update follow-up status error:', error);
    res.status(500).json({ message: 'Error updating follow-up status' });
  }
});

// DELETE /api/followups/:id - Delete follow-up entry
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM pastoral_followups WHERE id = ?', [id]);
    res.json({ message: 'Follow-up entry deleted successfully' });
  } catch (error) {
    console.error('Delete follow-up error:', error);
    res.status(500).json({ message: 'Error deleting follow-up entry' });
  }
});

module.exports = router;
