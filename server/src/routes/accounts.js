import { Router } from 'express';
import { getAccountBalances } from '../services/balanceService.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json(await getAccountBalances(req.userId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
