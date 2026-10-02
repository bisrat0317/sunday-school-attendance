const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin, requireSuperAdmin } = require('../middleware/auth');

// GET /api/students - List students with optional search, category, status, profession, education_level, and pagination
router.get('/', authenticateToken, async (req, res) => {
  const { category, status, profession, education_level, search, page, limit } = req.query;

  try {
    let whereClause = ' WHERE 1=1';
    const params = [];

    if (category && category !== 'All') {
      whereClause += ' AND s.category = ?';
      params.push(category);
    }

    if (status && status !== 'All') {
      whereClause += ' AND s.status = ?';
      params.push(status);
    }

    if (profession && profession !== 'All') {
      if (profession === 'Student') {
        whereClause += " AND s.profession LIKE 'Student%'";
      } else if (profession === 'Worker' || profession === 'Employee') {
        whereClause += " AND (s.profession = 'Worker' OR s.profession = 'Employee' OR s.profession = 'Employed')";
      } else if (profession === 'Other') {
        whereClause += " AND s.profession != '' AND s.profession NOT LIKE 'Student%' AND s.profession != 'Worker' AND s.profession != 'Employee' AND s.profession != 'Employed'";
      } else if (profession === 'Incomplete') {
        whereClause += " AND (s.phone IS NULL OR s.phone = '' OR s.category IS NULL OR s.category = '' OR s.category = 'All' OR s.age IS NULL OR s.age = 0 OR s.profession IS NULL OR s.profession = '')";
      }
    }

    if (education_level && education_level !== 'All') {
      whereClause += ' AND s.profession LIKE ?';
      params.push(`%${education_level}%`);
    }

    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      whereClause += ' AND (s.first_name ILIKE ? OR s.father_name ILIKE ? OR s.mother_name ILIKE ? OR s.christian_name ILIKE ? OR s.phone LIKE ? OR s.emergency_contact LIKE ?)';
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    let query = `
      SELECT 
        s.*,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN a.status = 'permission' THEN 1 END) AS permission_count,
        COUNT(a.id) AS total_sessions_attended
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id
      ${whereClause}
      GROUP BY s.id
      ORDER BY s.first_name ASC
    `;

    if (limit && !isNaN(parseInt(limit, 10))) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10)));
      const offset = (pageNum - 1) * limitNum;

      const countParams = [...params];
      const [[{ total }]] = await pool.query(`SELECT COUNT(s.id) AS total FROM students s ${whereClause}`, countParams);

      query += ` LIMIT ${limitNum} OFFSET ${offset}`;
      const [students] = await pool.query(query, params);

      return res.json({
        students,
        total: parseInt(total, 10),
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(parseInt(total, 10) / limitNum)
      });
    }

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
    christian_name,
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
        first_name, father_name, mother_name, christian_name, age, phone, 
        emergency_contact, profession, previous_service, category, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active') RETURNING id
    `, [
      first_name.trim(),
      father_name.trim(),
      mother_name.trim(),
      (christian_name || '').trim(),
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

// POST /api/students/bulk-import - Bulk import students (Excel/CSV - Super Admin Only)
router.post('/bulk-import', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { students } = req.body;

  if (!students || !Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ message: 'A non-empty array of students is required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let importedCount = 0;
    const errors = [];

    const insertSql = `
      INSERT INTO students (
        first_name, father_name, mother_name, christian_name, age, phone, 
        emergency_contact, profession, previous_service, category, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      const firstName = (s.first_name || '').trim();
      const fatherName = (s.father_name || '').trim();

      // Skip test/template dummy rows so template cannot be imported accidentally
      const lowerFirst = firstName.toLowerCase();
      const lowerFather = fatherName.toLowerCase();
      const isTestRow = ['test', 'sample', 'የሙከራ', 'ሙከራ'].includes(lowerFirst) ||
                        ['test', 'sample', 'የሙከራ', 'ሙከራ'].includes(lowerFather) ||
                        (lowerFirst.includes('test') && lowerFather.includes('test'));

      if (isTestRow) {
        continue;
      }

      if (!firstName || !fatherName) {
        errors.push(`Row #${i + 1}: First Name and Father's Name are required.`);
        continue;
      }

      const motherName = (s.mother_name || '').trim();
      const christianName = (s.christian_name || '').trim();
      const phone = (s.phone || '').trim();
      const category = (s.category || '').trim();
      
      let age = null;
      if (s.age !== undefined && s.age !== null && String(s.age).trim() !== '') {
        const parsedAge = parseInt(s.age, 10);
        if (!isNaN(parsedAge) && parsedAge > 0) {
          age = parsedAge;
        }
      }

      const emergency = (s.emergency_contact || '').trim();
      const profession = (s.profession || '').trim();
      const prevService = (s.previous_service || '').trim();
      const status = s.status === 'inactive' ? 'inactive' : 'active';

      await conn.query(insertSql, [
        firstName,
        fatherName,
        motherName,
        christianName,
        age,
        phone,
        emergency,
        profession,
        prevService,
        category,
        status
      ]);
      importedCount++;
    }

    await conn.commit();

    res.json({
      message: `Successfully imported ${importedCount} student(s).`,
      importedCount,
      errors
    });
  } catch (error) {
    await conn.rollback();
    console.error('Bulk import error:', error);
    res.status(500).json({ message: `Error during bulk import: ${error.message}` });
  } finally {
    conn.release();
  }
});

// PUT /api/students/:id - Update student information
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const {
    first_name,
    father_name,
    mother_name,
    christian_name,
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
        first_name = ?, father_name = ?, mother_name = ?, christian_name = ?, age = ?, phone = ?,
        emergency_contact = ?, profession = ?, previous_service = ?, category = ?, status = ?
      WHERE id = ?
    `, [
      first_name,
      father_name,
      mother_name,
      christian_name || '',
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

// DELETE /api/students/:id - Delete student (Super Admin only)
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
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

