/**
 * ChunkedAudioFile - Abstraction for reading large audio files in chunks
 * 
 * This class provides a streaming interface for reading audio files without
 * loading them entirely into memory. It's the foundation for supporting files
 * larger than JavaScript's ArrayBuffer limit (~2GB).
 * 
 * Usage:
 *   const chunked = new ChunkedAudioFile(file);
 *   await chunked.init();
 *   const chunk = await chunked.readChunk(0);
 */

export class ChunkedAudioFile {
    constructor(file, chunkSizeMB = 100) {
        this.file = file;
        this.chunkSize = chunkSizeMB * 1024 * 1024; // Convert MB to bytes
        this.totalChunks = Math.ceil(file.size / this.chunkSize);
        this.metadata = null;
        this.dataOffset = 0; // Offset where audio data starts
        this.dataSize = 0; // Size of audio data
    }

    /**
     * Initialize by parsing file header
     */
    async init() {
        // Read first chunk to get header info
        const headerSize = Math.min(50 * 1024, this.file.size); // 50KB should be enough for header
        const headerBlob = this.file.slice(0, headerSize);
        const headerBuffer = await headerBlob.arrayBuffer();
        const headerView = new DataView(headerBuffer);

        // Parse WAV/RF64 header
        const signature = String.fromCharCode(
            headerView.getUint8(0),
            headerView.getUint8(1),
            headerView.getUint8(2),
            headerView.getUint8(3)
        );

        const isRF64 = signature === 'RF64';
        const isWAV = signature === 'RIFF';

        if (!isRF64 && !isWAV) {
            throw new Error(`Unsupported file format: ${signature}`);
        }

        console.log(`[ChunkedAudioFile] Format: ${signature}, size: ${(this.file.size / 1024 / 1024).toFixed(2)} MB`);

        // Parse chunks to find fmt and data
        let offset = 12;
        let fmtData = null;
        let dataOffset = 0;
        let dataSize = 0;
        let actualDataSize = null; // For RF64, this comes from ds64 chunk

        while (offset < headerBuffer.byteLength - 8) {
            const chunkId = String.fromCharCode(
                headerView.getUint8(offset),
                headerView.getUint8(offset + 1),
                headerView.getUint8(offset + 2),
                headerView.getUint8(offset + 3)
            );
            let chunkSize = headerView.getUint32(offset + 4, true);

            // Handle ds64 chunk for RF64
            if (chunkId === 'ds64' && isRF64) {
                // ds64 contains 64-bit sizes
                const riffSize = this.readUint64(headerView, offset + 8);
                actualDataSize = this.readUint64(headerView, offset + 16);
                console.log(`[ChunkedAudioFile] RF64 ds64: dataSize=${actualDataSize} bytes`);
            }

            if (chunkId === 'fmt ') {
                // Parse format chunk
                fmtData = {
                    audioFormat: headerView.getUint16(offset + 8, true),
                    channels: headerView.getUint16(offset + 10, true),
                    sampleRate: headerView.getUint32(offset + 12, true),
                    byteRate: headerView.getUint32(offset + 16, true),
                    blockAlign: headerView.getUint16(offset + 20, true),
                    bitDepth: headerView.getUint16(offset + 22, true)
                };
                console.log(`[ChunkedAudioFile] Format: ${fmtData.channels}ch, ${fmtData.bitDepth}bit, ${fmtData.sampleRate}Hz`);
            }

            if (chunkId === 'data') {
                dataOffset = offset + 8;
                dataSize = (chunkSize === 0xFFFFFFFF && actualDataSize) ? actualDataSize : chunkSize;
                console.log(`[ChunkedAudioFile] Data chunk: offset=${dataOffset}, size=${dataSize} bytes`);
                break; // Stop after finding data chunk
            }

            offset += 8 + chunkSize;
            if (offset % 2 !== 0) offset++; // Word alignment
        }

        if (!fmtData || dataOffset === 0) {
            throw new Error('Invalid WAV file: missing fmt or data chunk');
        }

        this.metadata = {
            format: isRF64 ? 'RF64' : 'WAV',
            channels: fmtData.channels,
            sampleRate: fmtData.sampleRate,
            bitDepth: fmtData.bitDepth,
            audioFormat: fmtData.audioFormat,
            duration: dataSize / fmtData.byteRate
        };

        this.dataOffset = dataOffset;
        this.dataSize = dataSize;

        return this.metadata;
    }

