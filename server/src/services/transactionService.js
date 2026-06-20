import db from '../db.js';
import { ACCOUNTS } from '../constants/categories.js';
import { isValidNormalCategory } from './categoryService.js';

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

function assertValidNormalTransaction({ date, account_id, direction, category, amount }) {
  if (!date || !account_id || !direction || !category || amount == null) {
    throw new ValidationError('date, account_id, direction, category, and amount are required');
  }
  if (!['in', 'out'].includes(direction)) {
    throw new ValidationError('direction must be "in" or "out"');
  }
  if (TRANSFER_CATEGORIES.includes(category)) {
    throw new ValidationError('transfer categories cannot be set on normal transactions');
  }
  if (!isValidNormalCategory(category, direction)) {
    throw new ValidationError(`category "${category}" is not valid for direction "${direction}"`);
  }
  if (typeof amount !== 'number' || amount <= 0) {
    throw new ValidationError('amount must be a positive number');
  }
}

export function createTransaction({ date, account_id, direction, category, amount, comment = '' }) {
  assertValidNormalTransaction({ date, account_id, direction, category, amount });
  const stmt = db.prepare(`
    INSERT INTO transactions (date, account_id, direction, category, amount, comment, is_transfer)
    VALUES (@date, @account_id, @direction, @category, @amount, @comment, 0)
  `);
  const result = stmt.run({ date, account_id, direction, category, amount, comment });
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
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

export function createTransfer({ date, from_account_id, to_account_id, amount, comment }) {
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

  const txn = db.transaction(() => {
    const insertStmt = db.prepare(`
      INSERT INTO transactions (date, account_id, direction, category, amount, comment, is_transfer, linked_transaction_id)
      VALUES (@date, @account_id, @direction, @category, @amount, @comment, 1, @linked_transaction_id)
    `);

    const outResult = insertStmt.run({
      date, account_id: from_account_id, direction: 'out', category: 'transfer-out',
      amount, comment: outComment, linked_transaction_id: null,
    });
    const outId = outResult.lastInsertRowid;

    const inResult = insertStmt.run({
      date, account_id: to_account_id, direction: 'in', category: 'transfer-in',
      amount, comment: inComment, linked_transaction_id: outId,
    });
    const inId = inResult.lastInsertRowid;

    db.prepare('UPDATE transactions SET linked_transaction_id = ? WHERE id = ?').run(inId, outId);

    return {
      outRow: db.prepare('SELECT * FROM transactions WHERE id = ?').get(outId),
      inRow: db.prepare('SELECT * FROM transactions WHERE id = ?').get(inId),
    };
  });

  return txn();
}

export function updateTransaction(id, { date, amount, comment }) {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Transaction not found');
    err.statusCode = 404;
    throw err;
  }

  if (amount != null && (typeof amount !== 'number' || amount <= 0)) {
    throw new ValidationError('amount must be a positive number');
  }

  const updates = {
    date: date ?? existing.date,
    amount: amount ?? existing.amount,
    comment: comment ?? existing.comment,
  };

  const txn = db.transaction(() => {
    db.prepare('UPDATE transactions SET date = @date, amount = @amount, comment = @comment WHERE id = @id')
      .run({ ...updates, id });

    if (existing.is_transfer && existing.linked_transaction_id) {
      db.prepare('UPDATE transactions SET date = @date, amount = @amount, comment = @comment WHERE id = @id')
        .run({ ...updates, id: existing.linked_transaction_id });
    }
  });
  txn();

  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
}

export function deleteTransaction(id) {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Transaction not found');
    err.statusCode = 404;
    throw err;
  }

  const txn = db.transaction(() => {
    if (existing.is_transfer && existing.linked_transaction_id) {
      // Clear the mutual linked_transaction_id references first so deleting
      // either row doesn't violate the self-referencing foreign key.
      db.prepare('UPDATE transactions SET linked_transaction_id = NULL WHERE id IN (?, ?)')
        .run(id, existing.linked_transaction_id);
      db.prepare('DELETE FROM transactions WHERE id = ?').run(existing.linked_transaction_id);
    }
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  });
  txn();
}

export { ValidationError };
