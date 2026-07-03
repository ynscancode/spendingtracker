import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Configurable so a deployed instance (e.g. Fly.io) can point this at a
// mounted persistent volume (e.g. /data/budget.db) instead of the repo-local
// default used in local dev. Falls back to the original hardcoded path when
// DB_PATH is unset, so local dev/smoke-test behavior is unchanged.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'budget.db');

// On a fresh volume mount (e.g. Fly's /data) the parent directory exists but
// is otherwise empty — better-sqlite3 will not create missing directories on
// its own, only the file. Ensure the directory exists before opening.
const dbDir = path.dirname(DB_PATH);
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function runMigrations() {
  const hasTransactionsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'")
    .get();
  if (!hasTransactionsTable) {
    const migrationPath = path.join(__dirname, 'migrations', '001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
  }

  const hasBudgetsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='budgets'")
    .get();
  if (!hasBudgetsTable) {
    const migrationPath = path.join(__dirname, 'migrations', '002_budgets.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
  }

  const hasCategoriesTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'")
    .get();
  if (!hasCategoriesTable) {
    const migrationPath = path.join(__dirname, 'migrations', '003_categories.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
  }

  const hasCategoryAccountIdColumn = db
    .prepare("SELECT 1 FROM pragma_table_info('categories') WHERE name = 'account_id'")
    .get();
  if (!hasCategoryAccountIdColumn) {
    const migrationPath = path.join(__dirname, 'migrations', '004_category_accounts.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
  }

  const hasOldSeedColor = db
    .prepare("SELECT 1 FROM categories WHERE is_system = 0 AND name = 'food' AND color = '#CC785C'")
    .get();
  if (hasOldSeedColor) {
    const migrationPath = path.join(__dirname, 'migrations', '005_recolor_categories.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
  }
}

runMigrations();

export default db;
