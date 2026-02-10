const isDesktop = Boolean(window.electronAPI?.isElectron && window.electronFS);

if (!isDesktop) {
  // Browser mode keeps native File System Access API behavior.
} else {
  class ElectronBlobSlice {
    constructor(filePath, start, end) {
      this.filePath = filePath;
      this.start = start;
      this.end = end;
      this.size = Math.max(0, end - start);
    }

    async arrayBuffer() {
      const bytes = await window.electronFS.readFileSlice(this.filePath, this.start, this.end);
      return toArrayBuffer(bytes);
    }
  }

  class ElectronFileLike {
    constructor(filePath, name, size, lastModified) {
      this._path = filePath;
      this.name = name;
      this.size = size;
      this.lastModified = lastModified;
      this.type = inferMimeType(name);
      this.webkitRelativePath = '';
    }

    async arrayBuffer() {
      const bytes = await window.electronFS.readFile(this._path);
      return toArrayBuffer(bytes);
    }

    slice(start = 0, end = this.size) {
      const normalizedStart = normalizeSliceIndex(start, this.size);
      const normalizedEnd = normalizeSliceIndex(end, this.size);
      return new ElectronBlobSlice(this._path, normalizedStart, Math.max(normalizedStart, normalizedEnd));
    }
  }

  class ElectronFileHandle {
    constructor(filePath) {
      this.kind = 'file';
      this.path = filePath;
      this.name = basenameFromPath(filePath);
    }

    async getFile() {
      const stat = await window.electronFS.statPath(this.path);
      return new ElectronFileLike(this.path, this.name, stat.size, stat.mtimeMs);
    }

    async createWritable() {
      const handle = this;
      return {
        async write(data) {
          const bytes = await toUint8Array(data);
          await window.electronFS.writeFile(handle.path, bytes);
        },
        async close() {
          return undefined;
        },
      };
    }

    async move(newName) {
      const nextPath = await window.electronFS.moveFile(this.path, newName);
      this.path = nextPath;
      this.name = basenameFromPath(nextPath);
    }
  }

  class ElectronDirectoryHandle {
    constructor(directoryPath) {
      this.kind = 'directory';
      this.path = directoryPath;
      this.name = basenameFromPath(directoryPath);
    }

    async *values() {
      const entries = await window.electronFS.listDirectory(this.path);
      for (const entry of entries) {
        if (entry.kind === 'directory') {
          yield new ElectronDirectoryHandle(entry.path);
        } else {
          yield new ElectronFileHandle(entry.path);
        }
      }
    }

    async getFileHandle(name, options = {}) {
      const filePath = await window.electronFS.getFileHandle(this.path, name, Boolean(options.create));
      return new ElectronFileHandle(filePath);
    }
  }

  function inferMimeType(name) {
    const lower = (name || '').toLowerCase();
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.aac')) return 'audio/aac';
    return '';
  }

  function basenameFromPath(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || normalized;
  }

  function normalizeSliceIndex(value, size) {
    if (Number.isNaN(value)) return 0;
    if (value < 0) return Math.max(size + value, 0);
    return Math.min(Math.max(value, 0), size);
  }

  function toArrayBuffer(value) {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    return new Uint8Array(value).buffer;
  }

  async function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value && typeof value === 'object' && value.type === 'write' && value.data !== undefined) {
      return toUint8Array(value.data);
    }
    if (value == null) return new Uint8Array();
    throw new TypeError('Unsupported writable payload for Electron file handle.');
  }

  function mapFilePickerTypes(types) {
    if (!Array.isArray(types)) return [];
    return types
      .map((type) => {
        const extensions = [];
        const accept = type?.accept || {};
        for (const list of Object.values(accept)) {
          if (Array.isArray(list)) {
            extensions.push(...list.filter((item) => typeof item === 'string'));
          }
        }
        return {
          name: type?.description || 'Files',
          extensions: extensions
            .map((ext) => ext.replace(/^\./, '').trim())
            .filter((ext) => ext.length > 0),
        };
      })
      .filter((filter) => filter.extensions.length > 0);
  }

  window.showOpenFilePicker = async function showOpenFilePicker(options = {}) {
    const paths = await window.electronFS.openFiles({
      multiple: options.multiple !== false,
      filters: mapFilePickerTypes(options.types),
    });
    return paths.map((filePath) => new ElectronFileHandle(filePath));
  };

  window.showDirectoryPicker = async function showDirectoryPicker() {
    const directoryPath = await window.electronFS.openDirectory();
    return new ElectronDirectoryHandle(directoryPath);
  };

  window.showSaveFilePicker = async function showSaveFilePicker(options = {}) {
    const filePath = await window.electronFS.saveFile({
      suggestedName: options.suggestedName,
      filters: mapFilePickerTypes(options.types),
    });
    return new ElectronFileHandle(filePath);
  };
}
