# Deployment

Deploys the budget tracker backend as a **Vercel serverless function**, backed
by **Turso** (cloud libSQL) for the database, and the frontend to Vercel as a
static build. There is no long-running server process and no local SQLite
file in this setup — the app is fully serverless.

## Prerequisites

- A free [Turso](https://turso.tech) account.
- A free [Vercel](https://vercel.com) account.
- The GitHub repo already exists: https://github.com/ynscancode/claudecode-sandbox

---

## Part 1 — Set up Turso

1. Install the Turso CLI:
   ```
   curl -sSfL https://get.turso.tech/install.sh | bash
   ```
2. Sign up / log in (GitHub login):
   ```
   turso auth signup
   ```
3. Create the database:
   ```
   turso db create budget-db
   ```
4. Get the connection URL:
   ```
   turso db show budget-db
   ```
   Copy the URL — it looks like `libsql://budget-db-<username>.turso.io`.
5. Create an auth token:
   ```
   turso db tokens create budget-db
   ```
   Copy the token — you'll paste both the URL and the token into Vercel in Part 2.

---

## Part 2 — Deploy backend on Vercel

1. In the Vercel dashboard: **Add New Project** → import the
   `ynscancode/claudecode-sandbox` repo.
2. Set **Root Directory** to `server`.
3. **Framework Preset**: Other (this is a plain Express app exported as a
   serverless function via `server/api/index.js` and `server/vercel.json` —
   not a framework Vercel auto-detects).
4. Generate a random API token on your machine:
   ```
   openssl rand -hex 32
   ```
   Copy the output — you'll use it in the next step and again in Part 3.
5. Environment variables (**Project → Settings → Environment Variables**):
   - `TURSO_DATABASE_URL` = the URL from Part 1 step 4
   - `TURSO_AUTH_TOKEN` = the token from Part 1 step 5
   - `API_TOKEN` = the random string from step 4 above
   - `CORS_ORIGIN` = leave blank for now — you'll set this in Part 4 once you
     know the frontend's URL.
5. Deploy. Note the resulting backend URL (e.g.
   `https://claudecode-sandbox-server.vercel.app`) — you'll need it in Part 3.

---

## Part 3 — Connect frontend

1. Go to your existing frontend Vercel project → **Settings → Environment
   Variables**.
2. Set `VITE_API_URL` = the backend URL from Part 2.
3. Set `VITE_API_TOKEN` = the same random string you set as `API_TOKEN` on the
   backend in Part 2 step 4.
4. Redeploy (or push a commit). These are **build-time** variables —
   Vite inlines them when the app is built, not read at runtime — so a plain
   env-var save alone does not take effect until the next build/redeploy.

---

## Part 4 — Lock CORS

1. Go to the **backend** Vercel project → **Settings → Environment
   Variables** → add `CORS_ORIGIN` = your frontend's URL (from Part 3).
2. Redeploy the backend.

Comma-separate multiple origins if needed (e.g. a preview URL plus the
production URL).

---

## Part 5 — Test on phone

Open the frontend Vercel URL on your phone — it should load fully, including
fetching accounts/transactions from the backend.

---

## Part 6 — Updating the app

Push to `main`. Both Vercel projects (frontend and backend) auto-deploy on
every push — there is no manual redeploy/SSH step for updates.

---

## Security note

The `API_TOKEN` / `VITE_API_TOKEN` pair is a simple shared-secret gate: every
API request from the frontend carries `Authorization: Bearer <token>`, and the
backend rejects anything without it. This is sufficient protection for a
single-user personal app — someone would need to know your specific token to
access your data.

Keep the token out of version control (it lives only in Vercel's env var
settings, not in any committed file). If you ever suspect the token has leaked,
generate a new one (`openssl rand -hex 32`), update both the backend and
frontend Vercel env vars, and redeploy both.

`CORS_ORIGIN` is an additional browser-origin restriction on top of the token —
it stops other websites from making cross-origin requests to your backend from
a visitor's browser, even if they somehow had the token. Set it to your
frontend URL once both projects are deployed.
