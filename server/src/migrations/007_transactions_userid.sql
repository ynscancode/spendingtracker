-- Per-user data isolation for transactions (BATCH 11 user-auth). Plain INTEGER
-- column, logical FK to users(id) only (SQLite ALTER can't add a REFERENCES
-- FK to an existing table). NULL = legacy/unclaimed row, claimed by the first
-- real signup (see TEAM-BOARD.md BATCH 11 section E).
ALTER TABLE transactions ADD COLUMN user_id INTEGER;
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date, id);
