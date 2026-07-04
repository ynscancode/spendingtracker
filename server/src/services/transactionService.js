import XLSX from 'xlsx';
import client from '../db.js';
import { ACCOUNTS } from '../constants/categories.js';
import { isValidNormalCategory } from './categoryService.js';
import { listTransactionsWithBalance } from './balanceService.js';

// Categories only ever set by the transfer flow, never picked manually on a
// normal transaction. The transfer-insert path below still writes these
// literal strings directly (ADR-023 AC5 — zero behavior change there); this
// constant exists only to reject them on the normal POST/PUT path.
const TRANSFER_CATEGORIES = ['transfer-in', 'transfer-out'];

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

// EXECUTOR-THREADING: every write-service fn below takes an optional `exec`
// (a libsql interactive-transaction handle) defaulting to the module
// `client`. When a caller (e.g. importService.commitImport) already owns an
// open transaction and passes it in, we use it directly and never
// commit/rollback (the caller owns that lifecycle). When `exec` is left at
// its default (the bare `client`), the function opens, commits, and rolls
// back its own transaction — this is REQUIRED because a plain
// `client.execute` runs on a different connection than an already-open
// transaction and would silently lose atomicity across the batch (see team
// board Batch 8 contract).
async function withTransactionalExecutor(exec, body) {
  if (exec !== client) {
    // Caller-owned transaction — use it as-is, no commit/rollback here.
    return body(exec);
  }
  const tx = await client.transaction('write');
  try {
    const result = await body(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function assertValidNormalTransaction({ date, account_id, direction, category, amount }, userId, exec = client) {
  if (!date || !account_id || !direction || !category || amount == null) {
    throw new ValidationError('date, account_id, direction, category, and amount are required');
  }
  if (!['in', 'out'].includes(direction)) {
    throw new ValidationError('direction must be "in" or "out"');
  }
  if (TRANSFER_CATEGORIES.includes(category)) {
    throw new ValidationError('transfer categories cannot be set on normal transactions');
  }
  // Validation read is threaded through `exec` (not the bare module client)
  // so that when this runs inside commitImport's single interactive
  // transaction, it sees categories created earlier IN THAT SAME
  // transaction (e.g. a just-created category referenced by a later
  // transaction draft in the same import batch) — reading via the bare
  // client would miss uncommitted writes made through a separate tx handle.
  if (!(await isValidNormalCategory(category, direction, account_id, userId, exec))) {
    throw new ValidationError(`category "${category}" is not valid for direction "${direction}"`);
  }
  if (typeof amount !== 'number' || amount <= 0) {
    throw new ValidationError('amount must be a positive number');
  }
}

export async function createTransaction({ date, account_id, direction, category, amount, comment = '' }, userId, exec = client) {
  await assertValidNormalTransaction({ date, account_id, direction, category, amount }, userId, exec);

  return withTransactionalExecutor(exec, async (runner) => {
    const result = await runner.execute({
      sql: `
        INSERT INTO transactions (date, account_id, direction, category, amount, comment, is_transfer, user_id)
        VALUES (:date, :account_id, :direction, :category, :amount, :comment, 0, :userId)
      `,
      args: { date, account_id, direction, category, amount, comment, userId },
    });
    const id = Number(result.lastInsertRowid);
    const row = (
      await runner.execute({ sql: 'SELECT * FROM transactions WHERE id = :id AND user_id = :userId', args: { id, userId } })
    ).rows[0];
    return row;
  });
}

function defaultCommentFor(fromAccountId, toAccountId) {
  if (fromAccountId === ACCOUNTS.SAVINGS && toAccountId === ACCOUNTS.SPENDING) {
    return { out: 'topup spending from savings', in: 'topup spending from savings' };
  }
  if (fromAccountId === ACCOUNTS.SPENDING && toAccountId === ACCOUNTS.SAVINGS) {
    return { out: 'transfer to savings', in: 'transfer to savings' };
  }
  return { out: 'internal transfer', in: 'internal transfer' };
}

export async function createTransfer({ date, from_account_id, to_account_id, amount, comment }, userId, exec = client) {
  if (!date || !from_account_id || !to_account_id || amount == null) {
    throw new ValidationError('date, from_account_id, to_account_id, and amount are required');
  }
  if (from_account_id === to_account_id) {
    throw new ValidationError('from_account_id and to_account_id must differ');
  }
  if (typeof amount !== 'number' || amount <= 0) {
    throw new ValidationError('amount must be a positive number');
  }

  const defaults = defaultCommentFor(from_account_id, to_account_id);
  const outComment = comment ?? defaults.out;
  const inComment = comment ?? defaults.in;

  return withTransactionalExecutor(exec, async (runner) => {
    const insertSql = `
      INSERT INTO transactions (date, account_id, direction, category, amount, comment, is_transfer, linked_transaction_id, user_id)
      VALUES (:date, :account_id, :direction, :category, :amount, :comment, 1, :linked_transaction_id, :userId)
    `;

    const outResult = await runner.execute({
      sql: insertSql,
      args: {
        date, account_id: from_account_id, direction: 'out', category: 'transfer-out',
        amount, comment: outComment, linked_transaction_id: null, userId,
      },
    });
    const outId = Number(outResult.lastInsertRowid);

    const inResult = await runner.execute({
      sql: insertSql,
      args: {
        date, account_id: to_account_id, direction: 'in', category: 'transfer-in',
        amount, comment: inComment, linked_transaction_id: outId, userId,
      },
    });
    const inId = Number(inResult.lastInsertRowid);

    await runner.execute({
      sql: 'UPDATE transactions SET linked_transaction_id = :inId WHERE id = :outId AND user_id = :userId',
      args: { inId, outId, userId },
    });

    const outRow = (
      await runner.execute({ sql: 'SELECT * FROM transactions WHERE id = :id AND user_id = :userId', args: { id: outId, userId } })
    ).rows[0];
    const inRow = (
      await runner.execute({ sql: 'SELECT * FROM transactions WHERE id = :id AND user_id = :userId', args: { id: inId, userId } })
    ).rows[0];

    return { outRow, inRow };
  });
}

export async function updateTransaction(id, { date, amount, comment, category }, userId, exec = client) {
  const existing = (
    await exec.execute({ sql: 'SELECT * FROM transactions WHERE id = :id AND user_id = :userId', args: { id, userId } })
  ).rows[0];
  if (!existing) {
    const err = new Error('Transaction not found');
    err.statusCode = 404;
    throw err;
  }

  if (amount != null && (typeof amount !== 'number' || amount <= 0)) {
    throw new ValidationError('amount must be a positive number');
  }

  if (category != null) {
    if (existing.is_transfer) {
      throw new ValidationError('category cannot be changed on a transfer');
    }
    if (TRANSFER_CATEGORIES.includes(category)) {
      throw new ValidationError('transfer categories cannot be set on normal transactions');
    }
    if (!(await isValidNormalCategory(category, existing.direction, existing.account_id, userId, exec))) {
      throw new ValidationError(`category "${category}" is not valid for direction "${existing.direction}"`);
    }
  }

  const updates = {
    date: date ?? existing.date,
    amount: amount ?? existing.amount,
    comment: comment ?? existing.comment,
    category: category ?? existing.category,
  };

  await withTransactionalExecutor(exec, async (runner) => {
    await runner.execute({
      sql: 'UPDATE transactions SET date = :date, amount = :amount, comment = :comment, category = :category WHERE id = :id AND user_id = :userId',
      args: { ...updates, id, userId },
    });

    if (existing.is_transfer && existing.linked_transaction_id) {
      await runner.execute({
        sql: 'UPDATE transactions SET date = :date, amount = :amount, comment = :comment WHERE id = :id AND user_id = :userId',
        args: { date: updates.date, amount: updates.amount, comment: updates.comment, id: existing.linked_transaction_id, userId },
      });
    }
  });

  return (
    await exec.execute({ sql: 'SELECT * FROM transactions WHERE id = :id AND user_id = :userId', args: { id, userId } })
  ).rows[0];
}

export async function deleteTransaction(id, userId, exec = client) {
  const existing = (
    await exec.execute({ sql: 'SELECT * FROM transactions WHERE id = :id AND user_id = :userId', args: { id, userId } })
  ).rows[0];
  if (!existing) {
    const err = new Error('Transaction not found');
    err.statusCode = 404;
    throw err;
  }

  await withTransactionalExecutor(exec, async (runner) => {
    if (existing.is_transfer && existing.linked_transaction_id) {
      // Clear the mutual linked_transaction_id references first so deleting
      // either row doesn't violate the self-referencing foreign key.
      await runner.execute({
        sql: 'UPDATE transactions SET linked_transaction_id = NULL WHERE id IN (:id, :linkedId) AND user_id = :userId',
        args: { id, linkedId: existing.linked_transaction_id, userId },
      });
      await runner.execute({
        sql: 'DELETE FROM transactions WHERE id = :linkedId AND user_id = :userId',
        args: { linkedId: existing.linked_transaction_id, userId },
      });
    }
    await runner.execute({ sql: 'DELETE FROM transactions WHERE id = :id AND user_id = :userId', args: { id, userId } });
  });
}

export async function deleteAllTransactions(userId, exec = client) {
  return withTransactionalExecutor(exec, async (runner) => {
    // Null out every self-referencing linked_transaction_id first so the
    // subsequent bulk DELETE never violates the self-referencing FK
    // (a transfer leg's row would otherwise still be referenced by its
    // not-yet-deleted partner at the moment SQLite checks the constraint).
    // Scoped to this user only — never a global wipe.
    await runner.execute({
      sql: 'UPDATE transactions SET linked_transaction_id = NULL WHERE user_id = :userId',
      args: { userId },
    });
    const result = await runner.execute({ sql: 'DELETE FROM transactions WHERE user_id = :userId', args: { userId } });
    return result.rowsAffected;
  });
}

const MONTH_ABBREV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "YYYY-MM" -> "Month YYYY" (e.g. "2026-07" -> "July 2026"), used for the
// month-divider band rows in the multi-month (all-time) export.
function monthLabelFull(monthKey) {
  const [year, month] = monthKey.split('-');
  const monthIdx = Number(month) - 1;
  return `${MONTH_FULL[monthIdx] ?? month} ${year}`;
}

const MIN_COL_WIDTH = 8;
const COL_WIDTH_PADDING = 2;

// Computes SheetJS `!cols` widths from the header + data rows only (the
// row-1 title cell is intentionally excluded — it's a long string confined
// to column A and would otherwise blow out the Date column's width).
function computeColWidths(header, dataRows) {
  return header.map((headerLabel, colIdx) => {
    let maxLen = String(headerLabel).length;
    for (const row of dataRows) {
      const cellLen = String(row[colIdx]).length;
      if (cellLen > maxLen) maxLen = cellLen;
    }
    return { wch: Math.max(maxLen + COL_WIDTH_PADDING, MIN_COL_WIDTH) };
  });
}

// Builds an in-memory .xlsx workbook (via SheetJS) covering either a
// [from, to] date range ("month export") or all-time (no from/to). Reuses
// balanceService.listTransactionsWithBalance for the row data + running
// balance (window fn) rather than recomputing anything here — see the
// frozen contract on the team board (Export endpoint contract).
//
// Produces TWO sheets, "Spending" and "Savings" (per FOLLOW-UP BATCH 4):
// each account's rows (already carrying correct per-account running
// balances from the window fn, partitioned by account_id) are filtered
// into their own sheet rather than recomputed. Both sheets are always
// present, even if a given account has zero rows in range.
export async function buildTransactionsWorkbook({ from, to } = {}, userId) {
  const isAllTime = !from && !to;
  const rows = isAllTime
    ? await listTransactionsWithBalance({ userId })
    : await listTransactionsWithBalance({ from, to, userId });

  const accounts = (await client.execute('SELECT id, name FROM accounts')).rows;
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  const monthLabelSuffix = isAllTime
    ? null
    : (() => {
      // from is 'YYYY-MM-DD'; derive "Mon YYYY" from its year/month.
      const [year, month] = String(from).split('-');
      const monthIdx = Number(month) - 1;
      const monthLabel = MONTH_ABBREV[monthIdx] ?? month;
      return `${monthLabel} ${year}`;
    })();

  const header = ['Date', 'Account', 'Description', 'Amount', 'Direction', 'Category', 'Running Balance'];

  function rowToAoa(row) {
    return [
      row.date,
      accountNameById.get(row.account_id) ?? String(row.account_id),
      row.comment,
      row.amount,
      row.direction === 'in' ? 'In' : 'Out',
      row.category,
      row.running_balance,
    ];
  }

  function buildSheet(accountId, sheetName) {
    const accountName = accountNameById.get(accountId) ?? sheetName;
    const title = isAllTime
      ? `${accountName} — All Transactions`
      : `${accountName} — ${monthLabelSuffix}`;
    const accountRows = rows.filter((row) => row.account_id === accountId);
    const dataRows = accountRows.map(rowToAoa);

    // Month-divider bands: SheetJS Community Edition cannot persist cell
    // styles (borders/fills) on write (confirmed empirically — see
    // FOLLOW-UP BATCH 5 team-board note), so a full-width, merged label row
    // between month groups is the closest CE-compatible substitute for a
    // literal ruled border. Only added when this sheet's own rows actually
    // span more than one distinct month (i.e. an all-time/multi-month
    // export) — a single-month export stays exactly as before, no bands.
    const distinctMonths = new Set(accountRows.map((row) => row.date.slice(0, 7)));
    const isMultiMonth = distinctMonths.size > 1;

    const aoa = [[title], header];
    const merges = [];

    if (isMultiMonth) {
      let currentMonthKey = null;
      for (const row of accountRows) {
        const monthKey = row.date.slice(0, 7);
        if (monthKey !== currentMonthKey) {
          currentMonthKey = monthKey;
          const bandRowIdx = aoa.length; // 0-based row index in the eventual sheet
          aoa.push([monthLabelFull(monthKey)]);
          merges.push({ s: { r: bandRowIdx, c: 0 }, e: { r: bandRowIdx, c: header.length - 1 } });
        }
        aoa.push(rowToAoa(row));
      }
    } else {
      aoa.push(...dataRows);
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    if (merges.length) sheet['!merges'] = merges;
    // Width calc uses only the header + raw data rows (dataRows), never the
    // title row or the merged band label rows, so a band like "July 2026"
    // (merged across all 7 columns) can't blow out column A's width.
    sheet['!cols'] = computeColWidths(header, dataRows);
    return sheet;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildSheet(ACCOUNTS.SPENDING, 'Spending'), 'Spending');
  XLSX.utils.book_append_sheet(workbook, buildSheet(ACCOUNTS.SAVINGS, 'Savings'), 'Savings');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const filename = isAllTime ? 'transactions-all.xlsx' : `transactions-${from.slice(0, 7)}.xlsx`;

  return { buffer, filename };
}

export { ValidationError };
