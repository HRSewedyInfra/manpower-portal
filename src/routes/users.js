const express = require('express');
const { pool } = require('../db');
const { hashPassword, requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('hr'));

const ROLES = ['hr', 'od_bu', 'manager'];

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT code, name, role, created_at FROM users ORDER BY role, name');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const code = String(req.body.code || '').trim();
  const name = String(req.body.name || '').trim();
  const role = req.body.role;
  const password = String(req.body.password || '');
  if (!code || !ROLES.includes(role) || password.length < 4) {
    return res.status(400).json({ error: 'Code, role and a password (4+ characters) are required' });
  }
  try {
    await pool.query('INSERT INTO users (code, name, role, password_hash) VALUES ($1,$2,$3,$4)',
      [code, name, role, hashPassword(password)]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'This code already has an account' });
    throw e;
  }
});

router.put('/:code', async (req, res) => {
  const { name, role, password } = req.body;
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role && req.params.code === req.user.code && role !== 'hr') {
    return res.status(400).json({ error: 'You cannot remove your own HR role' });
  }
  if (name !== undefined) await pool.query('UPDATE users SET name = $1 WHERE code = $2', [name, req.params.code]);
  if (role) await pool.query('UPDATE users SET role = $1 WHERE code = $2', [role, req.params.code]);
  if (password) {
    if (String(password).length < 4) return res.status(400).json({ error: 'Password must be 4+ characters' });
    await pool.query('UPDATE users SET password_hash = $1 WHERE code = $2', [hashPassword(password), req.params.code]);
  }
  res.json({ ok: true });
});

router.delete('/:code', async (req, res) => {
  if (req.params.code === req.user.code) return res.status(400).json({ error: 'You cannot delete yourself' });
  await pool.query('DELETE FROM users WHERE code = $1', [req.params.code]);
  res.json({ ok: true });
});

// Create manager accounts for every manager code found in both files that has no account yet
router.post('/bulk-managers', async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 4) return res.status(400).json({ error: 'Default password must be 4+ characters' });
  const { rows } = await pool.query(`
    SELECT DISTINCT c AS code FROM (
      SELECT manager1_code AS c FROM employees UNION SELECT manager2_code FROM employees
      UNION SELECT manager1_code FROM titles UNION SELECT manager2_code FROM titles
    ) x
    WHERE c <> '' AND NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.code) = LOWER(x.c))`);
  const hash = hashPassword(password);
  let created = 0;
  for (const r of rows) {
    const nm = await pool.query('SELECT name FROM employees WHERE code = $1 LIMIT 1', [r.code]);
    await pool.query('INSERT INTO users (code, name, role, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING',
      [r.code, nm.rows[0] ? nm.rows[0].name : '', 'manager', hash]);
    created++;
  }
  res.json({ created });
});

module.exports = router;
