import client from '../db.js';
import { ACCOUNTS } from '../constants/categories.js';

export async function getDailySummary(date, userId) {
  const combined = (
    await client.execute({
      sql: `
        SELECT
          COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS total_in,
          COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS total_out
        FROM transactions WHERE date = :date AND user_id = :userId
      `,
      args: { date, userId },
    })
  ).rows[0];

  // The user_id predicate lives in the JOIN condition (not the WHERE) so a
  // zero-activity account for this user still produces a row (LEFT JOIN
  // preserved) instead of being filtered out entirely.
  const perAccount = (
    await client.execute({
      sql: `
        SELECT a.id AS account_id, a.name AS account_name,
          COALESCE(SUM(CASE WHEN t.direction = 'in' THEN t.amount ELSE 0 END), 0) AS total_in,
          COALESCE(SUM(CASE WHEN t.direction = 'out' THEN t.amount ELSE 0 END), 0) AS total_out
        FROM accounts a
        LEFT JOIN transactions t ON t.account_id = a.id AND t.date = :date AND t.user_id = :userId
        GROUP BY a.id, a.name
      `,
      args: { date, userId },
    })
  ).rows;

  const byCategoryOut = (
    await client.execute({
      sql: `
        SELECT category, SUM(amount) AS total
        FROM transactions
        WHERE date = :date AND direction = 'out' AND is_transfer = 0 AND user_id = :userId
        GROUP BY category
        ORDER BY total DESC
      `,
      args: { date, userId },
    })
  ).rows;

  const byCategoryIn = (
    await client.execute({
      sql: `
        SELECT category, SUM(amount) AS total
        FROM transactions
        WHERE date = :date AND direction = 'in' AND is_transfer = 0 AND user_id = :userId
        GROUP BY category
        ORDER BY total DESC
      `,
      args: { date, userId },
    })
  ).rows;

  return { date, combined, perAccount, byCategoryIn, byCategoryOut };
}

export async function getMonthlySummary(month, userId) {
  const totals = (
    await client.execute({
      sql: `
        SELECT
          COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS total_in,
          COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS total_out
        FROM transactions
        WHERE strftime('%Y-%m', date) = :month AND is_transfer = 0 AND user_id = :userId
      `,
      args: { month, userId },
    })
  ).rows[0];

  const byCategoryOut = (
    await client.execute({
      sql: `
        SELECT category, SUM(amount) AS total
        FROM transactions
        WHERE strftime('%Y-%m', date) = :month AND direction = 'out' AND is_transfer = 0 AND user_id = :userId
        GROUP BY category
        ORDER BY total DESC
      `,
      args: { month, userId },
    })
  ).rows;

  const byCategoryIn = (
    await client.execute({
      sql: `
        SELECT category, SUM(amount) AS total
        FROM transactions
        WHERE strftime('%Y-%m', date) = :month AND direction = 'in' AND is_transfer = 0 AND user_id = :userId
        GROUP BY category
        ORDER BY total DESC
      `,
      args: { month, userId },
    })
  ).rows;

  return {
    month,
    totalIn: totals.total_in,
    totalOut: totals.total_out,
    byCategoryIn,
    byCategoryOut,
  };
}

export async function getTransactionActivity(userId) {
  const rows = (
    await client.execute({
      sql: `
        SELECT account_id, strftime('%Y-%m', date) AS month
        FROM transactions
        WHERE user_id = :userId
        GROUP BY account_id, strftime('%Y-%m', date)
        ORDER BY month
      `,
      args: { userId },
    })
  ).rows;

  const byAccount = {};
  for (const id of Object.values(ACCOUNTS)) {
    byAccount[String(id)] = { months: [], earliest: null, latest: null };
  }

  const allMonths = new Set();
  for (const row of rows) {
    const key = String(row.account_id);
    if (!byAccount[key]) {
      byAccount[key] = { months: [], earliest: null, latest: null };
    }
    byAccount[key].months.push(row.month);
    allMonths.add(row.month);
  }

  for (const scope of Object.values(byAccount)) {
    scope.earliest = scope.months.length ? scope.months[0] : null;
    scope.latest = scope.months.length ? scope.months[scope.months.length - 1] : null;
  }

  const months = Array.from(allMonths).sort();

  return {
    all: {
      months,
      earliest: months.length ? months[0] : null,
      latest: months.length ? months[months.length - 1] : null,
    },
    byAccount,
  };
}
