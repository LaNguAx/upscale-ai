#!/bin/bash
# UPscale VPS deploy script (run on the server, see .github/workflows/deploy.yml).
#
# Manages: backend (PM2, port 3001) and the Python AI service (PM2, port 8000).
# TODO: the frontend is built to apps/frontend/dist but static hosting (nginx or
#       equivalent) must be configured separately to serve it.
set -e

export NVM_DIR="$HOME/.nvm"

if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
else
  echo "nvm not found at $NVM_DIR"
  exit 1
fi

APP_DIR="/var/www/upscale-ai"

echo "Starting deployment..."
cd "$APP_DIR"

# Respect the repo's .nvmrc (Node 24) instead of whatever LTS is current.
nvm install >/dev/null
nvm use >/dev/null

echo "Fetching latest code..."
git fetch origin

echo "Resetting to origin/main..."
git reset --hard origin/main

echo "Installing dependencies..."
npm install -g pnpm@latest
export CI=true
pnpm install --frozen-lockfile

echo "Building (turbo orders packages and apps)..."
pnpm build

echo "Installing Python dependencies for the AI service..."
pnpm --filter ai setup

echo "Restarting backend..."
export NODE_ENV=production
export PORT=3001
pm2 restart upscale-backend --update-env \
  || pm2 start apps/backend/dist/main.js --name upscale-backend --update-env

echo "Restarting AI service..."
pm2 restart upscale-ai-service --update-env \
  || pm2 start "python3 -m uvicorn server:app --host 0.0.0.0 --port 8000" \
       --name upscale-ai-service --cwd "$APP_DIR/apps/ai"

pm2 save

echo "Deployment complete!"
