const pool = require('../config/db');

async function viewDatabaseTables() {
  console.log('\n======================================================');
  console.log('       SUNDAY SCHOOL ATTENDANCE - DATABASE TABLES     ');
  console.log('======================================================\n');

  try {
    // 1. Users Table
    console.log('📋 1. USERS TABLE (users)');
    const [users] = await pool.query('SELECT id, username, full_name, role, created_at FROM users ORDER BY id ASC');
    console.table(users);
    console.log(`Total Users: ${users.length}\n`);

    // 2. Students Table
    console.log('📋 2. STUDENTS TABLE (students)');
    const [students] = await pool.query('SELECT id, first_name, father_name, age, phone, category, status FROM students ORDER BY id ASC LIMIT 10');
    console.table(students);
    const [[{ totalStudents }]] = await pool.query('SELECT COUNT(*) AS "totalStudents" FROM students');
    console.log(`Total Students: ${totalStudents} (showing top 10)\n`);

    // 3. Sessions Table
    console.log('📋 3. SESSIONS TABLE (sessions)');
    const [sessions] = await pool.query('SELECT id, course_title, session_date, session_time, category, attendance_status FROM sessions ORDER BY session_date DESC, id DESC LIMIT 10');
    console.table(sessions);
    const [[{ totalSessions }]] = await pool.query('SELECT COUNT(*) AS "totalSessions" FROM sessions');
    console.log(`Total Sessions: ${totalSessions} (showing top 10)\n`);

    // 4. Session Encoders Join Table
    console.log('📋 4. SESSION ENCODERS TABLE (session_encoders)');
    const [sessionEncoders] = await pool.query(`
      SELECT se.session_id, s.course_title, se.user_id, u.username, u.full_name 
      FROM session_encoders se
      JOIN sessions s ON se.session_id = s.id
      JOIN users u ON se.user_id = u.id
      ORDER BY se.session_id DESC LIMIT 10
    `);
    console.table(sessionEncoders);
    const [[{ totalEncAssignments }]] = await pool.query('SELECT COUNT(*) AS "totalEncAssignments" FROM session_encoders');
    console.log(`Total Assignments: ${totalEncAssignments}\n`);

    // 5. Attendance Records Table
    console.log('📋 5. ATTENDANCE TABLE (attendance)');
    const [attendance] = await pool.query(`
      SELECT a.id, a.session_id, s.first_name || ' ' || s.father_name AS student_name, a.status, a.remarks, a.timestamp
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      ORDER BY a.id DESC LIMIT 10
    `);
    console.table(attendance);
    const [[{ totalAttendance }]] = await pool.query('SELECT COUNT(*) AS "totalAttendance" FROM attendance');
    console.log(`Total Attendance Records: ${totalAttendance} (showing recent 10)\n`);

    // 6. Audit Logs Table
    console.log('📋 6. AUDIT LOGS TABLE (audit_logs)');
    const [auditLogs] = await pool.query('SELECT id, username, action, details, created_at FROM audit_logs ORDER BY id DESC LIMIT 10');
    console.table(auditLogs);
    const [[{ totalLogs }]] = await pool.query('SELECT COUNT(*) AS "totalLogs" FROM audit_logs');
    console.log(`Total Audit Logs: ${totalLogs} (showing recent 10)\n`);

    console.log('======================================================\n');
  } catch (err) {
    console.error('Error viewing database tables:', err.message);
  } finally {
    if (pool.pool) {
      await pool.pool.end();
    }
  }
}

viewDatabaseTables();
