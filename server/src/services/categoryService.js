import db from '../db.js';
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

export function listCategories(accountId) {
  assertValidAccountId(accountId);
  const rows = db
    .prepare('SELECT id, name, list, color FROM categories WHERE is_system = 0 AND account_id = ? ORDER BY id')
    .all(Number(accountId));
  return {
    outgoing: rows.filter((r) => r.list === 'outgoing'),
    incoming: rows.filter((r) => r.list === 'incoming'),
  };
}

export function createCategory({ name, list, account_id }) {
  const trimmedName = assertValidName(name);
  assertValidList(list);
  assertValidAccountId(account_id);
  const accountId = Number(account_id);

  const duplicate = db
    .prepare('SELECT id FROM categories WHERE lower(name) = lower(@name) AND list = @list AND account_id = @accountId')
    .get({ name: trimmedName, list, accountId });
  if (duplicate) {
    throw new ValidationError(`category "${trimmedName}" already exists in ${list}`);
  }

  // Each account independently consumes the full palette, rather than
  // sharing one pool, since Spending and Savings categories are now
  // entirely separate lists.
  const accountColors = db
    .prepare('SELECT color FROM categories WHERE account_id = ?')
    .all(accountId)
    .map((r) => r.color);
  const color = assignColor(trimmedName, accountColors);

  const result = db
    .prepare('INSERT INTO categories (name, list, is_system, color, account_id) VALUES (@name, @list, 0, @color, @accountId)')
    .run({ name: trimmedName, list, color, accountId });

  return { id: result.lastInsertRowid, name: trimmedName, list, color, account_id: accountId };
}

export function deleteCategory(id) {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!category) {
    throw new NotFoundError('category not found');
  }
  if (category.is_system) {
    throw new ValidationError('system categories cannot be deleted');
  }

  const txnCount = db
    .prepare('SELECT COUNT(*) AS count FROM transactions WHERE category = ? AND account_id = ?')
    .get(category.name, category.account_id).count;
  // Budgets are Spending-only (see budgetService), so a Savings category of
  // the same name can never actually appear in budgets — skip the check
  // entirely to avoid a false-positive block from an unrelated Spending budget.
  const budgetCount = category.account_id === ACCOUNTS.SPENDING
    ? db.prepare('SELECT COUNT(*) AS count FROM budgets WHERE category = ?').get(category.name).count
    : 0;

  if (txnCount + budgetCount > 0) {
    const parts = [];
    if (txnCount > 0) {
      parts.push(`${txnCount} transaction${txnCount === 1 ? '' : 's'}`);
    }
    if (budgetCount > 0) {
      parts.push(`${budgetCount} budget entr${budgetCount === 1 ? 'y' : 'ies'}`);
    }
    const totalItems = txnCount + budgetCount;
    const verb = totalItems === 1 ? 'uses' : 'use';
    throw new ValidationError(
      `Cannot delete '${category.name}': ${parts.join(' and ')} still ${verb} this category. Reassign or delete them first.`
    );
  }

  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

// Outgoing category names a normal transaction may use for the given
// account (excludes is_system, e.g. transfer-out).
export function getOutgoingNames(accountId) {
  return db
    .prepare("SELECT name FROM categories WHERE list = 'outgoing' AND is_system = 0 AND account_id = ? ORDER BY id")
    .all(Number(accountId))
    .map((r) => r.name);
}

// Outgoing categories a user can set a monthly budget for, on the given
// account. Computed live — currently identical to getOutgoingNames() since
// transfer-out is_system=1 is already excluded there, but kept as its own
// named export per ADR-023 Decision 5/6 so budgetService has a stable,
// semantically-named entry point independent of how "budgetable" is defined
// if that ever diverges from "all non-system outgoing categories". Always
// called with ACCOUNTS.SPENDING by budgetService — budgeting is Spending-only.
export function getBudgetableNames(accountId) {
  return getOutgoingNames(accountId);
}

// Validates a normal (non-transfer) transaction's category against the live
// categories table: must exist, be non-system, and belong to the list
// matching the transaction's direction ('out' -> outgoing, 'in' -> incoming),
// scoped to the transaction's own account (Spending/Savings categories are
// independent lists).
export function isValidNormalCategory(category, direction, accountId) {
  if (!category) return false;
  const list = direction === 'out' ? 'outgoing' : 'incoming';
  const row = db
    .prepare('SELECT id FROM categories WHERE name = @name AND list = @list AND is_system = 0 AND account_id = @accountId')
    .get({ name: category, list, accountId: Number(accountId) });
  return Boolean(row);
}

export { ValidationError, NotFoundError };
