const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/users - List system users (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
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

// POST /api/users - Create new encoder or admin (Admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, full_name, role } = req.body;

  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  if (!['admin', 'encoder'].includes(role)) {
    return res.status(400).json({ message: 'Role must be admin or encoder' });
  }

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      [username.trim(), passwordHash, full_name.trim(), role]
    );

    res.status(201).json({
      message: 'User created successfully',
      userId: result.insertId
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Error creating user' });
  }
});

// DELETE /api/users/:id - Delete user (Cannot delete self)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  try {
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Error deleting user' });
  }
});

module.exports = router;

