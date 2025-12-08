import { AutomationRecorder, AutomationPlayer } from './automation.js';

export class Mixer {
    constructor(audioCtx, onTrackNameChange, onStateChange) {
        this.audioCtx = audioCtx;
        this.onTrackNameChange = onTrackNameChange;
        this.onStateChange = onStateChange;
        this.channels = [];
        this.container = null;
        this.masterGain = null;
        this.masterFaderLevel = 1.0; // Master fader default to unity gain

        // Automation state
        this.isRecording = false;
        this.currentTime = 0;
        this.automationRecorders = [];
        this.automationPlayers = [];
    }

    async init(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) throw new Error('Mixer container not found');

        // Create master gain
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.connect(this.audioCtx.destination);

        // Event delegation
        this.container.addEventListener('click', (e) => {
            const btn = e.target;
            const idx = parseInt(btn.dataset.idx);

            if (isNaN(idx)) return;

            if (btn.classList.contains('mute-btn')) {
                this.toggleMute(idx, btn);
            } else if (btn.classList.contains('solo-btn')) {
                this.toggleSolo(idx, btn);
            } else if (btn.classList.contains('arm-btn')) {
                this.toggleArm(idx);
            } else if (btn.classList.contains('clear-auto-btn')) {
                this.clearAutomation(idx);
            }
        });

