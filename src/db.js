const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' text (no timezone shifting)
types.setTypeParser(1082, (v) => v);

const url = process.env.DATABASE_URL || '';
const needsSsl = url && !/localhost|127\.0\.0\.1|\.internal/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);

  // First admin account (HR) if no users exist yet
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const { hashPassword } = require('./auth');
    const code = process.env.ADMIN_CODE || 'admin';
    const pass = process.env.ADMIN_PASSWORD || 'admin123';
    await pool.query(
      'INSERT INTO users (code, name, role, password_hash) VALUES ($1,$2,$3,$4)',
      [code, 'HR Admin', 'hr', hashPassword(pass)]
    );
    console.log(`Created first HR admin: ${code}`);
  }
}

module.exports = { pool, initDb };
