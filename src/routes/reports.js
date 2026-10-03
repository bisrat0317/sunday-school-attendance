const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin, requireSuperAdmin } = require('../middleware/auth');

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

// GET /api/reports/three-absents - Students with 3 consecutive straight absences with latest follow-up info
router.get('/three-absents', authenticateToken, requireAdmin, async (req, res) => {
  try {
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
        last_present.last_present_date,
        lf.id AS latest_followup_id,
        COALESCE(lf.status, 'pending') AS followup_status,
        COALESCE(lf.status, 'pending') AS status,
        lf.contact_type AS followup_contact_type,
        lf.contact_type AS contact_method,
        lf.contacted_person AS followup_contacted_person,
        lf.contacted_person AS parent_contacted,
        lf.reason_category AS followup_reason,
        lf.reason_category AS reason_for_absence,
        lf.notes AS followup_notes,
        lf.notes AS notes,
        lf.contact_date AS followup_date,
        lf.contact_date AS last_contact_date,
        lf.next_followup_date,
        lf.next_followup_date AS next_action,
        lf.logged_by_name AS followup_logged_by,
        COALESCE(fc.total_followups, 0) AS total_followups
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
      LEFT JOIN (
        -- Total follow-up counts
        SELECT student_id, COUNT(*) AS total_followups
        FROM pastoral_followups
        GROUP BY student_id
      ) fc ON s.id = fc.student_id
      LEFT JOIN (
        -- Latest follow-up record per student
        SELECT DISTINCT ON (f.student_id)
          f.id,
          f.student_id,
          f.status,
          f.contact_type,
          f.contacted_person,
          f.reason_category,
          f.notes,
          f.contact_date,
          f.next_followup_date,
          u.full_name AS logged_by_name
        FROM pastoral_followups f
        LEFT JOIN users u ON f.user_id = u.id
        ORDER BY f.student_id, f.contact_date DESC, f.created_at DESC
      ) lf ON s.id = lf.student_id
      WHERE s.status = 'active'
      ORDER BY recent.last_absent_date DESC
    `);

    res.json(flaggedStudents);
  } catch (error) {
    console.error('Three absents report error:', error);
    res.status(500).json({ message: 'Error detecting 3-straight absent students' });
  }
});

// GET /api/reports/advanced-analytics - Comprehensive retention, seasonal & at-risk analytics (Super Admin Only)
router.get('/advanced-analytics', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    // 1. Weekly Attendance Trends (Time-series for chart)
    const [weeklyTrends] = await pool.query(`
      SELECT 
        TO_CHAR(s.session_date, 'YYYY-"W"IW') AS year_week,
        TO_CHAR(MIN(s.session_date), 'Mon DD, YYYY') AS week_start,
        COUNT(DISTINCT s.id) AS sessions_count,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS total_present,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS total_absent,
        COUNT(CASE WHEN a.status = 'permission' THEN 1 END) AS total_permission,
        COUNT(a.id) AS total_records,
        COALESCE(ROUND(
          (COUNT(CASE WHEN a.status = 'present' THEN 1 END)::numeric / NULLIF(COUNT(a.id), 0) * 100), 1
        ), 0) AS attendance_rate
      FROM sessions s
      JOIN attendance a ON s.id = a.session_id
      GROUP BY TO_CHAR(s.session_date, 'YYYY-"W"IW')
      ORDER BY year_week ASC
    `);

    // 2. Category Performance & Retention Comparison
    const [categoryRankings] = await pool.query(`
      SELECT 
        c.category,
        COUNT(DISTINCT st.id) AS total_students,
        COUNT(DISTINCT CASE WHEN st.status = 'active' THEN st.id END) AS active_students,
        COUNT(DISTINCT s.id) AS sessions_held,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN a.status = 'permission' THEN 1 END) AS permission_count,
        COALESCE(ROUND(
          (COUNT(CASE WHEN a.status = 'present' THEN 1 END)::numeric / NULLIF(COUNT(a.id), 0) * 100), 1
        ), 0) AS attendance_rate
      FROM (SELECT DISTINCT category FROM students WHERE category != '' AND category IS NOT NULL) c
      LEFT JOIN students st ON c.category = st.category
      LEFT JOIN sessions s ON c.category = s.category
      LEFT JOIN attendance a ON s.id = a.session_id AND a.student_id = st.id
      GROUP BY c.category
      ORDER BY attendance_rate DESC NULLS LAST, total_students DESC
    `);

    // 3. Seasonal Church Feasts Comparison
    // Q1 (Sep-Nov): Meskerem - Hidar (Fall Feasts)
    // Q2 (Dec-Feb): Tahsas - Yekatit (Gena & Timkat)
    // Q3 (Mar-May): Megabit - Ginbot (Great Lent & Fasika)
    // Q4 (Jun-Aug): Sene - Pagumen (Summer & Filseta)
    const [seasonalTrends] = await pool.query(`
      SELECT 
        CASE 
          WHEN EXTRACT(MONTH FROM s.session_date) IN (9, 10, 11) THEN 'Meskerem - Hidar (Fall Feasts)'
          WHEN EXTRACT(MONTH FROM s.session_date) IN (12, 1, 2) THEN 'Tahsas - Yekatit (Gena & Timkat)'
          WHEN EXTRACT(MONTH FROM s.session_date) IN (3, 4, 5) THEN 'Megabit - Ginbot (Great Lent & Fasika)'
          ELSE 'Sene - Pagumen (Summer & Filseta)'
        END AS name_en,
        CASE 
          WHEN EXTRACT(MONTH FROM s.session_date) IN (9, 10, 11) THEN 'መስከረም - ኅዳር (የበልግ በዓላት)'
          WHEN EXTRACT(MONTH FROM s.session_date) IN (12, 1, 2) THEN 'ታኅሣሥ - የካቲት (ገና እና ጥምቀት)'
          WHEN EXTRACT(MONTH FROM s.session_date) IN (3, 4, 5) THEN 'መጋቢት - ግንቦት (አቢይ ጾም እና ፋሲካ)'
          ELSE 'ሰኔ - ጳጉሜን (ክረምት እና ጾመ ፍልሰታ)'
        END AS name_am,
        CASE 
          WHEN EXTRACT(MONTH FROM s.session_date) IN (9, 10, 11) THEN 'fa-leaf'
          WHEN EXTRACT(MONTH FROM s.session_date) IN (12, 1, 2) THEN 'fa-church'
          WHEN EXTRACT(MONTH FROM s.session_date) IN (3, 4, 5) THEN 'fa-cross'
          ELSE 'fa-sun'
        END AS icon,
        COUNT(DISTINCT s.id) AS sessions_count,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_records,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_records,
        COUNT(CASE WHEN a.status = 'permission' THEN 1 END) AS permission_records,
        COUNT(a.id) AS total_records,
        COALESCE(ROUND(
          (COUNT(CASE WHEN a.status = 'present' THEN 1 END)::numeric / NULLIF(COUNT(a.id), 0) * 100), 1
        ), 0) AS attendance_rate
      FROM sessions s
      JOIN attendance a ON s.id = a.session_id
      GROUP BY 
        CASE 
          WHEN EXTRACT(MONTH FROM s.session_date) IN (9, 10, 11) THEN 1
          WHEN EXTRACT(MONTH FROM s.session_date) IN (12, 1, 2) THEN 2
          WHEN EXTRACT(MONTH FROM s.session_date) IN (3, 4, 5) THEN 3
          ELSE 4
        END,
        name_en, name_am, icon
      ORDER BY 1 ASC
    `);

    // 4. At-Risk Early Warning Students (< 70% Attendance in the Last 4 Recorded Sessions)
    const [atRiskStudents] = await pool.query(`
      WITH student_recent_att AS (
        SELECT 
          a.student_id,
          a.status,
          s.session_date,
          ROW_NUMBER() OVER (PARTITION BY a.student_id ORDER BY s.session_date DESC, s.id DESC) AS rn
        FROM attendance a
        JOIN sessions s ON a.session_id = s.id
      ),
      student_stats AS (
        SELECT 
          student_id,
          -- Last 4 sessions
          COUNT(CASE WHEN rn <= 4 AND status = 'present' THEN 1 END) AS recent_present,
          COUNT(CASE WHEN rn <= 4 AND status = 'absent' THEN 1 END) AS recent_absent,
          COUNT(CASE WHEN rn <= 4 AND status = 'permission' THEN 1 END) AS recent_permission,
          COUNT(CASE WHEN rn <= 4 THEN 1 END) AS recent_total,
          -- Overall stats
          COUNT(CASE WHEN status = 'present' THEN 1 END) AS overall_present,
          COUNT(*) AS overall_total
        FROM student_recent_att
        GROUP BY student_id
      )
      SELECT 
        st.id AS student_id,
        st.first_name,
        st.father_name,
        st.mother_name,
        st.christian_name,
        st.phone,
        st.emergency_contact,
        st.category,
        ss.recent_present,
        ss.recent_absent,
        ss.recent_permission,
        ss.recent_total,
        ROUND((ss.recent_present::numeric / NULLIF(ss.recent_total, 0) * 100), 0) AS recent_rate,
        ss.overall_present,
        ss.overall_total,
        ROUND((ss.overall_present::numeric / NULLIF(ss.overall_total, 0) * 100), 0) AS overall_rate,
        GREATEST(0, ROUND(
          (ss.overall_present::numeric / NULLIF(ss.overall_total, 0) * 100) - 
          (ss.recent_present::numeric / NULLIF(ss.recent_total, 0) * 100), 0
        )) AS drop_rate
      FROM student_stats ss
      JOIN students st ON ss.student_id = st.id
      WHERE st.status = 'active'
        AND ss.recent_total >= 1
        AND (ss.recent_present::numeric / ss.recent_total) < 0.70
      ORDER BY recent_rate ASC, ss.recent_present ASC, st.first_name ASC
      LIMIT 60
    `);

    // 5. Summary KPI metrics
    const [[overallStats]] = await pool.query(`
      SELECT 
        COUNT(a.id) AS total_records,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS total_present,
        COALESCE(ROUND(
          (COUNT(CASE WHEN a.status = 'present' THEN 1 END)::numeric / NULLIF(COUNT(a.id), 0) * 100), 1
        ), 0) AS overall_attendance_rate
      FROM attendance a
    `);

    const [[followupStats]] = await pool.query(`
      SELECT 
        COUNT(*) AS total_followups,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_count,
        COUNT(CASE WHEN status = 'contacted' THEN 1 END) AS contacted_count,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) AS resolved_count,
        COUNT(CASE WHEN status = 'needs_visit' THEN 1 END) AS needs_visit_count
      FROM pastoral_followups
    `);

    const topCategory = categoryRankings.length > 0 ? categoryRankings[0] : null;

    res.json({
      summary: {
        overall_attendance_rate: overallStats ? overallStats.overall_attendance_rate : 0,
        top_category: topCategory ? topCategory.category : null,
        top_category_rate: topCategory ? topCategory.attendance_rate : 0,
        at_risk_count: atRiskStudents.length,
        total_followups_logged: followupStats ? followupStats.total_followups : 0
      },
      weeklyTrends,
      categoryRankings,
      seasonalTrends,
      atRiskStudents,
      followupStats: followupStats || { total_followups: 0, pending_count: 0, contacted_count: 0, resolved_count: 0 }
    });
  } catch (error) {
    console.error('Advanced analytics error:', error);
    res.status(500).json({ message: 'Error computing advanced retention analytics' });
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