        this.container.addEventListener('input', (e) => {
            const input = e.target;
            
            // Handle master fader
            if (input.classList.contains('master-fader')) {
                const val = parseFloat(input.value);
                this.setMasterVolume(val);
                return;
            }
            
            const idx = parseInt(input.dataset.idx);

            if (isNaN(idx)) return;

            if (input.classList.contains('volume-fader')) {
                const val = parseFloat(input.value);
                // If recording and armed, record point
                if (this.isRecording && this.automationRecorders[idx].isRecording) {
                    this.automationRecorders[idx].recordPoint(this.currentTime, val);
                }
                this.setVolume(idx, val);
            } else if (input.classList.contains('pan-knob')) {
                const val = parseFloat(input.value);
                // If recording and armed, record pan point
                if (this.isRecording && this.panAutomationRecorders[idx].isRecording) {
                    this.panAutomationRecorders[idx].recordPoint(this.currentTime, val);
                }
                this.setPan(idx, val);
            }
        });
    }

    buildUI(trackCount, trackNames = []) {
        this.container.innerHTML = '';
        this.channels = [];
        this.automationRecorders = [];
        this.automationPlayers = [];
        this.panAutomationRecorders = [];
        this.panAutomationPlayers = [];
        this.muteAutomationRecorders = [];
        this.muteAutomationPlayers = [];

        // Create Master Fader Strip
        const masterStrip = document.createElement('div');
        masterStrip.className = 'channel-strip master-strip';
        masterStrip.innerHTML = `
            <div class="channel-header">
                <div class="channel-name master-label">MASTER</div>
                <button class="mute-btn master-mute-btn">M</button>
            </div>
            <div class="automation-controls" style="visibility: hidden;">
                <button class="arm-btn" style="opacity: 0;">A</button>
                <button class="clear-auto-btn" style="opacity: 0;">×</button>
            </div>
            <div class="fader-container">
                <div class="meter-scale">
                    <div class="scale-label" data-db="0">0</div>
                    <div class="scale-label" data-db="-20">-20</div>
                    <div class="scale-label" data-db="-40">-40</div>
                    <div class="scale-label" data-db="-60">-60</div>
                </div>
                <canvas class="master-meter-left" width="5" height="100"></canvas>
                <canvas class="master-meter-right" width="5" height="100"></canvas>
                <input type="range" orient="vertical" min="0" max="3.162" step="0.01" value="${this.masterFaderLevel}" class="volume-fader master-fader" tabindex="-1">
            </div>
            <div class="master-db-label">0.0 dB</div>
        `;
        this.container.appendChild(masterStrip);
        
        // Master mute button handler
        this.masterMuted = false;
        const masterMuteBtn = masterStrip.querySelector('.master-mute-btn');
        masterMuteBtn.addEventListener('click', () => {
            this.masterMuted = !this.masterMuted;
            if (this.masterMuted) {
                masterMuteBtn.classList.add('active');
                if (this.masterGain && this.audioCtx) {
                    this.masterGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.005);
                }
            } else {
                masterMuteBtn.classList.remove('active');
                if (this.masterGain && this.audioCtx) {
                    this.masterGain.gain.setTargetAtTime(this.masterFaderLevel, this.audioCtx.currentTime, 0.005);
                }
            }
        });
        
        // Store reference to master meters
        this.masterMeterLeft = masterStrip.querySelector('.master-meter-left');
        this.masterMeterRight = masterStrip.querySelector('.master-meter-right');
        this.masterMeterLevelLeft = 0;
        this.masterMeterLevelRight = 0;
        
        // Create analyser for master output
        if (this.audioCtx && this.masterGain) {
            this.masterAnalyserLeft = this.audioCtx.createAnalyser();
            this.masterAnalyserRight = this.audioCtx.createAnalyser();
            this.masterAnalyserLeft.fftSize = 256;
            this.masterAnalyserRight.fftSize = 256;
            this.masterAnalyserLeft.smoothingTimeConstant = 0.5;
            this.masterAnalyserRight.smoothingTimeConstant = 0.5;
            
            // Split master output to analysers
            this.masterSplitter = this.audioCtx.createChannelSplitter(2);
            this.masterGain.connect(this.masterSplitter);
            this.masterSplitter.connect(this.masterAnalyserLeft, 0);
            this.masterSplitter.connect(this.masterAnalyserRight, 1);
        }
        
        // Prevent master fader from stealing focus
        const masterFader = masterStrip.querySelector('.master-fader');
        masterFader.addEventListener('mousedown', (e) => {
            e.preventDefault();
            // Still allow the fader to work, just don't take focus
            const updateValue = (event) => {
                const rect = masterFader.getBoundingClientRect();
                const y = Math.max(0, Math.min(rect.height, rect.bottom - event.clientY));
                const percent = y / rect.height;
                const min = parseFloat(masterFader.min);
                const max = parseFloat(masterFader.max);
                const value = min + (percent * (max - min));
                masterFader.value = value;
                this.setMasterVolume(value);
            };
            
            updateValue(e);
            
            const onMouseMove = (event) => updateValue(event);
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // Create channels
        for (let i = 0; i < trackCount; i++) {
            // Initialize automation for volume, pan, and mute
            this.automationRecorders[i] = new AutomationRecorder(i, 'volume');
            this.automationPlayers[i] = new AutomationPlayer([]);
            this.panAutomationRecorders[i] = new AutomationRecorder(i, 'pan');
            this.panAutomationPlayers[i] = new AutomationPlayer([]);
            this.muteAutomationRecorders[i] = new AutomationRecorder(i, 'mute');
            this.muteAutomationPlayers[i] = new AutomationPlayer([]);

            const trackName = (trackNames && trackNames[i]) ? trackNames[i] : `Ch ${i + 1}`;

            const strip = document.createElement('div');
            strip.className = 'channel-strip';
            strip.innerHTML = `
                <div class="channel-header">
                    <div class="channel-name" contenteditable="true">${trackName}</div>
                    <button class="mute-btn" data-idx="${i}">M</button>
                    <button class="solo-btn" data-idx="${i}">S</button>
                </div>
                <div class="automation-controls">
                    <button class="arm-btn" data-idx="${i}" title="Arm for automation recording">A</button>
                    <button class="clear-auto-btn" data-idx="${i}" title="Clear automation">×</button>
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
                <input type="range" min="-1" max="1" step="0.1" value="${i % 2 === 0 ? -1 : 1}" data-idx="${i}" class="pan-knob" title="Pan">
            `;

            this.container.appendChild(strip);

            // Attach name edit listener
            const nameDiv = strip.querySelector('.channel-name');
            nameDiv.addEventListener('blur', (e) => {
                if (this.onTrackNameChange) {
                    this.onTrackNameChange(i, e.target.textContent);
                }
            });
            nameDiv.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                }
            });

            // Create Audio Nodes
            let gainNode = null;
            let panNode = null;
            let analyserNode = null;

            if (this.audioCtx) {
                gainNode = this.audioCtx.createGain();
                panNode = this.audioCtx.createStereoPanner();
                panNode.pan.value = i % 2 === 0 ? -1 : 1;
                analyserNode = this.audioCtx.createAnalyser();
                analyserNode.fftSize = 256;
                analyserNode.smoothingTimeConstant = 0.5;

                // Chain: Input -> Gain -> Analyser -> Pan -> Master Gain
                gainNode.connect(analyserNode);
                analyserNode.connect(panNode);
                panNode.connect(this.masterGain);
            }

            // Store channel refs
            this.channels.push({
                index: i,
                element: strip,
                gainNode: gainNode,
                panNode: panNode,
                analyserNode: analyserNode,
                volume: 1,
                isMuted: false,
                isSoloed: false,
                canvas: strip.querySelector('.vu-meter'),
                meterLevel: 0,
                automation: { volume: [], pan: [] }
            });
        }


    }

    toggleArm(idx) {
        const recorder = this.automationRecorders[idx];
        const btn = this.container.querySelector(`.arm-btn[data-idx="${idx}"]`);

        // We use a custom property on the recorder to track "Armed" state
        // The recorder.isRecording property tracks actual recording (during playback)
        if (recorder.isArmed) {
            // Disarm
            recorder.isArmed = false;
            btn.classList.remove('active');

            // If currently recording, stop this track
            if (this.isRecording) {
                const points = recorder.stop();
                if (points.length > 0) {
                    this.channels[idx].automation.volume = points;
                    this.automationPlayers[idx].points = points;
                    this.updateAutomationUI(idx);
                }
            }
        } else {
            // Arm
            recorder.isArmed = true;
            btn.classList.add('active');

            // If currently recording, start this track
            if (this.isRecording) {
                recorder.start(this.currentTime);
                recorder.recordPoint(this.currentTime, this.channels[idx].volume);
            }
        }
    }

    clearAutomation(idx) {
        if (confirm(`Clear automation for Channel ${idx + 1}?`)) {
            this.channels[idx].automation.volume = [];
            this.automationPlayers[idx].clear();
            this.updateAutomationUI(idx);
        }
    }

    updateAutomationUI(idx) {
        const fader = this.container.querySelector(`.volume-fader[data-idx="${idx}"]`);
        const hasAuto = this.channels[idx].automation.volume.length > 0;
        if (hasAuto) {
            fader.classList.add('has-automation');
        } else {
            fader.classList.remove('has-automation');
        }

        const clearBtn = this.container.querySelector(`.clear-auto-btn[data-idx="${idx}"]`);
        if (clearBtn) clearBtn.disabled = !hasAuto;
    }

    startRecording(startTime) {
        this.isRecording = true;
        this.currentTime = startTime;

        this.automationRecorders.forEach((recorder, idx) => {
            if (recorder.isArmed) {
                recorder.start(startTime);
                recorder.recordPoint(startTime, this.channels[idx].volume);
                // Also start pan and mute recording
                this.panAutomationRecorders[idx].start(startTime);
                this.panAutomationRecorders[idx].recordPoint(startTime, this.channels[idx].panNode ? this.channels[idx].panNode.pan.value : 0);
                this.muteAutomationRecorders[idx].start(startTime);
                this.muteAutomationRecorders[idx].recordPoint(startTime, this.channels[idx].isMuted ? 1 : 0);
            }
        });
    }

    stopRecording() {
        this.isRecording = false;

        this.automationRecorders.forEach((recorder, idx) => {
            if (recorder.isArmed) {
                const volumePoints = recorder.stop();
                if (volumePoints.length > 0) {
                    this.channels[idx].automation.volume = volumePoints;
                    this.automationPlayers[idx].points = volumePoints;
                }

                // Stop and save pan automation
                const panPoints = this.panAutomationRecorders[idx].stop();
                if (panPoints.length > 0) {
                    this.channels[idx].automation.pan = panPoints;
                    this.panAutomationPlayers[idx].points = panPoints;
                }

                // Stop and save mute automation
                const mutePoints = this.muteAutomationRecorders[idx].stop();
                if (mutePoints.length > 0) {
                    this.channels[idx].automation.mute = mutePoints;
                    this.muteAutomationPlayers[idx].points = mutePoints;
                }

                this.updateAutomationUI(idx);
            }
        });
    }

    updateAutomation(currentTime) {
        this.currentTime = currentTime;

        this.automationPlayers.forEach((player, idx) => {
            const recorder = this.automationRecorders[idx];

            // Only play back if NOT recording on this channel
            // (If armed and recording, user is controlling fader)
            if (!recorder.isArmed || !this.isRecording) {
                const volumeVal = player.getValue(currentTime);
                if (volumeVal !== null) {
                    this.setVolume(idx, volumeVal, true);
                }

                // Play back pan automation
                const panVal = this.panAutomationPlayers[idx].getValue(currentTime);
                if (panVal !== null) {
                    this.setPan(idx, panVal);
                    // Update pan knob UI
                    const panKnob = this.container.querySelector(`.pan-knob[data-idx="${idx}"]`);
                    if (panKnob && Math.abs(panKnob.value - panVal) > 0.01) {
                        panKnob.value = panVal;
                    }
                }

                // Play back mute automation
                const muteVal = this.muteAutomationPlayers[idx].getValue(currentTime);
                if (muteVal !== null) {
                    const shouldBeMuted = muteVal > 0.5;
                    if (this.channels[idx].isMuted !== shouldBeMuted) {
                        const muteBtn = this.container.querySelector(`.mute-btn[data-idx="${idx}"]`);
                        if (muteBtn) {
                            this.toggleMute(idx, muteBtn);
                        }
                    }
                }
            }
        });
    }

    setVolume(idx, val, fromAutomation = false) {
        const ch = this.channels[idx];
        ch.volume = val;

        if (ch.gainNode && this.audioCtx) {
            // Smooth transition if from automation to avoid clicks
            const time = fromAutomation ? 0.02 : 0.005;
            ch.gainNode.gain.setTargetAtTime(ch.isMuted ? 0 : val, this.audioCtx.currentTime, time);
        }

        // Update UI if from automation
        if (fromAutomation) {
            const fader = this.container.querySelector(`.volume-fader[data-idx="${idx}"]`);
            // Only update if value changed significantly to avoid DOM thrashing
            if (fader && Math.abs(fader.value - val) > 0.001) {
                fader.value = val;
            }
        }
    }

    setMasterVolume(val) {
        this.masterFaderLevel = val;
        
        if (this.masterGain && this.audioCtx && !this.masterMuted) {
            this.masterGain.gain.setTargetAtTime(val, this.audioCtx.currentTime, 0.005);
        }
        
        // Update dB label
        const dbLabel = this.container.querySelector('.master-db-label');
        if (dbLabel) {
            const db = val > 0 ? (20 * Math.log10(val)).toFixed(1) : '-∞';
            dbLabel.textContent = `${db} dB`;
        }
    }

    setPan(idx, val) {
        const ch = this.channels[idx];
        if (ch.panNode) {
            ch.panNode.pan.value = val;
        }
    }

    toggleMute(index, btn) {
        const ch = this.channels[index];
        ch.isMuted = !ch.isMuted;

        if (ch.isMuted) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        // If recording and armed, record mute state
        if (this.isRecording && this.muteAutomationRecorders[index].isRecording) {
            this.muteAutomationRecorders[index].recordPoint(this.currentTime, ch.isMuted ? 1 : 0);
        }

        this.updateGains();
        if (this.onStateChange) this.onStateChange();
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
        if (this.onStateChange) this.onStateChange();
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

            if (ch.gainNode && this.audioCtx) {
                ch.gainNode.gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.02);
            }
        });
    }

    updateMeters() {
        if (!this.channels.length) return;

        const attackCoef = 1.0;
        const decayCoef = 0.08;

        this.channels.forEach(ch => {
            const canvas = ch.canvas;
            if (!canvas || !ch.analyserNode) return;

            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;

            const dataArray = new Float32Array(ch.analyserNode.fftSize);
            ch.analyserNode.getFloatTimeDomainData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / dataArray.length);
            const db = 20 * Math.log10(Math.max(rms, 0.00001));

            let targetPercent = (db + 60) / 60;
            targetPercent = Math.max(0, Math.min(1, targetPercent));

            if (targetPercent > ch.meterLevel) {
                ch.meterLevel += (targetPercent - ch.meterLevel) * attackCoef;
            } else {
                ch.meterLevel += (targetPercent - ch.meterLevel) * decayCoef;
            }

            ch.meterLevel = Math.max(0, Math.min(1, ch.meterLevel));

            ctx.clearRect(0, 0, width, height);

            const gradient = ctx.createLinearGradient(0, height, 0, 0);
            gradient.addColorStop(0, '#00ff00');
            gradient.addColorStop(0.66, '#00ff00');
            gradient.addColorStop(0.66, '#ffff00');
            gradient.addColorStop(0.80, '#ffff00');
            gradient.addColorStop(0.80, '#ff9900');
            gradient.addColorStop(0.98, '#ff9900');
            gradient.addColorStop(0.98, '#ff0000');
            gradient.addColorStop(1, '#ff0000');

            ctx.fillStyle = gradient;
            const barHeight = ch.meterLevel * height;
            ctx.fillRect(0, height - barHeight, width, barHeight);
        });
        
        // Update master meters
        if (this.masterMeterLeft && this.masterMeterRight && this.masterAnalyserLeft && this.masterAnalyserRight) {
            const renderMasterMeter = (canvas, analyser, meterLevel) => {
                const ctx = canvas.getContext('2d');
                const width = canvas.width;
                const height = canvas.height;

                const dataArray = new Float32Array(analyser.fftSize);
                analyser.getFloatTimeDomainData(dataArray);

                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i] * dataArray[i];
                }
                const rms = Math.sqrt(sum / dataArray.length);
                const db = 20 * Math.log10(Math.max(rms, 0.00001));

                let targetPercent = (db + 60) / 60;
                targetPercent = Math.max(0, Math.min(1, targetPercent));

                if (targetPercent > meterLevel) {
                    meterLevel += (targetPercent - meterLevel) * attackCoef;
                } else {
                    meterLevel += (targetPercent - meterLevel) * decayCoef;
                }

                meterLevel = Math.max(0, Math.min(1, meterLevel));

                ctx.clearRect(0, 0, width, height);

                const gradient = ctx.createLinearGradient(0, height, 0, 0);
                gradient.addColorStop(0, '#00ff00');
                gradient.addColorStop(0.66, '#00ff00');
                gradient.addColorStop(0.66, '#ffff00');
                gradient.addColorStop(0.80, '#ffff00');
                gradient.addColorStop(0.80, '#ff9900');
                gradient.addColorStop(0.98, '#ff9900');
                gradient.addColorStop(0.98, '#ff0000');
                gradient.addColorStop(1, '#ff0000');

                ctx.fillStyle = gradient;
                const barHeight = meterLevel * height;
                ctx.fillRect(0, height - barHeight, width, barHeight);
                
                return meterLevel;
            };
            
            this.masterMeterLevelLeft = renderMasterMeter(this.masterMeterLeft, this.masterAnalyserLeft, this.masterMeterLevelLeft);
            this.masterMeterLevelRight = renderMasterMeter(this.masterMeterRight, this.masterAnalyserRight, this.masterMeterLevelRight);
        }
    }

    getMixerState() {
        return this.channels.map(ch => ({
            volume: ch.volume,
            pan: ch.panNode ? ch.panNode.pan.value : 0,
            isMuted: ch.isMuted,
            isSoloed: ch.isSoloed,
            automation: ch.automation // Save automation data
        }));
    }

    setMixerState(state) {
        state.forEach((chState, index) => {
            if (index >= this.channels.length) return;

            const ch = this.channels[index];

            // Set volume
            ch.volume = chState.volume;
            const fader = this.container.querySelector(`.volume-fader[data-idx="${index}"]`);
            if (fader) fader.value = chState.volume;

            // Set pan
            if (ch.panNode) {
                ch.panNode.pan.value = chState.pan;
            }
            const panKnob = this.container.querySelector(`.pan-knob[data-idx="${index}"]`);
            if (panKnob) panKnob.value = chState.pan;

            // Set mute
            ch.isMuted = chState.isMuted;
            const muteBtn = this.container.querySelector(`.mute-btn[data-idx="${index}"]`);
            if (muteBtn) {
                if (chState.isMuted) {
                    muteBtn.classList.add('active');
                } else {
                    muteBtn.classList.remove('active');
                }
            }

            // Set solo
            ch.isSoloed = chState.isSoloed;
            const soloBtn = this.container.querySelector(`.solo-btn[data-idx="${index}"]`);
            if (soloBtn) {
                if (chState.isSoloed) {
                    soloBtn.classList.add('active');
                } else {
                    soloBtn.classList.remove('active');
                }
            }

            // Set automation
            if (chState.automation) {
                ch.automation = chState.automation;
                if (chState.automation.volume) {
                    this.automationPlayers[index].points = chState.automation.volume;
                }
                this.updateAutomationUI(index);
            }
        });

        this.updateGains();
        if (this.onStateChange) this.onStateChange();
    }

    getChannelNodes() {
        return this.channels.map(ch => ({
            input: ch.gainNode,
            output: ch.panNode
        }));
    }
}
