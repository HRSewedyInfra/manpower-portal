-- Manpower Request Portal schema (safe to run on every start)

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('hr','od_bu','manager')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- File 1: all employees (replaced fully on each upload)
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  emp_type TEXT NOT NULL DEFAULT '',
  manager1_code TEXT NOT NULL DEFAULT '',
  manager2_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_emp_m1 ON employees(manager1_code);
CREATE INDEX IF NOT EXISTS idx_emp_m2 ON employees(manager2_code);

-- File 2: titles each manager may request (replaced fully on each upload)
CREATE TABLE IF NOT EXISTS titles (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  manager1_code TEXT NOT NULL DEFAULT '',
  manager2_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_titles_m1 ON titles(manager1_code);
CREATE INDEX IF NOT EXISTS idx_titles_m2 ON titles(manager2_code);

CREATE TABLE IF NOT EXISTS upload_log (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  rows_count INT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- status: in_progress -> requisition_open -> closed   (or rejected / cancelled)
CREATE TABLE IF NOT EXISTS manpower_requests (
  id SERIAL PRIMARY KEY,
  manager_code TEXT NOT NULL,
  manager_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  required_from DATE NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','requisition_open','closed','rejected','cancelled')),
  taleo_number TEXT,
  taleo_opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS request_stages (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES manpower_requests(id) ON DELETE CASCADE,
  stage_order INT NOT NULL,
  stage_name TEXT NOT NULL,
  duration_days INT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  UNIQUE (request_id, stage_order)
);

CREATE TABLE IF NOT EXISTS request_comments (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES manpower_requests(id) ON DELETE CASCADE,
  author_code TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- v2: location on each request
ALTER TABLE manpower_requests ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';

-- v3: requests imported once from the old sheet
ALTER TABLE manpower_requests ADD COLUMN IF NOT EXISTS imported BOOLEAN NOT NULL DEFAULT FALSE;
