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
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN a.status = 'permission' THEN 1 END) AS permission_count,
        COUNT(a.id) AS total_marked
      FROM sessions s
      LEFT JOIN attendance a ON s.id = a.session_id
      GROUP BY s.id
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
    // For each active student, examine their most recent 3 attendance records.
    // If the count of recent records is >= 3 AND all 3 have status = 'absent', flag them.
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
        -- Get students whose last 3 attendance records are all 'absent'
        SELECT 
          att_ranked.student_id,
          COUNT(*) AS absent_count,
          MAX(att_ranked.session_date) AS last_absent_date
        FROM (
          SELECT 
            a.student_id,
            a.status,
            sess.session_date,
            ROW_NUMBER() OVER (PARTITION BY a.student_id ORDER BY sess.session_date DESC, sess.session_time DESC) as rn
          FROM attendance a
          JOIN sessions sess ON a.session_id = sess.id
        ) att_ranked
        WHERE att_ranked.rn <= 3 AND att_ranked.status = 'absent'
        GROUP BY att_ranked.student_id
        HAVING COUNT(*) >= 3
      ) recent ON s.id = recent.student_id
      LEFT JOIN (
        -- Find their last known 'present' session date
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
        s.*,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS total_present,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS total_absent,
        MAX(CASE WHEN a.status = 'present' THEN sess.session_date END) AS last_attended_date
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id
      LEFT JOIN sessions sess ON a.session_id = sess.id
      WHERE s.status = 'inactive'
      GROUP BY s.id
      ORDER BY s.first_name ASC
    `);

    res.json(inactiveList);
  } catch (error) {
    console.error('Inactive students report error:', error);
    res.status(500).json({ message: 'Error retrieving inactive students' });
  }
});

module.exports = router;

