#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Keep install/build commands non-interactive for CI, WSL, and Git Bash invocations.
export CI="${CI:-true}"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  if type nvm >/dev/null 2>&1; then
    nvm install --silent >/dev/null 2>&1 || true
    nvm use --silent >/dev/null 2>&1 || true
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (20+)."
  exit 1
fi

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_major" -lt 20 ]; then
  echo "Node.js 20+ required. Current: $(node -v)"
  exit 1
fi

expected_pnpm="$(node -p "require('./package.json').packageManager.split('@')[1]")"

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack not found. Install Node.js with corepack support."
  exit 1
fi

echo "==> Enabling corepack + pnpm@$expected_pnpm"
corepack enable
corepack prepare "pnpm@$expected_pnpm" --activate

echo "==> Installing dependencies"
if ! corepack pnpm install --no-frozen-lockfile; then
  echo "==> Install failed. Removing node_modules and retrying once..."
  rm -rf node_modules apps/*/node_modules
  corepack pnpm install --no-frozen-lockfile
fi

echo "==> Running toolchain doctor"
bash scripts/doctor.sh

echo "==> Running smoke builds"
corepack pnpm build:web
corepack pnpm build:desktop

echo
echo "Bootstrap complete."
echo "Next commands:"
echo "  pnpm dev:web"
echo "  pnpm dev:desktop"
echo "  pnpm make:win"
echo "  pnpm make:mac   # requires macOS build host"
