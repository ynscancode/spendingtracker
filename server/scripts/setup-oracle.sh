#!/usr/bin/env bash
# One-time setup script for a fresh Oracle Cloud Always Free VM (Ubuntu 22.04, ARM Ampere A1.Flex).
# Run this after SSHing into the VM as the `ubuntu` user:
#   bash setup-oracle.sh
#
# This is meant to be run interactively — if a step fails, `set -e` stops the
# script so you can see the error and re-run. There is no error trapping/retry
# logic on purpose; just fix the problem and re-run the script (each step is
# safe to re-run).
set -e

REPO_URL="${REPO_URL:-https://github.com/ynscancode/claudecode-sandbox.git}"
REPO_DIR="$HOME/claudecode-sandbox"

echo "==> Updating apt packages"
sudo apt update && sudo apt upgrade -y

echo "==> Installing build tools (build-essential is required for better-sqlite3's"
echo "    native addon compile on ARM), git, curl"
sudo apt install -y build-essential git curl

echo "==> Installing Node.js 22 (NodeSource, arm64-supported)"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v

echo "==> Installing PM2 globally"
sudo npm install -g pm2

echo "==> Cloning the repo (REPO_URL=$REPO_URL)"
if [ -d "$REPO_DIR" ]; then
  echo "    $REPO_DIR already exists, skipping clone"
else
  git clone "$REPO_URL" "$REPO_DIR"
fi

echo "==> Installing server dependencies (production only)"
cd "$REPO_DIR/server"
npm ci --omit=dev

echo "==> Creating /data for the SQLite DB (must exist before the app boots and"
echo "    runs its migration)"
sudo mkdir -p /data
sudo chown ubuntu:ubuntu /data

echo "==> Starting the app with PM2 (production env, from ecosystem.config.cjs)"
pm2 start ecosystem.config.cjs --env production

echo "==> Saving the PM2 process list"
pm2 save

echo "==> Setting up PM2 to start on boot"
echo "    pm2 startup will print a command like:"
echo "      sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu"
echo "    Copy that exact line, run it, then re-run 'pm2 save' below."
pm2 startup

echo "==> After copy-pasting/running the command pm2 startup printed above, run:"
echo "      pm2 save"
echo ""
echo "==> Setup complete."
echo "    The API should be reachable at http://<VM_IP>:4000/api/accounts"
echo "    Don't forget to set CORS_ORIGIN once you have your Vercel URL:"
echo "      pm2 set budget-api:CORS_ORIGIN https://your-app.vercel.app && pm2 restart budget-api"
