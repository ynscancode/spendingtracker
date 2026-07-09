import client from '../db.js';
import { PALETTE } from '../constants/palette.js';
import { ACCOUNTS } from '../constants/categories.js';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

const RESERVED_NAMES = ['transfer-in', 'transfer-out'];
const MAX_NAME_LENGTH = 30;
const LISTS = ['outgoing', 'incoming'];

// Replicates exactly what 003_categories.sql + 004_category_accounts.sql
// produce for a fresh account pair (11 non-system seed categories, exact
// hex colors — see BATCH 11 tech-lead contract section E). Driven from code
// (not by cloning legacy NULL rows) since after the first-signup claim those
// rows are no longer NULL/unclaimed. transfer-in/transfer-out are NOT
// included here — they are system-managed, account_id IS NULL, user_id IS
// NULL, and already exist globally; never re-seeded per-user.
const SEED_CATEGORIES = [
  { name: 'food', list: 'outgoing', color: '#C76060' },
  { name: 'drinks', list: 'outgoing', color: '#60C7C7' },
  { name: 'transport', list: 'outgoing', color: '#C79E60' },
  { name: 'shopping', list: 'outgoing', color: '#7560C7' },
  { name: 'alcohol', list: 'outgoing', color: '#B360C7' },
  { name: 'fun', list: 'outgoing', color: '#75C760' },
  { name: 'bills', list: 'outgoing', color: '#C7609E' },
  { name: 'travel', list: 'outgoing', color: '#8A8F98' },
  { name: 'miscellaneous', list: 'outgoing', color: '#B3C760' },
  { name: 'income', list: 'incoming', color: '#608AC7' },
  { name: 'other', list: 'incoming', color: '#60C78A' },
];

// Seeds a brand-new user's independent categories set: for EACH account
// (Spending, Savings), inserts all 11 non-system seed categories, stamped
// `user_id`, `is_system = 0`, and that `account_id` — 22 rows total. Called
// for every signup that is NOT the one-time legacy claim (see authService.js
// signup()), and always for guest accounts (guests never claim legacy data).
// `exec` (optional): threaded through so authService's signup can run this
// inside its own single interactive transaction (see
// transactionService.js's EXECUTOR-THREADING doc for why a bare client
// won't do here).
export async function seedCategoriesForUser(userId, exec = client) {
  for (const accountId of Object.values(ACCOUNTS)) {
    for (const seed of SEED_CATEGORIES) {
      await exec.execute({
        sql: `
          INSERT INTO categories (name, list, is_system, color, account_id, user_id)
          VALUES (:name, :list, 0, :color, :accountId, :userId)
        `,
        args: { name: seed.name, list: seed.list, color: seed.color, accountId, userId },
      });
    }
  }
}

function assertValidName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('name is required');
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }
  if (RESERVED_NAMES.includes(trimmed.toLowerCase())) {
    throw new ValidationError(`"${trimmed}" is reserved and cannot be used as a category name`);
  }
  return trimmed;
}

function assertValidList(list) {
  if (!LISTS.includes(list)) {
    throw new ValidationError('list must be "outgoing" or "incoming"');
  }
}

const VALID_ACCOUNT_IDS = Object.values(ACCOUNTS);

function assertValidAccountId(accountId) {
  if (!VALID_ACCOUNT_IDS.includes(Number(accountId))) {
    throw new ValidationError('account_id must be a valid account');
  }
}

