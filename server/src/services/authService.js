import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import client from '../db.js';
import { seedCategoriesForUser } from './categoryService.js';

// JWT_SECRET is required — the feature cannot run without it (BATCH 11
// tech-lead contract, section B: "fail loud on boot if unset"). Read once at
// module load; this module is imported by both routes/auth.js and
// requireUser.js (both loaded at server boot regardless of API_TOKEN/env),
// so an unset secret crashes the process immediately rather than silently
// accepting/issuing unsigned or unverifiable tokens.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required — auth cannot start without it');
}

const BCRYPT_ROUNDS = 10;

const MIN_PASSWORD_LENGTH = 8;
// bcrypt silently truncates input at 72 bytes — reject longer passwords
// with a clear error instead of accepting a value that's effectively
// truncated without the caller knowing.
const MAX_PASSWORD_BYTES = 72;

// Precomputed dummy bcrypt hash (of an arbitrary fixed string, cost 10) used
// solely to burn comparable CPU time on the "user not found" / "guest with
// no password" login branches, so those branches take about as long as a
// real password comparison — closes the login timing side-channel flagged
// in the security review (LOW-1: nonexistent/guest usernames responded
// measurably faster than real ones since bcrypt.compare was skipped
// entirely). This hash is never compared against anything meaningful — its
// only purpose is to make bcrypt.compare do real work.
const DUMMY_BCRYPT_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Ffz3prR7fT5x1hknFbNMj9NL0wsB.';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
  }
}

function assertValidCredentials(username, password) {
  if (typeof username !== 'string' || username.trim().length === 0) {
    throw new ValidationError('username is required');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new ValidationError('password is required');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new ValidationError(`password must not exceed ${MAX_PASSWORD_BYTES} bytes`);
  }
}

// Claims: { sub, username, isGuest } — sub is the user id (services read
// req.userId). Algorithm HS256, no `exp` claim (non-expiring) per contract B
// — the token stays valid until explicit logout (client-side token
// discard) or a JWT_SECRET rotation (which invalidates every token at once).
function signToken({ id, username, isGuest }) {
  return jwt.sign({ sub: id, username, isGuest }, JWT_SECRET, { algorithm: 'HS256' });
}

function buildAuthResult({ id, username, isGuest }) {
  return {
    token: signToken({ id, username, isGuest }),
    user: { id, username, isGuest },
  };
}

// Verifies a raw JWT string against JWT_SECRET. Returns the decoded payload
// on success; throws on missing/invalid/malformed tokens. Used by
// requireUser.js so the verification logic lives in exactly one place.
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

// POST /api/auth/signup — see BATCH 11 tech-lead contract section E for the
// full first-signup-claim sequence. Everything below runs inside ONE
// interactive write transaction: validate -> compute the claim test BEFORE
// inserting the new user (guests never consume it, is_guest = 0 count) ->
// insert -> claim legacy NULL rows (first real signup only) or seed a fresh
// per-user category set (every subsequent signup) -> commit -> sign JWT.
export async function signup({ username, password }) {
  const trimmedUsername = typeof username === 'string' ? username.trim() : username;
  assertValidCredentials(trimmedUsername, password);

  const tx = await client.transaction('write');
  try {
    const existing = (
      await tx.execute({ sql: 'SELECT id FROM users WHERE username = :username', args: { username: trimmedUsername } })
    ).rows[0];
    if (existing) {
      throw new ValidationError('username is already taken');
    }

    // Computed BEFORE the insert below, and gated on is_guest = 0 so a prior
    // guest session (or many) never consumes the one-time legacy claim — the
    // first REAL (non-guest) signup gets it regardless of guest history.
    const nonGuestCountRow = (await tx.execute('SELECT COUNT(*) AS n FROM users WHERE is_guest = 0')).rows[0];
    const firstClaim = Number(nonGuestCountRow.n) === 0;

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const insertResult = await tx.execute({
      sql: 'INSERT INTO users (username, password_hash, is_guest) VALUES (:username, :passwordHash, 0)',
      args: { username: trimmedUsername, passwordHash },
    });
    const newId = Number(insertResult.lastInsertRowid);

    if (firstClaim) {
      // System categories (is_system = 1, user_id IS NULL permanently) are
      // deliberately excluded via `AND is_system = 0` — they stay global and
      // are never claimed by any user.
      await tx.execute({ sql: 'UPDATE transactions SET user_id = :newId WHERE user_id IS NULL', args: { newId } });
      await tx.execute({ sql: 'UPDATE budgets SET user_id = :newId WHERE user_id IS NULL', args: { newId } });
      await tx.execute({
        sql: 'UPDATE categories SET user_id = :newId WHERE user_id IS NULL AND is_system = 0',
        args: { newId },
      });
    } else {
      await seedCategoriesForUser(newId, tx);
    }

    await tx.commit();
    return buildAuthResult({ id: newId, username: trimmedUsername, isGuest: false });
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// POST /api/auth/login — 401 on bad credentials OR a guest username (guests
// have password_hash NULL, so bcrypt.compare is never even attempted against
// a null hash — they can never authenticate this way, by design).
export async function login({ username, password }) {
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    throw new AuthenticationError('invalid username or password');
  }

  const user = (
    await client.execute({ sql: 'SELECT * FROM users WHERE username = :username', args: { username } })
  ).rows[0];
  if (!user || !user.password_hash) {
    // No real hash to compare against (unknown username, or a guest whose
    // password_hash is NULL) — run a dummy compare against a fixed hash so
    // this branch costs about the same as the real-password path below,
    // closing the login timing side-channel (security review LOW-1). The
    // error returned is identical to the wrong-password case; only the
    // dummy comparison's *result* is discarded.
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    throw new AuthenticationError('invalid username or password');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AuthenticationError('invalid username or password');
  }

  return buildAuthResult({ id: user.id, username: user.username, isGuest: Boolean(user.is_guest) });
}

// POST /api/auth/guest — always seeds a fresh, isolated category set, never
// claims legacy data (is_guest = 1 users are excluded from the firstClaim
// count in signup() above, and this path never even computes/consults that
// count). Data persists across refresh (the JWT is stored client-side) and
// is fully isolated by user_id; guests can never log back in since
// password_hash stays NULL.
export async function createGuest() {
  const username = `guest_${crypto.randomUUID()}`;

  const tx = await client.transaction('write');
  try {
    const insertResult = await tx.execute({
      sql: 'INSERT INTO users (username, password_hash, is_guest) VALUES (:username, NULL, 1)',
      args: { username },
    });
    const newId = Number(insertResult.lastInsertRowid);

    await seedCategoriesForUser(newId, tx);

    await tx.commit();
    return buildAuthResult({ id: newId, username, isGuest: true });
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// GET /api/auth/me — looked up by req.userId (set by requireUser from the
// verified JWT's `sub` claim), not trusted from any client-supplied id.
export async function getUser(userId) {
  const row = (
    await client.execute({
      sql: 'SELECT id, username, is_guest FROM users WHERE id = :id',
      args: { id: userId },
    })
  ).rows[0];
  if (!row) return null;
  return { id: row.id, username: row.username, isGuest: Boolean(row.is_guest) };
}

export { ValidationError, AuthenticationError };
