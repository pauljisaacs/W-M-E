#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  if type nvm >/dev/null 2>&1; then
    nvm use --silent >/dev/null 2>&1 || true
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (20+)." >&2
  exit 1
fi

expected_pnpm="$(node -p "(() => { try { const pm = require('./package.json').packageManager || 'pnpm@10.28.2'; return pm.split('@')[1]; } catch { return '10.28.2'; } })()")"

if command -v corepack >/dev/null 2>&1; then
  if corepack enable >/dev/null 2>&1 && corepack prepare "pnpm@$expected_pnpm" --activate >/dev/null 2>&1; then
    exec corepack pnpm "$@"
  fi
fi

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm "$@"
fi

if command -v npm >/dev/null 2>&1; then
  echo "Using npm exec with pnpm@$expected_pnpm (corepack/pnpm binary unavailable)." >&2
  exec npm exec --yes "pnpm@$expected_pnpm" -- "$@"
fi

echo "Unable to run pnpm: corepack, pnpm, and npm are all unavailable." >&2
exit 1
