const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');

// GET /api/audit-logs - List audit logs with filters and pagination (Super Admin only)
router.get('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { action, search, limit, page } = req.query;

  try {
    let whereClause = ' WHERE 1=1';
    const params = [];

    if (action && action !== 'All') {
      whereClause += ' AND action = ?';
      params.push(action);
    }

    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      whereClause += ' AND (username ILIKE ? OR details ILIKE ? OR action ILIKE ? OR ip_address LIKE ?)';
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const countParams = [...params];
    const [[{ total }]] = await pool.query(`SELECT COUNT(id) AS total FROM audit_logs ${whereClause}`, countParams);

    const [logs] = await pool.query(`
      SELECT id, user_id, username, action, details, ip_address, created_at
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `, params);

    res.json({
      logs,
      total: parseInt(total, 10),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(parseInt(total, 10) / limitNum)
    });
  } catch (error) {
    console.error('Fetch audit logs error:', error);
    res.status(500).json({ message: 'Error retrieving audit logs' });
  }
});

module.exports = router;
