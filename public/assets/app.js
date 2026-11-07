// Shared helpers for every page
const ROLE_LABEL = { hr: 'HR', od_bu: 'OD BU', manager: 'Manager' };

function getUser() {
  try { return JSON.parse(localStorage.getItem('mp_user') || 'null'); } catch { return null; }
}

function logout() {
  localStorage.removeItem('mp_token');
  localStorage.removeItem('mp_user');
  location.href = '/login.html';
}

async function api(url, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  const token = localStorage.getItem('mp_token');
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401 && !url.includes('/login')) { logout(); throw new Error('Session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Call at the top of every protected page. roles = allowed roles (optional)
function initPage(roles) {
  const user = getUser();
  if (!user || !localStorage.getItem('mp_token')) { location.href = '/login.html'; return null; }
  if (roles && !roles.includes(user.role)) { location.href = '/dashboard.html'; return null; }
  const bar = document.createElement('header');
  bar.className = 'topbar';
  bar.innerHTML = `
    <div class="logo"><img src="/assets/logo.png" alt="" onerror="this.parentNode.style.display='none'"></div>
    <div class="app-name">Manpower Request Portal</div>
    <div class="spacer"></div>
    <div class="who">${esc(user.name || user.code)}<br><small>${ROLE_LABEL[user.role] || user.role}</small></div>
    <a class="btn-top" href="/dashboard.html">Home</a>
    <button onclick="logout()">Log out</button>`;
  document.body.prepend(bar);
  return user;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function showMsg(el, text, ok) {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
}

function typeBadge(t) {
  if (t === 'FTE') return '<span class="badge fte">FTE</span>';
  if (t === 'Outsource') return '<span class="badge out">Outsource</span>';
  return t ? `<span class="badge grey">${esc(t)}</span>` : '';
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
