-- Per-user data isolation for budgets (BATCH 11 user-auth). The existing
-- table-level UNIQUE(month, category) cannot be altered in SQLite/libSQL, and
-- must become UNIQUE(user_id, month, category) so two users can each budget
-- the same month+category independently — this requires a full table rebuild,
-- not an ALTER. Column order/types/defaults/CHECK preserved exactly from
-- 002_budgets.sql, with user_id INTEGER added (plain, logical FK only, no
-- REFERENCES — same reasoning as 007/008).
CREATE TABLE budgets_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  month TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, month, category)
);

-- Existing rows copied with user_id = NULL — claimable by the first real
-- signup (see TEAM-BOARD.md BATCH 11 section E). UNIQUE(user_id, month,
-- category) treats NULL as distinct per SQLite semantics, so this is safe
-- even though every pre-existing row shares user_id = NULL: only one legacy
-- set exists pre-claim, and (month, category) was already unique among them
-- under the old constraint, so no collision is possible here either.
INSERT INTO budgets_new (id, user_id, month, category, amount, created_at)
  SELECT id, NULL, month, category, amount, created_at FROM budgets;

DROP TABLE budgets;
ALTER TABLE budgets_new RENAME TO budgets;

-- Replaces the old idx_budgets_month (dropped implicitly with the old table).
CREATE INDEX idx_budgets_user_month ON budgets(user_id, month);
