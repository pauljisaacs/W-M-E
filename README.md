# W-M-E (Wave Agent X) Monorepo

W-M-E now follows the Astral-style workspace model:

- `apps/web` - Vite web app (vanilla JS renderer)
- `apps/desktop` - Electron wrapper with `electron-vite` and `electron-builder`

Both web and desktop share the same renderer code from `apps/web`.

## Prerequisites

- Node.js 20+ (`.nvmrc` is pinned to `20`)
- No global `corepack` install is required

## First Run (Recommended)

```bash
bash scripts/bootstrap.sh
```

This script:

1. Resolves pnpm automatically (`corepack` -> `pnpm` binary -> `npm exec pnpm@...`)
2. Installs dependencies
3. Runs doctor checks
4. Runs smoke builds for web + desktop

## Mac Quick Start (Build a Runnable Mac App)

Use these exact steps on a Mac terminal:

1. Install Apple build tools once:
```bash
xcode-select --install
```
2. Clone and enter the repo:
```bash
git clone <your-repo-url> W-M-E
cd W-M-E
```
3. Install dependencies and validate tooling:
```bash
bash scripts/bootstrap.sh
```
4. Launch the desktop app (single command):
```bash
bash scripts/run-desktop.sh
```
Or in Finder, double-click `Run-Wave-Agent-X.command`.
Close the app after it opens.

5. Build the macOS installer:
```bash
bash scripts/pnpmw.sh make:mac
```

6. Find the output files in:
```text
apps/desktop/release/1.0.0/
```
Expected artifact: `Wave Agent X-1.0.0.dmg` (plus related files).

7. Open the DMG and run the app:
- Double-click the `.dmg`
- Drag `Wave Agent X.app` into `Applications`
- Launch from `Applications`

If macOS blocks launch because the app is unsigned, right-click the app and choose `Open`.

## Daily Commands

```bash
# Verify local toolchain
bash scripts/doctor.sh

# One-command desktop startup (auto-bootstrap/repair)
bash scripts/run-desktop.sh

# Web development
bash scripts/pnpmw.sh dev:web

# Desktop development (Electron)
bash scripts/dev-desktop.sh

# Build web
bash scripts/pnpmw.sh build:web

# Build desktop (no installer)
bash scripts/pnpmw.sh build:desktop

# Run desktop preview build
bash scripts/pnpmw.sh start:desktop

# Build installers
bash scripts/pnpmw.sh make:win
bash scripts/pnpmw.sh make:mac   # Requires macOS build host/runner
bash scripts/pnpmw.sh make:linux
```

## Packaging Output

Desktop artifacts are created under:

- `apps/desktop/release/<version>/`

Typical outputs:

- Windows: NSIS `.exe`
- macOS: `.dmg` (x64 + arm64, requires macOS host)
- Linux: `.AppImage`

## CI/CD

GitLab pipeline config is in `.gitlab-ci.yml`.

Pipeline jobs include:

- Install dependencies with pnpm cache
- Build web artifacts
- Build Windows desktop installer
- Build macOS desktop installer (mac runner required)

See `docs/BUILD_AND_DEPLOY.md` for full details.

## Troubleshooting

### `pnpm` or workspace install errors

Run:

```bash
bash scripts/bootstrap.sh
```

### `npm install -g corepack` fails with `EEXIST` on macOS

If you see an error like `EEXIST: file already exists` for `/opt/homebrew/bin/pnpm`,
do not force-overwrite it. Run:

```bash
bash scripts/bootstrap.sh
```

### WSL mixed with Windows node/npm/pnpm

If commands resolve to `/mnt/c/...`, use one environment per clone (all-WSL or all-Windows).
`bash scripts/doctor.sh` reports this explicitly.

### Electron desktop build fails

- Re-run `bash scripts/bootstrap.sh`
- Re-run `bash scripts/pnpmw.sh build:desktop`
- Check `apps/desktop/release/` for partial outputs and logs

### Desktop app starts in Node mode (`ipcMain` undefined)

If your shell sets `ELECTRON_RUN_AS_NODE=1`, Electron runtime commands can fail.
Run `bash scripts/doctor.sh` to detect it. The desktop run scripts clear this variable automatically.

### macOS packaging from Windows machine

macOS `.dmg` artifacts must be produced on a macOS runner/host.
The config is provided and validated via CI path, but cannot be fully executed on Windows/WSL.
