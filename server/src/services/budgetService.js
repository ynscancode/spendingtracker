import db from '../db.js';
import { BUDGETABLE_CATEGORIES } from '../constants/categories.js';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertValidMonth(month) {
  if (!month || typeof month !== 'string' || !MONTH_RE.test(month)) {
    throw new ValidationError('month must be in YYYY-MM format');
  }
}

function assertValidCategory(category) {
  if (!category || !BUDGETABLE_CATEGORIES.includes(category)) {
    throw new ValidationError(`category "${category}" is not budgetable`);
  }
}

function assertValidAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new ValidationError('amount must be a finite number >= 0');
  }
}

export function getBudgetsForMonth(month) {
  assertValidMonth(month);
  return db
    .prepare('SELECT category, amount FROM budgets WHERE month = @month ORDER BY category')
    .all({ month });
}

export function setBudget({ month, category, amount }) {
  assertValidMonth(month);
  assertValidCategory(category);
  assertValidAmount(amount);

  db.prepare(`
    INSERT INTO budgets (month, category, amount)
    VALUES (@month, @category, @amount)
    ON CONFLICT(month, category) DO UPDATE SET amount = excluded.amount
  `).run({ month, category, amount });

  return { month, category, amount };
}

export function clearBudget({ month, category }) {
  assertValidMonth(month);
  assertValidCategory(category);

  db.prepare('DELETE FROM budgets WHERE month = @month AND category = @category').run({ month, category });
}

export { ValidationError };
