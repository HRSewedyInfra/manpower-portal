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
  project:    ['project', 'projectname', 'المشروع'],
  quantity:   ['number', 'numberneeded', 'quantity', 'qty', 'count', 'العدد'],
  required_from: ['requiredfrom', 'requireddate', 'neededfrom', 'startdate', 'from'],
  stage:      ['currentstage', 'stage', 'status', 'المرحلة'],
  taleo:      ['taleonumber', 'taleono', 'taleo', 'requisitionnumber', 'requisitionno'],
  request_date: ['requestdate', 'requestedon', 'date', 'createdat'],
  stage_date: ['stagestartdate', 'stagedate', 'instagesince', 'since'],
  comment:    ['comment', 'comments', 'odcomment', 'notes', 'ملاحظات'],
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

// ---------- One-time import of old requests that are already in progress ----------
function parseDate(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); // day/month/year
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return 'invalid';
}

// returns the stage number the request is in now: 1-4, or 5 = requisition open
function parseStage(v) {
  const t = norm(v);
  if (['odbu', 'bu'].includes(t)) return 1;
  if (['odgroup', 'group', 'groupod'].includes(t)) return 2;
  if (t === 'hris') return 3;
  if (t === 'hcm') return 4;
  if (['requisitionopen', 'requisition', 'open', 'taleo'].includes(t)) return 5;
  return 0;
}

router.get('/old-requests', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS n, MIN(l.uploaded_at) AS at FROM manpower_requests r
    LEFT JOIN upload_log l ON l.kind = 'old_requests' WHERE r.imported`);
  res.json(rows[0]);
});

router.post('/old-requests', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an Excel file first' });
  const already = await pool.query('SELECT 1 FROM manpower_requests WHERE imported LIMIT 1');
  if (already.rows.length) return res.status(400).json({ error: 'Old requests were already uploaded. Undo the import first if you need to upload again.' });

  const { rows, map, headers } = readSheet(req.file.buffer);
  const miss = missing(map, ['manager1', 'title', 'department', 'stage']);
  if (miss.length) {
    return res.status(400).json({ error: `Missing columns: ${miss.join(', ')}. Found: ${(headers || []).join(', ')}` });
  }

  const today = new Date().toISOString().slice(0, 10);
  const items = [];
  const errors = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const managerCode = clean(r[map.manager1]);
    const title = cleanText(r[map.title]);
    if (!managerCode && !title) return; // empty row
    const stage = parseStage(r[map.stage]);
    const requestDate = map.request_date ? parseDate(r[map.request_date]) : null;
    const stageDate = map.stage_date ? parseDate(r[map.stage_date]) : null;
    const requiredFrom = map.required_from ? parseDate(r[map.required_from]) : null;
    const taleo = map.taleo ? clean(r[map.taleo]) : '';
    if (!managerCode || !title) errors.push(`Row ${line}: manager code and title are required`);
    else if (!stage) errors.push(`Row ${line}: unknown stage "${r[map.stage]}" (use OD BU, OD Group, HRIS, HCM or Requisition open)`);
    else if ([requestDate, stageDate, requiredFrom].includes('invalid')) errors.push(`Row ${line}: a date is not readable (use YYYY-MM-DD or DD/MM/YYYY)`);
    else if (stage === 5 && !taleo) errors.push(`Row ${line}: Taleo number is required for Requisition open`);
    else {
      const created = requestDate || stageDate || today;
      items.push({
        managerCode, title, stage, taleo,
        department: cleanText(r[map.department]),
        location: map.location ? cleanText(r[map.location]) : '',
        project: map.project ? cleanText(r[map.project]) || '-' : '-',
        quantity: map.quantity ? Math.max(1, parseInt(r[map.quantity], 10) || 1) : 1,
        requiredFrom: requiredFrom || created,
        created,
        stageStart: stageDate || today,
        comment: map.comment ? cleanText(r[map.comment]) : '',
      });
    }
  });
  if (errors.length) return res.status(400).json({ error: 'Nothing was uploaded. Fix these rows first:\n' + errors.slice(0, 30).join('\n') });
  if (!items.length) return res.status(400).json({ error: 'No rows found in the file' });

  const { STAGES } = require('../workdays');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const it of items) {
      const nm = await client.query(
        `SELECT name FROM users WHERE LOWER(code) = LOWER($1)
         UNION ALL SELECT name FROM employees WHERE LOWER(code) = LOWER($1) LIMIT 1`, [it.managerCode]);
      const isOpen = it.stage === 5;
      const r = await client.query(
        `INSERT INTO manpower_requests (manager_code, manager_name, title, department, location, project, quantity,
           required_from, status, taleo_number, taleo_opened_at, created_at, imported)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE) RETURNING id`,
        [it.managerCode, nm.rows[0] ? nm.rows[0].name : '', it.title, it.department, it.location, it.project,
          it.quantity, it.requiredFrom, isOpen ? 'requisition_open' : 'in_progress', isOpen ? it.taleo : null,
          isOpen ? it.stageStart + 'T09:00:00+02:00' : null, it.created + 'T09:00:00+02:00']);
      const id = r.rows[0].id;
      for (const s of STAGES) {
        let started = null, completed = null, by = null;
        if (s.order < it.stage) { started = it.created + 'T09:00:00+02:00'; completed = it.stageStart + 'T09:00:00+02:00'; by = 'Imported'; }
        else if (s.order === it.stage) started = it.stageStart + 'T09:00:00+02:00';
        await client.query(
          `INSERT INTO request_stages (request_id, stage_order, stage_name, duration_days, started_at, completed_at, completed_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, s.order, s.name, s.days, started, completed, by]);
      }
      if (it.comment) {
        await client.query('INSERT INTO request_comments (request_id, author_code, author_name, body) VALUES ($1,$2,$3,$4)',
          [id, req.user.code, req.user.name || 'HR', it.comment]);
      }
    }
    await client.query("DELETE FROM upload_log WHERE kind = 'old_requests'");
    await client.query('INSERT INTO upload_log (kind, rows_count, uploaded_by) VALUES ($1,$2,$3)',
      ['old_requests', items.length, req.user.code]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true, rows: items.length });
});

// Undo: removes only the imported requests (in case the file had a mistake)
router.delete('/old-requests', async (req, res) => {
  const del = await pool.query('DELETE FROM manpower_requests WHERE imported');
  await pool.query("DELETE FROM upload_log WHERE kind = 'old_requests'");
  res.json({ ok: true, removed: del.rowCount });
});

router.get('/status', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (kind) kind, rows_count, uploaded_by, uploaded_at
    FROM upload_log ORDER BY kind, uploaded_at DESC`);
  res.json(rows);
});

module.exports = router;
