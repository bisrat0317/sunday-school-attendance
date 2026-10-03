const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticateToken, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/auditLogger');

// GET /api/users/encoders - List encoder accounts for assigning sessions (Admin and Super Admin only)
router.get('/encoders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [encoders] = await pool.query(
      "SELECT id, username, full_name FROM users WHERE role = 'encoder' ORDER BY full_name ASC, username ASC"
    );
    res.json(encoders);
  } catch (error) {
    console.error('Fetch encoders error:', error);
    res.status(500).json({ message: 'Error retrieving encoders' });
  }
});

// GET /api/users - List system users (Admin and Super Admin)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === 'super_admin';
    let query = 'SELECT id, username, full_name, role, created_at FROM users ';
    if (!isSuperAdmin) {
      query += "WHERE role != 'super_admin' ";
    }
    query += 'ORDER BY created_at DESC';

    const [users] = await pool.query(query);
    res.json(users);
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ message: 'Error retrieving users' });
  }
});

// POST /api/users - Create new encoder, admin, or super admin (Admin and Super Admin)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, full_name, role } = req.body;

  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const isSuperAdmin = req.user.role === 'super_admin';
  const allowedRoles = isSuperAdmin ? ['super_admin', 'admin', 'encoder'] : ['admin', 'encoder'];

  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role selection' });
  }

  if (role === 'super_admin' && !isSuperAdmin) {
    return res.status(403).json({ message: 'Only Super Admin can create Super Admin accounts' });
  }

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(username)) = LOWER(?)', [username.trim()]);
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

// DELETE /api/users/:id - Delete user (Admin and Super Admin, cannot delete self or super_admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  try {
    const [existing] = await pool.query('SELECT username, full_name, role FROM users WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (existing[0].role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Cannot delete Super Admin accounts' });
    }

    const details = `Deleted user: ${existing[0].username} (${existing[0].full_name})`;

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
