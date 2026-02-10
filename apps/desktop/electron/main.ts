import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

interface VersionInfo {
  version: string;
  displayVersion: string;
  major: number;
  minor: number;
  hotfix: number;
  build: string;
  buildDate: string;
  commitSha: string;
  commitShort: string;
  branch: string;
}

interface DesktopFilter {
  name: string;
  extensions: string[];
}

let mainWindow: BrowserWindow | null = null;

const fallbackVersion: VersionInfo = {
  version: '1.0.0',
  displayVersion: '1.00.00 Build 0000',
  major: 1,
  minor: 0,
  hotfix: 0,
  build: '0000',
  buildDate: new Date().toISOString(),
  commitSha: 'dev',
  commitShort: 'dev',
  branch: 'local',
};

let versionInfo: VersionInfo = fallbackVersion;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  versionInfo = require('../src/version').VERSION_INFO;
} catch {
  versionInfo = fallbackVersion;
}

function createAbortError() {
  const error = new Error('The user aborted a request.');
  error.name = 'AbortError';
  return error;
}

function normalizeFilters(filters: unknown): Electron.FileFilter[] {
  if (!Array.isArray(filters)) return [];

  return filters
    .map((item) => {
      const entry = item as DesktopFilter;
      if (!entry || typeof entry.name !== 'string' || !Array.isArray(entry.extensions)) {
        return null;
      }

      const extensions = entry.extensions
        .filter((value) => typeof value === 'string')
        .map((value) => value.replace(/^\./, '').trim())
        .filter((value) => value.length > 0);

      if (extensions.length === 0) {
        return null;
      }

      return { name: entry.name, extensions };
    })
    .filter((value): value is Electron.FileFilter => Boolean(value));
}

async function readFileSlice(filePath: string, start: number, end: number): Promise<Uint8Array> {
  const normalizedStart = Math.max(0, Math.floor(start));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(end));
  const length = normalizedEnd - normalizedStart;

  if (length === 0) {
    return new Uint8Array();
  }

  const fd = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await fd.read(buffer, 0, length, normalizedStart);
    return new Uint8Array(buffer.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

ipcMain.handle('app:get-version', async () => versionInfo);

ipcMain.handle('fs:open-files', async (_event, options?: { multiple?: boolean; filters?: DesktopFilter[] }) => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: options?.multiple === false ? ['openFile'] : ['openFile', 'multiSelections'],
    filters: normalizeFilters(options?.filters),
  });

  if (result.canceled) {
    throw createAbortError();
  }

  return result.filePaths;
});

ipcMain.handle('fs:open-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    throw createAbortError();
  }

  return result.filePaths[0];
});

ipcMain.handle('fs:save-file', async (_event, options?: { suggestedName?: string; filters?: DesktopFilter[] }) => {
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    defaultPath: options?.suggestedName,
    filters: normalizeFilters(options?.filters),
  });

  if (result.canceled || !result.filePath) {
    throw createAbortError();
  }

  return result.filePath;
});

ipcMain.handle('fs:read-file', async (_event, filePath: string) => {
  const data = await fs.readFile(filePath);
  return new Uint8Array(data);
});

ipcMain.handle('fs:read-file-slice', async (_event, filePath: string, start: number, end: number) => {
  return readFileSlice(filePath, start, end);
});

ipcMain.handle('fs:write-file', async (_event, filePath: string, data: Uint8Array) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(data));
  return true;
});

ipcMain.handle('fs:move-file', async (_event, filePath: string, newName: string) => {
  const nextPath = path.join(path.dirname(filePath), newName);
  await fs.rename(filePath, nextPath);
  return nextPath;
});

ipcMain.handle('fs:list-directory', async (_event, directoryPath: string) => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  return entries.map((entry) => ({
    name: entry.name,
    path: path.join(directoryPath, entry.name),
    kind: entry.isDirectory() ? 'directory' : 'file',
  }));
});

ipcMain.handle('fs:get-file-handle', async (_event, directoryPath: string, name: string, create: boolean) => {
  const targetPath = path.join(directoryPath, name);

  if (create) {
    await fs.mkdir(directoryPath, { recursive: true });
    const fd = await fs.open(targetPath, 'a');
    await fd.close();
  } else {
    await fs.access(targetPath);
  }

  return targetPath;
});

ipcMain.handle('fs:stat-path', async (_event, targetPath: string) => {
  const stat = await fs.stat(targetPath);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
  };
});

ipcMain.handle('fs:basename', async (_event, targetPath: string) => path.basename(targetPath));

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
