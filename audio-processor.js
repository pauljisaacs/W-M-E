export class AudioProcessor {
    constructor() {
    }

    /**
     * Normalizes the audio data in the WAV file to the target dBFS.
     * @param {ArrayBuffer} arrayBuffer - The raw WAV file data.
     * @param {number} targetDb - The target peak level in dBFS (e.g., -1.0).
     * @returns {Promise<ArrayBuffer>} - The normalized WAV file data.
     */
    async normalize(arrayBuffer, targetDb, region = null) {
        const view = new DataView(arrayBuffer);

        // 1. Parse WAV Header to find format and data chunk
        const info = this.parseWavFormat(view);
        if (!info) {
            throw new Error('Invalid WAV file or format not supported.');
        }

        const { channels, sampleRate, bitDepth, dataOffset, dataSize, audioFormat } = info;

        console.log(`Normalizing: ${bitDepth}-bit, ${channels}ch, ${sampleRate}Hz. Target: ${targetDb}dB`);
        if (region) {
            console.log(`Region: ${region.start.toFixed(3)}s to ${region.end.toFixed(3)}s`);
        } else {
            console.log('Region: Entire File');
        }

        // Calculate byte range
        let startByte = 0;
        let endByte = dataSize;

        if (region && region.start !== null && region.end !== null) {
            const bytesPerSample = bitDepth / 8;
            const blockAlign = channels * bytesPerSample;
            const startFrame = Math.floor(Math.min(region.start, region.end) * sampleRate);
            const endFrame = Math.floor(Math.max(region.start, region.end) * sampleRate);

            startByte = startFrame * blockAlign;
            endByte = endFrame * blockAlign;

            // Clamp
            if (startByte < 0) startByte = 0;
            if (endByte > dataSize) endByte = dataSize;

            // Align to block boundary (should already be aligned, but safety first)
            startByte = Math.floor(startByte / blockAlign) * blockAlign;
            endByte = Math.floor(endByte / blockAlign) * blockAlign;
        }

        const absStart = dataOffset + startByte;
        const absEnd = dataOffset + endByte; // Note: findPeak/applyGain use offsets relative to file start

        // 2. Analyze Peak (Pass 1)
        // Pass absolute file offsets directly
        const maxPeak = this.findPeak(view, absStart, endByte - startByte, bitDepth, audioFormat);

        // Convert peak to dBFS
        let maxPossibleVal;
        if (audioFormat === 3) { // Float
            maxPossibleVal = 1.0;
        } else {
            if (bitDepth === 16) maxPossibleVal = 32768;
            else if (bitDepth === 24) maxPossibleVal = 8388608;
            else if (bitDepth === 32) maxPossibleVal = 2147483648;
            else throw new Error(`Unsupported bit depth: ${bitDepth}`);
        }

        const currentPeakDb = (maxPeak === 0) ? -Infinity : 20 * Math.log10(maxPeak / maxPossibleVal);

        console.log(`Current Peak in Region: ${maxPeak} (${currentPeakDb.toFixed(2)} dBFS)`);

        // 3. Calculate Gain
        if (maxPeak === 0) {
            console.warn('Region is silent, skipping normalization.');
            return arrayBuffer;
        }

        const gainDb = targetDb - currentPeakDb;
        const gainLinear = Math.pow(10, gainDb / 20);

        console.log(`Applying Gain: ${gainDb.toFixed(2)} dB (x${gainLinear.toFixed(4)})`);

        // 4. Apply Gain (Pass 2)
        this.applyGain(view, absStart, endByte - startByte, bitDepth, audioFormat, gainLinear);

        return arrayBuffer;
    }

    parseWavFormat(view) {
        // Simple parser to find fmt and data chunks
        const chunkIdHeader = view.getUint32(0, false);
        const isRF64 = chunkIdHeader === 0x52463634; // RF64

        if (chunkIdHeader !== 0x52494646 && !isRF64) return null; // RIFF or RF64
        if (view.getUint32(8, false) !== 0x57415645) return null; // WAVE

        let offset = 12;
        let info = {};
        let rf64DataSize = 0n;

        while (offset < view.byteLength) {
            const chunkId = this.getChunkId(view, offset);
            let chunkSize = view.getUint32(offset + 4, true);

            if (chunkId === 'ds64') {
                const ds64View = new DataView(view.buffer, view.byteOffset + offset + 8, chunkSize);
                rf64DataSize = ds64View.getBigUint64(8, true);
            } else if (chunkId === 'fmt ') {
                info.audioFormat = view.getUint16(offset + 8, true); // 1=PCM, 3=Float, 65534=Extensible
                info.channels = view.getUint16(offset + 10, true);
                info.sampleRate = view.getUint32(offset + 12, true);
                info.bitDepth = view.getUint16(offset + 22, true);

                // Handle WAVE_FORMAT_EXTENSIBLE
                if (info.audioFormat === 0xFFFE && chunkSize >= 40) {
                    // SubFormat is at offset 24 relative to chunk data start (8 bytes header)
                    // The first 2 bytes of the SubFormat GUID effectively match the basic audio format code
                    const subFormat = view.getUint16(offset + 8 + 24, true);
                    info.audioFormat = subFormat;
                }
            } else if (chunkId === 'data') {
                info.dataOffset = offset + 8;

                if (chunkSize === 0xFFFFFFFF && isRF64) {
                    info.dataSize = Number(rf64DataSize);
                } else {
                    info.dataSize = chunkSize;
                }

                // We found data, we can stop if we have fmt info
                if (info.audioFormat) break;
            }

            offset += 8 + chunkSize;
            if (offset % 2 !== 0) offset++;
        }

        if (info.dataOffset && info.bitDepth) return info;
        return null;
    }

    getChunkId(view, offset) {
        let id = '';
        for (let i = 0; i < 4; i++) {
            id += String.fromCharCode(view.getUint8(offset + i));
        }
        return id;
    }

    findPeak(view, offset, size, bitDepth, audioFormat) {
        let max = 0;
        let pos = offset;
        const end = offset + size;

        while (pos < end) {
            let val = 0;
            if (audioFormat === 3 && bitDepth === 32) { // Float
                val = Math.abs(view.getFloat32(pos, true));
                pos += 4;
            } else if (bitDepth === 16) {
                val = Math.abs(view.getInt16(pos, true));
                pos += 2;
            } else if (bitDepth === 24) {
                val = Math.abs(this.getInt24(view, pos));
                pos += 3;
            } else if (bitDepth === 32) { // Int32
                val = Math.abs(view.getInt32(pos, true));
                pos += 4;
            } else {
                pos += bitDepth / 8; // Skip unsupported
            }

            if (val > max) max = val;
        }
        return max;
    }

    applyGain(view, offset, size, bitDepth, audioFormat, gain) {
        let pos = offset;
        const end = offset + size;

        while (pos < end) {
            if (audioFormat === 3 && bitDepth === 32) { // Float
                let val = view.getFloat32(pos, true);
                val *= gain;
                // Float usually doesn't clip in the file format, but standard is -1.0 to 1.0
                // We can clamp if desired, but floats can go above 0dB. 
                // However, for normalization to 0dB or below, we shouldn't exceed 1.0 unless target > 0dB.
                view.setFloat32(pos, val, true);
                pos += 4;
            } else if (bitDepth === 16) {
                let val = view.getInt16(pos, true);
                val = Math.round(val * gain);
                // Clamp
                if (val > 32767) val = 32767;
                if (val < -32768) val = -32768;
                view.setInt16(pos, val, true);
                pos += 2;
            } else if (bitDepth === 24) {
                let val = this.getInt24(view, pos);
                val = Math.round(val * gain);
                // Clamp
                if (val > 8388607) val = 8388607;
                if (val < -8388608) val = -8388608;
                this.setInt24(view, pos, val);
                pos += 3;
            } else if (bitDepth === 32) { // Int32
                let val = view.getInt32(pos, true);
                val = Math.round(val * gain);
                // Clamp
                if (val > 2147483647) val = 2147483647;
                if (val < -2147483648) val = -2147483648;
                view.setInt32(pos, val, true);
                pos += 4;
            } else {
                pos += bitDepth / 8;
            }
        }
    }

    getInt24(view, offset) {
        const b0 = view.getUint8(offset);
        const b1 = view.getUint8(offset + 1);
        const b2 = view.getUint8(offset + 2);
        let val = (b2 << 16) | (b1 << 8) | b0;
        if (val & 0x800000) val |= 0xFF000000; // Sign extend
        return val;
    }

    setInt24(view, offset, val) {
        if (val < 0) val += 0x1000000; // Convert to unsigned representation
        view.setUint8(offset, val & 0xFF);
        view.setUint8(offset + 1, (val >> 8) & 0xFF);
        view.setUint8(offset + 2, (val >> 16) & 0xFF);
    }

    createWavFile(audioBuffer, bitDepth, originalBuffer, exportMetadata) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const length = audioBuffer.length;

        let bytesPerSample = bitDepth / 8;
        if (bitDepth === 32) bytesPerSample = 4; // Float is 4 bytes

        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = length * blockAlign;

        // Prepare chunks
        const chunks = [];

        // 1. fmt chunk
        const fmtChunk = new Uint8Array(16);
        const fmtView = new DataView(fmtChunk.buffer);
        fmtView.setUint16(0, bitDepth === 32 ? 3 : 1, true); // Format (1=PCM, 3=Float)
        fmtView.setUint16(2, numChannels, true);
        fmtView.setUint32(4, sampleRate, true);
        fmtView.setUint32(8, byteRate, true);
        fmtView.setUint16(12, blockAlign, true);
        fmtView.setUint16(14, bitDepth, true);

        chunks.push({ id: 'fmt ', data: fmtChunk });

        // 2. data chunk
        const dataChunk = new Uint8Array(dataSize);
        const dataView = new DataView(dataChunk.buffer);

        // Interleave and convert samples
        const channelData = [];
        for (let i = 0; i < numChannels; i++) {
            channelData.push(audioBuffer.getChannelData(i));
        }

        let offset = 0;
        for (let i = 0; i < length; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                let sample = channelData[ch][i];

                // Clip
                sample = Math.max(-1, Math.min(1, sample));

                if (bitDepth === 16) {
                    sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                    dataView.setInt16(offset, sample, true);
                    offset += 2;
                } else if (bitDepth === 24) {
                    sample = sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF;
                    const val = Math.round(sample);
                    dataView.setUint8(offset, val & 0xFF);
                    dataView.setUint8(offset + 1, (val >> 8) & 0xFF);
                    dataView.setUint8(offset + 2, (val >> 16) & 0xFF);
                    offset += 3;
                } else if (bitDepth === 32) {
                    dataView.setFloat32(offset, sample, true);
                    offset += 4;
                }
            }
        }
        chunks.push({ id: 'data', data: dataChunk });

        // 3. Copy or update metadata chunks from original buffer
        // For mix exports or track name updates, regenerate metadata chunks
        if (originalBuffer) {
            if (exportMetadata && (exportMetadata.isMixExport || exportMetadata.trackNames)) {
                // Track names have been updated (e.g., for mix export) - regenerate both bEXT and iXML
                // Use metadata handler to create fresh chunks with updated track names
                console.log('[createWavFile] Regenerating metadata for mix export - channels:', exportMetadata.channels, 'trackNames:', exportMetadata.trackNames);
                if (this.metadataHandler) {
                    const bextChunk = this.metadataHandler.createBextChunk(exportMetadata);
                    if (bextChunk && bextChunk.byteLength > 0) {
                        chunks.push({ id: 'bext', data: new Uint8Array(bextChunk) });
                        console.log('[createWavFile] Added bEXT chunk:', bextChunk.byteLength, 'bytes');
                    }
                    const ixmlChunk = this.metadataHandler.createIXMLChunk(exportMetadata);
                    if (ixmlChunk && ixmlChunk.byteLength > 0) {
                        chunks.push({ id: 'iXML', data: new Uint8Array(ixmlChunk) });
                        console.log('[createWavFile] Added iXML chunk:', ixmlChunk.byteLength, 'bytes');
                    }
                }
            } else if (exportMetadata && exportMetadata.timeReference !== undefined) {
                // Region export with timeReference update only
                this.copyBextChunk(originalBuffer, chunks, exportMetadata);
                // Don't copy iXML - let the caller create fresh one with proper TIMESTAMP_SAMPLES_SINCE_MIDNIGHT
            } else {
                // Normal export - copy metadata as-is
                this.copyMetadataChunks(originalBuffer, chunks);
            }
        }

        // Construct final file
        const totalSize = chunks.reduce((acc, chunk) => acc + 8 + chunk.data.byteLength, 4);
        const fileBuffer = new Uint8Array(totalSize + 8);
        const fileView = new DataView(fileBuffer.buffer);

        fileView.setUint8(0, 0x52); // R
        fileView.setUint8(1, 0x49); // I
        fileView.setUint8(2, 0x46); // F
        fileView.setUint8(3, 0x46); // F
        fileView.setUint32(4, totalSize, true);
        fileView.setUint8(8, 0x57); // W
        fileView.setUint8(9, 0x41); // A
        fileView.setUint8(10, 0x56); // V
        fileView.setUint8(11, 0x45); // E

        let fileOffset = 12;
        for (const chunk of chunks) {
            // Chunk ID
            for (let i = 0; i < 4; i++) {
                fileView.setUint8(fileOffset + i, chunk.id.charCodeAt(i));
            }
            // Chunk Size
            fileView.setUint32(fileOffset + 4, chunk.data.byteLength, true);
            // Chunk Data
            fileBuffer.set(chunk.data, fileOffset + 8);

            fileOffset += 8 + chunk.data.byteLength;
        }

        return fileBuffer.buffer;
    }

    /**
     * Copy and update only the bEXT chunk with new timeReference
     */
    copyBextChunk(originalBuffer, chunks, exportMetadata) {
        const view = new DataView(originalBuffer);
        let offset = 12;
        while (offset < view.byteLength - 8) {
            const chunkId = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3)
            );
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId === 'bext') {
                // Copy and update bEXT chunk
                let chunkData = new Uint8Array(originalBuffer.slice(offset + 8, offset + 8 + chunkSize));
                if (exportMetadata && exportMetadata.timeReference !== undefined) {
                    // Update timeReference (8 bytes at offset 338-345 in bEXT chunk)
                    // Only update if the chunk is large enough
                    if (chunkData.byteLength >= 346) {
                        const dv = new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);
                        // Write as two 32-bit little endian values (low, high)
                        const timeRef = BigInt(exportMetadata.timeReference);
                        const timeRefLow = Number(timeRef & 0xFFFFFFFFn);
                        const timeRefHigh = Number((timeRef >> 32n) & 0xFFFFFFFFn);
                        dv.setUint32(338, timeRefLow, true);   // Low 32 bits
                        dv.setUint32(342, timeRefHigh, true);  // High 32 bits
                    }
                }
                chunks.push({ id: chunkId, data: chunkData });
                break; // Found bEXT, exit loop
            }

            offset += 8 + chunkSize;
            if (chunkSize % 2 !== 0) offset++;
        }
    }

    copyMetadataChunks(originalBuffer, chunks) {
        const view = new DataView(originalBuffer);
        let offset = 12;
        while (offset < view.byteLength - 8) {
            const chunkId = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3)
            );
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId === 'bext' || chunkId === 'iXML') {
                console.log(`[Export Debug] Copying ${chunkId} chunk.`);
                const chunkData = new Uint8Array(originalBuffer.slice(offset + 8, offset + 8 + chunkSize));

                if (chunkId === 'iXML') {
                    const decoder = new TextDecoder('utf-8');
                    console.log('[Export Debug] iXML Start:', decoder.decode(chunkData.slice(0, 100)));
                }

                chunks.push({ id: chunkId, data: chunkData });
            }

            offset += 8 + chunkSize;
            // Pad byte
            if (chunkSize % 2 !== 0) offset++;
        }
    }

    /**
     * Combines multiple monophonic WAV files into a single polyphonic WAV file.
     * @param {Array<ArrayBuffer>} fileBuffers - Array of WAV file buffers to combine
     * @param {Array<String>} trackNames - Array of track names for each channel
     * @param {Object} metadata - Metadata object to apply to the combined file
     * @returns {Promise<Blob>} - The combined WAV file as a Blob
     */
    async combineToPolyphonic(fileBuffers, trackNames, metadata) {
        console.log(`[Combine] Combining ${fileBuffers.length} files into polyphonic file`);
        
        // Parse all files and validate compatibility
        const fileInfos = [];
        let referenceSampleRate = null;
        let referenceBitDepth = null;
        let referenceAudioFormat = null;
        let referenceDataSize = null;
        let referenceDuration = null;
        
        for (let i = 0; i < fileBuffers.length; i++) {
            const view = new DataView(fileBuffers[i]);
            const info = this.parseWavFormat(view);
            
            if (!info) {
                throw new Error(`File ${i + 1} is not a valid WAV file`);
            }
            
            if (info.channels !== 1) {
                throw new Error(`File ${i + 1} is not monophonic (has ${info.channels} channels)`);
            }
            
            // Store reference values from first file
            if (i === 0) {
                referenceSampleRate = info.sampleRate;
                referenceBitDepth = info.bitDepth;
                referenceAudioFormat = info.audioFormat;
                referenceDataSize = info.dataSize;
                referenceDuration = info.dataSize / (info.sampleRate * (info.bitDepth / 8));
            } else {
                // Validate compatibility
                if (info.sampleRate !== referenceSampleRate) {
                    throw new Error(`Sample rate mismatch: File 1 has ${referenceSampleRate}Hz, File ${i + 1} has ${info.sampleRate}Hz`);
                }
                if (info.bitDepth !== referenceBitDepth) {
                    throw new Error(`Bit depth mismatch: File 1 has ${referenceBitDepth}-bit, File ${i + 1} has ${info.bitDepth}-bit`);
                }
                if (info.audioFormat !== referenceAudioFormat) {
                    throw new Error(`Audio format mismatch: File 1 has format ${referenceAudioFormat}, File ${i + 1} has format ${info.audioFormat}`);
                }
                if (info.dataSize !== referenceDataSize) {
                    const duration = info.dataSize / (info.sampleRate * (info.bitDepth / 8));
                    throw new Error(`Duration mismatch: File 1 has ${referenceDuration.toFixed(3)}s, File ${i + 1} has ${duration.toFixed(3)}s`);
                }
            }
            
            fileInfos.push(info);
        }
        
        console.log(`[Combine] All files validated: ${referenceSampleRate}Hz, ${referenceBitDepth}-bit, ${fileBuffers.length} channels`);
        
        // Calculate output parameters
        const numChannels = fileBuffers.length;
        const sampleRate = referenceSampleRate;
        const bitDepth = referenceBitDepth;
        const audioFormat = referenceAudioFormat;
        const bytesPerSample = bitDepth / 8;
        const numSamples = referenceDataSize / bytesPerSample;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = numSamples * blockAlign;
        
        // Create output buffer
        const outputBuffer = new ArrayBuffer(44 + dataSize); // RIFF header + fmt + data
        const outputView = new DataView(outputBuffer);
        
        // Write RIFF header
        outputView.setUint8(0, 0x52); // R
        outputView.setUint8(1, 0x49); // I
        outputView.setUint8(2, 0x46); // F
        outputView.setUint8(3, 0x46); // F
        outputView.setUint32(4, 36 + dataSize, true); // File size - 8
        outputView.setUint8(8, 0x57); // W
        outputView.setUint8(9, 0x41); // A
        outputView.setUint8(10, 0x56); // V
        outputView.setUint8(11, 0x45); // E
        
        // Write fmt chunk
        outputView.setUint8(12, 0x66); // f
        outputView.setUint8(13, 0x6D); // m
        outputView.setUint8(14, 0x74); // t
        outputView.setUint8(15, 0x20); // space
        outputView.setUint32(16, 16, true); // fmt chunk size
        outputView.setUint16(20, audioFormat, true); // Audio format (1=PCM, 3=Float)
        outputView.setUint16(22, numChannels, true); // Number of channels
        outputView.setUint32(24, sampleRate, true); // Sample rate
        outputView.setUint32(28, byteRate, true); // Byte rate
        outputView.setUint16(32, blockAlign, true); // Block align
        outputView.setUint16(34, bitDepth, true); // Bits per sample
        
        // Write data chunk header
        outputView.setUint8(36, 0x64); // d
        outputView.setUint8(37, 0x61); // a
        outputView.setUint8(38, 0x74); // t
        outputView.setUint8(39, 0x61); // a
        outputView.setUint32(40, dataSize, true); // Data size
        
        // Interleave audio data
        console.log(`[Combine] Interleaving ${numSamples} samples across ${numChannels} channels`);
        
        let outputOffset = 44; // Start of data chunk
        
        for (let sample = 0; sample < numSamples; sample++) {
            for (let channel = 0; channel < numChannels; channel++) {
                const fileView = new DataView(fileBuffers[channel]);
                const fileInfo = fileInfos[channel];
                const inputOffset = fileInfo.dataOffset + (sample * bytesPerSample);
                
                // Copy sample based on bit depth and format
                if (audioFormat === 3 && bitDepth === 32) { // Float
                    const value = fileView.getFloat32(inputOffset, true);
                    outputView.setFloat32(outputOffset, value, true);
                } else if (bitDepth === 16) {
                    const value = fileView.getInt16(inputOffset, true);
                    outputView.setInt16(outputOffset, value, true);
                } else if (bitDepth === 24) {
                    const b0 = fileView.getUint8(inputOffset);
                    const b1 = fileView.getUint8(inputOffset + 1);
                    const b2 = fileView.getUint8(inputOffset + 2);
                    outputView.setUint8(outputOffset, b0);
                    outputView.setUint8(outputOffset + 1, b1);
                    outputView.setUint8(outputOffset + 2, b2);
                } else if (bitDepth === 32) { // Int32
                    const value = fileView.getInt32(inputOffset, true);
                    outputView.setInt32(outputOffset, value, true);
                }
                
                outputOffset += bytesPerSample;
            }
        }
        
        console.log(`[Combine] Audio data interleaved successfully`);
        
        // Create blob and return (metadata will be added via MetadataHandler)
        return new Blob([outputBuffer], { type: 'audio/wav' });
    }
}
