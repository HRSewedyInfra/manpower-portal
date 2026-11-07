const express = require('express');
const { pool } = require('../db');
const { verifyPassword, hashPassword, createToken, requireAuth } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const code = String(req.body.code || '').trim();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(code) = LOWER($1)', [code]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong code or password' });
  }
  res.json({ token: createToken(user), user: { code: user.code, name: user.name, role: user.role } });
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

router.post('/change-password', requireAuth, async (req, res) => {
  const { current, next } = req.body;
  if (!next || String(next).length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE code = $1', [req.user.code]);
  if (!rows[0] || !verifyPassword(current, rows[0].password_hash)) {
    return res.status(400).json({ error: 'Current password is wrong' });
  }
  await pool.query('UPDATE users SET password_hash = $1 WHERE code = $2', [hashPassword(next), req.user.code]);
  res.json({ ok: true });
});

module.exports = router;
