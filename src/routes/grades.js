const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/auditLogger');

// Helper to get pass mark setting for a given category, semester, and academic year
async function getPassMarkSetting(category, semester, academicYear) {
  try {
    // 1. Check exact match
    const [exact] = await pool.query(
      `SELECT pass_mark FROM grade_settings 
       WHERE category = ? AND semester = ? AND academic_year = ? LIMIT 1`,
      [category || 'all', semester || 'all', academicYear || '2017']
    );
    if (exact && exact.length > 0 && exact[0].pass_mark != null) {
      return parseFloat(exact[0].pass_mark);
    }

    // 2. Check category default
    const [catDefault] = await pool.query(
      `SELECT pass_mark FROM grade_settings 
       WHERE category = ? AND semester = 'all' LIMIT 1`,
      [category || 'all']
    );
    if (catDefault && catDefault.length > 0 && catDefault[0].pass_mark != null) {
      return parseFloat(catDefault[0].pass_mark);
    }

    // 3. Check global default
    const [globalDefault] = await pool.query(
      `SELECT pass_mark FROM grade_settings 
       WHERE category = 'all' LIMIT 1`
    );
    if (globalDefault && globalDefault.length > 0 && globalDefault[0].pass_mark != null) {
      return parseFloat(globalDefault[0].pass_mark);
    }
  } catch (err) {
    console.error('Error fetching pass mark setting:', err.message);
  }
  return 50.0; // Standard default 50%
}

// --------------------------------------------------------------------------
// 1. GET /api/grades/assessments - List assessments with grading progress
// --------------------------------------------------------------------------
router.get('/assessments', authenticateToken, async (req, res) => {
  try {
    const { category, semester, academic_year, search } = req.query;

    let sql = `
      SELECT 
        a.id, a.category, a.title, a.assessment_type, a.semester, a.academic_year,
        a.exam_date, a.max_score, a.weight, a.description, a.created_at,
        u.full_name AS creator_name,
        (SELECT COUNT(*) FROM students s WHERE s.category = a.category AND s.status = 'active') AS total_students,
        (SELECT COUNT(*) FROM student_grades sg 
         JOIN students s ON sg.student_id = s.id
         WHERE sg.assessment_id = a.id AND s.status = 'active' AND (sg.score IS NOT NULL OR sg.is_absent = TRUE)
        ) AS graded_students
      FROM assessments a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'all') {
      sql += ` AND a.category = ?`;
      params.push(category);
    }
    if (semester && semester !== 'all') {
      sql += ` AND a.semester = ?`;
      params.push(semester);
    }
    if (academic_year && academic_year !== 'all') {
      sql += ` AND a.academic_year = ?`;
      params.push(academic_year);
    }
    if (search && search.trim()) {
      sql += ` AND (LOWER(a.title) LIKE LOWER(?) OR LOWER(a.description) LIKE LOWER(?))`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ` ORDER BY a.exam_date DESC, a.id DESC`;

    const [assessments] = await pool.query(sql, params);
    res.json({ success: true, assessments });
  } catch (err) {
    console.error('Error listing assessments:', err);
    res.status(500).json({ message: 'Failed to retrieve assessments', error: err.message });
  }
});

// --------------------------------------------------------------------------
// 2. POST /api/grades/assessments - Create a new assessment
// --------------------------------------------------------------------------
router.post('/assessments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      category,
      title,
      assessment_type = 'exam',
      semester = 'Semester 1',
      academic_year = '2017',
      exam_date,
      max_score = 100,
      weight = 100,
      description = ''
    } = req.body;

    if (!category || !title || !exam_date) {
      return res.status(400).json({ message: 'Category, title, and exam date are required' });
    }

    const numWeight = parseFloat(weight);
    const numMaxScore = parseFloat(max_score);

    if (isNaN(numWeight) || numWeight <= 0 || numWeight > 100) {
      return res.status(400).json({ message: 'Weight must be a number between 1 and 100' });
    }
    if (isNaN(numMaxScore) || numMaxScore <= 0) {
      return res.status(400).json({ message: 'Max score must be greater than 0' });
    }

    const [result] = await pool.query(
      `INSERT INTO assessments 
        (category, title, assessment_type, semester, academic_year, exam_date, max_score, weight, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        category.trim(),
        title.trim(),
        assessment_type,
        semester,
        academic_year,
        exam_date,
        numMaxScore,
        numWeight,
        description.trim(),
        req.user?.id || null
      ]
    );

    const assessmentId = result[0]?.id || result.insertId;

    await logActivity({
      req,
      action: 'ASSESSMENT_CREATE',
      details: `Created assessment "${title}" for category "${category}" (Weight: ${numWeight}%, Date: ${exam_date})`
    });

    res.status(201).json({
      success: true,
      message: 'Assessment created successfully',
      assessment_id: assessmentId
    });
  } catch (err) {
    console.error('Error creating assessment:', err);
    res.status(500).json({ message: 'Failed to create assessment', error: err.message });
  }
});

