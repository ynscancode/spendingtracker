# Deployment

Deploys the budget tracker backend to Fly.io (with a persistent volume for the
SQLite DB) and the frontend to Vercel (Netlify steps included as an alternative).

## Prerequisites

- A free [Fly.io](https://fly.io) account.
- A free [Vercel](https://vercel.com) account (or [Netlify](https://netlify.com)).
- The GitHub repo already exists: https://github.com/ynscancode/claudecode-sandbox
- `flyctl` installed: https://fly.io/docs/hands-on/install-flyctl/
- Logged in: `fly auth login`

---

## 1. Backend on Fly.io

Run all commands from the `server/` directory.

```
cd server
```

### 1.1 Launch the app

`server/fly.toml` already exists in the repo with the app's build/env/volume/http
config pre-filled — **do not let `fly launch` generate a new config**, tell it to
use the existing one.

```
fly launch
```

- When prompted for an app name: choose a globally-unique name (e.g.
  `your-name-budget-tracker-api`). The `app = "CHANGE-ME-budget-tracker-api"`
  line in `fly.toml` is a placeholder — either let `fly launch` overwrite it, or
  edit it yourself before running the command.
- When prompted for a region: pick one close to you (e.g. `iad` for US East,
  `lhr` for London, `syd` for Sydney). Full list: `fly platform regions`.
  Replace `primary_region = "CHANGE-ME"` in `fly.toml` accordingly.
- When asked "Would you like to copy its configuration to the new app?" — say
  **yes** (use the existing `fly.toml`, don't let it be regenerated from
  scratch, or you'll lose the `[mounts]`/`[env]`/`[http_service]` settings).
- **Say NO to "Would you like to deploy now?"** — the volume doesn't exist yet.
  Deploying before the volume is created will fail to mount `/data` (or Fly
  will create the machine without persistent storage, losing data on next
  restart).

### 1.2 Create the volume

`fly.toml`'s `[mounts]` block expects a volume named `budget_data` mounted at
`/data`. Create it once, in the same region you picked above:

```
fly volumes create budget_data --region <your-region> --size 1
```

(1GB — plenty for a single-user SQLite budgeting DB.)

### 1.3 Set secrets

`PORT` and `DB_PATH` are already set as plain env vars in `fly.toml`'s `[env]`
block — you do not need to set those manually.

`CORS_ORIGIN` is a secret and is intentionally **not** in `fly.toml`. This is a
chicken-and-egg problem: you don't have the frontend's URL until after you
deploy the frontend, but you're deploying the backend first. Handle it in two
steps:

**Now (before the frontend exists):** skip this — leaving `CORS_ORIGIN` unset
means the server falls back to fully-open CORS. That's fine temporarily but
should not be left that way once the app is live (see the Security section
below).

**After the frontend is deployed (step 2 below):**

```
fly secrets set CORS_ORIGIN=https://your-frontend.vercel.app
```

Comma-separate multiple origins if needed (e.g. a Vercel preview URL plus the
production URL):

```
fly secrets set CORS_ORIGIN=https://your-frontend.vercel.app,https://your-frontend-git-preview.vercel.app
```

**Optional — LLM-assisted import ("Suggest with AI"):** off by default. Only
set these if you want that feature in production:

```
fly secrets set OLLAMA_CLOUD_API_KEY=... OLLAMA_CLOUD_MODEL=... OLLAMA_CLOUD_BASE_URL=...
```

### 1.4 Deploy

```
fly deploy
```

Your backend is now live at `https://<your-app-name>.fly.dev`.

---

## 2. Frontend on Vercel

1. In the Vercel dashboard: **Add New Project** → import the
   `ynscancode/claudecode-sandbox` GitHub repo.
2. Project settings:
   - **Root Directory**: `client`
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Environment variable (Project Settings → Environment Variables):
   - `VITE_API_URL` = `https://<your-app-name>.fly.dev` (the Fly backend URL
     from step 1.4, no trailing slash)

   This is a **build-time** variable — Vite inlines it when the app is built,
   not at runtime. If you change it later, you must trigger a new deploy
   (Vercel does this automatically on the next push, or use "Redeploy" in the
   dashboard) for the change to take effect.
4. Deploy.
5. **Now go back to Fly and set CORS_ORIGIN** to the Vercel URL you were just
   given (from step 1.3), then apply it:

```
cd server
fly secrets set CORS_ORIGIN=https://your-frontend.vercel.app
fly deploy
```

(Setting a secret restarts the app automatically on `fly secrets set`, but
running `fly deploy` afterward is a safe, explicit way to confirm it's picked
up.)

### Netlify equivalent

- **Base directory**: `client`
- **Build command**: `npm run build`
- **Publish directory**: `client/dist`
- Environment variable: same `VITE_API_URL` = `https://<your-app-name>.fly.dev`
- Add a SPA redirect so client-side routing (React Router) works on direct/
  refreshed URLs — create `client/public/_redirects` with:

  ```
  /*  /index.html  200
  ```

  Without this, refreshing on any route other than `/` (e.g. `/transactions`)
  returns a Netlify 404 instead of the app. Vercel handles this automatically
  for Vite SPAs, which is why this step is Netlify-specific.

---

## 3. Security — no authentication

**This app has no login or authentication of any kind.** This was an accepted
tradeoff for a single-user personal tool, not an oversight — but it matters
once the app is reachable on a public URL:

- Anyone who knows (or guesses/finds) your Fly backend URL
  (`https://<your-app-name>.fly.dev`) can read and write your transaction data
  directly via the API — there is nothing checking who's asking.
- `CORS_ORIGIN` only restricts which **browser origins** (web pages) are
  allowed to make cross-origin requests to the backend from JavaScript. It
  does **not** block direct requests — `curl`, Postman, a script, or any
  non-browser client can hit the API regardless of `CORS_ORIGIN`. Treat
  `CORS_ORIGIN` as a hygiene measure against casual/accidental cross-site
  requests, not as an access-control mechanism.
- Set `CORS_ORIGIN` anyway (step 1.3) — it's still worth doing — but understand
  it does not make the deployment private. Don't rely on "nobody knows the
  URL" (security through obscurity) as your actual protection; be aware that a
  public Fly URL is genuinely public.
- If this exposure is unacceptable, don't deploy publicly — run the app
  locally instead (per the main `README.md`/`CLAUDE.md` setup), or add
  authentication before exposing it, which is out of scope for this
  deployment guide.

---

## 4. Ongoing operations

### Redeploying

- **Frontend**: push to GitHub → Vercel (or Netlify) auto-builds and deploys
  on every push to the connected branch. No manual step needed.
- **Backend**: `cd server && fly deploy` after pulling/pushing changes.

### Where the data lives

The SQLite DB (`/data/budget.db` inside the container, per `DB_PATH` in
`fly.toml`) lives on the Fly volume `budget_data`, not in the container image.
It survives `fly deploy` redeploys and machine restarts.

- List/inspect volumes: `fly volumes list`
- **Destroying the volume (`fly volumes destroy budget_data`) permanently
  wipes your data.** There is no automated backup configured.
- Fly volumes are tied to a single machine/region and are not
  multi-region-replicated on the free tier — this setup assumes one machine,
  which matches this app's `min_machines_running = 0` scale-to-zero config for
  a single personal user.

### Manual backup (nice-to-have, not automated)

Copy the DB file off the running machine via `fly ssh sftp`:

```
fly ssh sftp get /data/budget.db ./budget-backup.db
```

Run this periodically if you want a local backup — nothing in this deployment
does it for you automatically.
