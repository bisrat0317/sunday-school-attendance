const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { logActivity } = require('./auditLogger');

const BACKUP_DIR = path.join(__dirname, '../../backups/weekly');

// Ensure backup directory exists
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
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
 * Generate full Sunday School Excel workbook and JSON snapshot
 * @param {boolean} isManual - True if manually triggered by admin
 */
async function executeWeeklyExport(isManual = false) {
  ensureBackupDir();
  const dateStr = getFormattedDate();
  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
  console.log(`[Backup Engine] Starting ${isManual ? 'manual' : 'scheduled Monday night'} Sunday School export...`);

  try {
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

    // 5. Build Attendance Matrix Sheet
    const sessionMap = new Map();
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
        'Phone (ስልክ)': st.phone,
        'Status (ሁኔታ)': st.status
      };

      let presentCount = 0;
      let absentCount = 0;
      let permissionCount = 0;

      sortedSessions.forEach(sess => {
        const sessDate = String(sess.session_date).split('T')[0];
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

    // 6. Build Multi-Tab Workbook
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Students Directory
    const studentDataForSheet = students.map((s, i) => ({
      '#': i + 1,
      'Full Name': `${s.first_name} ${s.father_name}`,
      'First Name': s.first_name,
      'Father Name': s.father_name,
      'Mother Name': s.mother_name,
      'Christian Name': s.christian_name,
      'Age': s.age,
      'Category': s.category,
      'Phone': s.phone,
      'Emergency Contact': s.emergency_contact,
      'Profession': s.profession,
      'Previous Service': s.previous_service,
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
      'Phone': f.phone,
      'Contact Date': f.contact_date ? String(f.contact_date).split('T')[0] : '',
      'Contact Method': f.contact_type,
      'Contacted Person': f.contacted_person,
      'Reason Category': f.reason_category,
      'Notes': f.notes,
      'Resolution Status': f.status,
      'Next Follow-up Date': f.next_followup_date ? String(f.next_followup_date).split('T')[0] : '',
      'Logged By': f.logged_by_name || 'Admin'
    }));
    const wsFollowups = XLSX.utils.json_to_sheet(followupsForSheet);
    XLSX.utils.book_append_sheet(workbook, wsFollowups, 'Pastoral Follow-ups');

    // Write Excel File to Disk
    const excelFilename = `SundaySchool_Weekly_Export_${dateStr}_${isManual ? 'manual' : 'auto'}.xlsx`;
    const excelFilePath = path.join(BACKUP_DIR, excelFilename);
    XLSX.writeFile(workbook, excelFilePath);

    // Write JSON Full Backup to Disk
    const jsonFilename = `SundaySchool_Database_Snapshot_${dateStr}_${isManual ? 'manual' : 'auto'}.json`;
    const jsonFilePath = path.join(BACKUP_DIR, jsonFilename);
    const jsonSnapshot = {
      exported_at: new Date().toISOString(),
      export_type: isManual ? 'manual_admin_trigger' : 'scheduled_monday_night',
      counts: {
        students: students.length,
        sessions: sessions.length,
        attendance_records: attendance.length,
        pastoral_followups: followups.length
      },
      students,
      sessions,
      attendance,
      pastoral_followups: followups
    };
    fs.writeFileSync(jsonFilePath, JSON.stringify(jsonSnapshot, null, 2), 'utf-8');

    console.log(`[Backup Engine] Successfully created weekly exports:`);
    console.log(`  -> Excel: ${excelFilename}`);
    console.log(`  -> JSON:  ${jsonFilename}`);

    logActivity({
      userId: 1,
      username: 'SYSTEM',
      action: 'WEEKLY_AUTO_EXPORT',
      details: `${isManual ? 'Manual' : 'Scheduled Monday Night'} full export created: ${excelFilename} & ${jsonFilename} (${students.length} students, ${attendance.length} attendance records)`,
      req: null
    });

    return {
      success: true,
      excelFilename,
      jsonFilename,
      studentCount: students.length,
      sessionCount: sessions.length,
      attendanceCount: attendance.length,
      dateStr
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
    console.log('[Scheduler] Monday Night 23:59 Triggered: Running automated Sunday School weekly export...');
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
  executeWeeklyExport,
  BACKUP_DIR
};
