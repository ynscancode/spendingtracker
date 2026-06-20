import db from '../db.js';
import { PALETTE } from '../constants/palette.js';

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

// Deterministic 32-bit string hash -> hue, matching the algorithm documented in
// server/src/migrations/003_categories.sql (used to freeze 'miscellaneous'#CBAE4D).
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

function assignColor(name, usedColors) {
  const usedSet = new Set(usedColors.map((c) => c.toUpperCase()));
  const freeSlot = PALETTE.find((c) => !usedSet.has(c.toUpperCase()));
  if (freeSlot) {
    return freeSlot;
  }
  // All palette slots used: deterministic hash-of-name -> HSL -> hex, rotating
  // hue on exact collision until a free hex is found.
  const baseHue = hashNameToHue(name);
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const hue = (baseHue + attempt) % 360;
    const hex = hslToHex(hue, 55, 55);
    if (!usedSet.has(hex.toUpperCase())) {
      return hex;
    }
  }
  // Extremely unlikely fallback (would require 360 exact collisions).
  return hslToHex(baseHue, 55, 55);
}

export function listCategories() {
  const rows = db
    .prepare('SELECT id, name, list, color FROM categories WHERE is_system = 0 ORDER BY id')
    .all();
  return {
    outgoing: rows.filter((r) => r.list === 'outgoing'),
    incoming: rows.filter((r) => r.list === 'incoming'),
  };
}

export function createCategory({ name, list }) {
  const trimmedName = assertValidName(name);
  assertValidList(list);

  const duplicate = db
    .prepare('SELECT id FROM categories WHERE lower(name) = lower(@name) AND list = @list')
    .get({ name: trimmedName, list });
  if (duplicate) {
    throw new ValidationError(`category "${trimmedName}" already exists in ${list}`);
  }

  const allColors = db.prepare('SELECT color FROM categories').all().map((r) => r.color);
  const color = assignColor(trimmedName, allColors);

  const result = db
    .prepare('INSERT INTO categories (name, list, is_system, color) VALUES (@name, @list, 0, @color)')
    .run({ name: trimmedName, list, color });

  return { id: result.lastInsertRowid, name: trimmedName, list, color };
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
    .prepare('SELECT COUNT(*) AS count FROM transactions WHERE category = ?')
    .get(category.name).count;
  const budgetCount = db
    .prepare('SELECT COUNT(*) AS count FROM budgets WHERE category = ?')
    .get(category.name).count;

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

// Outgoing category names a normal transaction may use (excludes is_system, e.g. transfer-out).
export function getOutgoingNames() {
  return db
    .prepare("SELECT name FROM categories WHERE list = 'outgoing' AND is_system = 0")
    .all()
    .map((r) => r.name);
}

// Incoming category names a normal transaction may use (excludes is_system, e.g. transfer-in).
export function getIncomingNames() {
  return db
    .prepare("SELECT name FROM categories WHERE list = 'incoming' AND is_system = 0")
    .all()
    .map((r) => r.name);
}

// Outgoing categories a user can set a monthly budget for. Computed live —
// currently identical to getOutgoingNames() since transfer-out is_system=1 is
// already excluded there, but kept as its own named export per ADR-023
// Decision 5/6 so budgetService has a stable, semantically-named entry point
// independent of how "budgetable" is defined if that ever diverges from
// "all non-system outgoing categories".
export function getBudgetableNames() {
  return getOutgoingNames();
}

// Validates a normal (non-transfer) transaction's category against the live
// categories table: must exist, be non-system, and belong to the list
// matching the transaction's direction ('out' -> outgoing, 'in' -> incoming).
export function isValidNormalCategory(category, direction) {
  if (!category) return false;
  const list = direction === 'out' ? 'outgoing' : 'incoming';
  const row = db
    .prepare('SELECT id FROM categories WHERE name = @name AND list = @list AND is_system = 0')
    .get({ name: category, list });
  return Boolean(row);
}

export { ValidationError, NotFoundError };
