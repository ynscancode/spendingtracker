# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

This started as "a scratch repo for trying out Claude Code workflows" (see README.md) but now contains a real two-part app: a personal budgeting/expense tracker.

- `server/` — Express + better-sqlite3 backend (single-file SQLite DB)
- `client/` — React + Vite frontend

The two are independent npm projects; there is no root `package.json` or monorepo tooling. Run/build each from its own directory.

## Commands

### Server (`server/`)
```
npm install
npm run dev          # node --watch src/index.js, listens on http://localhost:4000
npm start            # node src/index.js (no watch)
npm run smoke-test    # node src/scripts/smokeTest.js — fetch-based end-to-end check against a running server
```
There is no automated test framework wired up; `smokeTest.js` is the only verification script. It expects the server to already be running on port 4000 and exercises the full transaction/transfer/summary flow via real HTTP calls, asserting on response values. Run it manually after starting `npm run dev`.

The SQLite DB file (`server/budget.db`, plus `-wal`/`-shm`) is gitignored and created automatically on first run via the migration in `server/src/migrations/001_init.sql`. Delete it to reset to a clean state (server re-applies the migration on next boot, including seeding the two accounts).

### Client (`client/`)
```
npm install
npm run dev           # Vite dev server on http://localhost:5173, proxies /api/* to http://localhost:4000 (see vite.config.js)
npm run build          # production build to client/dist
npm run lint            # eslint .
npm run preview         # serve the production build locally
```
No test suite is configured for the client either — `npm run build` is the main compile-correctness check.

To run the full app locally: start the server (`server/`, port 4000) and the client dev server (`client/`, port 5173) in separate terminals; the Vite proxy forwards API calls.

## Architecture

### Data model (single source of truth: `server/src/migrations/001_init.sql`)
Two fixed accounts (`Spending` id=1, `Savings` id=2, seeded by the migration — see `server/src/constants/categories.js` `ACCOUNTS` and the client's `client/src/constants/categories.js` `ACCOUNTS`/`ACCOUNT_NAMES`, which must stay in sync with the DB row ids). All money movement is one `transactions` table:
- `amount` is always stored positive; `direction` (`'in'` | `'out'`) carries the sign.
- Internal transfers (Spending ↔ Savings) are represented as **two linked rows**, not one: an `out` leg on the source account and an `in` leg on the destination account, both `is_transfer=1`, each pointing at the other via `linked_transaction_id`. This pairing is created/edited/deleted atomically in `server/src/services/transactionService.js` using a `better-sqlite3` transaction. When deleting a transfer pair, `linked_transaction_id` must be nulled on both rows *before* either row is deleted, or the self-referencing foreign key constraint fails.
- Categories are split into outgoing (`food, drinks, transport, shopping, alcohol, fun, bills, travel, transfer-out`) and incoming (`income, transfer-in, other`) sets — see `server/src/constants/categories.js`. `transfer-in`/`transfer-out` are system-managed only; the plain `POST /transactions` endpoint rejects them (only `POST /transactions/transfer` may set them).
- Running balance per account and daily/monthly aggregates are **computed on read via SQL**, never stored redundantly — see the window function in `server/src/services/balanceService.js` (`SUM(...) OVER (PARTITION BY account_id ORDER BY date, id)`) and the `GROUP BY` queries in `server/src/services/summaryService.js`. Monthly category breakdowns exclude transfers (`is_transfer = 0`) since they're internal movement, not real income/spend.

### Backend structure (`server/src`)
`index.js` wires three route groups under `/api`: `routes/accounts.js`, `routes/transactions.js` (CRUD + the special `/transactions/transfer` endpoint), `routes/summary.js` (`/summary/daily`, `/summary/monthly`). Routes delegate to `services/` (`transactionService`, `balanceService`, `summaryService`), which are the only modules that touch `db.js` directly. `transactionService.js` exports a `ValidationError` class that routes map to HTTP 400.

### Frontend structure (`client/src`)
Three routed pages (`react-router-dom`) under `App.jsx`: `pages/DashboardPage.jsx`, `pages/TransactionsPage.jsx`, `pages/BreakdownPage.jsx`. All server I/O goes through `api/client.js` (a thin fetch wrapper hitting `/api/...`, proxied by Vite in dev).

- **Transactions list** (`components/transactions/`): the flat transaction array from the API is grouped client-side into year → month → day via `utils/dateUtils.js` (`groupByYearMonthDay`), rendered by `TransactionList` → `TransactionGroup` → `DayGroup` → `TransactionRow`. Years/months/days display most-recent-first; transactions *within* a day keep the array's original (chronological) order. `DayGroup` computes per-day combined and per-account in/out subtotals plus end-of-day balances (`dayTotals.js`) and only renders the per-account breakdown when a day actually spans more than one account (avoids redundant rows on a single-account day or filtered view).
- **Highlight rules** (`components/transactions/highlight.js`): spend-amount highlighting (`>$20` orange, `>$40` red) applies only to non-transfer `out` transactions, and only colors the amount cell. Transfer highlighting colors the *whole row* and is direction-specific: a transfer leg landing in Spending from Savings (the "topup spending from savings" comment) gets one color; the reverse direction (Spending→Savings) gets another. `highlightLabelFor` provides a non-color text cue (e.g. "↑ topup") so the distinction isn't color-only.
- **Currency formatting** (`utils/format.js`): accounting-style — `formatCurrency` parenthesizes negative values (no minus sign), `formatInflow`/`formatOutflow` are for sums that are always non-negative but represent in/out flows.
- **Forms**: `TransactionForm.jsx` (normal entry, category dropdown filtered by selected direction) and `TransferForm.jsx` (transfer entry; direction radio buttons each carry a default auto-filled comment that's overwritten only if the user hasn't manually edited the comment field — see the `commentTouched` flag). `EditTransactionPanel.jsx` only allows editing date/amount/comment (matches what the backend's `PUT /transactions/:id` actually accepts); editing a transfer leg updates both linked rows.
- **Breakdown page**: two `recharts` pie charts (money in / money out by category) via `components/breakdown/CategoryPieChart.jsx`, with checkboxes for cash value / percentage / both (`BreakdownControls.jsx`) — at least one of the two must stay checked.

### Styling
Single global stylesheet `client/src/index.css` using CSS custom properties defined in `:root` — a warm dark theme modeled on the Claude app (charcoal background, terracotta accent `--accent`) with a small type scale (`--font-xs` … `--font-2xl`) and semantic color tokens (`--money-in`, `--money-out`, `--topup`, `--transfer-out`, etc.). Icons are from `lucide-react`, sized 14–16px, colored via `currentColor` so they inherit theme colors. Buttons/inputs/selects need an explicit `font-family: inherit` rule (added in `index.css`) since browsers don't inherit page font-family into form controls by default — if fonts look inconsistent after future styling changes, check that rule first before assuming a font-loading issue.

When changing colors or highlight rules, keep `server/src/constants/categories.js` and `client/src/constants/categories.js` in sync (account ids, category lists) — there is no shared package between client and server.