// Deterministic 32-bit string hash -> hue, used as the starting point for the
// hue-distance search in assignColor() below.
function hashNameToHue(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0; // force 32-bit
  }
  return Math.abs(hash) % 360;
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) => Math.round(255 * n).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`.toUpperCase();
}

function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hueDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Minimum hue separation (degrees) a new category's color must clear from every
// color already in use on the same account, so categories stay visually distinct
// at a glance (not just non-identical hex values).
const MIN_HUE_DISTANCE = 30;
const HUE_STEP = 37; // coprime with 360, so (baseHue + attempt*HUE_STEP) % 360 visits every hue once

function assignColor(name, usedColors) {
  const usedSet = new Set(usedColors.map((c) => c.toUpperCase()));
  const freeSlot = PALETTE.find((c) => !usedSet.has(c.toUpperCase()));
  if (freeSlot) {
    return freeSlot;
  }
  // All palette slots used: search hue space (starting from a deterministic
  // hash-of-name hue) for one at least MIN_HUE_DISTANCE from every used color's
  // hue, tracking the best candidate seen in case the account is too crowded for
  // any hue to clear the threshold (best-available fallback).
  const usedHues = usedColors.map(hexToHue);
  const baseHue = hashNameToHue(name);
  let bestHue = baseHue;
  let bestMinDist = -1;
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const hue = (baseHue + attempt * HUE_STEP) % 360;
    const minDist = usedHues.length === 0 ? Infinity : Math.min(...usedHues.map((h) => hueDistance(hue, h)));
    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      bestHue = hue;
    }
    if (minDist >= MIN_HUE_DISTANCE) {
      const hex = hslToHex(hue, 48, 58);
      if (!usedSet.has(hex.toUpperCase())) {
        return hex;
      }
    }
  }
  return hslToHex(bestHue, 48, 58);
}

export async function listCategories(accountId, userId) {
  assertValidAccountId(accountId);
  const rows = (
    await client.execute({
      sql: 'SELECT id, name, list, color FROM categories WHERE is_system = 0 AND account_id = :accountId AND user_id = :userId ORDER BY id',
      args: { accountId: Number(accountId), userId },
    })
  ).rows;
  return {
    outgoing: rows.filter((r) => r.list === 'outgoing'),
    incoming: rows.filter((r) => r.list === 'incoming'),
  };
}

// `exec` (optional): a libsql interactive-transaction handle, defaulting to
// the module `client`. Threaded through so a caller that already owns an
// open transaction can run this inside that same transaction alongside
// createTransaction/createTransfer — a plain client.execute runs on a
// different connection than an already-open transaction and would silently
// lose atomicity across the batch (see team board Batch 8 contract).
export async function createCategory({ name, list, account_id }, userId, exec = client) {
  const trimmedName = assertValidName(name);
  assertValidList(list);
  assertValidAccountId(account_id);
  const accountId = Number(account_id);

  const duplicate = (
    await exec.execute({
      sql: 'SELECT id FROM categories WHERE lower(name) = lower(:name) AND list = :list AND account_id = :accountId AND user_id = :userId',
      args: { name: trimmedName, list, accountId, userId },
    })
  ).rows[0];
  if (duplicate) {
    throw new ValidationError(`category "${trimmedName}" already exists in ${list}`);
  }

  // Each account independently consumes the full palette, rather than
  // sharing one pool, since Spending and Savings categories are now
  // entirely separate lists. Scoped per-user too — a per-user palette, not
  // shared across users on the same account.
  const accountColors = (
    await exec.execute({
      sql: 'SELECT color FROM categories WHERE account_id = :accountId AND user_id = :userId',
      args: { accountId, userId },
    })
  ).rows.map((r) => r.color);
  const color = assignColor(trimmedName, accountColors);

  const result = await exec.execute({
    sql: 'INSERT INTO categories (name, list, is_system, color, account_id, user_id) VALUES (:name, :list, 0, :color, :accountId, :userId)',
    args: { name: trimmedName, list, color, accountId, userId },
  });

  return { id: Number(result.lastInsertRowid), name: trimmedName, list, color, account_id: accountId };
}

export async function deleteCategory(id, userId) {
  // Lookup uses the same read exception as the other category reads
  // (own rows OR system rows) so a system category is actually found (and
  // correctly rejected with the is_system message below) rather than
  // silently 404ing; a non-system row found here is guaranteed to belong to
  // this user, since the only other rows this WHERE can match are is_system.
  const category = (
    await client.execute({
      sql: 'SELECT * FROM categories WHERE id = :id AND (user_id = :userId OR is_system = 1)',
      args: { id, userId },
    })
  ).rows[0];
  if (!category) {
    throw new NotFoundError('category not found');
  }
  if (category.is_system) {
    throw new ValidationError('system categories cannot be deleted');
  }

  const txnCount = (
    await client.execute({
      sql: 'SELECT COUNT(*) AS count FROM transactions WHERE category = :name AND account_id = :accountId AND user_id = :userId',
      args: { name: category.name, accountId: category.account_id, userId },
    })
  ).rows[0].count;
  // Budgets are Spending-only (see budgetService), so a Savings category of
  // the same name can never actually appear in budgets — skip the check
  // entirely to avoid a false-positive block from an unrelated Spending budget.
  const budgetCount = category.account_id === ACCOUNTS.SPENDING
    ? (
      await client.execute({
        sql: 'SELECT COUNT(*) AS count FROM budgets WHERE category = :name AND user_id = :userId',
        args: { name: category.name, userId },
      })
    ).rows[0].count
    : 0;

  if (Number(txnCount) + Number(budgetCount) > 0) {
    const parts = [];
    if (txnCount > 0) {
      parts.push(`${txnCount} transaction${txnCount === 1 ? '' : 's'}`);
    }
    if (budgetCount > 0) {
      parts.push(`${budgetCount} budget entr${budgetCount === 1 ? 'y' : 'ies'}`);
    }
    const totalItems = Number(txnCount) + Number(budgetCount);
    const verb = totalItems === 1 ? 'uses' : 'use';
    throw new ValidationError(
      `Cannot delete '${category.name}': ${parts.join(' and ')} still ${verb} this category. Reassign or delete them first.`
    );
  }

  // Scoped delete: never touches another user's row, and (defense-in-depth,
  // matching the contract's exact wording) never a system row even though
  // the lookup above already guarantees this branch only reaches here for a
  // non-system row owned by this user.
  await client.execute({
    sql: 'DELETE FROM categories WHERE id = :id AND user_id = :userId',
    args: { id, userId },
  });
}

// Outgoing category names a normal transaction may use for the given
// account (excludes is_system, e.g. transfer-out). Scoped to the caller's
// own categories — the `is_system = 0` filter already present here makes
// the contract's `(user_id = :userId OR is_system = 1)` read-exception a
// no-op (is_system = 0 rules out the is_system = 1 branch), so it reduces
// to a plain `AND user_id = :userId`.
export async function getOutgoingNames(accountId, userId, exec = client) {
  const rows = (
    await exec.execute({
      sql: "SELECT name FROM categories WHERE list = 'outgoing' AND is_system = 0 AND account_id = :accountId AND user_id = :userId ORDER BY id",
      args: { accountId: Number(accountId), userId },
    })
  ).rows;
  return rows.map((r) => r.name);
}

// Incoming category names a normal transaction may use for the given
// account (excludes is_system, e.g. transfer-in). Symmetric counterpart to
// getOutgoingNames().
export async function getIncomingNames(accountId, userId, exec = client) {
  const rows = (
    await exec.execute({
      sql: "SELECT name FROM categories WHERE list = 'incoming' AND is_system = 0 AND account_id = :accountId AND user_id = :userId ORDER BY id",
      args: { accountId: Number(accountId), userId },
    })
  ).rows;
  return rows.map((r) => r.name);
}

// Outgoing categories a user can set a monthly budget for, on the given
// account. Computed live — currently identical to getOutgoingNames() since
// transfer-out is_system=1 is already excluded there, but kept as its own
// named export per ADR-023 Decision 5/6 so budgetService has a stable,
// semantically-named entry point independent of how "budgetable" is defined
// if that ever diverges from "all non-system outgoing categories". Always
// called with ACCOUNTS.SPENDING by budgetService — budgeting is Spending-only.
export async function getBudgetableNames(accountId, userId) {
  return getOutgoingNames(accountId, userId);
}

// Validates a normal (non-transfer) transaction's category against the live
// categories table: must exist, be non-system, and belong to the list
// matching the transaction's direction ('out' -> outgoing, 'in' -> incoming),
// scoped to the transaction's own account (Spending/Savings categories are
// independent lists) AND to the calling user (per-user categories).
export async function isValidNormalCategory(category, direction, accountId, userId, exec = client) {
  if (!category) return false;
  const list = direction === 'out' ? 'outgoing' : 'incoming';
  const row = (
    await exec.execute({
      sql: 'SELECT id FROM categories WHERE name = :name AND list = :list AND is_system = 0 AND account_id = :accountId AND user_id = :userId',
      args: { name: category, list, accountId: Number(accountId), userId },
    })
  ).rows[0];
  return Boolean(row);
}

export { ValidationError };
