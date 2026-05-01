const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// Get all KRAs with their KPIs
router.get('/', authMiddleware, async (req, res) => {
  try {
    const kras = await pool.query('SELECT * FROM kras ORDER BY created_at DESC');
    const kpis = await pool.query('SELECT * FROM kpis ORDER BY created_at ASC');
    const result = kras.rows.map(k => ({
      ...k,
      kpis: kpis.rows.filter(p => p.kra_id === k.id)
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create KRA
router.post('/', authMiddleware, async (req, res) => {
  const { name, owner } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO kras (name, owner) VALUES ($1,$2) RETURNING *',
      [name, owner]
    );
    res.json({ ...result.rows[0], kpis: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update KRA
router.put('/:id', authMiddleware, async (req, res) => {
  const { name, owner } = req.body;
  try {
    const result = await pool.query(
      'UPDATE kras SET name=$1, owner=$2 WHERE id=$3 RETURNING *',
      [name, owner, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete KRA
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM kpis WHERE kra_id=$1', [req.params.id]);
    await pool.query('DELETE FROM kras WHERE id=$1', [req.params.id]);
    res.json({ message: 'KRA deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add KPI to a KRA
router.post('/:kraId/kpis', authMiddleware, async (req, res) => {
  const { name, target_value, current_value } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO kpis (kra_id, name, target_value, current_value) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.kraId, name, target_value, current_value]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update KPI value
router.patch('/kpis/:id', authMiddleware, async (req, res) => {
  const { current_value } = req.body;
  try {
    const result = await pool.query(
      'UPDATE kpis SET current_value=$1 WHERE id=$2 RETURNING *',
      [current_value, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete KPI
router.delete('/kpis/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM kpis WHERE id=$1', [req.params.id]);
    res.json({ message: 'KPI deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
