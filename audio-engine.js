export class AudioEngine {
    constructor() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.source = null;
        this.buffer = null;
        this.startTime = 0;
        this.pauseTime = 0;
        this.isPlaying = false;
        this.splitter = null;
        this.merger = null;
        this.mixerNodes = [];
    }

    setMixerNodes(nodes) {
        this.mixerNodes = nodes;
    }

    async loadAudio(arrayBuffer) {
        this.buffer = await this.decodeFile(arrayBuffer);
        return this.buffer;
    }

    async decodeFile(arrayBuffer) {
        try {
            // Check for RF64 header OR very large file (> 2GB) to skip native decoding
            // Native decoding requires cloning (double memory) and often crashes on large buffers
            const view = new DataView(arrayBuffer);
            const isRF64 = view.getUint32(0, false) === 0x52463634; // RF64 signature
            const isLargeFile = arrayBuffer.byteLength > 2 * 1024 * 1024 * 1024; // > 2GB

            if (isRF64 || isLargeFile) {
                console.log(`Large file detected (RF64: ${isRF64}, Size: ${arrayBuffer.byteLength}), skipping native decode...`);
                return this.decodeWavManually(arrayBuffer);
            } else {
                // Try native decoding first (fastest)
                // Note: decodeAudioData detaches the arrayBuffer, so we must clone it if we might need to fallback
                const bufferClone = arrayBuffer.slice(0);

                try {

                    const decoded = await this.audioCtx.decodeAudioData(arrayBuffer);

                    // Log first samples from each channel
                    for (let i = 0; i < Math.min(2, decoded.numberOfChannels); i++) {
                        const data = decoded.getChannelData(i);

                    }
                    return decoded;
                } catch (nativeErr) {
                    console.log('[decodeFile] Native decoding not supported for this file, using manual WAV decoder...');
                    return this.decodeWavManually(bufferClone);
                }
            }
        } catch (err) {
            console.error('Error decoding audio:', err);
            throw err;
        }
    }

    decodeWavManually(arrayBuffer) {
        const view = new DataView(arrayBuffer);

        // Check RIFF/RF64 header
        const chunkIdHeader = view.getUint32(0, false);
        const isRF64 = chunkIdHeader === 0x52463634;

        if ((chunkIdHeader !== 0x52494646 && !isRF64) || view.getUint32(8, false) !== 0x57415645) {
            throw new Error('Not a valid WAV file');
        }

        let offset = 12;
        let fmt = null;
        let dataOffset = -1;
        let dataSize = 0;
        let rf64DataSize = 0n;

        while (offset < view.byteLength) {
            const chunkId = this.getChunkId(view, offset);
            let chunkSize = view.getUint32(offset + 4, true);

            if (chunkId === 'ds64') {
                // Parse ds64 chunk (RF64 64-bit sizes)
                const ds64View = new DataView(view.buffer, view.byteOffset + offset + 8, chunkSize);
                rf64DataSize = ds64View.getBigUint64(8, true);
            } else if (chunkId === 'fmt ') {
                fmt = {
                    audioFormat: view.getUint16(offset + 8, true),
                    channels: view.getUint16(offset + 10, true),
                    sampleRate: view.getUint32(offset + 12, true),
                    byteRate: view.getUint32(offset + 16, true),
                    blockAlign: view.getUint16(offset + 20, true),
                    bitsPerSample: view.getUint16(offset + 22, true)
                };
            } else if (chunkId === 'data') {
                dataOffset = offset + 8;

                if (chunkSize === 0xFFFFFFFF && isRF64) {
                    dataSize = Number(rf64DataSize);
                } else {
                    dataSize = chunkSize;
                }
                // Don't break, might be other chunks? Usually data is last or near end.
                // But we found it.
            }

            offset += 8 + chunkSize;
            // Pad to even byte boundary if chunk size is odd
            if (chunkSize % 2 !== 0) offset++;
        }

        if (!fmt || dataOffset === -1) {
            throw new Error('Missing fmt or data chunk');
        }

        console.log('Manual Decode:', fmt);

        // Create AudioBuffer
        const frameCount = Math.floor(dataSize / fmt.blockAlign);
        const audioBuffer = this.audioCtx.createBuffer(fmt.channels, frameCount, fmt.sampleRate);

        // Fill Channels
        const channels = [];
        for (let c = 0; c < fmt.channels; c++) {
            channels.push(audioBuffer.getChannelData(c));
        }

        let sampleIndex = 0;
        let byteOffset = dataOffset;
        const bytesPerSample = fmt.bitsPerSample / 8;

        // Helper to read sample based on bit depth
        // 16-bit: int16 -> float (-1.0 to 1.0)
        // 24-bit: int24 -> float
        // 32-bit: float32 -> float

        // Optimization: Use TypedArrays if possible, but interleaving makes it hard.
        // We'll iterate frames.

        for (let i = 0; i < frameCount; i++) {
            for (let c = 0; c < fmt.channels; c++) {
                let sample = 0;

                if (fmt.bitsPerSample === 16) {
                    sample = view.getInt16(byteOffset, true) / 32768.0;
                    byteOffset += 2;
                } else if (fmt.bitsPerSample === 24) {
                    // Read 3 bytes as signed integer
                    const b1 = view.getUint8(byteOffset);
                    const b2 = view.getUint8(byteOffset + 1);
                    const b3 = view.getUint8(byteOffset + 2);
                    byteOffset += 3;

                    let val = (b3 << 16) | (b2 << 8) | b1;
                    // Sign extension for 24-bit
                    if (val & 0x800000) {
                        val = val - 16777216; // 2^24
                    }
                    sample = val / 8388608.0; // 2^23
                } else if (fmt.bitsPerSample === 32) {
                    if (fmt.audioFormat === 3) { // IEEE Float
                        sample = view.getFloat32(byteOffset, true);
                    } else { // Int32
                        sample = view.getInt32(byteOffset, true) / 2147483648.0;
                    }
                    byteOffset += 4;
                } else {
                    // 8-bit (unsigned 0-255)
                    sample = (view.getUint8(byteOffset) - 128) / 128.0;
                    byteOffset += 1;
                }

                channels[c][i] = sample;
            }
        }

        return audioBuffer;
    }

    getChunkId(view, offset) {
        let id = '';
        for (let i = 0; i < 4; i++) {
            id += String.fromCharCode(view.getUint8(offset + i));
        }
        return id;
    }

    setupRouting() {
        // Clean up old routing
        if (this.splitter) {
            this.splitter.disconnect();
            this.splitter = null;
        }
        if (this.masterBus) {
            this.masterBus.disconnect();
            this.masterBus = null;
        }

        // Note: We don't disconnect mixer node outputs anymore since they're internally
        // connected to the mixer's masterGain which connects to destination

        if (this.buffer && this.mixerNodes && this.mixerNodes.length > 0) {
            try {
                const channelCount = Math.min(this.buffer.numberOfChannels, 32);
                this.splitter = this.audioCtx.createChannelSplitter(channelCount);

                for (let i = 0; i < channelCount; i++) {
                    if (this.mixerNodes[i]) {
                        // Splitter -> Mixer Input (gainNode)
                        // The mixer internally routes: gainNode -> analyser -> panNode -> masterGain -> destination
                        this.splitter.connect(this.mixerNodes[i].input, i);
                    }
                }
            } catch (err) {
                console.error('Routing setup failed:', err);
            }
        }
    }

    play(startOffset = 0) {
        if (!this.buffer) return;

        // Stop any existing source ONLY (don't disconnect - let it be GC'd)
        if (this.source) {
            try {
                this.source.onended = null;
                this.source.stop();
                // Intentionally NO disconnect() - causes timing issues
            } catch (e) {
                // Already stopped, ignore
            }
        }

        // Clamp offset to buffer duration
        const clampedOffset = Math.max(0, Math.min(startOffset, this.buffer.duration - 0.001));

        // Create new source
        this.source = this.audioCtx.createBufferSource();
        this.source.buffer = this.buffer;

        // Connect to splitter (keeps audio graph active)
        if (this.splitter) {
            this.source.connect(this.splitter);
        } else {
            this.source.connect(this.audioCtx.destination);
        }

        // Set onended handler
        this.source.onended = () => {
            this.isPlaying = false;
        };

        // Calculate start time and start playback
        this.startTime = this.audioCtx.currentTime - clampedOffset;
        this.source.start(0, clampedOffset);
        
        this.isPlaying = true;
        this.pauseTime = 0;
    }

    stop() {
        if (this.source) {
            try {
                this.source.stop();
            } catch (e) {
                // Already stopped, ignore
            }
        }
        this.isPlaying = false;
        this.pauseTime = this.audioCtx.currentTime - this.startTime;
    }

    seek(time) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
            // Stop current playback (but don't disconnect)
            if (this.source) {
                try {
                    this.source.onended = null;
                    this.source.stop();
                    // NO disconnect() - keeps audio graph active
                } catch (e) { }
            }
            this.isPlaying = true;
            this.play(time);
        } else {
            this.pauseTime = time;
        }
    }

    getCurrentTime() {
        if (this.isPlaying) {
            return this.audioCtx.currentTime - this.startTime;
        }
        return this.pauseTime;
    }

    renderWaveform(canvas, buffer, channelStates = [], cueMarkers = null, selectedCueMarkerId = null) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const channelCount = buffer.numberOfChannels;

        // Clear canvas
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        // Colors for tracks (Vibrant palette)
        const colors = [
            'rgba(3, 218, 198, 0.7)',   // Teal
            'rgba(187, 134, 252, 0.7)', // Purple
            'rgba(207, 102, 121, 0.7)', // Red
            'rgba(255, 179, 0, 0.7)',   // Amber
            'rgba(33, 150, 243, 0.7)',  // Blue
            'rgba(76, 175, 80, 0.7)',   // Green
            'rgba(255, 87, 34, 0.7)',   // Deep Orange
            'rgba(0, 188, 212, 0.7)'    // Cyan
        ];

        const step = Math.ceil(buffer.length / width);
        const amp = height / 2;

        // Determine which channels to draw
        const anySolo = channelStates.some(ch => ch && ch.isSoloed);

        // Draw tracks in reverse order so Track 1 (index 0) is on top
        for (let c = channelCount - 1; c >= 0; c--) {
            // Check visibility - only respect solo state for waveform display
            // Muted channels still show in the waveform (audio is muted via mixer, not visual)
            if (channelStates[c]) {
                if (anySolo && !channelStates[c].isSoloed) {
                    continue; // Skip non-soloed channels if any are soloed
                }
            }

            const data = buffer.getChannelData(c);
            const color = colors[c % colors.length];

            ctx.fillStyle = color;
            ctx.beginPath();

            for (let i = 0; i < width; i++) {
                let min = 1.0;
                let max = -1.0;
                for (let j = 0; j < step; j++) {
                    const datum = data[(i * step) + j];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
                // Draw vertical bar for this pixel column
                ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
            }
        }

        // Render cue markers
        if (cueMarkers && buffer.duration) {
            this.renderCueMarkers(ctx, canvas, buffer.duration, cueMarkers, selectedCueMarkerId);
        }
    }

    /**
     * Render cue markers on the waveform canvas
     */
    renderCueMarkers(ctx, canvas, duration, cueMarkers, selectedCueMarkerId) {
        const markers = cueMarkers.getAllSorted();
        const width = canvas.width;
        const height = canvas.height;

        markers.forEach(marker => {
            const x = (marker.time / duration) * width;
            const isSelected = marker.id === selectedCueMarkerId;

            // Draw vertical line (dashed)
            ctx.strokeStyle = isSelected ? '#ffcf44' : '#00d4ff';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]); // 4px dash, 4px gap
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            ctx.setLineDash([]); // Reset to solid

            // Draw draggable handle at top
            ctx.fillStyle = isSelected ? '#ffcf44' : '#00d4ff';
            ctx.fillRect(x - 4, 0, 8, 12);

            // Draw label (if exists)
            if (marker.label) {
                ctx.fillStyle = '#ffffff';
                ctx.font = '12px Inter, sans-serif';
                ctx.textBaseline = 'top';
                
                // Draw text with background for readability
                const textMetrics = ctx.measureText(marker.label);
                const textWidth = textMetrics.width;
                const textX = x + 6;
                const textY = 2;
                
                // Background
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(textX - 2, textY, textWidth + 4, 14);
                
                // Text
                ctx.fillStyle = '#ffffff';
                ctx.fillText(marker.label, textX, textY);
            }
        });
    }

    async renderStereoMix(sourceBuffer, mixerChannels, mode = 'current', masterFaderLevel = 1.0) {
        if (!sourceBuffer) throw new Error("No buffer to render");

        const offlineCtx = new OfflineAudioContext(2, sourceBuffer.length, sourceBuffer.sampleRate);

        // Helper function to convert master fader level to gain
        const getMasterGain = (faderLevel) => {
            const dBCurve = [
                [1.00, 0],
                [0.75, -3],
                [0.50, -10],
                [0.40, -20],
                [0.30, -30],
                [0.20, -40],
                [0.10, -55],
                [0.05, -70],
                [0.02, -80],
                [0.00, -Infinity]
            ];
            
            const sliderToDb = (slider) => {
                if (slider <= 0) return -Infinity;
                for (let j = 1; j < dBCurve.length; ++j) {
                    if (slider >= dBCurve[j][0]) {
                        const [x1, y1] = dBCurve[j-1];
                        const [x2, y2] = dBCurve[j];
                        return y1 + (y2 - y1) * (slider - x1) / (x2 - x1);
                    }
                }
                return dBCurve[dBCurve.length-1][1];
            };
            
            const dbToGain = (db) => {
                if (!isFinite(db)) return 0;
                return Math.pow(10, db / 20);
            };
            
            return dbToGain(sliderToDb(faderLevel));
        };

        const masterGain = getMasterGain(masterFaderLevel);

        // Mode: bypass - use default settings
        if (mode === 'bypass') {
            const source = offlineCtx.createBufferSource();
            source.buffer = sourceBuffer;
            const splitter = offlineCtx.createChannelSplitter(sourceBuffer.numberOfChannels);
            source.connect(splitter);

            // Create master gain node to apply master fader
            const masterGainNode = offlineCtx.createGain();
            masterGainNode.gain.value = masterGain;
            masterGainNode.connect(offlineCtx.destination);

            // For bypass mode:
            // - Mono sources: output mono to stereo with 0.707 gain per channel (maintains total power)
            // - Multi-channel: pan odd channels left, even right
            if (sourceBuffer.numberOfChannels === 1) {
                // Mono source: output to both channels at 0.707 (-3dB) to maintain power
                const gainNode = offlineCtx.createGain();
                gainNode.gain.value = 0.707; // -3dB to compensate for stereo expansion
                splitter.connect(gainNode, 0);
                gainNode.connect(masterGainNode);
            } else {
                // Multi-channel: alternate panning
                for (let i = 0; i < sourceBuffer.numberOfChannels; i++) {
                    const gainNode = offlineCtx.createGain();
                    gainNode.gain.value = 1.0;

                    const panNode = offlineCtx.createStereoPanner();
                    panNode.pan.value = (i % 2 === 0) ? -1 : 1;

                    splitter.connect(gainNode, i);
                    gainNode.connect(panNode);
                    panNode.connect(masterGainNode);
                }
            }

            source.start(0);
            return await offlineCtx.startRendering();
        }

        // Mode: automation - process frame by frame with automation curves
        if (mode === 'automation') {
            // Check if any automation exists
            const hasAutomation = mixerChannels.some(ch =>
                ch.automation && ch.automation.volume && ch.automation.volume.length > 0
            );

            if (!hasAutomation) {
                // Fall back to 'current' mode
                console.warn('No automation found, falling back to current mix');
                mode = 'current';
            } else {
                // Process with automation
                return await this.renderWithAutomation(sourceBuffer, mixerChannels, offlineCtx, masterGain);
            }
        }

        // Mode: current (default) - use static mixer settings
        const source = offlineCtx.createBufferSource();
        source.buffer = sourceBuffer;
        const splitter = offlineCtx.createChannelSplitter(sourceBuffer.numberOfChannels);
        source.connect(splitter);

        // Create master gain node to apply master fader
        const masterGainNode = offlineCtx.createGain();
        masterGainNode.gain.value = masterGain;
        masterGainNode.connect(offlineCtx.destination);

        // Check Solo state
        const isAnySolo = mixerChannels.some(ch => ch.isSoloed);

        // For mono sources, we need to compensate for equal-power panning gain increase
        const isMono = sourceBuffer.numberOfChannels === 1;
        const monoCompensation = isMono ? 0.707 : 1.0; // -3dB for mono to stereo conversion

        mixerChannels.forEach(ch => {
            if (ch.index >= sourceBuffer.numberOfChannels) return;

            // Gain Logic
            let gainValue = ch.volume * monoCompensation;
            if (isAnySolo) {
                if (!ch.isSoloed) gainValue = 0;
            } else {
                if (ch.isMuted) gainValue = 0;
            }

            // Nodes
            const gainNode = offlineCtx.createGain();
            gainNode.gain.value = gainValue;

            const panNode = offlineCtx.createStereoPanner();
            const currentPan = ch.panNode ? ch.panNode.pan.value : 0;
            panNode.pan.value = currentPan;

            // Connect: Splitter -> Gain -> Pan -> Master Gain -> Destination
            splitter.connect(gainNode, ch.index);
            gainNode.connect(panNode);
            panNode.connect(masterGainNode);
        });

        source.start(0);
        return await offlineCtx.startRendering();
    }

    async renderMonoMix(sourceBuffer, mixerChannels, mode = 'current', masterFaderLevel = 1.0) {
        if (!sourceBuffer) throw new Error("No buffer to render");

        // Create MONO offline context (1 channel)
        const offlineCtx = new OfflineAudioContext(1, sourceBuffer.length, sourceBuffer.sampleRate);

        // Helper function to convert master fader level to gain
        const getMasterGain = (faderLevel) => {
            const dBCurve = [
                [1.00, 0],
                [0.75, -3],
                [0.50, -10],
                [0.40, -20],
                [0.30, -30],
                [0.20, -40],
                [0.10, -55],
                [0.05, -70],
                [0.02, -80],
                [0.00, -Infinity]
            ];
            
            const sliderToDb = (slider) => {
                if (slider <= 0) return -Infinity;
                for (let j = 1; j < dBCurve.length; ++j) {
                    if (slider >= dBCurve[j][0]) {
                        const [x1, y1] = dBCurve[j-1];
                        const [x2, y2] = dBCurve[j];
                        return y1 + (y2 - y1) * (slider - x1) / (x2 - x1);
                    }
                }
                return dBCurve[dBCurve.length-1][1];
            };
            
            const dbToGain = (db) => {
                if (!isFinite(db)) return 0;
                return Math.pow(10, db / 20);
            };
            
            return dbToGain(sliderToDb(faderLevel));
        };

        const masterGain = getMasterGain(masterFaderLevel);

        // Mode: bypass - use default settings (sum all channels to mono)
        if (mode === 'bypass') {
            const source = offlineCtx.createBufferSource();
            source.buffer = sourceBuffer;
            const splitter = offlineCtx.createChannelSplitter(sourceBuffer.numberOfChannels);
            source.connect(splitter);

            // Create master gain node to apply master fader
            const masterGainNode = offlineCtx.createGain();
            masterGainNode.gain.value = masterGain;
            masterGainNode.connect(offlineCtx.destination);

            // Sum all channels to mono with equal weighting
            const channelCount = sourceBuffer.numberOfChannels;
            const gainPerChannel = 1.0 / Math.sqrt(channelCount); // Energy-preserving sum

            for (let i = 0; i < channelCount; i++) {
                const gainNode = offlineCtx.createGain();
                gainNode.gain.value = gainPerChannel;
                splitter.connect(gainNode, i);
                gainNode.connect(masterGainNode);
            }

            source.start(0);
            return await offlineCtx.startRendering();
        }

        // Mode: automation - not implemented for mono yet, fall back to current
        if (mode === 'automation') {
            console.warn('Automation not yet implemented for mono mix, falling back to current mix');
            mode = 'current';
        }

        // Mode: current (default) - use static mixer settings, sum to mono
        const source = offlineCtx.createBufferSource();
        source.buffer = sourceBuffer;
        const splitter = offlineCtx.createChannelSplitter(sourceBuffer.numberOfChannels);
        source.connect(splitter);

        // Create master gain node to apply master fader
        const masterGainNode = offlineCtx.createGain();
        masterGainNode.gain.value = masterGain;
        masterGainNode.connect(offlineCtx.destination);

        // Check Solo state
        const isAnySolo = mixerChannels.some(ch => ch.isSoloed);

        mixerChannels.forEach(ch => {
            if (ch.index >= sourceBuffer.numberOfChannels) return;

            // Gain Logic (ignore pan for mono mix)
            let gainValue = ch.volume;
            if (isAnySolo) {
                if (!ch.isSoloed) gainValue = 0;
            } else {
                if (ch.isMuted) gainValue = 0;
            }

            // Create gain node and connect directly to master (no panning for mono)
            const gainNode = offlineCtx.createGain();
            gainNode.gain.value = gainValue;

            // Connect: Splitter -> Gain -> Master Gain -> Destination (mono)
            splitter.connect(gainNode, ch.index);
            gainNode.connect(masterGainNode);
        });

        source.start(0);
        return await offlineCtx.startRendering();
    }

    async renderWithAutomation(sourceBuffer, mixerChannels, offlineCtx, masterGain = 1.0) {
        // This is a simplified version - for proper automation rendering,
        // we'd need to manually process samples or use AudioParam automation
        const source = offlineCtx.createBufferSource();
        source.buffer = sourceBuffer;
        const splitter = offlineCtx.createChannelSplitter(sourceBuffer.numberOfChannels);
        source.connect(splitter);

        const duration = sourceBuffer.duration;

        // Create master gain node to apply master fader
        const masterGainNode = offlineCtx.createGain();
        masterGainNode.gain.value = masterGain;
        masterGainNode.connect(offlineCtx.destination);

        // For mono sources, we need to compensate for equal-power panning gain increase
        const isMono = sourceBuffer.numberOfChannels === 1;
        const monoCompensation = isMono ? 0.707 : 1.0; // -3dB for mono to stereo conversion

        mixerChannels.forEach(ch => {
            if (ch.index >= sourceBuffer.numberOfChannels) return;

            const gainNode = offlineCtx.createGain();
            const panNode = offlineCtx.createStereoPanner();

            // Apply automation points to AudioParam
            if (ch.automation && ch.automation.volume && ch.automation.volume.length > 0) {
                // Set initial value
                const firstPoint = ch.automation.volume[0];
                gainNode.gain.setValueAtTime(firstPoint.value * monoCompensation, 0);

                // Add automation points
                ch.automation.volume.forEach(point => {
                    if (point.time <= duration) {
                        gainNode.gain.linearRampToValueAtTime(point.value * monoCompensation, point.time);
                    }
                });
            } else {
                gainNode.gain.value = ch.volume * monoCompensation;
            }

            // Pan (currently no automation, use current value)
            const currentPan = ch.panNode ? ch.panNode.pan.value : 0;
            panNode.pan.value = currentPan;

            splitter.connect(gainNode, ch.index);
            gainNode.connect(panNode);
            panNode.connect(masterGainNode);
        });

        source.start(0);
        return await offlineCtx.startRendering();
    }

    extractRegion(sourceBuffer, startTime, endTime) {
        const sampleRate = sourceBuffer.sampleRate;
        const startSample = Math.floor(startTime * sampleRate);
        const endSample = Math.floor(endTime * sampleRate);
        const regionLength = endSample - startSample;

        if (regionLength <= 0) {
            throw new Error('Invalid region: end must be after start');
        }

        // Create new buffer for the region
        const regionBuffer = this.audioCtx.createBuffer(
            sourceBuffer.numberOfChannels,
            regionLength,
            sampleRate
        );

        // Copy samples for each channel
        for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
            const sourceData = sourceBuffer.getChannelData(channel);
            const regionData = regionBuffer.getChannelData(channel);

            for (let i = 0; i < regionLength; i++) {
                regionData[i] = sourceData[startSample + i];
            }
        }

        return regionBuffer;
    }
}
