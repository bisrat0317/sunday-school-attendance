const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

let config;
if (connectionString) {
  config = {
    connectionString,
    ssl: { rejectUnauthorized: false }
  };
} else {
  const isRemote = process.env.DB_SSL === 'true' || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost');
  config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'attendance_db',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: isRemote ? { rejectUnauthorized: false } : false
  };
}

const pool = new Pool(config);

// Convert MySQL ? placeholders to PostgreSQL $1, $2, $3...
function convertPlaceholders(sql) {
  if (typeof sql !== 'string') return sql;
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

// Wrapper to provide compatibility with mysql2 [rows] pattern
async function query(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  const res = await pool.query(pgSql, params);

  const rows = res.rows || [];
  const resultObj = {
    insertId: rows[0]?.id || null,
    affectedRows: res.rowCount,
    rowCount: res.rowCount
  };

  Object.assign(rows, resultObj);
  return [rows, res.fields];
}

// Transaction client wrapper
async function getConnection() {
  const client = await pool.connect();

  return {
    query: async (sql, params = []) => {
      const pgSql = convertPlaceholders(sql);
      const res = await client.query(pgSql, params);
      const rows = res.rows || [];
      const resultObj = {
        insertId: rows[0]?.id || null,
        affectedRows: res.rowCount,
        rowCount: res.rowCount
      };
      Object.assign(rows, resultObj);
      return [rows, res.fields];
    },
    beginTransaction: async () => client.query('BEGIN'),
    commit: async () => client.query('COMMIT'),
    rollback: async () => client.query('ROLLBACK'),
    release: () => client.release()
  };
}

module.exports = {
  query,
  getConnection,
  pool
};