    /**
     * Read 64-bit unsigned integer (little-endian)
     */
    readUint64(view, offset) {
        const low = view.getUint32(offset, true);
        const high = view.getUint32(offset + 4, true);
        // JavaScript can't accurately represent numbers > 2^53, but for file sizes this should work
        return high * 0x100000000 + low;
    }

    /**
     * Read a chunk by index (0-based)
     * Returns ArrayBuffer of chunk data
     */
    async readChunk(chunkIndex) {
        if (chunkIndex < 0 || chunkIndex >= this.totalChunks) {
            throw new Error(`Invalid chunk index: ${chunkIndex} (max: ${this.totalChunks - 1})`);
        }

        const start = chunkIndex * this.chunkSize;
        const end = Math.min(start + this.chunkSize, this.file.size);
        
        const blob = this.file.slice(start, end);
        return await blob.arrayBuffer();
    }

    /**
     * Read chunk of audio data specifically (excludes header)
     * @param {number} chunkIndex - 0-based chunk index within audio data
     * @returns {ArrayBuffer} Raw audio data
     */
    async readAudioChunk(chunkIndex) {
        const audioStart = this.dataOffset;
        const audioEnd = audioStart + this.dataSize;
        
        const chunkStart = audioStart + (chunkIndex * this.chunkSize);
        const chunkEnd = Math.min(chunkStart + this.chunkSize, audioEnd);
        
        if (chunkStart >= audioEnd) {
            throw new Error(`Audio chunk ${chunkIndex} exceeds audio data`);
        }
        
        const blob = this.file.slice(chunkStart, chunkEnd);
        return await blob.arrayBuffer();
    }

    /**
     * Get total number of audio chunks
     */
    getAudioChunkCount() {
        return Math.ceil(this.dataSize / this.chunkSize);
    }

    /**
     * Read specific byte range from file
     */
    async readRange(start, length) {
        const end = Math.min(start + length, this.file.size);
        const blob = this.file.slice(start, end);
        return await blob.arrayBuffer();
    }

    /**
     * Stream all chunks with progress callback
     * @param {Function} onChunk - Called for each chunk: (chunkData, index, total) => {}
     * @param {Function} onProgress - Called with progress: (percent) => {}
     */
    async streamChunks(onChunk, onProgress = null) {
        for (let i = 0; i < this.totalChunks; i++) {
            const chunk = await this.readChunk(i);
            await onChunk(chunk, i, this.totalChunks);
            
            if (onProgress) {
                const progress = ((i + 1) / this.totalChunks) * 100;
                onProgress(Math.round(progress));
            }
        }
    }

    /**
     * Stream audio data chunks only
     */
    async streamAudioChunks(onChunk, onProgress = null) {
        const audioChunkCount = this.getAudioChunkCount();
        
        for (let i = 0; i < audioChunkCount; i++) {
            const chunk = await this.readAudioChunk(i);
            await onChunk(chunk, i, audioChunkCount);
            
            if (onProgress) {
                const progress = ((i + 1) / audioChunkCount) * 100;
                onProgress(Math.round(progress));
            }
        }
    }

    /**
     * Get file info
     */
    getInfo() {
        return {
            name: this.file.name,
            size: this.file.size,
            chunkSize: this.chunkSize,
            totalChunks: this.totalChunks,
            audioChunks: this.getAudioChunkCount(),
            metadata: this.metadata,
            dataOffset: this.dataOffset,
            dataSize: this.dataSize
        };
    }
}
