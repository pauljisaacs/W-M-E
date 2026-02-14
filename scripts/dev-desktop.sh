#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

unset ELECTRON_RUN_AS_NODE || true

bash scripts/pnpmw.sh --filter @app/desktop dev
