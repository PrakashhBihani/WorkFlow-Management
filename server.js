const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'staffflow_secret';

// ─── AUTH MIDDLEWARE ───
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── AUTH ROUTES ───
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email.toLowerCase()]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Incorrect email or password.' });
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }, must_change_password: user.must_change_password });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { contact, method } = req.body;
  try {
    let user;
    if (method === 'whatsapp') {
      const phone = contact.replace(/\D/g, '').slice(-10);
      const r = await pool.query('SELECT * FROM users WHERE phone=$1 AND is_active=TRUE', [phone]);
      user = r.rows[0];
    } else {
      const r = await pool.query('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [contact.toLowerCase()]);
      user = r.rows[0];
    }
    if (!user) return res.status(404).json({ error: 'Not found. Contact your admin.' });
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('INSERT INTO otp_store (contact, method, otp, user_id, expires_at) VALUES ($1,$2,$3,$4,$5)', [contact, method, otp, user.id, expiresAt]);
    if (method === 'email') {
      const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
      await transporter.sendMail({ from: process.env.EMAIL_USER, to: contact, subject: 'StaffFlow OTP', html: `<h2>Your OTP: <b>${otp}</b></h2><p>Valid for 10 minutes.</p>` });
    }
    res.json({ message: `OTP sent via ${method}`, name: user.name });
  } catch (err) { res.status(500).json({ error: 'Failed to send OTP.' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { contact, method, otp, new_password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM otp_store WHERE contact=$1 AND method=$2 AND used=FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1', [contact, method]);
    const stored = r.rows[0];
    if (!stored) return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    if (stored.otp !== otp.trim()) return res.status(400).json({ error: 'Incorrect OTP.' });
    await pool.query('UPDATE otp_store SET used=TRUE WHERE id=$1', [stored.id]);
    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password=$1, must_change_password=FALSE WHERE id=$2', [hashed, stored.user_id]);
    res.json({ message: 'Password reset successfully.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/change-password', auth, async (req, res) => {
  const { old_password, new_password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = r.rows[0];
    if (!(await bcrypt.compare(old_password, user.password))) return res.status(401).json({ error: 'Current password incorrect.' });
    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password=$1, must_change_password=FALSE WHERE id=$2', [hashed, req.user.id]);
    res.json({ message: 'Password changed.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/users', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, email, phone, role, is_active, must_change_password, created_at FROM users ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/users', auth, async (req, res) => {
  if (!['admin','manager'].includes(req.user.role)) return res.status(403).json({ error: 'Admins only.' });
  const { name, email, phone, role, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const r = await pool.query('INSERT INTO users (name, email, phone, password, role, must_change_password) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id, name, email, phone, role, is_active, must_change_password', [name, email.toLowerCase(), phone || null, hashed, role || 'staff']);
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already registered.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/users/:id', auth, async (req, res) => {
  if (!['admin','manager'].includes(req.user.role)) return res.status(403).json({ error: 'Admins only.' });
  const { name, email, phone, role, is_active } = req.body;
  try {
    const r = await pool.query('UPDATE users SET name=$1, email=$2, phone=$3, role=$4, is_active=$5 WHERE id=$6 RETURNING id, name, email, phone, role, is_active', [name, email.toLowerCase(), phone || null, role, is_active, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/users/:id/reset-password', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  const hashed = await bcrypt.hash(req.body.new_password, 10);
  await pool.query('UPDATE users SET password=$1, must_change_password=TRUE WHERE id=$2', [hashed, req.params.id]);
  res.json({ message: 'Password reset.' });
});

app.patch('/api/auth/users/:id/toggle', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  const r = await pool.query('UPDATE users SET is_active = NOT is_active WHERE id=$1 RETURNING id, name, is_active', [req.params.id]);
  res.json(r.rows[0]);
});

// ─── TASK ROUTES ───
app.get('/api/tasks', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks', auth, async (req, res) => {
  const { title, assigned_to, status, priority, due_date, kra_linked, description } = req.body;
  try {
    const r = await pool.query('INSERT INTO tasks (title, assigned_to, status, priority, due_date, kra_linked, description) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [title, assigned_to, status || 'to_do', priority || 'medium', due_date, kra_linked, description]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/tasks/:id', auth, async (req, res) => {
  const { title, assigned_to, status, priority, due_date, kra_linked, description } = req.body;
  try {
    const r = await pool.query('UPDATE tasks SET title=$1, assigned_to=$2, status=$3, priority=$4, due_date=$5, kra_linked=$6, description=$7, updated_at=NOW() WHERE id=$8 RETURNING *', [title, assigned_to, status, priority, due_date, kra_linked, description, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/tasks/:id/status', auth, async (req, res) => {
  try {
    const r = await pool.query('UPDATE tasks SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── KRA ROUTES ───
app.get('/api/kras', auth, async (req, res) => {
  try {
    const kras = await pool.query('SELECT * FROM kras ORDER BY created_at DESC');
    const kpis = await pool.query('SELECT * FROM kpis ORDER BY created_at ASC');
    res.json(kras.rows.map(k => ({ ...k, kpis: kpis.rows.filter(p => p.kra_id === k.id) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/kras', auth, async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO kras (name, owner) VALUES ($1,$2) RETURNING *', [req.body.name, req.body.owner]);
    res.json({ ...r.rows[0], kpis: [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/kras/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM kpis WHERE kra_id=$1', [req.params.id]);
    await pool.query('DELETE FROM kras WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/kras/:kraId/kpis', auth, async (req, res) => {
  const { name, target_value, current_value } = req.body;
  try {
    const r = await pool.query('INSERT INTO kpis (kra_id, name, target_value, current_value) VALUES ($1,$2,$3,$4) RETURNING *', [req.params.kraId, name, target_value, current_value]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/kras/kpis/:id', auth, async (req, res) => {
  try {
    const r = await pool.query('UPDATE kpis SET current_value=$1 WHERE id=$2 RETURNING *', [req.body.current_value, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/kras/kpis/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM kpis WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── REPORTS ROUTES ───
app.get('/api/reports/summary', auth, async (req, res) => {
  try {
    const tasks = await pool.query('SELECT status, priority FROM tasks');
    const kpis = await pool.query('SELECT target_value, current_value FROM kpis');
    const kras = await pool.query('SELECT COUNT(*) FROM kras');
    const total = tasks.rows.length;
    const done = tasks.rows.filter(t => t.status === 'done').length;
    const avgKpi = kpis.rows.length ? Math.round(kpis.rows.reduce((a, k) => a + (k.current_value / k.target_value * 100), 0) / kpis.rows.length) : 0;
    const onTrack = kpis.rows.filter(k => k.current_value / k.target_value >= 0.8).length;
    res.json({ total_tasks: total, in_progress: tasks.rows.filter(t => t.status === 'in_progress').length, completed: done, completion_rate: total ? Math.round(done / total * 100) : 0, high_priority_done: tasks.rows.filter(t => t.status === 'done' && t.priority === 'high').length, avg_kpi_score: avgKpi, kras_count: parseInt(kras.rows[0].count), kpis_on_track: kpis.rows.length ? Math.round(onTrack / kpis.rows.length * 100) : 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reports/by-assignee', auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT assigned_to, COUNT(*) as total, COUNT(CASE WHEN status='done' THEN 1 END) as done, COUNT(CASE WHEN status='in_progress' THEN 1 END) as in_progress, COUNT(CASE WHEN status='to_do' THEN 1 END) as to_do FROM tasks GROUP BY assigned_to ORDER BY total DESC");
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reports/overdue', auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM tasks WHERE due_date < NOW() AND status != 'done' ORDER BY due_date ASC");
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'StaffFlow is running!' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`StaffFlow running on port ${PORT}`));  