// --------------------------------------------------------------------------
// 3. GET /api/grades/assessments/:id - Single assessment details
// --------------------------------------------------------------------------
router.get('/assessments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT a.*, u.full_name as creator_name 
       FROM assessments a 
       LEFT JOIN users u ON a.created_by = u.id 
       WHERE a.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    res.json({ success: true, assessment: rows[0] });
  } catch (err) {
    console.error('Error getting assessment:', err);
    res.status(500).json({ message: 'Failed to retrieve assessment', error: err.message });
  }
});

// --------------------------------------------------------------------------
// 4. PUT /api/grades/assessments/:id - Update assessment
// --------------------------------------------------------------------------
router.put('/assessments/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      category,
      title,
      assessment_type,
      semester,
      academic_year,
      exam_date,
      max_score,
      weight,
      description
    } = req.body;

    const [existing] = await pool.query('SELECT * FROM assessments WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    const numWeight = parseFloat(weight);
    const numMaxScore = parseFloat(max_score);

    if (isNaN(numWeight) || numWeight <= 0 || numWeight > 100) {
      return res.status(400).json({ message: 'Weight must be between 1 and 100' });
    }
    if (isNaN(numMaxScore) || numMaxScore <= 0) {
      return res.status(400).json({ message: 'Max score must be greater than 0' });
    }

    await pool.query(
      `UPDATE assessments SET
        category = ?,
        title = ?,
        assessment_type = ?,
        semester = ?,
        academic_year = ?,
        exam_date = ?,
        max_score = ?,
        weight = ?,
        description = ?
       WHERE id = ?`,
      [
        category.trim(),
        title.trim(),
        assessment_type,
        semester,
        academic_year,
        exam_date,
        numMaxScore,
        numWeight,
        description ? description.trim() : '',
        id
      ]
    );

    await logActivity({
      req,
      action: 'ASSESSMENT_UPDATE',
      details: `Updated assessment #${id} "${title}" (Weight: ${numWeight}%)`
    });

    res.json({ success: true, message: 'Assessment updated successfully' });
  } catch (err) {
    console.error('Error updating assessment:', err);
    res.status(500).json({ message: 'Failed to update assessment', error: err.message });
  }
});

// --------------------------------------------------------------------------
// 5. DELETE /api/grades/assessments/:id - Delete assessment
// --------------------------------------------------------------------------
router.delete('/assessments/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT title, category FROM assessments WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    await pool.query('DELETE FROM assessments WHERE id = ?', [id]);

    await logActivity({
      req,
      action: 'ASSESSMENT_DELETE',
      details: `Deleted assessment #${id} "${existing[0].title}" from category "${existing[0].category}"`
    });

    res.json({ success: true, message: 'Assessment deleted successfully' });
  } catch (err) {
    console.error('Error deleting assessment:', err);
    res.status(500).json({ message: 'Failed to delete assessment', error: err.message });
  }
});

