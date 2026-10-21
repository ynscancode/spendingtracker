# CLAUDE.md

## Repository purpose

Personal budgeting/expense tracker — two independent npm projects:
- `server/` — Express + better-sqlite3 backend (SQLite DB)
- `client/` — React + Vite frontend

No root `package.json`. Run/build each from its own directory.

## Commands

### Server (`server/`)
```
npm install
npm run dev       # node --watch, port 4000
npm start         # no watch
npm run smoke-test  # fetch-based e2e check against a running server
```

### Client (`client/`)
```
npm install
npm run dev       # Vite dev server, port 5173, proxies /api/* to :4000
npm run build     # production build to client/dist
npm run lint      # eslint .
npm run preview   # serve production build locally
```

The SQLite DB (`server/budget.db`) is gitignored, created automatically via migrations on first run. Delete it to reset. `server/.env.example` documents all vars. Required: `JWT_SECRET` (throws at module load if unset, crashing the server), `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`, `API_TOKEN`, `CORS_ORIGIN`. Optional LLM: `OLLAMA_CLOUD_*`.

## Architecture

### Data model
Migrations: `server/src/migrations/001_init.sql`–`009_budgets_userid.sql`. `db.js` applies them via sequential existence guards (no versioned runner).

**Accounts**: Two fixed rows — `Spending` id=1, `Savings` id=2. `ACCOUNTS`/`ACCOUNT_NAMES` constants in `server/src/constants/categories.js` and `client/src/constants/categories.js` must stay in sync.

**Transactions**: Single `transactions` table.
- `amount` always positive; `direction` (`'in'`|`'out'`) carries the sign.
- Transfers: two linked rows (`is_transfer=1`), each pointing at the other via `linked_transaction_id`. Created/edited/deleted atomically in `transactionService.js`. To delete a pair, null `linked_transaction_id` on both rows before deleting either (self-referencing FK constraint).
- Running balance computed via SQL window function in `balanceService.js` (`SUM OVER PARTITION BY account_id ORDER BY date, id`); never stored redundantly.

**Categories**: Per-account rows in `categories` table, scoped by `account_id` (`004_category_accounts.sql`). System categories (`transfer-in`/`transfer-out`) are `is_system=1`, `account_id IS NULL`, `user_id IS NULL` permanently. Unique index: `(user_id, account_id, lower(name), list)`. `categoryService.js` is the only module reading/writing this table.

**Budgets**: `budgets` table — one row per `(user_id, month, category)`. `month` = `'YYYY-MM'`, `category` = Spending outgoing category name only. Sparse: rows exist only after a `PUT`. `getBudgetsForMonth` synthesizes `0` default for missing rows. No "unset" concept exposed to callers — zero and unset are identical at the product level.

