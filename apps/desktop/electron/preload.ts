import { contextBridge, ipcRenderer } from 'electron';

async function invoke(channel: string, ...args: unknown[]) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    const message = String((error as Error)?.message || '');
    if (message.includes('aborted a request')) {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }
    throw error;
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getMode: () => 'desktop-offline',
  getVersion: () => invoke('app:get-version'),
});

contextBridge.exposeInMainWorld('electronFS', {
  openFiles: (options: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }) =>
    invoke('fs:open-files', options),
  openDirectory: () => invoke('fs:open-directory'),
  saveFile: (options: { suggestedName?: string; filters?: Array<{ name: string; extensions: string[] }> }) =>
    invoke('fs:save-file', options),
  readFile: (filePath: string) => invoke('fs:read-file', filePath),
  readFileSlice: (filePath: string, start: number, end: number) =>
    invoke('fs:read-file-slice', filePath, start, end),
  writeFile: (filePath: string, data: Uint8Array) => invoke('fs:write-file', filePath, data),
  moveFile: (filePath: string, newName: string) => invoke('fs:move-file', filePath, newName),
  listDirectory: (directoryPath: string) => invoke('fs:list-directory', directoryPath),
  getFileHandle: (directoryPath: string, name: string, create: boolean) =>
    invoke('fs:get-file-handle', directoryPath, name, create),
  statPath: (targetPath: string) => invoke('fs:stat-path', targetPath),
  basename: (targetPath: string) => invoke('fs:basename', targetPath),
});
