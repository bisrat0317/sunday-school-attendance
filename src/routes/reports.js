const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/reports/dashboard - Overview statistics for Admin
router.get('/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // 1. Student counts
    const [[studentCounts]] = await pool.query(`
      SELECT 
        COUNT(*) AS total_students,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_students,
        COUNT(CASE WHEN status = 'inactive' THEN 1 END) AS inactive_students
      FROM students
    `);

    // 2. Category distribution
    const [categoryCounts] = await pool.query(`
      SELECT category, COUNT(*) as count 
      FROM students 
      WHERE status = 'active'
      GROUP BY category
    `);

    // 3. Sessions summary
    const [[sessionCounts]] = await pool.query(`
      SELECT COUNT(*) AS total_sessions FROM sessions
    `);

    // 4. Overall attendance rates
    const [[attendanceTotals]] = await pool.query(`
      SELECT 
        COUNT(*) AS total_records,
        COUNT(CASE WHEN status = 'present' THEN 1 END) AS total_present,
        COUNT(CASE WHEN status = 'absent' THEN 1 END) AS total_absent,
        COUNT(CASE WHEN status = 'permission' THEN 1 END) AS total_permission
      FROM attendance
    `);

    // 5. Recent 5 sessions with stats
    const [recentSessions] = await pool.query(`
      SELECT 
        s.id,
        s.course_title,
        s.session_date,
        s.session_time,
        s.category,
        COALESCE(att.present_count, 0) AS present_count,
        COALESCE(att.absent_count, 0) AS absent_count,
        COALESCE(att.permission_count, 0) AS permission_count,
        COALESCE(att.total_marked, 0) AS total_marked
      FROM sessions s
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
      ORDER BY s.session_date DESC, s.session_time DESC
      LIMIT 5
    `);

    res.json({
      students: studentCounts,
      categories: categoryCounts,
      total_sessions: sessionCounts.total_sessions,
      attendanceTotals,
      recentSessions
    });
  } catch (error) {
    console.error('Dashboard report error:', error);
    res.status(500).json({ message: 'Error generating dashboard report' });
  }
});

// GET /api/reports/three-absents - Students with 3 consecutive straight absences
router.get('/three-absents', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // For each active student, examine their daily attendance status across all sessions for their most recent 3 session dates.
    // If a student was marked present in any session on a date (e.g. cross-category session), their daily status is 'present'.
    // If all 3 most recent session dates have daily status = 'absent', flag them.
    const [flaggedStudents] = await pool.query(`
      SELECT 
        s.id AS student_id,
        s.first_name,
        s.father_name,
        s.mother_name,
        s.phone,
        s.emergency_contact,
        s.category,
        s.profession,
        recent.absent_count,
        recent.last_absent_date,
        last_present.last_present_date
      FROM students s
      INNER JOIN (
        -- Get students whose last 3 distinct session dates all have daily status = 'absent'
        SELECT 
          att_ranked.student_id,
          COUNT(*) AS absent_count,
          MAX(att_ranked.session_date) AS last_absent_date
        FROM (
          SELECT 
            daily.student_id,
            daily.session_date,
            daily.daily_status,
            ROW_NUMBER() OVER (PARTITION BY daily.student_id ORDER BY daily.session_date DESC, daily.max_id DESC) as rn
          FROM (
            SELECT 
              a.student_id,
              sess.session_date,
              MAX(a.id) AS max_id,
              CASE 
                WHEN COUNT(CASE WHEN a.status = 'present' THEN 1 END) > 0 THEN 'present'
                WHEN COUNT(CASE WHEN a.status = 'permission' THEN 1 END) > 0 THEN 'permission'
                ELSE 'absent'
              END AS daily_status
            FROM attendance a
            JOIN sessions sess ON a.session_id = sess.id
            GROUP BY a.student_id, sess.session_date
          ) daily
        ) att_ranked
        WHERE att_ranked.rn <= 3 AND att_ranked.daily_status = 'absent'
        GROUP BY att_ranked.student_id
        HAVING COUNT(*) >= 3
      ) recent ON s.id = recent.student_id
      LEFT JOIN (
        -- Find their last known 'present' session date across all sessions
        SELECT 
          a.student_id,
          MAX(sess.session_date) AS last_present_date
        FROM attendance a
        JOIN sessions sess ON a.session_id = sess.id
        WHERE a.status = 'present'
        GROUP BY a.student_id
      ) last_present ON s.id = last_present.student_id
      WHERE s.status = 'active'
      ORDER BY recent.last_absent_date DESC
    `);

    res.json(flaggedStudents);
  } catch (error) {
    console.error('Three absents report error:', error);
    res.status(500).json({ message: 'Error detecting 3-straight absent students' });
  }
});

