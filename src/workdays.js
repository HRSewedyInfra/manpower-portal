// Work week in Egypt: Sunday - Thursday (Friday & Saturday off)
const TZ = 'Africa/Cairo';

const STAGES = [
  { order: 1, name: 'OD BU',     days: 3 },
  { order: 2, name: 'OD Group',  days: 3 },
  { order: 3, name: 'HRIS',      days: 2 },
  { order: 4, name: 'HCM',       days: 2 },
];
const REQUISITION_DAYS = 10;

function cairoDate(ts) {
  // returns a Date at midnight UTC representing the Cairo calendar day
  const s = new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  return new Date(s + 'T00:00:00Z');
}

function isWorkday(d) {
  const day = d.getUTCDay(); // 5 = Fri, 6 = Sat
  return day !== 5 && day !== 6;
}

function addWorkdays(startTs, n) {
  const d = cairoDate(startTs);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkday(d)) added++;
  }
  return d.toISOString().slice(0, 10);
}

// work days passed after the start day, up to `endTs` (default now)
function workdaysBetween(startTs, endTs = Date.now()) {
  const a = cairoDate(startTs);
  const b = cairoDate(endTs);
  let n = 0;
  while (a < b) {
    a.setUTCDate(a.getUTCDate() + 1);
    if (isWorkday(a)) n++;
  }
  return n;
}

module.exports = { STAGES, REQUISITION_DAYS, addWorkdays, workdaysBetween };
