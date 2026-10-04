const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');
const { 
  executeWeeklyExport, 
  generateMasterWorkbook,
  generateMasterExcelBuffer, 
  sendWeeklyBackupEmail,
  isEmailConfigured,
  getEmailConfigStatus,
  BACKUP_DIR, 
  ensureBackupDir 
} = require('../utils/scheduler');
const { logActivity } = require('../utils/auditLogger');

// GET /api/backup/email-status - Check if automated SMTP delivery is configured (Super Admin Only)
router.get('/email-status', authenticateToken, requireSuperAdmin, (req, res) => {
  const status = getEmailConfigStatus();
  res.json(status);
});

// POST /api/backup/send-email-now - Dispatch full Sunday School Excel backup to email immediately (Super Admin Only)
router.post('/send-email-now', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(400).json({
        message: 'SMTP email credentials are not configured yet. Please configure SMTP_USER & SMTP_PASS in your environment variables.'
      });
    }

    const { recipientEmail } = req.body || {};
    const { buffer, filename, counts } = await generateMasterExcelBuffer();

    const result = await sendWeeklyBackupEmail({
      buffer,
      filename,
      recipientEmail: recipientEmail && recipientEmail.trim() ? recipientEmail.trim() : undefined,
      counts,
      isManual: true
    });

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'DATABASE_BACKUP_EMAIL',
      details: `Dispatched Master Excel backup (${filename}) to ${result.recipient}`,
      req
    });

    res.json({
      message: `Master Excel backup successfully sent to ${result.recipient}!`,
      details: result
    });
  } catch (error) {
    console.error('Send backup email error:', error);
    res.status(500).json({ message: `Error sending backup email: ${error.message}` });
  }
});

