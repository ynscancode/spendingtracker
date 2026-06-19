import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'budget.db');

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
}

runMigrations();

export default db;