// GET /api/reports/inactive-students - List of inactive students or disengaged students
router.get('/inactive-students', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [inactiveList] = await pool.query(`
      SELECT 
        s.id,
        s.first_name,
        s.father_name,
        s.mother_name,
        s.age,
        s.phone,
        s.emergency_contact,
        s.profession,
        s.previous_service,
        s.category,
        s.status,
        s.created_at,
        COALESCE(att.total_present, 0) AS total_present,
        COALESCE(att.total_absent, 0) AS total_absent,
        att.last_attended_date
      FROM students s
      LEFT JOIN (
        SELECT 
          a.student_id,
          COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS total_present,
          COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS total_absent,
          MAX(CASE WHEN a.status = 'present' THEN sess.session_date END) AS last_attended_date
        FROM attendance a
        JOIN sessions sess ON a.session_id = sess.id
        GROUP BY a.student_id
      ) att ON s.id = att.student_id
      WHERE s.status = 'inactive'
      ORDER BY s.first_name ASC
    `);

    res.json(inactiveList);
  } catch (error) {
    console.error('Inactive students report error:', error);
    res.status(500).json({ message: 'Error retrieving inactive students' });
  }
});

// GET /api/reports/master-attendance-matrix - Multi-sheet attendance register query
router.get('/master-attendance-matrix', authenticateToken, async (req, res) => {
  try {
    const [categories] = await pool.query("SELECT DISTINCT category FROM students WHERE status = 'active' ORDER BY category ASC");
    const [students] = await pool.query("SELECT id, first_name, father_name, mother_name, phone, category FROM students WHERE status = 'active' ORDER BY first_name ASC, father_name ASC");
    const [sessions] = await pool.query('SELECT id, course_title, session_date, session_time, category FROM sessions ORDER BY session_date ASC, session_time ASC');
    const [attendance] = await pool.query(`
      SELECT 
        a.session_id, 
        a.student_id, 
        a.status, 
        a.remarks,
        sess.session_date,
        sess.category AS session_category,
        sess.course_title
      FROM attendance a
      JOIN sessions sess ON a.session_id = sess.id
    `);

    res.json({
      categories: categories.map(c => c.category),
      students,
      sessions,
      attendance
    });
  } catch (error) {
    console.error('Master matrix report error:', error);
    res.status(500).json({ message: 'Error generating master matrix report' });
  }
});

// GET /api/reports/category-matrix - Single Category Matrix with Student Registration Date
router.get('/category-matrix', authenticateToken, async (req, res) => {
  const { category } = req.query;
  const targetCategory = category || 'Youth';

  try {
    let studentQuery = "SELECT id, first_name, father_name, mother_name, phone, emergency_contact, category, created_at FROM students WHERE status = 'active'";
    const studentParams = [];

    if (targetCategory !== 'All') {
      studentQuery += ' AND category = ?';
      studentParams.push(targetCategory);
    }
    studentQuery += ' ORDER BY first_name ASC, father_name ASC';

    const [students] = await pool.query(studentQuery, studentParams);

    let sessionQuery = 'SELECT id, course_title, session_date, session_time, category FROM sessions';
    const sessionParams = [];

    if (targetCategory !== 'All') {
      sessionQuery += " WHERE category = ? OR category = 'All'";
      sessionParams.push(targetCategory);
    }
    sessionQuery += ' ORDER BY session_date ASC, session_time ASC, id ASC';

    const [sessions] = await pool.query(sessionQuery, sessionParams);

    const [attendance] = await pool.query(`
      SELECT 
        a.session_id, 
        a.student_id, 
        a.status, 
        a.remarks,
        sess.session_date,
        sess.category AS session_category,
        sess.course_title
      FROM attendance a
      JOIN sessions sess ON a.session_id = sess.id
    `);

    res.json({
      category: targetCategory,
      students,
      sessions,
      attendance
    });
  } catch (error) {
    console.error('Category matrix report error:', error);
    res.status(500).json({ message: 'Error generating category matrix report' });
  }
});

module.exports = router;

