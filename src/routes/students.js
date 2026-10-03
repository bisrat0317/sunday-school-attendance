const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/auditLogger');

// GET /api/students/families/overview - Group students into family clusters
router.get('/families/overview', authenticateToken, async (req, res) => {
  try {
    const [allStudents] = await pool.query(`
      SELECT s.id, s.first_name, s.father_name, s.mother_name, s.christian_name, s.age, s.category, s.status, s.phone, s.emergency_contact, s.profession
      FROM students s
      ORDER BY s.father_name ASC, s.first_name ASC
    `);

    // Group into family clusters
    const familyMap = new Map();

    allStudents.forEach(st => {
      const f = (st.father_name || '').trim();
      const m = (st.mother_name || '').trim();
      const em = (st.emergency_contact || '').trim();
      
      let key = null;
      if (f && m) {
        key = `parents:${f.toLowerCase()}::${m.toLowerCase()}`;
      } else if (em && em.length >= 8) {
        key = `em:${em}`;
      } else if (f) {
        key = `father:${f.toLowerCase()}`;
      } else {
        key = `single:${st.id}`;
      }

      if (!familyMap.has(key)) {
        familyMap.set(key, {
          family_key: key,
          father_name: f,
          mother_name: m,
          phone: st.phone || '',
          emergency_contact: em,
          students: []
        });
      }

      const fam = familyMap.get(key);
      fam.students.push(st);
      if (!fam.phone && st.phone) fam.phone = st.phone;
      if (!fam.emergency_contact && em) fam.emergency_contact = em;
      if (!fam.mother_name && m) fam.mother_name = m;
    });

    const families = Array.from(familyMap.values()).map(fam => ({
      ...fam,
      students_count: fam.students.length
    }));

    // Sort: multi-child families first, then alphabetically by father name
    families.sort((a, b) => {
      if (b.students_count !== a.students_count) {
        return b.students_count - a.students_count;
      }
      return (a.father_name || '').localeCompare(b.father_name || '');
    });

    res.json({
      total_families: families.length,
      multi_child_families: families.filter(f => f.students_count > 1).length,
      families
    });
  } catch (error) {
    console.error('Fetch families error:', error);
    res.status(500).json({ message: 'Error retrieving family groups' });
  }
});

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

    // Query all students father/mother/emergency contact for sibling count mapping
    const [allSummary] = await pool.query('SELECT id, father_name, mother_name, emergency_contact FROM students');
    const parentMap = new Map();
    const emContactMap = new Map();

    allSummary.forEach(st => {
      const f = (st.father_name || '').trim().toLowerCase();
      const m = (st.mother_name || '').trim().toLowerCase();
      if (f && m) {
        const k = `${f}::${m}`;
        parentMap.set(k, (parentMap.get(k) || 0) + 1);
      }
      const em = (st.emergency_contact || '').trim();
      if (em && em.length >= 8) {
        emContactMap.set(em, (emContactMap.get(em) || 0) + 1);
      }
    });

    function annotateSiblings(list) {
      list.forEach(st => {
        const f = (st.father_name || '').trim().toLowerCase();
        const m = (st.mother_name || '').trim().toLowerCase();
        const em = (st.emergency_contact || '').trim();
        let count = 0;
        if (f && m && parentMap.has(`${f}::${m}`)) {
          count = Math.max(count, parentMap.get(`${f}::${m}`) - 1);
        }
        if (em && em.length >= 8 && emContactMap.has(em)) {
          count = Math.max(count, emContactMap.get(em) - 1);
        }
        st.sibling_count = count;
      });
    }

    if (limit && !isNaN(parseInt(limit, 10))) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10)));
      const offset = (pageNum - 1) * limitNum;

      const countParams = [...params];
      const [[{ total }]] = await pool.query(`SELECT COUNT(s.id) AS total FROM students s ${whereClause}`, countParams);

      query += ` LIMIT ${limitNum} OFFSET ${offset}`;
      const [students] = await pool.query(query, params);
      annotateSiblings(students);

      return res.json({
        students,
        total: parseInt(total, 10),
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(parseInt(total, 10) / limitNum)
      });
    }

    const [students] = await pool.query(query, params);
    annotateSiblings(students);
    res.json(students);
  } catch (error) {
    console.error('Fetch students error:', error);
    res.status(500).json({ message: 'Error retrieving students' });
  }
});

