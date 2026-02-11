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

is_wsl=false
if grep -qi microsoft /proc/version 2>/dev/null; then
  is_wsl=true
fi

echo "Repo: $repo_root"
echo "OS: $(uname -srmo)"
echo

missing=false
expected_pnpm=""
resolved_pnpm=""

if command -v node >/dev/null 2>&1; then
  echo "node: $(command -v node) ($(node -v))"
  expected_pnpm="$(node -p "require('./package.json').packageManager.split('@')[1]" 2>/dev/null || true)"
else
  echo "node: missing"
  missing=true
fi

if command -v npm >/dev/null 2>&1; then
  echo "npm:  $(command -v npm) ($(npm -v))"
else
  echo "npm:  missing"
fi

if command -v corepack >/dev/null 2>&1; then
  echo "corepack: $(command -v corepack) ($(corepack --version))"
else
  echo "corepack: missing"
fi

if command -v pnpm >/dev/null 2>&1; then
  echo "pnpm (binary): $(command -v pnpm) ($(pnpm -v))"
else
  echo "pnpm (binary): missing"
fi

if [ "$missing" = false ]; then
  if pnpm_probe="$(bash scripts/pnpmw.sh --version 2>&1)"; then
    resolved_pnpm="$(printf '%s\n' "$pnpm_probe" | awk 'NF {line=$0} END {print line}')"
    echo "pnpm (resolved): $resolved_pnpm"
  else
    echo "pnpm (resolved): unavailable"
    printf '%s\n' "$pnpm_probe" | sed 's/^/  /'
    missing=true
  fi
fi

if [ "$missing" = true ]; then
  echo
  echo "Missing required tools or pnpm resolution failed."
  echo
  echo "Run the bootstrap script to auto-repair toolchain setup:"
  echo "  bash scripts/bootstrap.sh"
  exit 1
fi

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_major" -lt 20 ]; then
  echo
  echo "Node.js must be 20+. Current: $(node -v)"
  exit 1
fi

if [ -n "$expected_pnpm" ] && [ -n "$resolved_pnpm" ] && [ "$expected_pnpm" != "$resolved_pnpm" ]; then
  echo
  echo "Warning: pnpm version mismatch (expected $expected_pnpm, got $resolved_pnpm)."
  echo "Tip: run 'bash scripts/bootstrap.sh' to align the pinned version."
fi

if [ "$is_wsl" = true ]; then
  npm_path="$(command -v npm || true)"
  node_path="$(command -v node || true)"
  pnpm_path="$(command -v pnpm || true)"
  if [[ "$npm_path" == /mnt/* ]] || [[ "$node_path" == /mnt/* ]] || [[ "$pnpm_path" == /mnt/* ]]; then
    echo
    echo "Warning: WSL is resolving node/npm/pnpm from /mnt/* (Windows paths)."
    echo "Tip: prefer one environment per clone (all-Windows or all-WSL)."
  fi
fi

if [ "${ELECTRON_RUN_AS_NODE:-}" = "1" ]; then
  echo
  echo "Warning: ELECTRON_RUN_AS_NODE=1 is set in this shell."
  echo "Desktop runtime commands may fail unless this variable is unset."
fi

echo
echo "OK"
