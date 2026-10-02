const pool = require('../config/db');

/**
 * Record an audit log entry for administrative actions and system security
 * @param {Object} options
 * @param {number|null} [options.userId]
 * @param {string} [options.username]
 * @param {string} options.action - Short code e.g. 'LOGIN', 'STUDENT_CREATE', 'STUDENT_UPDATE', 'STUDENT_DELETE', 'STUDENT_STATUS', 'BULK_IMPORT', 'ATTENDANCE_SAVE', 'SESSION_CREATE', 'SESSION_DELETE', 'USER_CREATE', 'USER_DELETE', 'USER_RESET_PASSWORD', 'CHANGE_PASSWORD'
 * @param {string|Object} [options.details] - Description of the action performed
 * @param {string} [options.ip]
 * @param {Object} [options.req] - Express request object to extract user and client IP
 */
async function logActivity({ userId, username, action, details, ip, req }) {
  try {
    const uId = userId || req?.user?.id || null;
    const uName = username || req?.user?.username || 'system';
    
    let clientIp = ip;
    if (!clientIp && req) {
      clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    }
    const cleanIp = typeof clientIp === 'string' ? clientIp.split(',')[0].trim() : '';
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : String(details || '');

    await pool.query(
      'INSERT INTO audit_logs (user_id, username, action, details, ip_address) VALUES (?, ?, ?, ?, ?)',
      [uId, uName, action, detailsStr, cleanIp]
    );
  } catch (err) {
    console.error('Audit logging error:', err.message);
  }
}

module.exports = { logActivity };
