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

interface ElectronAPI {
  isElectron: boolean;
  getMode: () => string;
  getVersion: () => Promise<VersionInfo>;
}

interface ElectronFS {
  openFiles: (options: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string[]>;
  openDirectory: () => Promise<string>;
  saveFile: (options: { suggestedName?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string>;
  readFile: (filePath: string) => Promise<Uint8Array>;
  readFileSlice: (filePath: string, start: number, end: number) => Promise<Uint8Array>;
  writeFile: (filePath: string, data: Uint8Array) => Promise<boolean>;
  moveFile: (filePath: string, newName: string) => Promise<string>;
  listDirectory: (directoryPath: string) => Promise<Array<{ name: string; path: string; kind: 'file' | 'directory' }>>;
  getFileHandle: (directoryPath: string, name: string, create: boolean) => Promise<string>;
  statPath: (targetPath: string) => Promise<{ size: number; mtimeMs: number; isFile: boolean; isDirectory: boolean }>;
  basename: (targetPath: string) => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    electronFS?: ElectronFS;
  }
}

export {};
