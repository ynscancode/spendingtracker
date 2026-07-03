# Deployment

Deploys the budget tracker backend to an **Oracle Cloud Always Free** VM (a
real Ubuntu 22.04 ARM Ampere A1.Flex instance, running 24/7 at no cost, with a
persistent disk for the SQLite DB) and the frontend to Vercel.

## Prerequisites

- A free [Oracle Cloud](https://cloud.oracle.com) account (Always Free tier).
- A free [Vercel](https://vercel.com) account.
- The GitHub repo already exists: https://github.com/ynscancode/claudecode-sandbox
- An SSH client (built into macOS/Linux/Windows 10+ terminals).

---

## Part 1 — Oracle Cloud VM setup (one-time)

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) and create a free
   Always Free account.
2. Create a VM instance: **Compute → Instances → Create Instance**
   - **Shape**: `VM.Standard.A1.Flex` (Ampere ARM, Always Free eligible) — 1
     OCPU / 6GB RAM is plenty for this app.
   - **Image**: Ubuntu 22.04 (Canonical).
   - Generate and download the SSH key pair when prompted (you'll need the
     private key file to SSH in).
3. Note the VM's **public IP address** (shown on the instance detail page).
4. Open port 4000 in the VM's security list:
   **Networking → Virtual Cloud Networks → your VCN → Security Lists →
   Default Security List → Ingress Rules → Add Ingress Rules**
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: TCP
   - Destination Port Range: `4000`

   **Gotcha**: this only opens the port at the Oracle Cloud network level.
   Oracle's Ubuntu 22.04 image also ships with its own restrictive `iptables`
   rules that block inbound traffic by default — even after the security list
   change, the VM's own firewall can still drop the connection. If
   `curl http://<VM_IP>:4000/api/accounts` times out after everything else is
   done, check/fix the VM's iptables:
   ```
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 4000 -j ACCEPT
   sudo netfilter-persistent save   # or: sudo apt install iptables-persistent
   ```
5. SSH in:
   ```
   ssh -i ~/path/to/privatekey ubuntu@<YOUR_VM_IP>
   ```
6. Run the setup script. Two ways to get it onto the VM:
   - **(a) curl it directly from GitHub** (fastest, no clone needed first):
     ```
     curl -fsSL https://raw.githubusercontent.com/ynscancode/claudecode-sandbox/main/server/scripts/setup-oracle.sh -o setup-oracle.sh && bash setup-oracle.sh
     ```
   - **(b) it's already in the repo** — the script itself clones the repo, so
     once that clone exists you can also run it from there:
     ```
     bash ~/claudecode-sandbox/server/scripts/setup-oracle.sh
     ```

   The script (`server/scripts/setup-oracle.sh`) is linear and fail-fast
   (`set -e`, no error trapping) — it's meant to be run interactively; if a
   step fails, read the error, fix it, and re-run (every step is safe to
   re-run). It updates apt, installs `build-essential`/`git`/`curl`
   (`build-essential` is required because `better-sqlite3` compiles a native
   addon on ARM), installs Node.js 22 via NodeSource, installs PM2 globally,
   clones the repo (default `https://github.com/ynscancode/claudecode-sandbox.git`,
   override with `REPO_URL=... bash setup-oracle.sh` if you're deploying a
   fork), runs `npm ci --omit=dev` in `server/`, creates `/data` (owned by
   `ubuntu`, so the SQLite migration can create the DB file there on boot),
   starts the app via `pm2 start ecosystem.config.cjs --env production`, and
   sets up PM2 to survive a reboot.

   **One manual step in the middle of the script**: `pm2 startup` prints a
   `sudo env PATH=... pm2 startup systemd -u ubuntu ...` command that you must
   copy, paste, and run yourself (PM2 can't run this part unattended), then
   run `pm2 save` again afterward. The script's echoes call this out when you
   get there.

---

## Part 2 — Deploy the backend

1. The setup script above handles everything: Node, PM2, cloning, installing
   dependencies, creating `/data`, starting the app, and configuring it to
   start on boot.
2. Test it:
   ```
   curl http://<YOUR_VM_IP>:4000/api/accounts
   ```
   should return a JSON array of the two accounts.
3. Set CORS for your Vercel frontend (do this once you have the Vercel URL
   from Part 3):
   ```
   pm2 set budget-api:CORS_ORIGIN https://your-app.vercel.app
   pm2 restart budget-api
   ```
   Comma-separate multiple origins if needed (e.g. a preview URL plus the
   production URL):
   ```
   pm2 set budget-api:CORS_ORIGIN https://your-app.vercel.app,https://your-app-git-preview.vercel.app
   pm2 restart budget-api
   ```

   **Optional — LLM-assisted import ("Suggest with AI")**: off by default.
   Only set these if you want that feature in production. `ecosystem.config.cjs`
   doesn't define them, so set them the same way as `CORS_ORIGIN`:
   ```
   pm2 set budget-api:OLLAMA_CLOUD_API_KEY ...
   pm2 set budget-api:OLLAMA_CLOUD_MODEL ...
   pm2 set budget-api:OLLAMA_CLOUD_BASE_URL ...
   pm2 restart budget-api
   ```

---

## Part 3 — Connect the Vercel frontend

1. In the Vercel dashboard: **Add New Project** → import the
   `ynscancode/claudecode-sandbox` GitHub repo.
2. Project settings:
   - **Root Directory**: `client`
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Environment variable (Project Settings → Environment Variables):
   - `VITE_API_URL` = `http://<YOUR_VM_IP>:4000` (no trailing slash)

   This is a **build-time** variable — Vite inlines it when the app is built,
   not at runtime. If you change it later, you must trigger a new deploy
   (push a commit, or use "Redeploy" in the dashboard) for the change to take
   effect.
4. Deploy (or push a commit to trigger the first auto-deploy).
5. **Now go back to the VM and set `CORS_ORIGIN`** to the Vercel URL you were
   just given (Part 2, step 3), then restart:
   ```
   pm2 set budget-api:CORS_ORIGIN https://your-app.vercel.app
   pm2 restart budget-api
   ```
6. Test the live app, including on your phone (over plain HTTP — see the
   security note below on why this is fine for personal use but worth being
   aware of).

---

## Part 4 — Updating the app in the future

```
ssh -i ~/path/to/privatekey ubuntu@<YOUR_VM_IP>
cd ~/claudecode-sandbox/server
git pull
npm ci --omit=dev
pm2 restart budget-api
```

The frontend redeploys automatically on every push to the connected branch —
no manual step needed there.

---

## Security — no authentication

**This app has no login or authentication of any kind.** This was an accepted
tradeoff for a single-user personal tool, not an oversight — but it matters
once the app is reachable on a public URL:

- Anyone who knows (or guesses/finds) your VM's IP and port 4000 can read and
  write your transaction data directly via the API — there is nothing
  checking who's asking.
- `CORS_ORIGIN` only restricts which **browser origins** (web pages) are
  allowed to make cross-origin requests to the backend from JavaScript. It
  does **not** block direct requests — `curl`, Postman, a script, or any
  non-browser client can hit the API regardless of `CORS_ORIGIN`. Treat
  `CORS_ORIGIN` as a hygiene measure against casual/accidental cross-site
  requests, not as an access-control mechanism.
- Set `CORS_ORIGIN` anyway (Part 2, step 3) — it's still worth doing — but
  understand it does not make the deployment private. Don't rely on "nobody
  knows the IP" (security through obscurity) as your actual protection; be
  aware that an open port on a public IP is genuinely public, and the API is
  served over plain HTTP (no TLS) unless you add a reverse proxy/certificate
  yourself — treat traffic to it as unencrypted.
- If this exposure is unacceptable, don't deploy publicly — run the app
  locally instead (per the main `README.md`/`CLAUDE.md` setup), or add
  authentication (and TLS) before exposing it, which is out of scope for this
  deployment guide.

### Where the data lives / backups

The SQLite DB lives at `/data/budget.db` on the VM's persistent boot disk
(per `DB_PATH` in `ecosystem.config.cjs`) — it survives app restarts, `git
pull` + redeploys, and VM reboots (as long as you didn't terminate/recreate
the VM instance itself). There is no automated backup configured. To take a
manual backup, copy the file off the VM via `scp`:

```
scp -i ~/path/to/privatekey ubuntu@<YOUR_VM_IP>:/data/budget.db ./budget-backup.db
```

Run this periodically if you want a local backup — nothing in this
deployment does it for you automatically.
