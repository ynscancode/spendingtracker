import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Turso (cloud libSQL) connection — replaces the local better-sqlite3 file.
// TURSO_DATABASE_URL/TURSO_AUTH_TOKEN are required; there is no local-file
// fallback anymore (see team board Batch 8 — Vercel serverless + Turso).
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function tableExists(name) {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    args: [name],
  });
  return result.rows[0] !== undefined;
}

async function applyMigration(filename) {
  const migrationPath = path.join(__dirname, 'migrations', filename);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await client.executeMultiple(sql);
}

async function runMigrations() {
  const hasTransactionsTable = await tableExists('transactions');
  if (!hasTransactionsTable) {
    await applyMigration('001_init.sql');
  }

  const hasBudgetsTable = await tableExists('budgets');
  if (!hasBudgetsTable) {
    await applyMigration('002_budgets.sql');
  }

  const hasCategoriesTable = await tableExists('categories');
  if (!hasCategoriesTable) {
    await applyMigration('003_categories.sql');
  }

  const hasCategoryAccountIdColumn = (
    await client.execute("SELECT 1 FROM pragma_table_info('categories') WHERE name = 'account_id'")
  ).rows[0] !== undefined;
  if (!hasCategoryAccountIdColumn) {
    await applyMigration('004_category_accounts.sql');
  }

  const hasOldSeedColor = (
    await client.execute("SELECT 1 FROM categories WHERE is_system = 0 AND name = 'food' AND color = '#CC785C'")
  ).rows[0] !== undefined;
  if (hasOldSeedColor) {
    await applyMigration('005_recolor_categories.sql');
  }

  const hasUsersTable = await tableExists('users');
  if (!hasUsersTable) {
    await applyMigration('006_users.sql');
  }

  const hasTransactionsUserIdColumn = (
    await client.execute("SELECT 1 FROM pragma_table_info('transactions') WHERE name = 'user_id'")
  ).rows[0] !== undefined;
  if (!hasTransactionsUserIdColumn) {
    await applyMigration('007_transactions_userid.sql');
  }

  const hasCategoriesUserIdColumn = (
    await client.execute("SELECT 1 FROM pragma_table_info('categories') WHERE name = 'user_id'")
  ).rows[0] !== undefined;
  if (!hasCategoriesUserIdColumn) {
    await applyMigration('008_categories_userid.sql');
  }

  const hasBudgetsUserIdColumn = (
    await client.execute("SELECT 1 FROM pragma_table_info('budgets') WHERE name = 'user_id'")
  ).rows[0] !== undefined;
  if (!hasBudgetsUserIdColumn) {
    await applyMigration('009_budgets_userid.sql');
  }
}

// Top-level await: this suspends the whole ESM module graph (index.js ->
// routes -> services -> db.js) until migrations finish, so no request can
// ever race an unmigrated DB — including on a Vercel cold start, where the
// platform awaits this module before invoking the serverless handler.
const migrationsReady = runMigrations();
await migrationsReady;

export const ready = migrationsReady;
export default client;
