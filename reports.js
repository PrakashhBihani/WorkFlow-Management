const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// Dashboard summary
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const tasks = await pool.query('SELECT status, priority FROM tasks');
    const kpis = await pool.query('SELECT target_value, current_value FROM kpis');
    const kras = await pool.query('SELECT COUNT(*) FROM kras');

    const total = tasks.rows.length;
    const done = tasks.rows.filter(t => t.status === 'done').length;
    const inprog = tasks.rows.filter(t => t.status === 'in_progress').length;
    const highDone = tasks.rows.filter(t => t.status === 'done' && t.priority === 'high').length;

    const avgKpi = kpis.rows.length
      ? Math.round(kpis.rows.reduce((a, k) => a + (k.current_value / k.target_value * 100), 0) / kpis.rows.length)
      : 0;
    const onTrack = kpis.rows.filter(k => k.current_value / k.target_value >= 0.8).length;
    const kpiOnTrackPct = kpis.rows.length ? Math.round(onTrack / kpis.rows.length * 100) : 0;

    res.json({
      total_tasks: total,
      in_progress: inprog,
      completed: done,
      completion_rate: total ? Math.round(done / total * 100) : 0,
      high_priority_done: highDone,
      avg_kpi_score: avgKpi,
      kras_count: parseInt(kras.rows[0].count),
      kpis_on_track: kpiOnTrackPct
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tasks by assignee
router.get('/by-assignee', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT assigned_to, COUNT(*) as total,
        COUNT(CASE WHEN status='done' THEN 1 END) as done,
        COUNT(CASE WHEN status='in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status='to_do' THEN 1 END) as to_do
      FROM tasks GROUP BY assigned_to ORDER BY total DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Overdue tasks
router.get('/overdue', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM tasks WHERE due_date < NOW() AND status != 'done' ORDER BY due_date ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
