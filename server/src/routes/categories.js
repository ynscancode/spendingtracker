import { Router } from 'express';
import { listCategories, createCategory, deleteCategory, ValidationError } from '../services/categoryService.js';

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
    const categories = await listCategories(req.query.account_id, req.userId);
    res.json(categories);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const result = await createCategory(req.body, req.userId);
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteCategory(req.params.id, req.userId);
    res.status(204).send();
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
