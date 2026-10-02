const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/auditLogger');

// GET /api/users - List system users (Super Admin only)
router.get('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(users);
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ message: 'Error retrieving users' });
  }
});

// POST /api/users - Create new encoder, admin, or super admin (Super Admin only)
router.post('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { username, password, full_name, role } = req.body;

  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  if (!['super_admin', 'admin', 'encoder'].includes(role)) {
    return res.status(400).json({ message: 'Role must be super_admin, admin, or encoder' });
  }

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?) RETURNING id',
      [username.trim(), passwordHash, full_name.trim(), role]
    );

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'USER_CREATE',
      details: `Created new user account: ${username.trim()} (${full_name.trim()}, role: ${role})`,
      req
    });

    res.status(201).json({
      message: 'User created successfully',
      userId: result.insertId
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Error creating user' });
  }
});

// DELETE /api/users/:id - Delete user (Super Admin only, cannot delete self)
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;

  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  try {
    const [existing] = await pool.query('SELECT username, full_name FROM users WHERE id = ?', [id]);
    const details = existing[0] ? `Deleted user: ${existing[0].username} (${existing[0].full_name})` : `Deleted user ID ${id}`;

    await pool.query('DELETE FROM users WHERE id = ?', [id]);

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'USER_DELETE',
      details,
      req
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Error deleting user' });
  }
});

// PATCH /api/users/:id/reset-password - Reset another user's password (Super Admin only)
router.patch('/:id/reset-password', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters long' });
  }

  try {
    const [existing] = await pool.query('SELECT username, full_name FROM users WHERE id = ?', [id]);
    const targetInfo = existing[0] ? `${existing[0].username} (${existing[0].full_name})` : `ID ${id}`;

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'USER_RESET_PASSWORD',
      details: `Reset password for user: ${targetInfo}`,
      req
    });

    res.json({ message: 'User password reset successfully' });
  } catch (error) {
    console.error('Reset user password error:', error);
    res.status(500).json({ message: 'Error resetting password' });
  }
});

module.exports = router;
