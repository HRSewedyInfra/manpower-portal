const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Managers see employees where they are manager 1 or manager 2; HR & OD BU see everyone
router.get('/actual', async (req, res) => {
  const all = req.user.role === 'hr' || req.user.role === 'od_bu';
  const { rows } = await pool.query(
    `SELECT code, name, title, department, location, emp_type
     FROM employees
     ${all ? '' : 'WHERE LOWER(manager1_code) = LOWER($1) OR LOWER(manager2_code) = LOWER($1)'}
     ORDER BY department, location, title, name`,
    all ? [] : [req.user.code]);
  res.json(rows);
});

module.exports = router;
