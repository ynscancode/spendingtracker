CREATE TABLE budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (month, category)
);

CREATE INDEX idx_budgets_month ON budgets(month);
