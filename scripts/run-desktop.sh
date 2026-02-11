#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [ ! -d node_modules ]; then
  echo "==> First-time setup detected. Running bootstrap..."
  bash scripts/bootstrap.sh
else
  echo "==> Checking local toolchain..."
  if ! bash scripts/doctor.sh; then
    echo "==> Doctor check failed. Running bootstrap repair..."
    bash scripts/bootstrap.sh
  fi
fi

echo "==> Launching desktop app"
bash scripts/dev-desktop.sh
