import client from '../db.js';
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
async function assertValidCategory(category, userId) {
  if (!category || !(await getBudgetableNames(ACCOUNTS.SPENDING, userId)).includes(category)) {
    throw new ValidationError(`category "${category}" is not budgetable`);
  }
}

function assertValidAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new ValidationError('amount must be a finite number >= 0');
  }
}

export async function getBudgetsForMonth(month, userId) {
  assertValidMonth(month);

  const rows = (
    await client.execute({
      sql: 'SELECT category, amount FROM budgets WHERE month = :month AND user_id = :userId',
      args: { month, userId },
    })
  ).rows;
  const byCategory = new Map(rows.map((row) => [row.category, row.amount]));

  return (await getBudgetableNames(ACCOUNTS.SPENDING, userId)).map((category) => ({
    category,
    amount: byCategory.get(category) ?? 0,
  }));
}

export async function setBudget({ month, category, amount }, userId) {
  assertValidMonth(month);
  await assertValidCategory(category, userId);
  assertValidAmount(amount);

  await client.execute({
    sql: `
      INSERT INTO budgets (month, category, amount, user_id)
      VALUES (:month, :category, :amount, :userId)
      ON CONFLICT(user_id, month, category) DO UPDATE SET amount = excluded.amount
    `,
    args: { month, category, amount, userId },
  });

  return { month, category, amount };
}

export { ValidationError };
