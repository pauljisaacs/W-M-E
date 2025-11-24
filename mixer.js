export class Mixer {
    constructor() {
        this.container = document.getElementById('mixer-container');
        this.channels = []; // Array of { gainNode, panNode, mute, solo, ... }
        this.audioCtx = null;
    }

    init(audioCtx) {
        this.audioCtx = audioCtx;
    }

    buildUI(trackCount, trackNames = [], onTrackNameChange = null, onStateChange = null) {
        this.container.innerHTML = '';
        this.channels = [];
        this.onStateChange = onStateChange; // Store callback

        for (let i = 0; i < trackCount; i++) {
            // ... (rest of loop is same)
            const name = trackNames[i] || `Ch ${i + 1}`;
            const defaultPan = i % 2 === 0 ? -1 : 1; // Left for odd (0, 2...), Right for even (1, 3...)

            const strip = document.createElement('div');
            strip.className = 'channel-strip';

            strip.innerHTML = `
                <div class="channel-name" title="${name}" contenteditable="true" data-idx="${i}">${name}</div>
                <div class="channel-controls">
                    <button class="mute-btn" data-idx="${i}">M</button>
                    <button class="solo-btn" data-idx="${i}">S</button>
                </div>
                <div class="fader-container">
                    <div class="meter-scale">
                        <div class="scale-label" data-db="0">0</div>
                        <div class="scale-label" data-db="-20">-20</div>
                        <div class="scale-label" data-db="-40">-40</div>
                        <div class="scale-label" data-db="-60">-60</div>
                    </div>
                    <canvas class="vu-meter" width="10" height="100"></canvas>
                    <input type="range" orient="vertical" min="0" max="1.2" step="0.01" value="1" data-idx="${i}" class="volume-fader">
                </div>
                <input type="range" min="-1" max="1" step="0.1" value="${defaultPan}" data-idx="${i}" class="pan-knob" title="Pan">
            `;

            this.container.appendChild(strip);

            // Attach name edit listener
            const nameDiv = strip.querySelector('.channel-name');
            nameDiv.addEventListener('blur', (e) => {
                if (onTrackNameChange) {
                    onTrackNameChange(i, e.target.textContent);
                }
            });
            nameDiv.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                }
            });

            // Create Audio Nodes only if audioCtx is available
            let gainNode = null;
            let panNode = null;
            let analyserNode = null;

            if (this.audioCtx) {
                gainNode = this.audioCtx.createGain();
                panNode = this.audioCtx.createStereoPanner();
                panNode.pan.value = defaultPan; // Set default pan
                analyserNode = this.audioCtx.createAnalyser();
                analyserNode.fftSize = 256; // Small FFT for responsiveness
                analyserNode.smoothingTimeConstant = 0.5; // Smooth decay

                // Chain: Input -> Gain -> Analyser -> Pan -> Output (Merger)
                gainNode.connect(analyserNode);
                analyserNode.connect(panNode);
            }

            this.channels.push({
                index: i,
                gainNode: gainNode,
                panNode: panNode,
                analyserNode: analyserNode,
                canvas: strip.querySelector('.vu-meter'),
                meterLevel: 0,
                isMuted: false,
                isSoloed: false,
                volume: 1.0
            });
        }

        this.attachListeners();
    }

    // ... (updateMeters, attachListeners, setVolume, setPan are same)

    toggleMute(index, btn) {
        const ch = this.channels[index];
        ch.isMuted = !ch.isMuted;

        if (ch.isMuted) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        this.updateGains();
        if (this.onStateChange) this.onStateChange(); // Notify change
    }

    toggleSolo(index, btn) {
        const ch = this.channels[index];
        ch.isSoloed = !ch.isSoloed;

        if (ch.isSoloed) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        this.updateGains();
        if (this.onStateChange) this.onStateChange(); // Notify change
    }

    updateMeters() {
        if (!this.channels.length) return;

        // Coefficients for 60fps (approx 16.7ms per frame)
        // Attack 1ms: Instant (1.0)
        // Decay 200ms: 1 - exp(-16.7 / 200) ≈ 0.08
        const attackCoef = 1.0;
        const decayCoef = 0.08;

        this.channels.forEach(ch => {
            const canvas = ch.canvas;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;

            // Get audio data
            const dataArray = new Float32Array(ch.analyserNode.fftSize);
            ch.analyserNode.getFloatTimeDomainData(dataArray);

            // Calculate RMS (Root Mean Square)
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / dataArray.length);

            // Convert to dB
            // Avoid log(0) = -Infinity
            const db = 20 * Math.log10(Math.max(rms, 0.00001));

            // Map -60dB to 0dB to 0-1 range
            let targetPercent = (db + 60) / 60;
            targetPercent = Math.max(0, Math.min(1, targetPercent));

            // Apply Ballistics
            if (targetPercent > ch.meterLevel) {
                // Attack
                ch.meterLevel += (targetPercent - ch.meterLevel) * attackCoef;
            } else {
                // Decay
                ch.meterLevel += (targetPercent - ch.meterLevel) * decayCoef;
            }

            // Clamp
            ch.meterLevel = Math.max(0, Math.min(1, ch.meterLevel));

            // Draw Meter
            ctx.clearRect(0, 0, width, height);

            // Create Gradient
            const gradient = ctx.createLinearGradient(0, height, 0, 0);
            gradient.addColorStop(0, '#00ff00');    // -60dB Green
            gradient.addColorStop(0.66, '#00ff00'); // -20dB Green
            gradient.addColorStop(0.66, '#ffff00'); // -20dB Yellow
            gradient.addColorStop(0.80, '#ffff00'); // -12dB Yellow
            gradient.addColorStop(0.80, '#ff9900'); // -12dB Orange
            gradient.addColorStop(0.98, '#ff9900'); // -1dB Orange
            gradient.addColorStop(0.98, '#ff0000'); // -1dB Red
            gradient.addColorStop(1, '#ff0000');    // 0dB Red

            ctx.fillStyle = gradient;

            const barHeight = ch.meterLevel * height;
            ctx.fillRect(0, height - barHeight, width, barHeight);
        });
    }

    attachListeners() {
        this.container.querySelectorAll('.volume-fader').forEach(el => {
            el.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                const val = parseFloat(e.target.value);
                this.setVolume(idx, val);
            });
        });

        this.container.querySelectorAll('.pan-knob').forEach(el => {
            el.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                const val = parseFloat(e.target.value);
                this.setPan(idx, val);
            });
        });

        this.container.querySelectorAll('.mute-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                this.toggleMute(idx, e.target);
            });
        });

        this.container.querySelectorAll('.solo-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                this.toggleSolo(idx, e.target);
            });
        });
    }

    setVolume(idx, val) {
        const ch = this.channels[idx];
        ch.volume = val;
        if (!ch.isMuted && ch.gainNode) {
            ch.gainNode.gain.value = val;
        }
    }

    /**
     * Get current mixer state
     * @returns {Array} Array of channel states
     */
    getMixerState() {
        return this.channels.map(ch => ({
            volume: ch.volume,
            pan: ch.panNode ? ch.panNode.pan.value : 0,
            isMuted: ch.isMuted,
            isSoloed: ch.isSoloed
        }));
    }

    /**
     * Set mixer state from saved data
     * @param {Array} state - Array of channel states
     */
    setMixerState(state) {
        state.forEach((chState, index) => {
            if (index >= this.channels.length) return; // Skip if more channels in state than mixer

            const ch = this.channels[index];

            // Set volume
            ch.volume = chState.volume;
            const fader = this.container.querySelector(`[data-idx="${index}"].volume-fader`);
            if (fader) fader.value = chState.volume;

            // Set pan
            if (ch.panNode) {
                ch.panNode.pan.value = chState.pan;
            }
            const panKnob = this.container.querySelector(`[data-idx="${index}"].pan-knob`);
            if (panKnob) panKnob.value = chState.pan;

            // Set mute
            ch.isMuted = chState.isMuted;
            const muteBtn = this.container.querySelector(`[data-idx="${index}"].mute-btn`);
            if (muteBtn) {
                if (chState.isMuted) {
                    muteBtn.classList.add('active');
                } else {
                    muteBtn.classList.remove('active');
                }
            }

            // Set solo
            ch.isSoloed = chState.isSoloed;
            const soloBtn = this.container.querySelector(`[data-idx="${index}"].solo-btn`);
            if (soloBtn) {
                if (chState.isSoloed) {
                    soloBtn.classList.add('active');
                } else {
                    soloBtn.classList.remove('active');
                }
            }
        });

        // Update gains based on new mute/solo state
        this.updateGains();
    }

    setPan(idx, val) {
        const ch = this.channels[idx];
        if (ch.panNode) {
            ch.panNode.pan.value = val;
        }
    }



    updateGains() {
        const anySolo = this.channels.some(ch => ch.isSoloed);

        this.channels.forEach(ch => {
            let targetGain = ch.volume;

            if (ch.isMuted) {
                targetGain = 0;
            } else if (anySolo && !ch.isSoloed) {
                targetGain = 0;
            }

            // Smooth transition (only if gainNode exists)
            if (ch.gainNode && this.audioCtx) {
                ch.gainNode.gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.02);
            }
        });
    }

    getChannelNodes() {
        return this.channels.map(ch => ({
            input: ch.gainNode,
            output: ch.panNode
        }));
    }
}
