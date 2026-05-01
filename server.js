const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const kraRoutes = require('./routes/kras');
const reportRoutes = require('./routes/reports');
const pool = require('./db');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/kras', kraRoutes);
app.use('/api/reports', reportRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// TAT Alert: runs every day at 8AM
cron.schedule('0 8 * * *', async () => {
  try {
    const result = await pool.query(`
      SELECT t.*, u.email FROM tasks t
      JOIN users u ON t.assigned_to = u.name
      WHERE t.status != 'done'
        AND t.due_date < NOW() + INTERVAL '1 day'
        AND t.due_date >= NOW()
    `);
    for (const task of result.rows) {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: task.email,
        subject: `Reminder: Task "${task.title}" is due tomorrow`,
        html: `<p>Hi ${task.assigned_to},</p>
               <p>Your task <b>${task.title}</b> is due tomorrow (${task.due_date.toDateString()}).</p>
               <p>Current status: <b>${task.status}</b></p>
               <p>Please update the status on StaffFlow.</p>`
      });
    }
    console.log(`TAT alerts sent for ${result.rows.length} tasks`);
  } catch (err) {
    console.error('TAT alert error:', err.message);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`StaffFlow backend running on port ${PORT}`));