// GET /api/students/:id - Get student details, full attendance timeline, and siblings
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [students] = await pool.query('SELECT * FROM students WHERE id = ?', [id]);
    if (students.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const s = students[0];

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

    // Find siblings belonging to the same family
    let siblings = [];
    const conditions = [];
    const siblingParams = [id];

    if (s.father_name && s.mother_name && s.mother_name.trim() !== '') {
      conditions.push(`(LOWER(TRIM(father_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(mother_name)) = LOWER(TRIM(?)))`);
      siblingParams.push(s.father_name.trim(), s.mother_name.trim());
    }

    if (s.emergency_contact && s.emergency_contact.trim().length >= 8) {
      conditions.push(`emergency_contact = ?`);
      siblingParams.push(s.emergency_contact.trim());
    }

    if (conditions.length > 0) {
      const [siblingResult] = await pool.query(`
        SELECT id, first_name, father_name, mother_name, christian_name, age, category, status, phone, emergency_contact, profession
        FROM students
        WHERE id != ? AND (${conditions.join(' OR ')})
        ORDER BY first_name ASC
      `, siblingParams);
      siblings = siblingResult;
    }

    res.json({
      student: s,
      history,
      siblings
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

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'STUDENT_CREATE',
      details: `Registered new student: ${first_name.trim()} ${father_name.trim()} (${category.trim()})`,
      req
    });

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

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'BULK_IMPORT',
      details: `Bulk imported ${importedCount} student(s) from Excel/CSV`,
      req
    });

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

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'STUDENT_UPDATE',
      details: `Updated student ID ${id}: ${first_name} ${father_name}`,
      req
    });

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

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'STUDENT_STATUS',
      details: `Changed student ID ${id} status to ${status}`,
      req
    });

    res.json({ message: `Student status set to ${status}` });
  } catch (error) {
    console.error('Status change error:', error);
    res.status(500).json({ message: 'Error changing status' });
  }
});

// POST /api/students/promote/batch - Batch promote or graduate selected students
router.post('/promote/batch', authenticateToken, requireAdmin, async (req, res) => {
  const {
    student_ids,
    from_category,
    to_category,
    action_type = 'promote',
    notes = ''
  } = req.body;

  if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
    return res.status(400).json({ message: 'A non-empty list of student IDs is required' });
  }

  if (action_type === 'promote' && (!to_category || to_category.trim() === '')) {
    return res.status(400).json({ message: 'Target category is required for promotion' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let updatedCount = 0;
    const targetCat = action_type === 'graduate' ? (from_category || 'Graduated') : to_category.trim();
    const targetStatus = action_type === 'graduate' ? 'graduated' : 'active';

    for (const sid of student_ids) {
      // Get current student status & category
      const [currRows] = await conn.query('SELECT id, category, status FROM students WHERE id = ?', [sid]);
      if (currRows.length === 0) continue;
      const current = currRows[0];

      if (action_type === 'graduate') {
        await conn.query('UPDATE students SET status = ? WHERE id = ?', ['graduated', sid]);
      } else {
        await conn.query('UPDATE students SET category = ?, status = ? WHERE id = ?', [targetCat, targetStatus, sid]);
      }

      await conn.query(`
        INSERT INTO student_promotions (
          student_id, from_category, to_category, from_status, to_status, promoted_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        sid,
        current.category || from_category || 'Uncategorized',
        targetCat,
        current.status,
        targetStatus,
        req.user.id,
        notes.trim()
      ]);

      updatedCount++;
    }

    await conn.commit();

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: action_type === 'graduate' ? 'STUDENT_GRADUATION' : 'STUDENT_PROMOTION',
      details: `${action_type === 'graduate' ? 'Graduated' : 'Promoted'} ${updatedCount} student(s) from "${from_category || 'Various'}" to "${targetCat}"`,
      req
    });

    res.json({
      message: `Successfully ${action_type === 'graduate' ? 'graduated' : 'promoted'} ${updatedCount} student(s).`,
      promotedCount: updatedCount,
      targetCategory: targetCat
    });
  } catch (error) {
    await conn.rollback();
    console.error('Promotion error:', error);
    res.status(500).json({ message: 'Error processing student promotion / graduation' });
  } finally {
    conn.release();
  }
});

// GET /api/students/promotions/history - View past promotion and graduation logs
router.get('/promotions/history', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [history] = await pool.query(`
      SELECT 
        p.id,
        p.student_id,
        p.from_category,
        p.to_category,
        p.from_status,
        p.to_status,
        p.promotion_date,
        p.notes,
        p.created_at,
        s.first_name,
        s.father_name,
        s.phone,
        u.full_name AS promoted_by_name
      FROM student_promotions p
      JOIN students s ON p.student_id = s.id
      LEFT JOIN users u ON p.promoted_by = u.id
      ORDER BY p.created_at DESC
      LIMIT 100
    `);

    res.json(history);
  } catch (error) {
    console.error('Promotion history error:', error);
    res.status(500).json({ message: 'Error retrieving promotion history' });
  }
});

// DELETE /api/students/:id - Delete student (Super Admin only)
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await pool.query('SELECT first_name, father_name FROM students WHERE id = ?', [id]);
    const name = existing[0] ? `${existing[0].first_name} ${existing[0].father_name}` : `ID ${id}`;

    await pool.query('DELETE FROM students WHERE id = ?', [id]);

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'STUDENT_DELETE',
      details: `Deleted student: ${name}`,
      req
    });

    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ message: 'Error deleting student' });
  }
});

module.exports = router;


