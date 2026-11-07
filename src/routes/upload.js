const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use(requireAuth, requireRole('hr'));

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');

// Accepted header names for each field (compared after removing spaces/symbols)
const FIELDS = {
  code:       ['code', 'employeecode', 'empcode', 'id', 'employeeid', 'staffid', 'الكود', 'كود'],
  name:       ['name', 'employeename', 'fullname', 'englishname', 'arabicname', 'الاسم', 'اسم'],
  title:      ['title', 'jobtitle', 'position', 'positiontitle', 'الوظيفة'],
  department: ['department', 'dept', 'administration', 'organizationdescription', 'organization', 'الإدارة', 'الادارة'],
  location:   ['location', 'site', 'worklocation', 'الموقع', 'الموقع'],
  emp_type:   ['type', 'employmenttype', 'contracttype', 'fteoutsource', 'fte', 'النوع'],
  manager1:   ['manager1code', 'manager1', 'firstmanagercode', 'firstmanager', 'manager', 'managercode'],
  manager2:   ['manager2code', 'manager2', 'secondmanagercode', 'secondmanager'],
  national_id: ['nationalid', 'nid', 'nationalidnumber', 'idnumber', 'الرقمالقومي', 'رقمالبطاقة', 'رقمقومي'],
};

function readSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // raw values so long numbers (national IDs, codes) are not turned into 2.9E+13
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  if (!rows.length) return { rows: [], map: {} };
  const headers = Object.keys(rows[0]);
  const map = {};
  for (const [field, names] of Object.entries(FIELDS)) {
    const h = headers.find((x) => names.includes(norm(x)));
    if (h) map[field] = h;
  }
  return { rows, map, headers };
}

const clean = (v) => String(v == null ? '' : v).trim().replace(/\.0+$/, '');
const cleanText = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

function normalizeType(v) {
  const t = cleanText(v).toLowerCase();
  if (!t) return '';
  if (t.includes('out')) return 'Outsource';
  if (t.includes('fte') || t.includes('perm') || t.includes('direct')) return 'FTE';
  return cleanText(v);
}

function missing(map, needed) {
  return needed.filter((f) => !map[f]);
}

router.post('/employees', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an Excel file first' });
  const { rows, map, headers } = readSheet(req.file.buffer);
  const miss = missing(map, ['code', 'name', 'title', 'department', 'location', 'emp_type', 'manager1']);
  if (miss.length) {
    return res.status(400).json({ error: `Missing columns: ${miss.join(', ')}. Found: ${(headers || []).join(', ')}` });
  }
  const data = rows
    .map((r) => [
      clean(r[map.code]), cleanText(r[map.name]), cleanText(r[map.title]), cleanText(r[map.department]),
      cleanText(r[map.location]), normalizeType(r[map.emp_type]),
      clean(r[map.manager1]), map.manager2 ? clean(r[map.manager2]) : '',
    ])
    .filter((r) => r[0]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM employees');
    for (let i = 0; i < data.length; i += 500) {
      const chunk = data.slice(i, i + 500);
      const values = [];
      const params = [];
      chunk.forEach((r, j) => {
        values.push(`(${r.map((_, k) => `$${j * 8 + k + 1}`).join(',')})`);
        params.push(...r);
      });
      await client.query(
        `INSERT INTO employees (code,name,title,department,location,emp_type,manager1_code,manager2_code) VALUES ${values.join(',')}`,
        params);
    }
    await client.query('INSERT INTO upload_log (kind, rows_count, uploaded_by) VALUES ($1,$2,$3)',
      ['employees', data.length, req.user.code]);
    await client.query('COMMIT');
    res.json({ ok: true, rows: data.length });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.post('/titles', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an Excel file first' });
  const { rows, map, headers } = readSheet(req.file.buffer);
  const miss = missing(map, ['title', 'department']);
  if (miss.length) {
    return res.status(400).json({ error: `Missing columns: ${miss.join(', ')}. Found: ${(headers || []).join(', ')}` });
  }
  const data = rows
    .map((r) => [cleanText(r[map.title]), cleanText(r[map.department]),
      map.manager1 ? clean(r[map.manager1]) : '', map.manager2 ? clean(r[map.manager2]) : ''])
    .filter((r) => r[0]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM titles');
    for (const r of data) {
      await client.query('INSERT INTO titles (title, department, manager1_code, manager2_code) VALUES ($1,$2,$3,$4)', r);
    }
    await client.query('INSERT INTO upload_log (kind, rows_count, uploaded_by) VALUES ($1,$2,$3)',
      ['titles', data.length, req.user.code]);
    await client.query('COMMIT');
    res.json({ ok: true, rows: data.length });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// File 3: managers allowed to request. Only these get manager accounts.
// Password = last 4 digits of the national ID (the ID itself is never stored).
router.post('/managers', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an Excel file first' });
  const { hashPassword } = require('../auth');
  const { rows, map, headers } = readSheet(req.file.buffer);
  const miss = missing(map, ['code', 'name', 'national_id']);
  if (miss.length) {
    return res.status(400).json({ error: `Missing columns: ${miss.join(', ')}. Found: ${(headers || []).join(', ')}` });
  }

  const managers = [];
  const skipped = [];
  for (const r of rows) {
    const code = clean(r[map.code]);
    if (!code) continue;
    const digits = clean(r[map.national_id]).replace(/\D/g, '');
    if (digits.length < 4) { skipped.push(code); continue; }
    managers.push({ code, name: cleanText(r[map.name]), pass: digits.slice(-4) });
  }
  if (!managers.length) return res.status(400).json({ error: 'No valid rows found in the file' });

  const client = await pool.connect();
  let created = 0, updated = 0, removed = 0;
  try {
    await client.query('BEGIN');
    for (const m of managers) {
      const ex = await client.query('SELECT role FROM users WHERE LOWER(code) = LOWER($1)', [m.code]);
      if (!ex.rows.length) {
        await client.query('INSERT INTO users (code, name, role, password_hash) VALUES ($1,$2,$3,$4)',
          [m.code, m.name, 'manager', hashPassword(m.pass)]);
        created++;
      } else {
        // keep their current password and role (HR / OD BU stay as they are)
        await client.query('UPDATE users SET name = $1 WHERE LOWER(code) = LOWER($2)', [m.name, m.code]);
        updated++;
      }
    }
    // manager accounts not in the file lose access
    const del = await client.query(
      `DELETE FROM users WHERE role = 'manager' AND NOT (LOWER(code) = ANY($1))`,
      [managers.map((m) => m.code.toLowerCase())]);
    removed = del.rowCount;
    await client.query('INSERT INTO upload_log (kind, rows_count, uploaded_by) VALUES ($1,$2,$3)',
      ['managers', managers.length, req.user.code]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true, rows: managers.length, created, updated, removed, skipped });
});

router.get('/status', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (kind) kind, rows_count, uploaded_by, uploaded_at
    FROM upload_log ORDER BY kind, uploaded_at DESC`);
  res.json(rows);
});

module.exports = router;
