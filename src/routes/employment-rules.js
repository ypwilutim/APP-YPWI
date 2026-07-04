const express = require('express');
const db = require('../../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const rules = await db.query('SELECT * FROM employment_rules ORDER BY job_title_pattern');
    const statusRules = await db.query('SELECT * FROM employment_status_rules');
    res.json({ success: true, rules, statusRules });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching employment rules' });
  }
});

router.put('/', async (req, res) => {
  try {
    const { rules, statusRules } = req.body;
    await db.query('DELETE FROM employment_rules');
    await db.query('DELETE FROM employment_status_rules');
    for (const r of rules) {
      await db.query('INSERT INTO employment_rules (job_title_pattern, employment_type, min_years, max_years) VALUES (?, ?, ?, ?)',
        [r.job_title_pattern, r.employment_type, r.min_years, r.max_years]);
    }
    for (const r of statusRules) {
      await db.query('INSERT INTO employment_status_rules (employment_type, min_years, max_years) VALUES (?, ?, ?)',
        [r.employment_type, r.min_years, r.max_years]);
    }
    res.json({ success: true, message: 'Employment rules updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating employment rules' });
  }
});

module.exports = router;