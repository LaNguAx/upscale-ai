#!/bin/bash
set -e

export NVM_DIR="$HOME/.nvm"

if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
else
  echo "nvm not found at $NVM_DIR"
  exit 1
fi

nvm use --lts >/dev/null

APP_DIR="/var/www/upscale-ai"

echo "Starting deployment..."
cd "$APP_DIR"

echo "Fetching latest code..."
git fetch origin

echo "Resetting to origin/main..."
git reset --hard origin/main

echo "Installing dependencies..."
npm install -g pnpm@latest
pnpm install

echo "Building backend..."
cd backend
pnpm run build

echo "Building frontend..."
cd ../frontend
pnpm run build

echo "Restarting backend..."
cd ..
pm2 restart upscale-backend || pm2 start backend/dist/main.js --name upscale-backend -- --port 3001

echo "Deployment complete!"
