import { Router } from 'express';
import { getBudgetsForMonth, setBudget, ValidationError } from '../services/budgetService.js';

const router = Router();

function handleError(res, err) {
  if (err instanceof ValidationError || err.statusCode === 400) {
    return res.status(400).json({ error: err.message });
  }
  if (err.statusCode === 404) {
    return res.status(404).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/', async (req, res) => {
  try {
    const { month } = req.query;
    const budgets = await getBudgetsForMonth(month, req.userId);
    res.json({ month, budgets });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/', async (req, res) => {
  try {
    const result = await setBudget(req.body, req.userId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
