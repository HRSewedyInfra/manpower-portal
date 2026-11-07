const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { STAGES, REQUISITION_DAYS, addWorkdays, workdaysBetween } = require('../workdays');

const router = express.Router();
router.use(requireAuth);

const isOD = (u) => u.role === 'od_bu' || u.role === 'hr';
const odOnly = requireRole('od_bu', 'hr');

router.get('/config', (req, res) => res.json({ stages: STAGES, requisitionDays: REQUISITION_DAYS }));

// Titles this manager can request (manager 1 or manager 2 on the titles file)
router.get('/my-titles', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT title, department FROM titles
     WHERE LOWER(manager1_code) = LOWER($1) OR LOWER(manager2_code) = LOWER($1)
     ORDER BY department, title`, [req.user.code]);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const title = String(req.body.title || '').trim();
  const department = String(req.body.department || '').trim();
  const project = String(req.body.project || '').trim();
  const quantity = parseInt(req.body.quantity, 10) || 1;
  const requiredFrom = String(req.body.required_from || '');
  const notes = String(req.body.notes || '').trim();

  if (!title || !project || !/^\d{4}-\d{2}-\d{2}$/.test(requiredFrom) || quantity < 1) {
    return res.status(400).json({ error: 'Title, project, quantity and required date are required' });
  }
  const allowed = await pool.query(
    `SELECT 1 FROM titles WHERE title = $1 AND department = $2
     AND (LOWER(manager1_code) = LOWER($3) OR LOWER(manager2_code) = LOWER($3)) LIMIT 1`,
    [title, department, req.user.code]);
  if (!allowed.rows.length) return res.status(403).json({ error: 'This title is not assigned to you' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO manpower_requests (manager_code, manager_name, title, department, project, quantity, required_from, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
      [req.user.code, req.user.name || '', title, department, project, quantity, requiredFrom, notes]);
    const { id, created_at } = r.rows[0];
    for (const s of STAGES) {
      await client.query(
        `INSERT INTO request_stages (request_id, stage_order, stage_name, duration_days, started_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, s.order, s.name, s.days, s.order === 1 ? created_at : null]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, id });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

function decorate(request, stages, comments) {
  const now = Date.now();
  const st = stages.map((s) => {
    const due = s.started_at ? addWorkdays(s.started_at, s.duration_days) : null;
    const used = s.started_at ? workdaysBetween(s.started_at, s.completed_at || now) : null;
    return {
      order: s.stage_order, name: s.stage_name, days: s.duration_days,
      started_at: s.started_at, completed_at: s.completed_at, completed_by: s.completed_by,
      due_date: due, days_used: used,
      state: s.completed_at ? 'done' : s.started_at ? 'current' : 'waiting',
      late: used !== null && used > s.duration_days,
    };
  });
  let requisition = null;
  if (request.taleo_opened_at) {
    const used = workdaysBetween(request.taleo_opened_at, request.closed_at || now);
    requisition = {
      number: request.taleo_number, opened_at: request.taleo_opened_at,
      due_date: addWorkdays(request.taleo_opened_at, REQUISITION_DAYS),
      days: REQUISITION_DAYS, days_used: used, late: used > REQUISITION_DAYS,
    };
  }
  const current = st.find((s) => s.state === 'current');
  return { ...request, stages: st, requisition, current_stage: current ? current.name : null, comments };
}

async function loadRequests(where, params) {
  const reqs = await pool.query(`SELECT * FROM manpower_requests ${where} ORDER BY created_at DESC`, params);
  if (!reqs.rows.length) return [];
  const ids = reqs.rows.map((r) => r.id);
  const stages = await pool.query('SELECT * FROM request_stages WHERE request_id = ANY($1) ORDER BY stage_order', [ids]);
  const comments = await pool.query('SELECT * FROM request_comments WHERE request_id = ANY($1) ORDER BY created_at', [ids]);
  return reqs.rows.map((r) => decorate(
    r,
    stages.rows.filter((s) => s.request_id === r.id),
    comments.rows.filter((c) => c.request_id === r.id)));
}

// Manager: own requests + requests on titles they share with another manager. OD BU / HR: all.
router.get('/', async (req, res) => {
  if (isOD(req.user)) return res.json(await loadRequests('', []));
  res.json(await loadRequests(
    `WHERE LOWER(manager_code) = LOWER($1) OR EXISTS (
       SELECT 1 FROM titles t WHERE t.title = manpower_requests.title AND t.department = manpower_requests.department
       AND (LOWER(t.manager1_code) = LOWER($1) OR LOWER(t.manager2_code) = LOWER($1)))`,
    [req.user.code]));
});

