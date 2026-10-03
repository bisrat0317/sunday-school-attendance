const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { authenticateToken, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { executeWeeklyExport, BACKUP_DIR } = require('../utils/scheduler');
const { logActivity } = require('../utils/auditLogger');

// GET /api/backup/export/full-json - 1-Click download full database JSON snapshot
router.get('/export/full-json', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [students] = await pool.query('SELECT * FROM students ORDER BY category, first_name');
    const [sessions] = await pool.query('SELECT * FROM sessions ORDER BY session_date DESC');
    const [attendance] = await pool.query('SELECT * FROM attendance ORDER BY timestamp DESC');
    const [sessionEncoders] = await pool.query('SELECT * FROM session_encoders');
    const [followups] = await pool.query('SELECT * FROM pastoral_followups ORDER BY contact_date DESC');
    const [promotions] = await pool.query('SELECT * FROM student_promotions ORDER BY created_at DESC');

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

// GET /api/backup/export/full-excel - 1-Click download multi-sheet Sunday School Excel
router.get('/export/full-excel', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const exportResult = await executeWeeklyExport(true);
    const filePath = path.join(BACKUP_DIR, exportResult.excelFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Generated export file not found' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.excelFilename}"`);
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Export full Excel error:', error);
    res.status(500).json({ message: 'Error generating multi-sheet Excel export' });
  }
});

// GET /api/backup/weekly-list - List all archived weekly exports
router.get('/weekly-list', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return res.json([]);
    }

    const files = fs.readdirSync(BACKUP_DIR);
    const fileDetails = files.map(filename => {
      const filePath = path.join(BACKUP_DIR, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        sizeBytes: stats.size,
        sizeFormatted: `${(stats.size / 1024).toFixed(1)} KB`,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        isExcel: filename.endsWith('.xlsx'),
        isJson: filename.endsWith('.json')
      };
    });

    // Sort newest first
    fileDetails.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

    res.json(fileDetails);
  } catch (error) {
    console.error('Fetch weekly archive list error:', error);
    res.status(500).json({ message: 'Error retrieving weekly export archives' });
  }
});

// GET /api/backup/download/:filename - Download specific archived export file
router.get('/download/:filename', authenticateToken, requireAdmin, (req, res) => {
  const { filename } = req.params;
  const safeFilename = path.basename(filename);
  const filePath = path.join(BACKUP_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Backup file not found' });
  }

  res.download(filePath, safeFilename);
});

// POST /api/backup/run-weekly-now - Trigger the Monday night export on demand
router.post('/run-weekly-now', authenticateToken, requireAdmin, async (req, res) => {
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
