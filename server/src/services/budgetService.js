import db from '../db.js';
import { getBudgetableNames } from './categoryService.js';
import { ACCOUNTS } from '../constants/categories.js';

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

// Budgeting is Spending-only by design — a Savings category is never a
// valid budget target even if a same-named category exists on Spending's
// independent list.
function assertValidCategory(category) {
  if (!category || !getBudgetableNames(ACCOUNTS.SPENDING).includes(category)) {
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

  const rows = db
    .prepare('SELECT category, amount FROM budgets WHERE month = @month')
    .all({ month });
  const byCategory = new Map(rows.map((row) => [row.category, row.amount]));

  return getBudgetableNames(ACCOUNTS.SPENDING).map((category) => ({
    category,
    amount: byCategory.get(category) ?? 0,
  }));
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

export { ValidationError };