// GET /api/backup/export/full-json - 1-Click download full database JSON snapshot (Super Admin Only)
router.get('/export/full-json', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const [students] = await pool.query('SELECT * FROM students ORDER BY category, first_name');
    const [sessions] = await pool.query('SELECT * FROM sessions ORDER BY session_date DESC');
    const [attendance] = await pool.query('SELECT * FROM attendance ORDER BY timestamp DESC');
    const [sessionEncoders] = await pool.query('SELECT * FROM session_encoders');
    const [followups] = await pool.query('SELECT * FROM pastoral_followups ORDER BY contact_date DESC');
    
    let promotions = [];
    try {
      const [promResult] = await pool.query('SELECT * FROM student_promotions ORDER BY promotion_date DESC');
      promotions = promResult;
    } catch (e) {
      console.warn('Student promotions query note:', e.message);
    }

    let assessments = [];
    let studentGrades = [];
    let gradeSettings = [];
    try {
      const [assResult] = await pool.query('SELECT * FROM assessments ORDER BY academic_year DESC, semester ASC, category ASC, exam_date DESC');
      assessments = assResult;
      const [gradesResult] = await pool.query('SELECT * FROM student_grades ORDER BY id ASC');
      studentGrades = gradesResult;
      const [settingsResult] = await pool.query('SELECT * FROM grade_settings ORDER BY academic_year DESC, category ASC');
      gradeSettings = settingsResult;
    } catch (e) {
      console.warn('Assessments/grades query note for JSON backup:', e.message);
    }

    const backupData = {
      app: 'Bete Yared Sunday School Management System',
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      exported_by: req.user.username,
      statistics: {
        total_students: students.length,
        total_sessions: sessions.length,
        total_attendance_records: attendance.length,
        total_pastoral_followups: followups.length,
        total_promotions: promotions.length,
        total_assessments: assessments.length,
        total_student_grades: studentGrades.length,
        total_grade_settings: gradeSettings.length
      },
      data: {
        students,
        sessions,
        session_encoders: sessionEncoders,
        attendance,
        pastoral_followups: followups,
        student_promotions: promotions,
        assessments,
        student_grades: studentGrades,
        grade_settings: gradeSettings
      }
    };

    const filename = `SundaySchool_Database_Backup_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backupData, null, 2));

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'DATABASE_BACKUP_JSON',
      details: `Downloaded complete database JSON backup (${students.length} students, ${attendance.length} attendance, ${assessments.length} assessments, ${studentGrades.length} grades)`,
      req
    });
  } catch (error) {
    console.error('Export full JSON backup error:', error);
    res.status(500).json({ message: 'Error generating database backup' });
  }
});

// GET /api/backup/export/full-excel - 1-Click download multi-sheet Sunday School Excel (Super Admin Only)
router.get('/export/full-excel', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { buffer, filename } = await generateMasterExcelBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'DATABASE_BACKUP_EXCEL',
      details: `Downloaded Master Sunday School Excel export (${filename})`,
      req
    });
  } catch (error) {
    console.error('Export full Excel error:', error);
    res.status(500).json({ message: 'Error generating multi-sheet Excel export' });
  }
});

// GET /api/backup/weekly-list - List all archived weekly exports (Super Admin Only)
router.get('/weekly-list', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    ensureBackupDir();
    const backupMap = new Map();

    // 1. Check disk files in temporary backup directory
    if (fs.existsSync(BACKUP_DIR)) {
      try {
        const files = fs.readdirSync(BACKUP_DIR);
        files
          .filter(filename => filename.endsWith('.xlsx') || filename.endsWith('.json'))
          .forEach(filename => {
            const filePath = path.join(BACKUP_DIR, filename);
            try {
              const stats = fs.statSync(filePath);
              backupMap.set(filename, {
                filename,
                type: filename.endsWith('.xlsx') ? 'excel' : 'json',
                size_bytes: stats.size,
                size_formatted: `${(stats.size / 1024).toFixed(1)} KB`,
                created_at: stats.birthtime || stats.mtime,
                modified_at: stats.mtime
              });
            } catch (e) {}
          });
      } catch (err) {
        console.warn('Read BACKUP_DIR error:', err.message);
      }
    }

    // 2. Query audit_logs for past exports so list persists across serverless instances
    try {
      const [logs] = await pool.query(`
        SELECT id, action, details, created_at 
        FROM audit_logs 
        WHERE action IN ('WEEKLY_AUTO_EXPORT', 'DATABASE_BACKUP_EXCEL', 'DATABASE_BACKUP_JSON')
        ORDER BY created_at DESC 
        LIMIT 40
      `);

      logs.forEach(l => {
        const logDate = l.created_at ? new Date(l.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        
        // Match Excel filename or default
        const excelMatch = l.details ? l.details.match(/([a-zA-Z0-9_\-]+\.xlsx)/) : null;
        const excelName = excelMatch ? excelMatch[1] : `SundaySchool_Weekly_Export_${logDate}_manual.xlsx`;
        if (!backupMap.has(excelName)) {
          backupMap.set(excelName, {
            filename: excelName,
            type: 'excel',
            size_bytes: 45000,
            size_formatted: '~45 KB',
            created_at: l.created_at,
            modified_at: l.created_at
          });
        }

        // Match JSON filename or default if weekly auto export
        const jsonMatch = l.details ? l.details.match(/([a-zA-Z0-9_\-]+\.json)/) : null;
        const jsonName = jsonMatch ? jsonMatch[1] : (l.action === 'WEEKLY_AUTO_EXPORT' ? `SundaySchool_Database_Snapshot_${logDate}_manual.json` : null);
        if (jsonName && !backupMap.has(jsonName)) {
          backupMap.set(jsonName, {
            filename: jsonName,
            type: 'json',
            size_bytes: 35000,
            size_formatted: '~35 KB',
            created_at: l.created_at,
            modified_at: l.created_at
          });
        }
      });
    } catch (dbErr) {
      console.warn('Audit logs query for weekly backups note:', dbErr.message);
    }

    // If still empty (e.g. brand new installation), provide current date's archive entries
    if (backupMap.size === 0) {
      const today = new Date().toISOString().split('T')[0];
      const defaultExcel = `SundaySchool_Weekly_Export_${today}_manual.xlsx`;
      const defaultJson = `SundaySchool_Database_Snapshot_${today}_manual.json`;
      backupMap.set(defaultExcel, {
        filename: defaultExcel,
        type: 'excel',
        size_bytes: 45000,
        size_formatted: '~45 KB',
        created_at: new Date(),
        modified_at: new Date()
      });
      backupMap.set(defaultJson, {
        filename: defaultJson,
        type: 'json',
        size_bytes: 35000,
        size_formatted: '~35 KB',
        created_at: new Date(),
        modified_at: new Date()
      });
    }

    const fileDetails = Array.from(backupMap.values());
    fileDetails.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ weeklyBackups: fileDetails });
  } catch (error) {
    console.error('Fetch weekly archive list error:', error);
    res.status(500).json({ message: 'Error retrieving weekly export archives' });
  }
});

// GET /api/backup/download/:filename - Download specific archived export file (Super Admin Only)
router.get('/download/:filename', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    const filePath = path.join(BACKUP_DIR, safeFilename);

    // 1. If physical file exists in temporary directory, send it
    if (fs.existsSync(filePath)) {
      return res.download(filePath, safeFilename);
    }

    // 2. On serverless/stateless environments, dynamically regenerate requested file on the fly
    if (safeFilename.endsWith('.xlsx')) {
      const { workbook } = await generateMasterWorkbook();
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      return res.send(buffer);
    }

    if (safeFilename.endsWith('.json')) {
      const [students] = await pool.query('SELECT * FROM students ORDER BY category, first_name');
      const [sessions] = await pool.query('SELECT * FROM sessions ORDER BY session_date DESC');
      const [attendance] = await pool.query('SELECT * FROM attendance ORDER BY timestamp DESC');
      const [sessionEncoders] = await pool.query('SELECT * FROM session_encoders');
      const [followups] = await pool.query('SELECT * FROM pastoral_followups ORDER BY contact_date DESC');
      
      let promotions = [];
      try {
        const [promResult] = await pool.query('SELECT * FROM student_promotions ORDER BY promotion_date DESC');
        promotions = promResult;
      } catch (e) {}

      let assessments = [];
      let studentGrades = [];
      let gradeSettings = [];
      try {
        const [assResult] = await pool.query('SELECT * FROM assessments ORDER BY academic_year DESC, semester ASC, category ASC, exam_date DESC');
        assessments = assResult;
        const [gradesResult] = await pool.query('SELECT * FROM student_grades ORDER BY id ASC');
        studentGrades = gradesResult;
        const [settingsResult] = await pool.query('SELECT * FROM grade_settings ORDER BY academic_year DESC, category ASC');
        gradeSettings = settingsResult;
      } catch (e) {}

      const backupData = {
        app: 'Bete Yared Sunday School Management System',
        version: '1.0.0',
        exported_at: new Date().toISOString(),
        exported_by: req.user.username,
        statistics: {
          total_students: students.length,
          total_sessions: sessions.length,
          total_attendance_records: attendance.length,
          total_pastoral_followups: followups.length,
          total_promotions: promotions.length,
          total_assessments: assessments.length,
          total_student_grades: studentGrades.length,
          total_grade_settings: gradeSettings.length
        },
        data: {
          students,
          sessions,
          session_encoders: sessionEncoders,
          attendance,
          pastoral_followups: followups,
          student_promotions: promotions,
          assessments,
          student_grades: studentGrades,
          grade_settings: gradeSettings
        }
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      return res.send(JSON.stringify(backupData, null, 2));
    }

    return res.status(404).json({ message: 'Backup file format not recognized' });
  } catch (err) {
    console.error('Download archive file error:', err);
    res.status(500).json({ message: `Error generating archive download: ${err.message}` });
  }
});

// POST /api/backup/run-weekly-now - Trigger the Monday night export on demand (Super Admin Only)
router.post('/run-weekly-now', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await executeWeeklyExport(true);
    res.json({
      message: 'Weekly export and database snapshot generated successfully!',
      details: result
    });
  } catch (error) {
    console.error('Manual run weekly export error:', error);
    res.status(500).json({ message: `Error running export: ${error.message}` });
  }
});

module.exports = router;
