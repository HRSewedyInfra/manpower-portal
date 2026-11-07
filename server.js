const express = require('express');
const path = require('path');
const { initDb } = require('./src/db');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Wrap async routes so errors reach the error handler
const wrap = (router) => {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const l of layer.route.stack) {
      const fn = l.handle;
      if (fn.length <= 3) l.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    }
  }
  return router;
};

app.use('/api/auth', wrap(require('./src/routes/auth')));
app.use('/api/users', wrap(require('./src/routes/users')));
app.use('/api/upload', wrap(require('./src/routes/upload')));
app.use('/api/manpower', wrap(require('./src/routes/manpower')));
app.use('/api/requests', wrap(require('./src/routes/requests')));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/login.html'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error: ' + err.message });
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Manpower Portal running on port ${PORT}`)))
  .catch((e) => { console.error('Database init failed:', e); process.exit(1); });
