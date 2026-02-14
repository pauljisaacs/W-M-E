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
        this.dbVersion = 5; // Bumped: v4 had uninitialized peaks at chunk boundaries
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
                const oldVersion = event.oldVersion;
                
                // Create object store for peak data (v1)
                if (!db.objectStoreNames.contains('peaks')) {
                    const store = db.createObjectStore('peaks', { keyPath: 'fileKey' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                // Clear all cached peaks when upgrading
                // v1: had chunk boundary bugs
                // v2: still had boundary issues with continue vs break
                // v3: lost samples at chunk boundaries (no global sample tracking)
                // v4: accessed uninitialized peaks (not pre-allocated)
                // v5: fixed with pre-allocated peak arrays
                if (oldVersion < 5) {
                    const transaction = event.target.transaction;
                    const store = transaction.objectStore('peaks');
                    store.clear();
                    console.log(`[PeakCache] Cleared old peak cache (upgrading from v${oldVersion} to v5)`);
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
                    const peakCount = result.peaks[0]?.length || 0;
                    console.log(`[PeakCache] Retrieved cached peaks for ${file.name} (${peakCount} peaks per channel, ${result.peaks.length} channels)`);
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
        // Use larger header size to account for metadata chunks (bEXT, iXML, etc.)
        let headerSize = 50 * 1024; // Start with 50KB
        const maxHeaderSize = 10 * 1024 * 1024; // Max 10MB for header search
        
        let dataOffset = 0;
        let dataSize = 0;
        let headerBuffer = null;
        let headerView = null;
        
        // Try to find data chunk, expanding search if needed
        while (dataOffset === 0 && headerSize <= maxHeaderSize) {
            const actualHeaderSize = Math.min(headerSize, file.size);
            const headerBlob = file.slice(0, actualHeaderSize);
            headerBuffer = await headerBlob.arrayBuffer();
            headerView = new DataView(headerBuffer);
            
            // Check for valid WAV/RF64 header
            const signature = String.fromCharCode(
                headerView.getUint8(0),
                headerView.getUint8(1),
                headerView.getUint8(2),
                headerView.getUint8(3)
            );
            
            if (signature !== 'RIFF' && signature !== 'RF64') {
                throw new Error(`Invalid WAV file signature: ${signature}`);
            }
            
            // Scan for data chunk
            let offset = 12; // Skip RIFF/RF64 header
            let ds64DataSize = null;
            
            while (offset < headerBuffer.byteLength - 8) {
                const chunkId = String.fromCharCode(
                    headerView.getUint8(offset),
                    headerView.getUint8(offset + 1),
                    headerView.getUint8(offset + 2),
                    headerView.getUint8(offset + 3)
                );
                const chunkSize = headerView.getUint32(offset + 4, true);
                
                // Validate chunk size
                if (chunkSize < 0 || chunkSize > file.size) {
                    console.warn(`[PeakCache] Invalid chunk size at offset ${offset}: ${chunkSize}`);
                    break;
                }
                
                // Handle ds64 chunk for RF64
                if (chunkId === 'ds64' && signature === 'RF64') {
                    // Read 64-bit data size
                    const low = headerView.getUint32(offset + 16, true);
                    const high = headerView.getUint32(offset + 20, true);
                    ds64DataSize = high * 0x100000000 + low;
                    console.log(`[PeakCache] Found RF64 ds64 chunk, dataSize=${ds64DataSize}`);
                }
                
                if (chunkId === 'data') {
                    dataOffset = offset + 8;
                    // Use ds64 size for RF64 files with 0xFFFFFFFF placeholder
                    dataSize = (chunkSize === 0xFFFFFFFF && ds64DataSize) ? ds64DataSize : chunkSize;
                    console.log(`[PeakCache] Found data chunk at offset ${dataOffset}, size=${dataSize}`);
                    break;
                }
                
                // Move to next chunk
                offset += 8 + chunkSize;
                if (offset % 2 !== 0) offset++; // Word alignment
                
                // If offset exceeds current buffer, need to read more
                if (offset >= headerBuffer.byteLength - 8) {
                    console.log(`[PeakCache] Data chunk not found in first ${(headerSize / 1024).toFixed(0)}KB, expanding search...`);
                    break;
                }
            }
            
            // If not found, double the search size
            if (dataOffset === 0) {
                headerSize *= 2;
            }
        }
        
        if (dataOffset === 0) {
            throw new Error(`Could not find data chunk in WAV file (searched up to ${(headerSize / 1024).toFixed(0)}KB)`);
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
        
        // Pre-allocate peak arrays based on total samples
        const totalPeaks = Math.ceil(totalSamples / samplesPerPeak);
        const peaks = [];
        for (let c = 0; c < channels; c++) {
            const channelPeaks = [];
            for (let p = 0; p < totalPeaks; p++) {
                channelPeaks.push({ min: 1.0, max: -1.0 });
            }
            peaks.push(channelPeaks);
        }
        
        console.log(`[PeakCache] Pre-allocated ${totalPeaks} peaks (${totalSamples} samples / ${samplesPerPeak} samples per peak)`);
        
        let processedBytes = 0;
        let globalSampleIndex = 0; // Track sample position across chunks
        
        // Process audio data in chunks
        for (let chunkStart = dataOffset; chunkStart < dataOffset + dataSize; chunkStart += chunkSize) {
            const chunkEnd = Math.min(chunkStart + chunkSize, dataOffset + dataSize);
            const blob = file.slice(chunkStart, chunkEnd);
            const arrayBuffer = await blob.arrayBuffer();
            const dataView = new DataView(arrayBuffer);
            
            const samplesInChunk = Math.floor(arrayBuffer.byteLength / frameSize);
            
            // Process samples in this chunk
            for (let sampleIdx = 0; sampleIdx < samplesInChunk; sampleIdx++) {
                const globalPeakIndex = Math.floor(globalSampleIndex / samplesPerPeak);
                
                // Read sample for each channel
                const byteOffset = sampleIdx * frameSize;
                for (let ch = 0; ch < channels; ch++) {
                    const sampleByteOffset = byteOffset + (ch * bytesPerSample);
                    
                    let sample = 0;
                    if (bitDepth === 16) {
                        sample = dataView.getInt16(sampleByteOffset, true) / 32768.0;
                    } else if (bitDepth === 24) {
                        // 24-bit is stored as 3 bytes, little-endian
                        const byte1 = dataView.getUint8(sampleByteOffset);
                        const byte2 = dataView.getUint8(sampleByteOffset + 1);
                        const byte3 = dataView.getInt8(sampleByteOffset + 2); // Signed for sign extension
                        const int24 = (byte3 << 16) | (byte2 << 8) | byte1;
                        sample = int24 / 8388608.0; // 2^23
                    } else if (bitDepth === 32) {
                        // Assume 32-bit float
                        sample = dataView.getFloat32(sampleByteOffset, true);
                    }
                    
                    // Update min/max for current peak
                    const peak = peaks[ch][globalPeakIndex];
                    if (sample < peak.min) peak.min = sample;
                    if (sample > peak.max) peak.max = sample;
                }
                
                globalSampleIndex++;
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
            console.log(`[PeakCache] Using cached peaks (v${this.dbVersion})`);
            return cached;
        }
        
        // Generate if not cached
        console.log(`[PeakCache] Cache miss - generating new peaks (v${this.dbVersion})`);
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
