import client from '../db.js';

// The `t.user_id = :userId` filter lives INSIDE this subquery (not applied
// as an outer WHERE) so that another user's rows can never enter the
// PARTITION BY account_id / ORDER BY date, id running-balance window in the
// first place — filtering only outside would still let another user's rows
// shift the balance calculation before being discarded.
const runningBalanceSql = `
  SELECT t.*,
    SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END)
      OVER (PARTITION BY account_id ORDER BY date, id) AS running_balance
  FROM transactions t
  WHERE t.user_id = :userId
`;

export async function listTransactionsWithBalance({ from, to, accountId, userId } = {}) {
  const clauses = [];
  const params = { userId };

  if (from) {
    clauses.push('date >= :from');
    params.from = from;
  }
  if (to) {
    clauses.push('date <= :to');
    params.to = to;
  }
  if (accountId) {
    clauses.push('account_id = :accountId');
    params.accountId = accountId;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT * FROM (${runningBalanceSql}) ${where} ORDER BY date, id`;
  const result = await client.execute({ sql, args: params });
  return result.rows;
}

// The `accounts` table stays GLOBAL (Spending/Savings are shared, fixed
// rows) — only the transaction aggregate summed per account is scoped to
// the calling user.
export async function getAccountBalances(userId) {
  const accounts = (await client.execute('SELECT * FROM accounts')).rows;
  const balances = [];
  for (const account of accounts) {
    const row = (
      await client.execute({
        sql: `SELECT SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) AS balance
              FROM transactions WHERE account_id = :accountId AND user_id = :userId`,
        args: { accountId: account.id, userId },
      })
    ).rows[0];
    balances.push({ ...account, balance: row.balance ?? 0 });
  }
  return balances;
}
