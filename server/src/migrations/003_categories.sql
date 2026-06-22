-- Categories table (ADR-023 Decision 2). Additive only: no changes to transactions/budgets
-- columns (category stays free-text there, soft-referenced — ADR-023 Decision 1).
--
-- Color assignment: the 8 original outgoing seed categories (food, drinks, transport,
-- shopping, alcohol, fun, bills, travel) consume all 8 entries of the shared palette
-- (see server/src/constants/palette.js PALETTE, in that exact order). transfer-out and
-- transfer-in are system-managed and both use the neutral palette color (#8A8F98) already
-- assigned to "travel" by design (ADR-023) — they are never shown alongside travel in the
-- same picker (system categories are excluded from user-facing CRUD/pickers entirely), so
-- this is not a user-visible collision.
--
-- 'miscellaneous' (outgoing) and 'income'/'other' (incoming) sit outside the 8-slot
-- palette but share the same hue-spacing scheme: every non-system, non-travel category's
-- hue is 36 degrees from its neighbors (10 hues total, fixed sat=48%, light=58%), so no
-- two read as the same color — see server/src/migrations/005_recolor_categories.sql,
-- which re-applies this same scheme to any pre-existing dev DB seeded before this scheme
-- existed (e.g. one where 'income' still equalled 'food' or 'transport'/'miscellaneous'
-- were near-identical golds).
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  list TEXT NOT NULL CHECK (list IN ('outgoing', 'incoming')),
  is_system INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_categories_name_list ON categories(lower(name), list);

INSERT INTO categories (name, list, is_system, color) VALUES
  ('food', 'outgoing', 0, '#C76060'),
  ('drinks', 'outgoing', 0, '#60C7C7'),
  ('transport', 'outgoing', 0, '#C79E60'),
  ('shopping', 'outgoing', 0, '#7560C7'),
  ('alcohol', 'outgoing', 0, '#B360C7'),
  ('fun', 'outgoing', 0, '#75C760'),
  ('bills', 'outgoing', 0, '#C7609E'),
  ('travel', 'outgoing', 0, '#8A8F98'),
  ('miscellaneous', 'outgoing', 0, '#B3C760'),
  ('transfer-out', 'outgoing', 1, '#8A8F98'),
  ('income', 'incoming', 0, '#608AC7'),
  ('other', 'incoming', 0, '#60C78A'),
  ('transfer-in', 'incoming', 1, '#8A8F98');
