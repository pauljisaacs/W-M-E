#!/usr/bin/env node

import { spawn } from 'node:child_process';

const mode = process.argv[2];
const allowedModes = new Set(['dev', 'preview']);

if (!mode || !allowedModes.has(mode)) {
  console.error('Usage: node scripts/run-electron-vite.mjs <dev|preview>');
  process.exit(1);
}

const env = { ...process.env };

// Some environments leak this flag globally, which forces Electron into Node mode.
if (env.ELECTRON_RUN_AS_NODE) {
  delete env.ELECTRON_RUN_AS_NODE;
}

const child = spawn(`pnpm exec electron-vite ${mode}`, {
  stdio: 'inherit',
  env,
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('Failed to launch electron-vite:', error);
  process.exit(1);
});
