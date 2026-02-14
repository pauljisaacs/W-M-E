/**
 * PeakFileCache - Generates and caches waveform peak data for efficient display
 * 
 * Professional DAWs use peak files to display waveforms without loading entire audio.
 * This class generates min/max peak values at multiple zoom levels and caches them
 * to IndexedDB for fast subsequent loads.
 * 
 * Peak files are typically <1MB even for multi-GB audio files.
 */

export class PeakFileCache {
    constructor() {
        this.dbName = 'WaveAgentXPeaks';
        this.dbVersion = 1;
        this.db = null;
        this.initPromise = this.initDB();
    }

    /**
     * Initialize IndexedDB for peak file storage
     */
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create object store for peak data
                if (!db.objectStoreNames.contains('peaks')) {
                    const store = db.createObjectStore('peaks', { keyPath: 'fileKey' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    /**
     * Generate a unique key for a file based on name, size, and modified date
     */
    getFileKey(file) {
        // Use file name, size, and lastModified as key
        // This ensures we regenerate if file changes
        return `${file.name}_${file.size}_${file.lastModified}`;
    }

    /**
     * Check if peak data exists in cache
     */
    async hasCachedPeaks(file) {
        await this.initPromise;
        const fileKey = this.getFileKey(file);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peaks'], 'readonly');
            const store = transaction.objectStore('peaks');
            const request = store.get(fileKey);

            request.onsuccess = () => resolve(request.result !== undefined);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get cached peak data
     */
    async getCachedPeaks(file) {
        await this.initPromise;
        const fileKey = this.getFileKey(file);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peaks'], 'readonly');
            const store = transaction.objectStore('peaks');
            const request = store.get(fileKey);

            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    console.log(`[PeakCache] Retrieved cached peaks for ${file.name} (${result.peaks.length} peaks)`);
                    resolve(result);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Store peak data in cache
     */
    async cachePeaks(file, peakData) {
        await this.initPromise;
        const fileKey = this.getFileKey(file);
        
        const record = {
            fileKey,
            fileName: file.name,
            fileSize: file.size,
            timestamp: Date.now(),
            ...peakData
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peaks'], 'readwrite');
            const store = transaction.objectStore('peaks');
            const request = store.put(record);

            request.onsuccess = () => {
                console.log(`[PeakCache] Cached peaks for ${file.name} (${peakData.peaks.length} peaks)`);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Generate peak data from audio file by reading in chunks
     * 
     * @param {File} file - Audio file
     * @param {Object} metadata - File metadata (channels, sampleRate, bitDepth, format)
     * @param {Function} onProgress - Progress callback (0-100)
     * @returns {Object} Peak data { peaks, channels, sampleRate, duration }
     */
    async generatePeaks(file, metadata, onProgress = null) {
        console.log(`[PeakCache] Generating peaks for ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        
        const startTime = performance.now();
        const samplesPerPeak = 256; // Each peak represents 256 samples
        const chunkSize = 10 * 1024 * 1024; // 10MB chunks
        
        // Parse WAV header to find data chunk
        const headerSize = 1024; // Read first 1KB for header
        const headerBlob = file.slice(0, headerSize);
        const headerBuffer = await headerBlob.arrayBuffer();
        const headerView = new DataView(headerBuffer);
        
        // Find data chunk
        let offset = 12; // Skip RIFF header
        let dataOffset = 0;
        let dataSize = 0;
        
        while (offset < headerBuffer.byteLength - 8) {
            const chunkId = String.fromCharCode(
                headerView.getUint8(offset),
                headerView.getUint8(offset + 1),
                headerView.getUint8(offset + 2),
                headerView.getUint8(offset + 3)
            );
            const chunkSize = headerView.getUint32(offset + 4, true);
            
            if (chunkId === 'data') {
                dataOffset = offset + 8;
                dataSize = chunkSize;
                break;
            }
            
            offset += 8 + chunkSize;
            if (offset % 2 !== 0) offset++; // Padding
        }
        
        if (dataOffset === 0) {
            throw new Error('Could not find data chunk in WAV file');
        }
        
        console.log(`[PeakCache] Data chunk: offset=${dataOffset}, size=${dataSize} bytes`);
        
        // Calculate parameters
        const channels = metadata.channels || 2;
        const bitDepth = metadata.bitDepth || 16;
        const sampleRate = metadata.sampleRate || 48000;
        const bytesPerSample = bitDepth / 8;
        const frameSize = bytesPerSample * channels;
        const totalSamples = Math.floor(dataSize / frameSize);
        const duration = totalSamples / sampleRate;
        
        console.log(`[PeakCache] Audio: ${channels}ch, ${bitDepth}bit, ${sampleRate}Hz, ${duration.toFixed(2)}s`);
        
        // Initialize peak arrays (one per channel)
        const peaks = [];
        for (let c = 0; c < channels; c++) {
            peaks.push([]);
        }
        
        let processedBytes = 0;
        
        // Process audio data in chunks
        for (let chunkStart = dataOffset; chunkStart < dataOffset + dataSize; chunkStart += chunkSize) {
            const chunkEnd = Math.min(chunkStart + chunkSize, dataOffset + dataSize);
            const blob = file.slice(chunkStart, chunkEnd);
            const arrayBuffer = await blob.arrayBuffer();
            const dataView = new DataView(arrayBuffer);
            
            // Process samples in this chunk
            for (let i = 0; i < arrayBuffer.byteLength; i += frameSize * samplesPerPeak) {
                // Calculate min/max for each channel in this peak window
                for (let ch = 0; ch < channels; ch++) {
                    let min = 1.0;
                    let max = -1.0;
                    
                    // Sample within peak window
                    for (let s = 0; s < samplesPerPeak * frameSize && i + s < arrayBuffer.byteLength; s += frameSize) {
                        const byteOffset = i + s + (ch * bytesPerSample);
                        
                        if (byteOffset + bytesPerSample > arrayBuffer.byteLength) break;
                        
                        let sample = 0;
                        if (bitDepth === 16) {
                            sample = dataView.getInt16(byteOffset, true) / 32768.0;
                        } else if (bitDepth === 24) {
                            // 24-bit is stored as 3 bytes, little-endian
                            const byte1 = dataView.getUint8(byteOffset);
                            const byte2 = dataView.getUint8(byteOffset + 1);
                            const byte3 = dataView.getInt8(byteOffset + 2); // Signed for sign extension
                            const int24 = (byte3 << 16) | (byte2 << 8) | byte1;
                            sample = int24 / 8388608.0; // 2^23
                        } else if (bitDepth === 32) {
                            // Assume 32-bit float
                            sample = dataView.getFloat32(byteOffset, true);
                        }
                        
                        if (sample < min) min = sample;
                        if (sample > max) max = sample;
                    }
                    
                    // Store min/max pair
                    peaks[ch].push({ min, max });
                }
            }
            
            processedBytes += arrayBuffer.byteLength;
            if (onProgress) {
                const progress = (processedBytes / dataSize) * 100;
                onProgress(Math.round(progress));
            }
        }
        
        const elapsedTime = performance.now() - startTime;
        console.log(`[PeakCache] Generated ${peaks[0].length} peaks in ${elapsedTime.toFixed(0)}ms`);
        
        const peakData = {
            peaks,
            channels,
            sampleRate,
            duration,
            samplesPerPeak,
            generatedAt: Date.now()
        };
        
        // Cache the peaks
        await this.cachePeaks(file, peakData);
        
        return peakData;
    }

    /**
     * Get or generate peak data for a file
     */
    async getPeaks(file, metadata, onProgress = null) {
        // Check cache first
        const cached = await this.getCachedPeaks(file);
        if (cached) {
            return cached;
        }
        
        // Generate if not cached
        return await this.generatePeaks(file, metadata, onProgress);
    }

    /**
     * Clear all cached peaks
     */
    async clearCache() {
        await this.initPromise;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peaks'], 'readwrite');
            const store = transaction.objectStore('peaks');
            const request = store.clear();

            request.onsuccess = () => {
                console.log('[PeakCache] Cache cleared');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get cache size information
     */
    async getCacheInfo() {
        await this.initPromise;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['peaks'], 'readonly');
            const store = transaction.objectStore('peaks');
            const request = store.getAll();

            request.onsuccess = () => {
                const records = request.result;
                const totalSize = records.reduce((sum, record) => {
                    // Estimate size of peak data
                    const peakBytes = record.peaks.reduce((s, ch) => s + ch.length * 16, 0); // ~16 bytes per peak
                    return sum + peakBytes;
                }, 0);
                
                resolve({
                    count: records.length,
                    totalSize,
                    files: records.map(r => ({
                        name: r.fileName,
                        size: r.fileSize,
                        peakCount: r.peaks[0]?.length || 0,
                        timestamp: r.timestamp
                    }))
                });
            };
            request.onerror = () => reject(request.error);
        });
    }
}
