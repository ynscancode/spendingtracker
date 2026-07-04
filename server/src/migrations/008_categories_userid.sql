-- Per-user data isolation for categories (BATCH 11 user-auth). Plain INTEGER
-- column, logical FK to users(id) only. System rows (is_system=1,
-- account_id IS NULL — transfer-in/transfer-out) stay user_id IS NULL forever:
-- they are global and shared by every user, never claimed or per-user seeded.
-- The 004-created non-system rows also stay user_id IS NULL until the first
-- real signup claims them (see TEAM-BOARD.md BATCH 11 section E).
ALTER TABLE categories ADD COLUMN user_id INTEGER;

-- Swap the per-account unique index for a per-user-per-account one. Must drop
-- before create, same as 004's own index swap.
DROP INDEX idx_categories_account_name_list;
CREATE UNIQUE INDEX idx_categories_user_account_name_list
  ON categories(user_id, account_id, lower(name), list);
