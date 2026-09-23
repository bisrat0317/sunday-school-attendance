const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/students - List students with optional search, category, and status filters
router.get('/', authenticateToken, async (req, res) => {
  const { category, status, search } = req.query;

  try {
    let query = `
      SELECT 
        s.*,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN a.status = 'permission' THEN 1 END) AS permission_count,
        COUNT(a.id) AS total_sessions_attended
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'All') {
      query += ' AND s.category = ?';
      params.push(category);
    }

    if (status && status !== 'All') {
      query += ' AND s.status = ?';
      params.push(status);
    }

    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      query += ' AND (s.first_name LIKE ? OR s.father_name LIKE ? OR s.mother_name LIKE ? OR s.phone LIKE ? OR s.emergency_contact LIKE ?)';
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ' GROUP BY s.id ORDER BY s.first_name ASC';

    const [students] = await pool.query(query, params);
    res.json(students);
  } catch (error) {
    console.error('Fetch students error:', error);
    res.status(500).json({ message: 'Error retrieving students' });
  }
});

// GET /api/students/:id - Get student details & full attendance timeline
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [students] = await pool.query('SELECT * FROM students WHERE id = ?', [id]);
    if (students.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Get attendance history
    const [history] = await pool.query(`
      SELECT 
        a.id AS attendance_id,
        a.status,
        a.remarks,
        a.timestamp,
        s.course_title,
        s.session_date,
        s.session_time,
        s.category
      FROM attendance a
      JOIN sessions s ON a.session_id = s.id
      WHERE a.student_id = ?
      ORDER BY s.session_date DESC, s.session_time DESC
    `, [id]);

    res.json({
      student: students[0],
      history
    });
  } catch (error) {
    console.error('Fetch student details error:', error);
    res.status(500).json({ message: 'Error retrieving student details' });
  }
});

// POST /api/students - Register new student (Encoder & Admin)
router.post('/', authenticateToken, async (req, res) => {
  const {
    first_name,
    father_name,
    mother_name,
    age,
    phone,
    emergency_contact,
    profession,
    previous_service,
    category
  } = req.body;

  if (!first_name || !father_name || !mother_name || !phone || !category) {
    return res.status(400).json({ 
      message: 'Required fields: first_name, father_name, mother_name, phone, category' 
    });
  }

  try {
    const [result] = await pool.query(`
      INSERT INTO students (
        first_name, father_name, mother_name, age, phone, 
        emergency_contact, profession, previous_service, category, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `, [
      first_name.trim(),
      father_name.trim(),
      mother_name.trim(),
      parseInt(age, 10) || 0,
      phone.trim(),
      (emergency_contact || '').trim(),
      (profession || '').trim(),
      (previous_service || '').trim(),
      category.trim()
    ]);

    res.status(201).json({
      message: 'Student registered successfully',
      studentId: result.insertId
    });
  } catch (error) {
    console.error('Register student error:', error);
    res.status(500).json({ message: 'Error registering student' });
  }
});

// PUT /api/students/:id - Update student information
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const {
    first_name,
    father_name,
    mother_name,
    age,
    phone,
    emergency_contact,
    profession,
    previous_service,
    category,
    status
  } = req.body;

  try {
    await pool.query(`
      UPDATE students SET 
        first_name = ?, father_name = ?, mother_name = ?, age = ?, phone = ?,
        emergency_contact = ?, profession = ?, previous_service = ?, category = ?, status = ?
      WHERE id = ?
    `, [
      first_name,
      father_name,
      mother_name,
      parseInt(age, 10) || 0,
      phone,
      emergency_contact || '',
      profession || '',
      previous_service || '',
      category,
      status || 'active',
      id
    ]);

    res.json({ message: 'Student updated successfully' });
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ message: 'Error updating student' });
  }
});

// PATCH /api/students/:id/status - Toggle active/inactive
router.patch('/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ message: 'Status must be active or inactive' });
  }

  try {
    await pool.query('UPDATE students SET status = ? WHERE id = ?', [status, id]);
    res.json({ message: `Student status set to ${status}` });
  } catch (error) {
    console.error('Status change error:', error);
    res.status(500).json({ message: 'Error changing status' });
  }
});

// DELETE /api/students/:id - Delete student (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM students WHERE id = ?', [id]);
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ message: 'Error deleting student' });
  }
});

module.exports = router;

