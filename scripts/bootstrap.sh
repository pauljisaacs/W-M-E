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

pnpmw="$repo_root/scripts/pnpmw.sh"

echo "==> Resolving pnpm toolchain"
"$pnpmw" --version >/dev/null

echo "==> Installing dependencies"
if ! "$pnpmw" install --no-frozen-lockfile; then
  echo "==> Install failed. Removing node_modules and retrying once..."
  rm -rf node_modules apps/*/node_modules
  "$pnpmw" install --no-frozen-lockfile
fi

echo "==> Running toolchain doctor"
bash scripts/doctor.sh

echo "==> Running smoke builds"
"$pnpmw" build:web
"$pnpmw" build:desktop

echo
echo "Bootstrap complete."
echo "Next commands:"
echo "  bash scripts/pnpmw.sh dev:web"
echo "  bash scripts/run-desktop.sh"
echo "  bash scripts/pnpmw.sh make:win"
echo "  bash scripts/pnpmw.sh make:mac   # requires macOS build host"
