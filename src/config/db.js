const mysql = require('mysql2/promise');
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const defaultCaPath = path.join(__dirname, '../../certs/isrgrootx1.pem');
const caPath = process.env.DB_CA_PATH || defaultCaPath;

let sslConfig = false;
if (process.env.DB_SSL === 'true' || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost')) {
  if (fs.existsSync(caPath)) {
    sslConfig = { ca: fs.readFileSync(caPath) };
  } else {
    sslConfig = { rejectUnauthorized: false };
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || (process.env.DB_HOST && process.env.DB_HOST.includes('aiven') ? 'avnadmin' : 'root'),
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'attendance_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  ssl: sslConfig
});

module.exports = pool;
