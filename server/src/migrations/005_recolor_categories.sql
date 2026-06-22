-- Re-applies the 36-degree hue-spacing scheme (see 003_categories.sql header) to any DB
-- seeded before that scheme existed. Matches by name, which covers both accounts since
-- 004_category_accounts.sql cloned Spending's rows into Savings by name. User-renamed or
-- user-added categories are intentionally left untouched here (no name to map them by) —
-- they get a correctly-spaced hue from assignColor() the next time they're touched, or
-- can simply be left as-is since they were never part of this fixed seed set.
UPDATE categories SET color = '#C76060' WHERE is_system = 0 AND name = 'food';
UPDATE categories SET color = '#60C7C7' WHERE is_system = 0 AND name = 'drinks';
UPDATE categories SET color = '#C79E60' WHERE is_system = 0 AND name = 'transport';
UPDATE categories SET color = '#7560C7' WHERE is_system = 0 AND name = 'shopping';
UPDATE categories SET color = '#B360C7' WHERE is_system = 0 AND name = 'alcohol';
UPDATE categories SET color = '#75C760' WHERE is_system = 0 AND name = 'fun';
UPDATE categories SET color = '#C7609E' WHERE is_system = 0 AND name = 'bills';
UPDATE categories SET color = '#B3C760' WHERE is_system = 0 AND name = 'miscellaneous';
UPDATE categories SET color = '#608AC7' WHERE is_system = 0 AND name = 'income';
UPDATE categories SET color = '#60C78A' WHERE is_system = 0 AND name = 'other';
