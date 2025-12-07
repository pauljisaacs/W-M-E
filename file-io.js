export class FileIO {
    constructor() {
        this.supportedTypes = [
            { description: 'Audio Files', accept: { 'audio/*': ['.wav', '.mp3', '.aac'] } }
        ];
    }

    async openFiles() {
        // On file:// protocol, showOpenFilePicker often fails or behaves strictly.
        // Fallback to input element immediately to preserve user gesture.
        if (window.location.protocol === 'file:') {
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
                if (err.name === 'AbortError') {
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
                if (err.name !== 'AbortError') console.error(err);
                return [];
            }
        }
        return [];
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
}
