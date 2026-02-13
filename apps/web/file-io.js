export class FileIO {
    constructor() {
        this.supportedTypes = [
            { description: 'Audio Files', accept: { 'audio/*': ['.wav', '.mp3', '.aac'] } }
        ];
    }

    async openFiles() {
        const isElectron = Boolean(window.electronAPI?.isElectron);

        // On file:// protocol, showOpenFilePicker often fails or behaves strictly.
        // Fallback to input element immediately to preserve user gesture.
        if (!isElectron && window.location.protocol === 'file:') {
            return null;
        }

        if ('showOpenFilePicker' in window) {
            try {
                const handles = await window.showOpenFilePicker({
                    multiple: true,
                    types: this.supportedTypes
                });
                return handles;
            } catch (err) {
                if (this.isAbortError(err)) {
                    return []; // User cancelled
                }
                console.error('File System Access API error:', err);
                return null; // Trigger fallback
            }
        } else {
            // Fallback handled by input element in App class
            return null;
        }
    }

    async openDirectory() {
        if ('showDirectoryPicker' in window) {
            try {
                const dirHandle = await window.showDirectoryPicker();
                const files = [];
                await this.scanDirectory(dirHandle, files);
                return files;
            } catch (err) {
                if (!this.isAbortError(err)) console.error(err);
                return [];
            }
        }
        return [];
    }

    isAbortError(err) {
        const message = String(err?.message || '');
        return err?.name === 'AbortError' || message.includes('aborted a request');
    }

    async scanDirectory(dirHandle, fileList) {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                if (this.isAudioFile(entry.name)) {
                    fileList.push(entry);
                }
            } else if (entry.kind === 'directory') {
                await this.scanDirectory(entry, fileList);
            }
        }
    }

    isAudioFile(filename) {
        // Ignore macOS hidden/metadata files
        if (filename.startsWith('._')) return false;

        const ext = filename.split('.').pop().toLowerCase();
        return ['wav', 'mp3', 'aac'].includes(ext);
    }

    async saveFile(fileHandle, blob) {
        try {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return true;
        } catch (err) {
            console.error('Save failed:', err);
            return false;
        }
    }

    async openCSVFile() {
        const isElectron = Boolean(window.electronAPI?.isElectron);

        if (isElectron && window.electronFS) {
            // Electron path
            try {
                const result = await window.electronFS.openFiles({
                    multiple: false,
                    filters: [
                        { name: 'CSV Files', extensions: ['csv'] }
                    ]
                });

                if (!result || result.length === 0) {
                    return null; // User cancelled
                }

                // In Electron, we get file paths. Need to read the file content.
                const filePath = result[0];
                const fileContent = await window.electronFS.readFile(filePath);
                
                // Get filename from path
                const filename = window.electronFS.basename ? 
                    await window.electronFS.basename(filePath) : 
                    filePath.split(/[\/\\]/).pop();

                // Return object with text content and filename
                return {
                    text: () => Promise.resolve(new TextDecoder().decode(fileContent)),
                    name: filename
                };
            } catch (err) {
                if (this.isAbortError(err)) {
                    return null; // User cancelled
                }
                console.error('Electron file picker error:', err);
                return null;
            }
        } else if ('showOpenFilePicker' in window) {
            // Web path
            try {
                const [fileHandle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'CSV Files',
                        accept: { 'text/csv': ['.csv'] }
                    }],
                    multiple: false
                });

                const file = await fileHandle.getFile();
                return file; // Returns File object with .text() method
            } catch (err) {
                if (this.isAbortError(err)) {
                    return null; // User cancelled
                }
                console.error('File System Access API error:', err);
                return null;
            }
        }

        return null;
    }
}