**Users** (`006_users.sql`–`009_budgets_userid.sql`): `users` table (`id, username, password_hash, is_guest, created_at`). `user_id INTEGER` added to `transactions`, `categories`, `budgets` — plain columns, **no FK** (SQLite `ALTER TABLE ADD COLUMN` can't add FK). **Isolation is pure service-layer discipline**: every query on these three tables must include a `user_id` predicate or stamp. Any new query omitting `user_id` is a bug.

**First-signup legacy claim**: The first non-guest signup (checked via `COUNT(*) FROM users WHERE is_guest = 0` before insert, in one write transaction) claims all `user_id IS NULL` rows: `UPDATE transactions/budgets/categories SET user_id = :newId WHERE user_id IS NULL` (categories also requires `AND is_system = 0`). Every subsequent signup (and every guest) calls `seedCategoriesForUser()` instead. Guest signups never trigger the claim.

### Backend structure (`server/src`)

`index.js` mounts route groups under `/api`: `accounts`, `transactions` (+ `/transfer`), `summary` (`/daily`, `/monthly`), `budgets`, `categories`, `imports`, `auth`.

**Auth gates** (checked in order):
1. Static `X-API-Token: <API_TOKEN>` header gate — infra-level; skipped if `API_TOKEN` unset. `OPTIONS` always passes.
2. `requireUser` middleware — all routers except `/api/auth`. Reads JWT from `Authorization: Bearer <jwt>`, or for `GET /api/transactions/export` only from `?authToken=<jwt>` query param. Sets `req.userId`/`req.user` on success; 401 otherwise.

**JWT**: HS256, `{ sub: userId, username, isGuest }`, **no `exp`** — tokens don't expire; only revocation is rotating `JWT_SECRET` (logs everyone out). `JWT_SECRET` read at module load; throws immediately if unset. Passwords: bcryptjs cost 10, 8-char min, 72-byte max.

**Auth endpoints** (`routes/auth.js` → `authService.js`):
- `POST /api/auth/signup` → 201 `{ token, user }` | 400
- `POST /api/auth/login` → 200 `{ token, user }` | 401 (runs dummy bcrypt compare on not-found/guest to prevent timing enumeration)
- `POST /api/auth/guest` → 201 `{ token, user }` (always seeds fresh categories, never claims legacy)
- `GET /api/auth/me` → 200 `{ user }` | 401 (requireUser inside router)
- `POST /api/auth/logout` → 200 `{ ok: true }` (stateless no-op)
- `DELETE /api/auth/me` → 200 `{ ok: true }` | 400/401/404. Password required for non-guests; guests skip it. Cascade in one write transaction: null transfer links → delete transactions → delete budgets → delete non-system categories → delete user.

**Services**: All scoped by `userId`. `transactionService` stamps `user_id` on INSERT, filters on all reads/updates/deletes; `deleteAllTransactions` is always `WHERE user_id = :userId`. `balanceService` filters inside the window subquery. `summaryService` scopes all aggregates. `budgetService` upserts on `ON CONFLICT(user_id, month, category)`. `categoryService` uses `(user_id = :userId OR is_system = 1)` on delete-lookup (returns 400 not 404 for system rows), strict `AND user_id = :userId` on the actual DELETE.

**Budgets API** (`routes/budgets.js` → `budgetService.js`): Spending-only.
- `GET /api/budgets?month=YYYY-MM` → exhaustive array (every category, amount 0 if unset), scoped to `req.userId`
- `PUT /api/budgets` `{ month, category, amount }` → upsert; `amount=0` is valid. No `DELETE` endpoint.
- `GET /api/budgets/recent?before=YYYY-MM` → nearest prior month with rows
- `POST /api/budgets/copy-from-recent` `{ month }` → copies from most recent prior month
- `POST /api/budgets/clear` `{ month }` → deletes all rows for that month

**Import LLM-suggest** (`routes/imports.js` → `importLlmService.js`): `POST /api/imports/suggest`. Assist-only, never auto-commits. Hard-off if `OLLAMA_CLOUD_*` unset or base URL not `https:`. Server-enforces: 5-row cap, comment-column redaction, `REQUEST_TIMEOUT_MS` abort, `MAX_RESPONSE_BYTES` cap. Validates response with drop-whole-on-any-deviation strict allow-list. In-memory cache by `fileHash`. Returns 200 `{ suggestion: null }` for all expected failures.

### Frontend structure (`client/src`)

Three pages under `App.jsx` (react-router-dom): `DashboardPage`, `TransactionsPage`, `BudgetPage`. All server I/O through `api/client.js`.

**Auth** (`contexts/AuthContext.jsx`, `contexts/auth.js`):
- JWT in `localStorage['ledger.authToken']` (persist=true) or `sessionStorage['ledger.authToken']` (persist=false, login only). `getAuthToken()` checks localStorage first, then sessionStorage. `clearAuthToken()` clears both.
- `localStorage['ledger.authSessions']` = `{ [username]: token }` — account switcher's saved sessions. Not written for persist=false logins.
- On mount: reads stored token, calls `GET /api/auth/me` to verify; failure clears token.
- `switchAccount(username)` re-verifies via `/auth/me`; drops stale session on failure.
- Any 401 from `/api/*` (except `/auth/*`) dispatches `window` CustomEvent `ledger:unauthorized` → clears token + shows AuthScreen.
- `applySession(token, user, { persist })` is the single write path for login/signup/guest.
- `CategoriesProvider` and `TransactionActivityProvider` are `key={user.id}` — remounts on account switch.

**Auth UI** (`components/auth/`):
- `AuthScreen.jsx` — full-page login/signup tabs + guest button
- `AuthForms.jsx` — shared `LoginForm`/`SignupForm`; LoginForm has "Stay signed in" checkbox (default checked)
- `AddAccountModal.jsx` — add second account; portal to `#modal-root`
- `DeleteAccountModal.jsx` — password confirmation (skipped for guests); uses `.btn-danger` + `.clear-history-warning` styles
- `AccountSwitcher.jsx` — Header dropdown: current username, switch/add/logout/delete; mobile: `order: 1/2` reorder, `calc(100vw - 32px)` width clamp

**`api/client.js`**: `authHeader()` attaches `X-API-Token` + `Authorization: Bearer` to every request. Export download uses `?token=&authToken=` query params. `setAuthToken(token, { persist })`, `getAuthToken()`, `clearAuthToken()`.

**Transactions list** (`components/transactions/`): Flat array grouped client-side (year → month → day) via `groupByYearMonthDay`. Most-recent-first for years/months/days; within a day keeps original chronological order. `DayGroup` computes per-day totals and end-of-day balances (`dayTotals.js`); shows per-account breakdown only when a day spans multiple accounts.

- **Highlight** (`highlight.js`): transfers → `'highlight-transfer'` (no direction coloring). Non-transfer out: `'highlight-orange'` (>$20) / `'highlight-red'` (>$40) as a small colored dot. `transferBadgeFor` → IN/OUT text badge (green/red) in the comment cell.
- **Currency**: `formatCurrency` parenthesizes negatives. `formatInflow`/`formatOutflow` for non-negative flows. `AccountingValue` splits trailing `)` into a right-edge gutter span so digits align. `BalanceValue` wraps `AccountingValue` for `formatCurrency`.
- **Inline edit**: `TransactionRow` shows `ReadRow` or `EditRow` based on `editingId`. `editingId` held in `TransactionsPage`, threaded down. For transfers, Category is locked (plain text); save omits `category`. Enter saves, Escape cancels. Errors render as `role="alert"` row beneath editing row.

**Modal portal**: `TransactionModal` (and nested `CategoryManagerModal`) portal to `<div id="modal-root" />`, a sibling of `<main>` inside `.app-root`. Required because `.page-animate` has a CSS `transform` which makes it a containing block for `position: fixed`. Any new full-page modal must use `#modal-root`.

**Dashboard** (`DashboardPage.jsx`): Spending-only (`scopeAccountId` = fixed constant), except Monthly insights money figures and the Breakdown section (both accounts). Contains:
- Daily insights card — "Budget $X/day" pill is click-to-edit, backed by `hooks/useDailyBudget.js` (localStorage `ledger.dailyBudget`, `null` stored as `'null'` to survive reload)
- Budget card — total budgeted vs. actual, full worst-first category list (over → near → under), no row cap
- Balance cards — Spending + Net worth
- Top spending + Recent activity (Spending-only)
- Monthly insights — money in/out/net/savings rate are Combined (both accounts, transfers excluded, `selectedMonth`) via shared `realFlows`/`sumAmounts` in `utils/breakdown.js`; the daily spending bar chart stays Spending-only.
- Breakdown section — heading row has `BreakdownViewSwitch` (Combined | Spending | Savings, default Combined; `role="radiogroup"`, arrow/Home/End keys) + `MonthSwitcher` + cash/percentage toggle; independent `selectedMonth` state and `breakdownTransactions` fetch. One `DonutCard` pair + one `InOutCompareCard` driven by the selected view. Derived client-side by `utils/breakdown.js`:
  - Combined (`combinedBreakdown`): both accounts as one pot, transfers excluded; grouped by (account, category), account-name suffix only when a category name collides across accounts; donut center Spent/Earned.
  - Spending/Savings (`accountBreakdown`): transfers included as one gray (`var(--faint)`) segment per direction, "From/To <other account>", so in − out = the account's net balance change; donut center Out/In.

**Budget page** (`BudgetPage.jsx`): edit-only. `MonthSwitcher` + editable category list (Spending outgoing only). Each row: actual spend (from `/api/summary/monthly`) + editable budget input. Blur/Enter commits via `PUT /api/budgets`. Empty input commits `0`. "Copy from [Month]" + "Clear" buttons. Health: `under` (<90%) / `near` (90–100%) / `over` (>100%); no `unset`.

**Categories**: Fetched live via `CategoriesContext` (`contexts/CategoriesContext.jsx`). Exposes `outgoingFor(accountId)`, `incomingFor(accountId)`, `colorFor(accountId, name)`. Components use `ACCOUNTS.SPENDING`/`ACCOUNTS.SAVINGS` (not a static list).

**Category colors**: 10 seed colors at 36° hue intervals (sat 48%, light 58%). `travel` and system transfer categories share neutral gray `#8A8F98`. `assignColor()` in `categoryService.js` finds a hue ≥30° from all existing colors on that account for new categories.

**LLM import suggest** (`components/imports/ImportSuggestAI.jsx`, Step 2 of import wizard): "Suggest with AI" button opens consent panel showing exact payload before sending. `buildPayload()` is shared between preview and real request. Applies to `columnMapping`/`categoryMapping`/`accountMapping` state only; never auto-commits. Failed/null response → silent no-op + `role="status"` note.

**Month navigation** (`components/layout/MonthSwitcher.jsx`): shared across BudgetPage, DashboardPage Breakdown, and TransactionsPage (if applicable). Props: `{ month, onChange }` where `onChange` receives `'YYYY-MM'`.

### Styling

`client/src/index.css` — single global stylesheet, CSS custom properties in `:root`. Warm dark theme, terracotta accent `--accent`. Tokens: `--money-in`, `--money-out`, `--topup`, `--transfer-out`, `--warning` (decorative fills), `--warning-text` (near-budget text — differs from `--warning` on light theme for WCAG AA). Three themes in `contexts/theme.js`: refined/dark, editorial/light, terminal/mono.

Buttons/inputs/selects need `font-family: inherit` (already in `index.css`).

**iOS auto-zoom fix** (at end of `index.css`):
```css
@media (pointer: coarse) {
  input, select, textarea, /* + scoped selectors */ { font-size: 16px; }
}
```
Placed at end of file so it isn't overridden by later equal-specificity rules.

## Known security risks (accepted)

- **`xlsx` @0.18.5**: unpatched Prototype Pollution + ReDoS advisories on npm (no registry fix). Accepted for single-user local app. Reopens if app becomes multi-user/network-exposed or a registry fix appears.
- **JWT in localStorage** (XSS exposure): accepted for SPA with no cookie-based session. Reopens if a plausible XSS vector is added.
- **No token expiry**: deliberate. Only revocation = rotate `JWT_SECRET` (logs everyone out). Reopens if deployed with higher-consequence data.
- **No rate limiting on `/api/auth/*`**: behind static `X-API-Token` gate; bcrypt cost-10 slows brute force. Reopens before any deploy where the static token is no longer an effective secret.
- **`?authToken` query param**: narrowed to `GET /api/transactions/export` only (originally all routes — durable credential in logs risk). Static `?token=` remains unscoped (lower severity — infra token, not per-user identity).
- **Login timing/enumeration**: fixed — dummy bcrypt compare on not-found/guest branch. Signup "username taken" 400 remains a direct oracle (accepted UX tradeoff).
- **Password floor**: fixed — `signup` rejects <8 chars or >72 bytes.
- **No DB-level FK for `user_id`**: permanent design (SQLite ALTER TABLE limitation). Isolation is 100% service-layer. Any new query omitting `user_id` on transactions/budgets/categories is a regression.
- **Open CORS if `CORS_ORIGIN` unset**: infra/deploy-checklist item. Set `CORS_ORIGIN` to deployed frontend origin in production.
- **LLM suggest data egress**: only path data leaves the machine. Opt-in per file with mandatory consent/preview. Server-enforced 5-row cap, comment redaction, schema-validation drop-whole. Accepted under current single-user model. Reopens if multi-user, auto-commit, or always-on default is added.