// --------------------------------------------------------------------------
// 6. GET /api/grades/assessments/:id/roster - Get roster of students & marks
// --------------------------------------------------------------------------
router.get('/assessments/:id/roster', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [assessmentRows] = await pool.query('SELECT * FROM assessments WHERE id = ?', [id]);
    if (assessmentRows.length === 0) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    const assessment = assessmentRows[0];

    // Get all active students in the category + existing grades
    const [roster] = await pool.query(
      `SELECT 
        s.id AS student_id,
        s.first_name,
        s.father_name,
        s.mother_name,
        s.christian_name,
        s.phone,
        s.category,
        sg.id AS grade_id,
        sg.score,
        sg.is_absent,
        sg.remarks,
        sg.updated_at,
        u.full_name AS graded_by_name
       FROM students s
       LEFT JOIN student_grades sg ON s.id = sg.student_id AND sg.assessment_id = ?
       LEFT JOIN users u ON sg.graded_by = u.id
       WHERE s.category = ? AND s.status = 'active'
       ORDER BY s.father_name ASC, s.first_name ASC`,
      [id, assessment.category]
    );

    res.json({
      success: true,
      assessment,
      roster
    });
  } catch (err) {
    console.error('Error getting assessment roster:', err);
    res.status(500).json({ message: 'Failed to retrieve assessment roster', error: err.message });
  }
});

// --------------------------------------------------------------------------
// 7. POST /api/grades/assessments/:id/roster - Batch save grades for all students
// --------------------------------------------------------------------------
router.post('/assessments/:id/roster', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { grades } = req.body; // Array of { student_id, score, is_absent, remarks }

    if (!Array.isArray(grades)) {
      return res.status(400).json({ message: 'Grades must be provided as an array' });
    }

    const [assessmentRows] = await pool.query('SELECT * FROM assessments WHERE id = ?', [id]);
    if (assessmentRows.length === 0) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    const assessment = assessmentRows[0];
    const maxScore = parseFloat(assessment.max_score) || 100;

    let savedCount = 0;

    for (const item of grades) {
      const studentId = parseInt(item.student_id, 10);
      if (!studentId) continue;

      const isAbsent = Boolean(item.is_absent);
      let score = null;

      if (!isAbsent && item.score !== null && item.score !== undefined && item.score !== '') {
        const parsed = parseFloat(item.score);
        if (!isNaN(parsed)) {
          // Clamp score between 0 and max_score
          score = Math.max(0, Math.min(maxScore, parsed));
        }
      }

      const remarks = item.remarks ? String(item.remarks).trim() : '';

      await pool.query(
        `INSERT INTO student_grades (assessment_id, student_id, score, is_absent, remarks, graded_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (assessment_id, student_id)
         DO UPDATE SET
           score = EXCLUDED.score,
           is_absent = EXCLUDED.is_absent,
           remarks = EXCLUDED.remarks,
           graded_by = EXCLUDED.graded_by,
           updated_at = CURRENT_TIMESTAMP`,
        [id, studentId, score, isAbsent, remarks, req.user?.id || null]
      );
      savedCount++;
    }

    await logActivity({
      req,
      action: 'GRADES_RECORD',
      details: `Recorded/updated marks for ${savedCount} students in assessment "${assessment.title}" (${assessment.category})`
    });

    res.json({
      success: true,
      message: `Marks successfully saved for ${savedCount} students.`,
      saved_count: savedCount
    });
  } catch (err) {
    console.error('Error saving grades:', err);
    res.status(500).json({ message: 'Failed to save grades', error: err.message });
  }
});

// --------------------------------------------------------------------------
// 8. GET & POST /api/grades/settings - Manage Minimum Pass/Fail Threshold
// --------------------------------------------------------------------------
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const { category = 'all', semester = 'all', academic_year = '2017' } = req.query;
    const passMark = await getPassMarkSetting(category, semester, academic_year);

    const [allSettings] = await pool.query(
      `SELECT * FROM grade_settings ORDER BY category, semester, academic_year`
    );

    res.json({
      success: true,
      current_pass_mark: passMark,
      settings: allSettings
    });
  } catch (err) {
    console.error('Error getting grade settings:', err);
    res.status(500).json({ message: 'Failed to get grade settings', error: err.message });
  }
});

