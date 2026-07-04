-- User accounts (BATCH 11 user-auth). users(id) is the logical FK target for
-- user_id columns added to transactions/categories/budgets in 007-009 — SQLite
-- ALTER TABLE cannot add a REFERENCES FK to an existing table, so those columns
-- stay plain INTEGER and this relationship is enforced only at the service
-- layer (see tech-lead contract, TEAM-BOARD.md BATCH 11 section C/D).
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,                       -- NULL for guest users
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
