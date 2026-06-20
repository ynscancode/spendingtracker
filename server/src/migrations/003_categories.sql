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
-- 'miscellaneous' (new outgoing, non-system) cannot take a palette slot since all 8 are
-- already used by the seeds above. Per ADR-023 Decision 3, its color is derived via the
-- deterministic name-hash -> HSL -> hex fallback (32-bit JS string hash of the literal
-- name "miscellaneous" -> hue = |hash| % 360, fixed sat=55%, light=55% -> hex), then
-- FROZEN as a literal here rather than computed in SQL:
--   hash("miscellaneous") -> hue 46, sat 55%, light 55% -> #CBAE4D
-- Verified #CBAE4D does not exactly collide with any of the 8 palette hexes above.
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
  ('food', 'outgoing', 0, '#CC785C'),
  ('drinks', 'outgoing', 0, '#4FB3A7'),
  ('transport', 'outgoing', 0, '#D4A24E'),
  ('shopping', 'outgoing', 0, '#7C8CDE'),
  ('alcohol', 'outgoing', 0, '#C06A9E'),
  ('fun', 'outgoing', 0, '#5FA85A'),
  ('bills', 'outgoing', 0, '#B4754A'),
  ('travel', 'outgoing', 0, '#8A8F98'),
  ('miscellaneous', 'outgoing', 0, '#CBAE4D'),
  ('transfer-out', 'outgoing', 1, '#8A8F98'),
  ('income', 'incoming', 0, '#CC785C'),
  ('other', 'incoming', 0, '#4FB3A7'),
  ('transfer-in', 'incoming', 1, '#8A8F98');
