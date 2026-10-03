const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');
const { 
  executeWeeklyExport, 
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
        total_promotions: promotions.length
      },
      data: {
        students,
        sessions,
        session_encoders: sessionEncoders,
        attendance,
        pastoral_followups: followups,
        student_promotions: promotions
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
      details: `Downloaded complete database JSON backup (${students.length} students, ${attendance.length} attendance records)`,
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
    if (!fs.existsSync(BACKUP_DIR)) {
      return res.json({ weeklyBackups: [] });
    }

    const files = fs.readdirSync(BACKUP_DIR);
    const fileDetails = files
      .filter(filename => filename.endsWith('.xlsx') || filename.endsWith('.json'))
      .map(filename => {
        const filePath = path.join(BACKUP_DIR, filename);
        try {
          const stats = fs.statSync(filePath);
          return {
            filename,
            type: filename.endsWith('.xlsx') ? 'excel' : 'json',
            size_bytes: stats.size,
            size_formatted: `${(stats.size / 1024).toFixed(1)} KB`,
            created_at: stats.birthtime || stats.mtime,
            modified_at: stats.mtime
          };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);

    // Sort newest first
    fileDetails.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ weeklyBackups: fileDetails });
  } catch (error) {
    console.error('Fetch weekly archive list error:', error);
    res.status(500).json({ message: 'Error retrieving weekly export archives' });
  }
});

// GET /api/backup/download/:filename - Download specific archived export file (Super Admin Only)
router.get('/download/:filename', authenticateToken, requireSuperAdmin, (req, res) => {
  const { filename } = req.params;
  const safeFilename = path.basename(filename);
  const filePath = path.join(BACKUP_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Backup file not found' });
  }

  res.download(filePath, safeFilename);
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
