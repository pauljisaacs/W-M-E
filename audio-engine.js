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
        try {
            // Try native decoding first (fastest)
            // Note: decodeAudioData detaches the arrayBuffer, so we must clone it if we might need to fallback
            const bufferClone = arrayBuffer.slice(0);

            try {
                this.buffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            } catch (nativeErr) {
                console.warn('Native decoding failed, trying manual WAV decoding...', nativeErr);
                this.buffer = this.decodeWavManually(bufferClone);
            }

            return this.buffer;
        } catch (err) {
            console.error('Error decoding audio:', err);
            throw err;
        }
    }

    decodeWavManually(arrayBuffer) {
        const view = new DataView(arrayBuffer);

        // Check RIFF header
        if (view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
            throw new Error('Not a valid WAV file');
        }

        let offset = 12;
        let fmt = null;
        let dataOffset = -1;
        let dataSize = 0;

        while (offset < view.byteLength) {
            const chunkId = this.getChunkId(view, offset);
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId === 'fmt ') {
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
                dataSize = chunkSize;
                // Don't break, might be other chunks? Usually data is last or near end.
                // But we found it.
            }

            offset += 8 + chunkSize;
            if (offset % 2 !== 0) offset++;
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

        // Disconnect mixer nodes from old merger
        if (this.mixerNodes) {
            this.mixerNodes.forEach(node => {
                if (node && node.output) {
                    node.output.disconnect();
                }
            });
        }

        if (this.buffer && this.mixerNodes && this.mixerNodes.length > 0) {
            try {
                const channelCount = Math.min(this.buffer.numberOfChannels, 32);
                this.splitter = this.audioCtx.createChannelSplitter(channelCount);
                // Use a GainNode as Master Bus to sum stereo outputs from panners
                this.masterBus = this.audioCtx.createGain();

                for (let i = 0; i < channelCount; i++) {
                    if (this.mixerNodes[i]) {
                        // Splitter -> Mixer Input
                        this.splitter.connect(this.mixerNodes[i].input, i);
                        // Mixer Output -> Master Bus
                        this.mixerNodes[i].output.connect(this.masterBus);
                    }
                }
                this.masterBus.connect(this.audioCtx.destination);
            } catch (err) {
                console.error('Routing setup failed:', err);
            }
        }
    }

    play(startOffset = 0) {
        if (this.isPlaying) this.stop();
        if (!this.buffer) return;

        this.source = this.audioCtx.createBufferSource();
        this.source.buffer = this.buffer;

        // Connect Source -> Splitter (or Destination)
        if (this.splitter) {
            this.source.connect(this.splitter);
        } else {
            this.source.connect(this.audioCtx.destination);
        }

        this.startTime = this.audioCtx.currentTime - startOffset;
        this.source.start(0, startOffset);
        this.isPlaying = true;

        this.source.onended = () => {
            this.isPlaying = false;
        };
    }

    stop() {
        if (this.source) {
            try {
                this.source.stop();
                this.source.disconnect(); // Important!
            } catch (e) { /* ignore */ }
            this.source = null;
        }
        this.isPlaying = false;
        this.pauseTime = this.audioCtx.currentTime - this.startTime;
    }

    seek(time) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
            // Don't fully stop, just restart source
            if (this.source) {
                try {
                    this.source.onended = null; // Prevent onended from firing
                    this.source.stop();
                    this.source.disconnect();
                } catch (e) { }
            }
            this.isPlaying = true; // Keep playing state
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

    renderWaveform(canvas, buffer, channelStates = []) {
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
            // Check visibility
            if (channelStates[c]) {
                if (anySolo) {
                    if (!channelStates[c].isSoloed) continue;
                } else {
                    if (channelStates[c].isMuted) continue;
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
    }

    async renderStereoMix(sourceBuffer, mixerChannels) {
        if (!sourceBuffer) throw new Error("No buffer to render");

        const offlineCtx = new OfflineAudioContext(2, sourceBuffer.length, sourceBuffer.sampleRate);

        // Create source
        const source = offlineCtx.createBufferSource();
        source.buffer = sourceBuffer;

        // Splitter
        const splitter = offlineCtx.createChannelSplitter(sourceBuffer.numberOfChannels);
        source.connect(splitter);

        // Mixer Logic
        // Check Solo state
        const isAnySolo = mixerChannels.some(ch => ch.isSoloed);

        mixerChannels.forEach(ch => {
            if (ch.index >= sourceBuffer.numberOfChannels) return;

            // Gain Logic
            let gainValue = ch.volume;
            if (isAnySolo) {
                if (!ch.isSoloed) gainValue = 0;
            } else {
                if (ch.isMuted) gainValue = 0;
            }

            // Nodes
            const gainNode = offlineCtx.createGain();
            gainNode.gain.value = gainValue;

            const panNode = offlineCtx.createStereoPanner();
            // Get pan value from existing node or default
            // Note: We access the AudioParam value directly
            const currentPan = ch.panNode ? ch.panNode.pan.value : 0;
            panNode.pan.value = currentPan;

            // Connect: Splitter -> Gain -> Pan -> Destination
            splitter.connect(gainNode, ch.index);
            gainNode.connect(panNode);
            panNode.connect(offlineCtx.destination);
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