router.post('/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { category = 'all', semester = 'all', academic_year = '2017', pass_mark } = req.body;
    const numPassMark = parseFloat(pass_mark);

    if (isNaN(numPassMark) || numPassMark < 0 || numPassMark > 100) {
      return res.status(400).json({ message: 'Pass mark must be a valid percentage between 0 and 100' });
    }

    await pool.query(
      `INSERT INTO grade_settings (category, semester, academic_year, pass_mark, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (category, semester, academic_year)
       DO UPDATE SET
         pass_mark = EXCLUDED.pass_mark,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [category, semester, academic_year, numPassMark, req.user?.id || null]
    );

    await logActivity({
      req,
      action: 'GRADE_SETTINGS_UPDATE',
      details: `Updated passing mark to ${numPassMark}% (Category: ${category}, Semester: ${semester})`
    });

    res.json({
      success: true,
      message: `Passing score threshold set to ${numPassMark}%.`,
      pass_mark: numPassMark
    });
  } catch (err) {
    console.error('Error saving grade settings:', err);
    res.status(500).json({ message: 'Failed to save grade settings', error: err.message });
  }
});

// --------------------------------------------------------------------------
// 9. GET /api/grades/matrix - Category Semester Gradebook Matrix
// --------------------------------------------------------------------------
router.get('/matrix', authenticateToken, async (req, res) => {
  try {
    const { category, semester = 'Semester 1', academic_year = '2017' } = req.query;

    if (!category) {
      return res.status(400).json({ message: 'Category is required for gradebook matrix' });
    }

    const passMark = await getPassMarkSetting(category, semester, academic_year);

    // 1. Get assessments in this category & semester
    const [assessments] = await pool.query(
      `SELECT id, title, assessment_type, exam_date, max_score, weight 
       FROM assessments 
       WHERE category = ? AND semester = ? AND academic_year = ?
       ORDER BY exam_date ASC, id ASC`,
      [category, semester, academic_year]
    );

    // Calculate total possible assessment weights
    const totalWeights = assessments.reduce((acc, a) => acc + (parseFloat(a.weight) || 0), 0);

    // 2. Get all active students in this category
    const [students] = await pool.query(
      `SELECT id, first_name, father_name, mother_name, christian_name, phone
       FROM students 
       WHERE category = ? AND status = 'active'
       ORDER BY father_name ASC, first_name ASC`,
      [category]
    );

    // 3. Get all grade entries
    const assessmentIds = assessments.map(a => a.id);
    let grades = [];
    if (assessmentIds.length > 0) {
      const placeholders = assessmentIds.map(() => '?').join(',');
      const [gradeRows] = await pool.query(
        `SELECT assessment_id, student_id, score, is_absent, remarks 
         FROM student_grades 
         WHERE assessment_id IN (${placeholders})`,
        assessmentIds
      );
      grades = gradeRows;
    }

    // Map grades by student_id and assessment_id
    const gradeMap = new Map();
    grades.forEach(g => {
      const key = `${g.student_id}_${g.assessment_id}`;
      gradeMap.set(key, g);
    });

    // 4. Compute each student's gradebook row
    const matrixRows = students.map(st => {
      const studentAssessmentScores = {};
      let totalWeightedScore = 0;
      let hasAnyGrades = false;

      assessments.forEach(a => {
        const key = `${st.id}_${a.id}`;
        const g = gradeMap.get(key);
        const maxScore = parseFloat(a.max_score) || 100;
        const weight = parseFloat(a.weight) || 0;

        if (g && g.is_absent) {
          studentAssessmentScores[a.id] = {
            raw_score: null,
            weighted_score: 0,
            is_absent: true,
            remarks: g.remarks || ''
          };
          hasAnyGrades = true;
        } else if (g && g.score !== null && g.score !== undefined) {
          const rawScore = parseFloat(g.score);
          const weightedScore = (rawScore / maxScore) * weight;
          studentAssessmentScores[a.id] = {
            raw_score: rawScore,
            weighted_score: parseFloat(weightedScore.toFixed(2)),
            is_absent: false,
            remarks: g.remarks || ''
          };
          totalWeightedScore += weightedScore;
          hasAnyGrades = true;
        } else {
          studentAssessmentScores[a.id] = {
            raw_score: null,
            weighted_score: null,
            is_absent: false,
            remarks: ''
          };
        }
      });

      const finalScore = parseFloat(totalWeightedScore.toFixed(2));
      // Pass or Fail status (Strictly NO letter grades!)
      const passStatus = hasAnyGrades ? (finalScore >= passMark ? 'pass' : 'fail') : 'ungraded';

      return {
        student: st,
        scores: studentAssessmentScores,
        total_score: finalScore,
        pass_status: passStatus,
        has_grades: hasAnyGrades
      };
    });

    // 5. Compute ranks among students who have grades
    const gradedRows = matrixRows.filter(r => r.has_grades);
    gradedRows.sort((a, b) => b.total_score - a.total_score);

    gradedRows.forEach((row, idx) => {
      // If score is tied with previous, share rank
      if (idx > 0 && row.total_score === gradedRows[idx - 1].total_score) {
        row.rank = gradedRows[idx - 1].rank;
      } else {
        row.rank = idx + 1;
      }
    });

    // Set rank for matrix
    const finalMatrix = matrixRows.map(row => {
      const match = gradedRows.find(g => g.student.id === row.student.id);
      return {
        ...row,
        rank: match ? match.rank : '-'
      };
    });

    res.json({
      success: true,
      category,
      semester,
      academic_year,
      pass_mark: passMark,
      total_weights: totalWeights,
      assessments,
      matrix: finalMatrix
    });
  } catch (err) {
    console.error('Error generating grade matrix:', err);
    res.status(500).json({ message: 'Failed to generate grade matrix', error: err.message });
  }
});

// --------------------------------------------------------------------------
// 10. GET /api/grades/report-cards - Batch (or single) Report Cards for Print
// --------------------------------------------------------------------------
router.get('/report-cards', authenticateToken, async (req, res) => {
  try {
    const { category, semester = 'Semester 1', academic_year = '2017', student_id } = req.query;

    if (!category && !student_id) {
      return res.status(400).json({ message: 'Category or student_id is required' });
    }

    let targetCategory = category;
    if (student_id && !category) {
      const [st] = await pool.query('SELECT category FROM students WHERE id = ?', [student_id]);
      if (st.length > 0) targetCategory = st[0].category;
    }

    const passMark = await getPassMarkSetting(targetCategory, semester, academic_year);

    // 1. Get Assessments for this category & semester
    const [assessments] = await pool.query(
      `SELECT id, title, assessment_type, exam_date, max_score, weight, description
       FROM assessments
       WHERE category = ? AND semester = ? AND academic_year = ?
       ORDER BY exam_date ASC, id ASC`,
      [targetCategory, semester, academic_year]
    );

    const totalWeights = assessments.reduce((acc, a) => acc + (parseFloat(a.weight) || 0), 0);

    // 2. Get Target Students
    let studentSql = `
      SELECT id, first_name, father_name, mother_name, christian_name, age, phone, emergency_contact, category, profession
      FROM students
      WHERE status = 'active'
    `;
    const studentParams = [];

    if (student_id) {
      studentSql += ` AND id = ?`;
      studentParams.push(student_id);
    } else {
      studentSql += ` AND category = ?`;
      studentParams.push(targetCategory);
    }
    studentSql += ` ORDER BY father_name ASC, first_name ASC`;

    const [students] = await pool.query(studentSql, studentParams);

    // 3. Get all assessment grades for these students
    const assessmentIds = assessments.map(a => a.id);
    let gradeMap = new Map();
    if (assessmentIds.length > 0) {
      const placeholders = assessmentIds.map(() => '?').join(',');
      const [grades] = await pool.query(
        `SELECT assessment_id, student_id, score, is_absent, remarks 
         FROM student_grades 
         WHERE assessment_id IN (${placeholders})`,
        assessmentIds
      );
      grades.forEach(g => {
        gradeMap.set(`${g.student_id}_${g.assessment_id}`, g);
      });
    }

    // 4. Get Attendance Statistics per student in this semester/category
    const [attendanceRows] = await pool.query(
      `SELECT 
        a.student_id,
        COUNT(a.id) as total_marked,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present_count,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_count,
        SUM(CASE WHEN a.status = 'permission' THEN 1 ELSE 0 END) as permission_count
       FROM attendance a
       JOIN sessions s ON a.session_id = s.id
       WHERE s.category = ?
       GROUP BY a.student_id`,
      [targetCategory]
    );

    const attendanceMap = new Map();
    attendanceRows.forEach(att => {
      const total = parseInt(att.total_marked, 10) || 0;
      const present = parseInt(att.present_count, 10) || 0;
      const absent = parseInt(att.absent_count, 10) || 0;
      const permission = parseInt(att.permission_count, 10) || 0;
      const rate = total > 0 ? Math.round((present / total) * 100) : 0;
      attendanceMap.set(att.student_id, {
        total_sessions: total,
        present_count: present,
        absent_count: absent,
        permission_count: permission,
        rate_percentage: rate
      });
    });

    // 5. First pass: Calculate scores for rank calculation across the category
    const rankedList = students.map(st => {
      let totalWeightedScore = 0;
      let hasAnyGrades = false;

      assessments.forEach(a => {
        const g = gradeMap.get(`${st.id}_${a.id}`);
        const maxScore = parseFloat(a.max_score) || 100;
        const weight = parseFloat(a.weight) || 0;
        if (g && !g.is_absent && g.score !== null && g.score !== undefined) {
          const rawScore = parseFloat(g.score);
          totalWeightedScore += (rawScore / maxScore) * weight;
          hasAnyGrades = true;
        } else if (g && g.is_absent) {
          hasAnyGrades = true;
        }
      });

      return {
        student_id: st.id,
        total_score: parseFloat(totalWeightedScore.toFixed(2)),
        has_grades: hasAnyGrades
      };
    });

    const activeGraded = rankedList.filter(r => r.has_grades);
    activeGraded.sort((a, b) => b.total_score - a.total_score);
    activeGraded.forEach((r, idx) => {
      if (idx > 0 && r.total_score === activeGraded[idx - 1].total_score) {
        r.rank = activeGraded[idx - 1].rank;
      } else {
        r.rank = idx + 1;
      }
    });

    // 6. Build final report card objects for each student
    const reportCards = students.map(st => {
      let totalScore = 0;
      let totalGradedWeight = 0;
      let hasAnyGrades = false;

      const studentAssessments = assessments.map(a => {
        const g = gradeMap.get(`${st.id}_${a.id}`);
        const maxScore = parseFloat(a.max_score) || 100;
        const weight = parseFloat(a.weight) || 0;

        let scoreVal = null;
        let weightedVal = null;
        let isAbsent = false;
        let remarks = '';

        if (g) {
          isAbsent = Boolean(g.is_absent);
          remarks = g.remarks || '';
          if (!isAbsent && g.score !== null && g.score !== undefined) {
            scoreVal = parseFloat(g.score);
            weightedVal = parseFloat(((scoreVal / maxScore) * weight).toFixed(2));
            totalScore += weightedVal;
            totalGradedWeight += weight;
            hasAnyGrades = true;
          } else if (isAbsent) {
            scoreVal = 0;
            weightedVal = 0;
            hasAnyGrades = true;
          }
        }

        return {
          id: a.id,
          title: a.title,
          assessment_type: a.assessment_type,
          exam_date: a.exam_date,
          max_score: maxScore,
          weight: weight,
          raw_score: scoreVal,
          weighted_score: weightedVal,
          is_absent: isAbsent,
          remarks: remarks
        };
      });

      const finalTotalScore = parseFloat(totalScore.toFixed(2));
      const rankObj = activeGraded.find(r => r.student_id === st.id);
      const studentRank = rankObj ? rankObj.rank : '-';
      const passStatus = hasAnyGrades ? (finalTotalScore >= passMark ? 'pass' : 'fail') : 'ungraded';

      const attStats = attendanceMap.get(st.id) || {
        total_sessions: 0,
        present_count: 0,
        absent_count: 0,
        permission_count: 0,
        rate_percentage: 0
      };

      return {
        student: st,
        category: targetCategory,
        semester,
        academic_year,
        assessments: studentAssessments,
        summary: {
          total_score: finalTotalScore,
          total_possible_weights: totalWeights,
          pass_mark: passMark,
          pass_status: passStatus,
          rank: studentRank,
          total_students_in_class: students.length
        },
        attendance: attStats
      };
    });

    res.json({
      success: true,
      category: targetCategory,
      semester,
      academic_year,
      pass_mark: passMark,
      count: reportCards.length,
      report_cards: reportCards
    });
  } catch (err) {
    console.error('Error generating report cards:', err);
    res.status(500).json({ message: 'Failed to generate report cards', error: err.message });
  }
});

module.exports = router;
