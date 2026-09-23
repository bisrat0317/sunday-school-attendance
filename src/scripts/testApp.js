const http = require('http');

async function runTests() {
  console.log('=== Starting Sunday School Attendance System Verification ===');

  const pool = require('../config/db');
  const initDatabase = require('./initDb');

  await initDatabase();

  // Test 1: Verify database tables
  const [tables] = await pool.query('SHOW TABLES');
  console.log('Verified MySQL Tables:', tables.map(t => Object.values(t)[0]));

  // Test 2: Check student records
  const [students] = await pool.query('SELECT id, first_name, father_name, category, phone FROM students');
  console.log(`Verified Registered Students (${students.length}):`, students.map(s => `${s.first_name} ${s.father_name} (${s.category})`));

  // Test 3: Test 3-consecutive-absent detection logic
  console.log('\nTesting 3-consecutive-absent alert engine...');
  const testStudent = students[0]; // Dawit Yohannes

  // Create 3 historical sessions for Youth
  const [s1] = await pool.query(`
    INSERT INTO sessions (course_title, session_date, session_time, category, description)
    VALUES ('የመጽሐፍ ቅዱስ ጥናት 1', '2026-09-01', '3:00', 'Youth', 'ክፍለ-ጊዜ 1')
  `);
  const [s2] = await pool.query(`
    INSERT INTO sessions (course_title, session_date, session_time, category, description)
    VALUES ('የመጽሐፍ ቅዱስ ጥናት 2', '2026-09-08', '3:00', 'Youth', 'ክፍለ-ጊዜ 2')
  `);
  const [s3] = await pool.query(`
    INSERT INTO sessions (course_title, session_date, session_time, category, description)
    VALUES ('የመጽሐፍ ቅዱስ ጥናት 3', '2026-09-15', '3:00', 'Youth', 'ክፍለ-ጊዜ 3')
  `);

  // Mark testStudent as 'absent' in all 3 sessions
  await pool.query(`
    INSERT INTO attendance (session_id, student_id, status, remarks)
    VALUES 
    (?, ?, 'absent', 'ያልተገኘ'),
    (?, ?, 'absent', 'ያልተገኘ'),
    (?, ?, 'absent', 'ያልተገኘ')
  `, [s1.insertId, testStudent.id, s2.insertId, testStudent.id, s3.insertId, testStudent.id]);

  // Now query 3-straight absent engine
  const [flagged] = await pool.query(`
    SELECT 
      s.id AS student_id,
      s.first_name,
      s.father_name,
      s.phone,
      s.emergency_contact,
      s.category,
      recent.absent_count
    FROM students s
    INNER JOIN (
      SELECT 
        att_ranked.student_id,
        COUNT(*) AS absent_count
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
    WHERE s.status = 'active'
  `);

  console.log(`3-Consecutive Absent Detection Result: Found ${flagged.length} student(s)`);
  flagged.forEach(f => {
    console.log(`  -> Flagged: ${f.first_name} ${f.father_name} (${f.category}) | Phone: ${f.phone} | Emergency: ${f.emergency_contact} | Absences: ${f.absent_count}`);
  });

  if (flagged.length > 0) {
    console.log('✓ 3-Straight Absence Notification Engine PASSED successfully!');
  } else {
    console.error('✗ 3-Straight Absence Engine FAILED!');
    process.exit(1);
  }

  await pool.end();
  console.log('\n=== All Tests Passed Successfully! ===');
}

runTests();

