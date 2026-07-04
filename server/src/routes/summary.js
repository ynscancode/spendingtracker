import { Router } from 'express';
import { getDailySummary, getMonthlySummary, getTransactionActivity } from '../services/summaryService.js';
import { isValidDateStr, isValidMonthStr } from '../utils/dateUtils.js';

const router = Router();

router.get('/daily', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || !isValidDateStr(date)) {
      return res.status(400).json({ error: 'date query param required in YYYY-MM-DD format' });
    }
    res.json(await getDailySummary(date, req.userId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/monthly', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !isValidMonthStr(month)) {
      return res.status(400).json({ error: 'month query param required in YYYY-MM format' });
    }
    res.json(await getMonthlySummary(month, req.userId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/activity', async (req, res) => {
  try {
    res.json(await getTransactionActivity(req.userId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
