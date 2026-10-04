const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { logActivity } = require('./auditLogger');
const { sendWeeklyBackupEmail, isEmailConfigured, getEmailConfigStatus } = require('./mailer');

// Use OS temporary directory for serverless (Vercel/Lambda) compatibility
const BACKUP_DIR = path.join(os.tmpdir(), 'sunday-school-backups', 'weekly');

// Ensure backup directory exists safely
function ensureBackupDir() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('[Backup Engine] Note: Could not create temporary backup directory:', err.message);
  }
}

// Helper to format date YYYY-MM-DD
function getFormattedDate(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Build the master multi-sheet Excel workbook in memory
 */
async function generateMasterWorkbook() {
  // 1. Fetch Students
  const [students] = await pool.query(`
    SELECT 
      id, first_name, father_name, mother_name, christian_name,
      age, phone, emergency_contact, profession, previous_service,
      category, status, created_at
    FROM students
    ORDER BY category ASC, first_name ASC, father_name ASC
  `);

  // 2. Fetch Sessions
  const [sessions] = await pool.query(`
    SELECT 
      s.id, s.course_title, s.session_date, s.session_time,
      s.start_time, s.end_time, s.category, s.attendance_status,
      s.created_at, u.full_name AS creator_name
    FROM sessions s
    LEFT JOIN users u ON s.created_by = u.id
    ORDER BY s.session_date DESC, s.id DESC
  `);

  // 3. Fetch Attendance
  const [attendance] = await pool.query(`
    SELECT 
      a.id, a.session_id, a.student_id, a.status, a.remarks, a.timestamp,
      s.course_title, s.session_date, s.category AS session_category,
      st.first_name, st.father_name, st.category AS student_category
    FROM attendance a
    JOIN sessions s ON a.session_id = s.id
    JOIN students st ON a.student_id = st.id
    ORDER BY s.session_date DESC, st.first_name ASC
  `);

  // 4. Fetch Pastoral Follow-ups
  const [followups] = await pool.query(`
    SELECT 
      f.id, f.student_id, f.contact_date, f.contact_type, f.contacted_person,
      f.reason_category, f.notes, f.status, f.next_followup_date, f.created_at,
      s.first_name, s.father_name, s.category AS student_category, s.phone,
      u.full_name AS logged_by_name
    FROM pastoral_followups f
    JOIN students s ON f.student_id = s.id
    LEFT JOIN users u ON f.user_id = u.id
    ORDER BY f.contact_date DESC, f.created_at DESC
  `);

  // 5. Fetch Promotions
  let promotions = [];
  try {
    const [promResult] = await pool.query(`
      SELECT 
        p.id, p.student_id, p.from_category, p.to_category, p.action_type,
        p.reason, p.promotion_date, p.created_at,
        s.first_name, s.father_name,
        u.full_name AS promoted_by_name
      FROM student_promotions p
      JOIN students s ON p.student_id = s.id
      LEFT JOIN users u ON p.promoted_by = u.id
      ORDER BY p.promotion_date DESC, p.id DESC
    `);
    promotions = promResult;
  } catch (e) {
    console.warn('[Backup Engine] Promotions table query note:', e.message);
  }

  // 6. Fetch Student Assessments & Grades
  let assessments = [];
  let studentGrades = [];
  let gradeSettings = [];
  try {
    const [assResult] = await pool.query(`
      SELECT 
        a.id, a.category, a.title, a.assessment_type, a.semester, a.academic_year,
        a.exam_date, a.max_score, a.weight, a.description, a.created_at,
        u.full_name AS creator_name
      FROM assessments a
      LEFT JOIN users u ON a.created_by = u.id
      ORDER BY a.academic_year DESC, a.semester ASC, a.category ASC, a.exam_date DESC
    `);
    assessments = assResult;

    const [gradesResult] = await pool.query(`
      SELECT 
        g.id, g.assessment_id, g.student_id, g.score, g.is_absent, g.remarks, g.updated_at,
        a.title AS assessment_title, a.assessment_type, a.semester, a.academic_year,
        a.exam_date, a.max_score, a.weight, a.category AS assessment_category,
        st.first_name, st.father_name, st.christian_name, st.category AS student_category, st.phone
      FROM student_grades g
      JOIN assessments a ON g.assessment_id = a.id
      JOIN students st ON g.student_id = st.id
      ORDER BY a.academic_year DESC, a.semester ASC, a.category ASC, a.exam_date DESC, st.first_name ASC
    `);
    studentGrades = gradesResult;

    const [settingsResult] = await pool.query(`
      SELECT 
        gs.id, gs.category, gs.semester, gs.academic_year, gs.pass_mark, gs.updated_at,
        u.full_name AS updated_by_name
      FROM grade_settings gs
      LEFT JOIN users u ON gs.updated_by = u.id
      ORDER BY gs.academic_year DESC, gs.category ASC, gs.semester ASC
    `);
    gradeSettings = settingsResult;
  } catch (gradeErr) {
    console.warn('[Backup Engine] Assessments/grades query note:', gradeErr.message);
  }

  // 6. Build Attendance Matrix Sheet
  const sortedSessions = [...sessions].sort((a, b) => new Date(a.session_date) - new Date(b.session_date));
  
  // Group attendance by student_id and session_id
  const attLookup = new Map();
  attendance.forEach(a => {
    attLookup.set(`${a.student_id}::${a.session_id}`, a.status);
  });

  const matrixRows = students.map((st, idx) => {
    const row = {
      '#': idx + 1,
      'Student Name (ስም)': `${st.first_name} ${st.father_name}`,
      'Christian Name (የክርስትና)': st.christian_name || '',
      'Category (ምድብ)': st.category,
      'Phone (ስልክ)': st.phone || '',
      'Status (ሁኔታ)': st.status
    };

    let presentCount = 0;
    let absentCount = 0;
    let permissionCount = 0;

    sortedSessions.forEach(sess => {
      const sessDate = sess.session_date ? String(sess.session_date).split('T')[0] : '';
      const colHeader = `${sessDate} (${sess.category})`;
      const attStatus = attLookup.get(`${st.id}::${sess.id}`);

      if (attStatus === 'present') {
        row[colHeader] = 'P (✓)';
        presentCount++;
      } else if (attStatus === 'absent') {
        row[colHeader] = 'A (✗)';
        absentCount++;
      } else if (attStatus === 'permission') {
        row[colHeader] = 'L (ፈ)';
        permissionCount++;
      } else {
        row[colHeader] = '-';
      }
    });

    const totalMarked = presentCount + absentCount + permissionCount;
    row['Total Present'] = presentCount;
    row['Total Absent'] = absentCount;
    row['Total Permission'] = permissionCount;
    row['Attendance %'] = totalMarked > 0 ? `${Math.round((presentCount / totalMarked) * 100)}%` : '0%';

    return row;
  });

  // 7. Build Multi-Tab Workbook
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Students Directory
  const studentDataForSheet = students.map((s, i) => ({
    '#': i + 1,
    'Full Name': `${s.first_name} ${s.father_name}`,
    'First Name': s.first_name,
    'Father Name': s.father_name,
    'Mother Name': s.mother_name || '',
    'Christian Name': s.christian_name || '',
    'Age': s.age || '',
    'Category': s.category,
    'Phone': s.phone || '',
    'Emergency Contact': s.emergency_contact || '',
    'Profession': s.profession || '',
    'Previous Service': s.previous_service || '',
    'Status': s.status,
    'Registered Date': s.created_at ? String(s.created_at).split('T')[0] : ''
  }));
  const wsStudents = XLSX.utils.json_to_sheet(studentDataForSheet);
  XLSX.utils.book_append_sheet(workbook, wsStudents, 'Student Directory');

  // Sheet 2: Attendance Matrix
  const wsMatrix = XLSX.utils.json_to_sheet(matrixRows);
  XLSX.utils.book_append_sheet(workbook, wsMatrix, 'Master Attendance Matrix');

  // Sheet 3: Sessions List
  const sessionDataForSheet = sessions.map((s, i) => ({
    '#': i + 1,
    'Course Title': s.course_title,
    'Date': s.session_date ? String(s.session_date).split('T')[0] : '',
    'Time': s.session_time,
    'Category': s.category,
    'Attendance Status': s.attendance_status,
    'Created By': s.creator_name || 'System'
  }));
  const wsSessions = XLSX.utils.json_to_sheet(sessionDataForSheet);
  XLSX.utils.book_append_sheet(workbook, wsSessions, 'Sessions Held');

  // Sheet 4: Pastoral Follow-ups
  const followupsForSheet = followups.map((f, i) => ({
    '#': i + 1,
    'Student Name': `${f.first_name} ${f.father_name}`,
    'Category': f.student_category,
    'Phone': f.phone || '',
    'Contact Date': f.contact_date ? String(f.contact_date).split('T')[0] : '',
    'Contact Method': f.contact_type,
    'Contacted Person': f.contacted_person || '',
    'Reason Category': f.reason_category || '',
    'Notes': f.notes || '',
    'Resolution Status': f.status,
    'Next Follow-up Date': f.next_followup_date ? String(f.next_followup_date).split('T')[0] : '',
    'Logged By': f.logged_by_name || 'Admin'
  }));
  const wsFollowups = XLSX.utils.json_to_sheet(followupsForSheet);
  XLSX.utils.book_append_sheet(workbook, wsFollowups, 'Pastoral Follow-ups');

  // Sheet 5: Promotions & Graduation
  if (promotions.length > 0) {
    const promoForSheet = promotions.map((p, i) => ({
      '#': i + 1,
      'Student Name': `${p.first_name} ${p.father_name}`,
      'From Category': p.from_category,
      'To Category': p.to_category || 'Alumni (Graduated)',
      'Action': p.action_type,
      'Reason': p.reason || '',
      'Date': p.promotion_date ? String(p.promotion_date).split('T')[0] : '',
      'Promoted By': p.promoted_by_name || 'Admin'
    }));
    const wsPromo = XLSX.utils.json_to_sheet(promoForSheet);
    XLSX.utils.book_append_sheet(workbook, wsPromo, 'Promotions & Alumni');
  }

  // Sheet 6: Student Assessment Results & Marks
  if (studentGrades.length > 0) {
    const gradesForSheet = studentGrades.map((g, i) => {
      const maxScore = parseFloat(g.max_score) || 100;
      const weight = parseFloat(g.weight) || 0;
      const rawScore = g.score !== null ? parseFloat(g.score) : null;
      let calculatedWeight = '';
      let scorePercentage = '';
      if (g.is_absent) {
        calculatedWeight = '0% (Absent)';
        scorePercentage = '0%';
      } else if (rawScore !== null) {
        calculatedWeight = `${parseFloat(((rawScore / maxScore) * weight).toFixed(2))}%`;
        scorePercentage = `${parseFloat(((rawScore / maxScore) * 100).toFixed(2))}%`;
      }

      return {
        '#': i + 1,
        'Student Name (የተማሪ ስም)': `${g.first_name} ${g.father_name}`,
        'Christian Name (የክርስትና ስም)': g.christian_name || '',
        'Category (ምድብ)': g.student_category,
        'Academic Year (የትምህርት ዘመን)': g.academic_year,
        'Semester (መንፈቀ ዓመት)': g.semester,
        'Assessment Title (የፈተና ርዕስ)': g.assessment_title,
        'Assessment Type (ዓይነት)': g.assessment_type,
        'Exam Date (ቀን)': g.exam_date ? String(g.exam_date).split('T')[0] : '',
        'Max Score (ሙሉ ነጥብ)': g.max_score,
        'Weight % (ድርሻ)': `${g.weight}%`,
        'Raw Score (ያገኘው ነጥብ)': g.is_absent ? 'Absent (አልተፈተነም)' : (rawScore !== null ? rawScore : '-'),
        'Score % (የመቶኛ ውጤት)': scorePercentage,
        'Weighted Score % (የተሰላ ድርሻ)': calculatedWeight,
        'Absent Status (አልተፈተነም)': g.is_absent ? 'Yes' : 'No',
        'Teacher Remarks (ማስታወሻ)': g.remarks || ''
      };
    });
    const wsGrades = XLSX.utils.json_to_sheet(gradesForSheet);
    XLSX.utils.book_append_sheet(workbook, wsGrades, 'Assessment Results & Marks');
  }

  // Sheet 7: Assessments Directory
  if (assessments.length > 0) {
    const assessmentsForSheet = assessments.map((a, i) => ({
      '#': i + 1,
      'Assessment Title': a.title,
      'Category': a.category,
      'Assessment Type': a.assessment_type,
      'Semester': a.semester,
      'Academic Year': a.academic_year,
      'Exam Date': a.exam_date ? String(a.exam_date).split('T')[0] : '',
      'Max Score': a.max_score,
      'Weight (%)': `${a.weight}%`,
      'Description / Notes': a.description || '',
      'Created By': a.creator_name || 'Admin',
      'Created Date': a.created_at ? String(a.created_at).split('T')[0] : ''
    }));
    const wsAssessments = XLSX.utils.json_to_sheet(assessmentsForSheet);
    XLSX.utils.book_append_sheet(workbook, wsAssessments, 'Assessments Directory');
  }

  // Sheet 8: Grade Pass Mark Settings
  if (gradeSettings.length > 0) {
    const settingsForSheet = gradeSettings.map((s, i) => ({
      '#': i + 1,
      'Category': s.category,
      'Semester': s.semester,
      'Academic Year': s.academic_year,
      'Pass Mark (%)': `${s.pass_mark}%`,
      'Updated By': s.updated_by_name || 'Admin',
      'Last Updated': s.updated_at ? String(s.updated_at).split('T')[0] : ''
    }));
    const wsSettings = XLSX.utils.json_to_sheet(settingsForSheet);
    XLSX.utils.book_append_sheet(workbook, wsSettings, 'Grade Pass Mark Settings');
  }

  return {
    workbook,
    students,
    sessions,
    attendance,
    followups,
    promotions,
    assessments,
    studentGrades,
    gradeSettings
  };
}

/**
 * Generate Master Excel export as in-memory Buffer (Zero-disk writes, safe for Serverless)
 */
async function generateMasterExcelBuffer() {
  const { workbook, students, sessions, attendance, assessments, studentGrades } = await generateMasterWorkbook();
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const dateStr = getFormattedDate();
  const filename = `SundaySchool_Master_Export_${dateStr}.xlsx`;
  return {
    buffer,
    filename,
    counts: {
      students: students.length,
      sessions: sessions.length,
      attendance: attendance.length,
      assessments: (assessments || []).length,
      student_grades: (studentGrades || []).length
    }
  };
}

/**
 * Generate full Sunday School Excel workbook, JSON snapshot, and automated email
 * @param {boolean} isManual - True if manually triggered by super admin
 * @param {string} [customRecipientEmail] - Specific recipient email if requested
 */
async function executeWeeklyExport(isManual = false, customRecipientEmail = null) {
  ensureBackupDir();
  const dateStr = getFormattedDate();
  console.log(`[Backup Engine] Starting ${isManual ? 'manual' : 'scheduled Monday night'} Sunday School export...`);

  try {
    const { 
      workbook, 
      students, 
      sessions, 
      attendance, 
      followups, 
      promotions,
      assessments,
      studentGrades,
      gradeSettings
    } = await generateMasterWorkbook();

    const excelFilename = `SundaySchool_Weekly_Export_${dateStr}_${isManual ? 'manual' : 'auto'}.xlsx`;
    const jsonFilename = `SundaySchool_Database_Snapshot_${dateStr}_${isManual ? 'manual' : 'auto'}.json`;
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // 1. Try saving files to temporary backup directory
    try {
      ensureBackupDir();
      const excelFilePath = path.join(BACKUP_DIR, excelFilename);
      XLSX.writeFile(workbook, excelFilePath);

      const jsonFilePath = path.join(BACKUP_DIR, jsonFilename);
      const jsonSnapshot = {
        exported_at: new Date().toISOString(),
        export_type: isManual ? 'manual_admin_trigger' : 'scheduled_monday_night',
        counts: {
          students: students.length,
          sessions: sessions.length,
          attendance_records: attendance.length,
          pastoral_followups: followups.length,
          promotions: promotions.length,
          assessments: (assessments || []).length,
          student_grades: (studentGrades || []).length,
          grade_settings: (gradeSettings || []).length
        },
        students,
        sessions,
        attendance,
        pastoral_followups: followups,
        promotions,
        assessments,
        student_grades: studentGrades,
        grade_settings: gradeSettings
      };
      fs.writeFileSync(jsonFilePath, JSON.stringify(jsonSnapshot, null, 2), 'utf-8');

      console.log(`[Backup Engine] Successfully archived weekly exports to ${BACKUP_DIR}:`);
      console.log(`  -> Excel: ${excelFilename}`);
      console.log(`  -> JSON:  ${jsonFilename}`);
    } catch (fsErr) {
      console.warn('[Backup Engine] File write to backup directory was skipped/failed:', fsErr.message);
    }

    // 2. Automated Email Delivery (Super Admin Notification with Excel Attachment)
    let emailResult = { skipped: true };
    try {
      emailResult = await sendWeeklyBackupEmail({
        buffer,
        filename: excelFilename,
        recipientEmail: customRecipientEmail,
        counts: {
          students: students.length,
          sessions: sessions.length,
          attendance: attendance.length,
          assessments: (assessments || []).length,
          student_grades: (studentGrades || []).length
        },
        isManual
      });
    } catch (mailErr) {
      console.warn('[Backup Engine] Email delivery note:', mailErr.message);
      emailResult = { success: false, error: mailErr.message };
    }

    // 3. Log Audit
    try {
      logActivity({
        userId: 1,
        username: 'SYSTEM',
        action: 'WEEKLY_AUTO_EXPORT',
        details: `${isManual ? 'Manual' : 'Scheduled Monday Night'} full export generated: ${excelFilename} & ${jsonFilename} (${students.length} students, ${attendance.length} attendance, ${(assessments || []).length} assessments, ${(studentGrades || []).length} grades)${emailResult && emailResult.success ? ` [Emailed to ${emailResult.recipient}]` : ''}`,
        req: null
      });
    } catch (logErr) {
      console.warn('[Backup Engine] Audit log note:', logErr.message);
    }

    return {
      success: true,
      excelFilename,
      jsonFilename,
      studentCount: students.length,
      sessionCount: sessions.length,
      attendanceCount: attendance.length,
      assessmentCount: (assessments || []).length,
      gradeCount: (studentGrades || []).length,
      dateStr,
      emailDelivery: emailResult
    };
  } catch (error) {
    console.error('[Backup Engine] Error generating weekly export:', error);
    throw error;
  }
}

/**
 * Initialize the weekly cron scheduler
 * Runs every Monday at 23:59:00 (11:59 PM EAT/Local time)
 */
function initScheduler() {
  ensureBackupDir();

  // '59 23 * * 1' -> At minute 59 past hour 23 on Monday
  cron.schedule('59 23 * * 1', async () => {
    console.log('[Scheduler] Monday Night 23:59 Triggered: Running automated Sunday School weekly export and email dispatch...');
    try {
      await executeWeeklyExport(false);
    } catch (err) {
      console.error('[Scheduler] Monday night export failed:', err);
    }
  });

  console.log('⏰ Weekly Monday Night Auto-Export Scheduler initialized (Cron: 59 23 * * 1).');
}

module.exports = {
  initScheduler,
  generateMasterWorkbook,
  generateMasterExcelBuffer,
  executeWeeklyExport,
  sendWeeklyBackupEmail,
  isEmailConfigured,
  getEmailConfigStatus,
  BACKUP_DIR,
  ensureBackupDir
};