async function getRequest(id) {
  const list = await loadRequests('WHERE id = $1', [id]);
  return list[0];
}

async function addComment(id, user, body) {
  await pool.query('INSERT INTO request_comments (request_id, author_code, author_name, body) VALUES ($1,$2,$3,$4)',
    [id, user.code, user.name || '', body]);
}

// OD BU marks the current stage as done -> next stage starts
router.post('/:id/complete-stage', odOnly, async (req, res) => {
  const r = await getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'in_progress') return res.status(400).json({ error: 'Request is not in progress' });
  const cur = r.stages.find((s) => s.state === 'current');
  if (!cur) return res.status(400).json({ error: 'All stages are already done' });
  await pool.query(
    'UPDATE request_stages SET completed_at = NOW(), completed_by = $1 WHERE request_id = $2 AND stage_order = $3',
    [req.user.name || req.user.code, r.id, cur.order]);
  await pool.query(
    'UPDATE request_stages SET started_at = NOW() WHERE request_id = $1 AND stage_order = $2',
    [r.id, cur.order + 1]);
  if (req.body.comment) await addComment(r.id, req.user, String(req.body.comment));
  res.json(await getRequest(r.id));
});

// OD BU undoes the last completed stage (mistake fix)
router.post('/:id/undo-stage', odOnly, async (req, res) => {
  const r = await getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'in_progress') return res.status(400).json({ error: 'Only in-progress requests can be changed' });
  const done = r.stages.filter((s) => s.state === 'done');
  if (!done.length) return res.status(400).json({ error: 'No completed stage to undo' });
  const last = done[done.length - 1];
  await pool.query('UPDATE request_stages SET completed_at = NULL, completed_by = NULL WHERE request_id = $1 AND stage_order = $2',
    [r.id, last.order]);
  await pool.query('UPDATE request_stages SET started_at = NULL WHERE request_id = $1 AND stage_order = $2',
    [r.id, last.order + 1]);
  res.json(await getRequest(r.id));
});

// After the 4 stages: OD BU enters the Taleo requisition number
router.post('/:id/taleo', odOnly, async (req, res) => {
  const number = String(req.body.number || '').trim();
  if (!number) return res.status(400).json({ error: 'Enter the Taleo requisition number' });
  const r = await getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.stages.some((s) => s.state !== 'done')) return res.status(400).json({ error: 'Finish all 4 stages first' });
  if (r.status === 'requisition_open') {
    await pool.query('UPDATE manpower_requests SET taleo_number = $1 WHERE id = $2', [number, r.id]);
  } else if (r.status === 'in_progress') {
    await pool.query(
      `UPDATE manpower_requests SET taleo_number = $1, taleo_opened_at = NOW(), status = 'requisition_open' WHERE id = $2`,
      [number, r.id]);
  } else {
    return res.status(400).json({ error: 'Request is already finished' });
  }
  res.json(await getRequest(r.id));
});

router.post('/:id/close', odOnly, async (req, res) => {
  const r = await getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'requisition_open') return res.status(400).json({ error: 'Only open requisitions can be closed' });
  await pool.query(`UPDATE manpower_requests SET status = 'closed', closed_at = NOW() WHERE id = $1`, [r.id]);
  if (req.body.comment) await addComment(r.id, req.user, String(req.body.comment));
  res.json(await getRequest(r.id));
});

router.post('/:id/reject', odOnly, async (req, res) => {
  const comment = String(req.body.comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'Write the rejection reason' });
  const r = await getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (!['in_progress', 'requisition_open'].includes(r.status)) return res.status(400).json({ error: 'Request is already finished' });
  await pool.query(`UPDATE manpower_requests SET status = 'rejected', closed_at = NOW() WHERE id = $1`, [r.id]);
  await addComment(r.id, req.user, 'Rejected: ' + comment);
  res.json(await getRequest(r.id));
});

router.post('/:id/comments', odOnly, async (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment is empty' });
  const r = await getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  await addComment(r.id, req.user, body);
  res.json(await getRequest(r.id));
});

// Manager cancels own request while OD BU has not finished the first stage
router.post('/:id/cancel', async (req, res) => {
  const r = await getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.manager_code.toLowerCase() !== req.user.code.toLowerCase()) return res.status(403).json({ error: 'Not your request' });
  if (r.status !== 'in_progress' || r.stages[0].state === 'done') {
    return res.status(400).json({ error: 'Request can only be cancelled before OD BU finishes its stage' });
  }
  await pool.query(`UPDATE manpower_requests SET status = 'cancelled', closed_at = NOW() WHERE id = $1`, [r.id]);
  res.json(await getRequest(r.id));
});

module.exports = router;
