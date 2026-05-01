const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// Get all tasks
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get tasks for specific user
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE assigned_to=$1 ORDER BY due_date ASC',
      [req.user.name]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create task
router.post('/', authMiddleware, async (req, res) => {
  const { title, assigned_to, status, priority, due_date, kra_linked, description } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, assigned_to, status, priority, due_date, kra_linked, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, assigned_to, status || 'to_do', priority || 'medium', due_date, kra_linked, description]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update task
router.put('/:id', authMiddleware, async (req, res) => {
  const { title, assigned_to, status, priority, due_date, kra_linked, description } = req.body;
  try {
    const result = await pool.query(
      `UPDATE tasks SET title=$1, assigned_to=$2, status=$3, priority=$4, due_date=$5,
       kra_linked=$6, description=$7, updated_at=NOW() WHERE id=$8 RETURNING *`,
      [title, assigned_to, status, priority, due_date, kra_linked, description, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update status only
router.patch('/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  try {
    const result = await pool.query(
      'UPDATE tasks SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete task
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
