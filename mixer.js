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
        this.stereoLinks = {}; // Track stereo link state: { 0: true } means channels 0-1 are linked
        this.stereoLinkModes = {}; // 'stereo', 'ms', or undefined (unlinked)
        this.selectedLinkPair = null; // For modal interaction
        this.msDecoderNodes = {}; // Store MS decoder nodes for each pair

        // Automation state
        this.isRecording = false;
        this.currentTime = 0;
        this.sessionStartTime = 0; // Shared start time for all automation in a recording session
        this.automationRecorders = [];
        this.automationPlayers = [];

        // dB curve mapping points: [slider, dB]
        this.dBCurve = [
            [1.00, 10],
            [0.75, 0],
            [0.50, -10],
            [0.40, -20],
            [0.30, -30],
            [0.20, -40],
            [0.10, -55],
            [0.05, -70],
            [0.02, -80],
            [0.00, -Infinity]
        ];
    }

    sliderToDb(slider) {
        if (slider <= 0) return -Infinity;
        for (let j = 1; j < this.dBCurve.length; ++j) {
            if (slider >= this.dBCurve[j][0]) {
                const [x1, y1] = this.dBCurve[j-1];
                const [x2, y2] = this.dBCurve[j];
                // Linear interpolation in slider domain
                return y1 + (y2 - y1) * (slider - x1) / (x2 - x1);
            }
        }
        return this.dBCurve[this.dBCurve.length-1][1];
    }

    dbToGain(db) {
        if (!isFinite(db)) return 0;
        return Math.pow(10, db / 20);
    }

    sliderToGain(slider) {
        return this.dbToGain(this.sliderToDb(slider));
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
                e.stopPropagation();
            } else if (btn.classList.contains('solo-btn')) {
                this.toggleSolo(idx, btn);
                e.stopPropagation();
            } else if (btn.classList.contains('arm-btn')) {
                this.toggleArm(idx);
                e.stopPropagation();
            } else if (btn.classList.contains('clear-auto-btn')) {
                this.clearAutomation(idx);
                e.stopPropagation();
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
                // Touch-write mode: if armed and touching, record point
                if (this.automationRecorders[idx] && this.automationRecorders[idx].isArmed && this.isTouchingFader[idx]) {
                    if (!this.automationRecorders[idx].isRecording) {
                        // Start recording for this touch - use session start time
                        this.automationRecorders[idx].start(this.sessionStartTime);
                    }
                    this.automationRecorders[idx].recordPoint(this.currentTime, val);
                }
                this.setVolume(idx, val);
            } else if (input.classList.contains('pan-knob')) {
                const val = parseFloat(input.value);
                
                // Set touching state if not already set (input can fire before mousedown)
                if (!this.isTouchingPan[idx]) {
                    this.isTouchingPan[idx] = true;
                }
                
                // Touch-write mode: if armed and touching, record point
                if (this.panAutomationRecorders[idx] && this.panAutomationRecorders[idx].isArmed && this.isTouchingPan[idx]) {
                    if (!this.panAutomationRecorders[idx].isRecording) {
                        // Start recording for this touch - use session start time
                        this.panAutomationRecorders[idx].start(this.sessionStartTime);
                    }
                    this.panAutomationRecorders[idx].recordPoint(this.currentTime, val);
                }
                this.setPan(idx, val);
            }
        });
        
        // Track mouse/touch events on faders and pan knobs for touch-write automation
        this.container.addEventListener('mousedown', (e) => {
            const input = e.target;
            const idx = parseInt(input.dataset.idx);
            if (isNaN(idx)) return;
            
            if (input.classList.contains('volume-fader')) {
                this.isTouchingFader[idx] = true;
            } else if (input.classList.contains('pan-knob')) {
                this.isTouchingPan[idx] = true;
            }
        });
        
        // Double-click volume fader to set to 0.0 dB
        this.container.addEventListener('dblclick', (e) => {
            const input = e.target;
            
            if (input.classList.contains('volume-fader')) {
                const idx = parseInt(input.dataset.idx);
                if (isNaN(idx)) return;
                
                input.value = 0.75; // 0.75 slider value = 0.0 dB
                this.setVolume(idx, 0.75);
                
                // Update gain box display
                const gainBox = this.container.querySelector(`.channel-gain-box[data-idx="${idx}"]`);
                if (gainBox) {
                    gainBox.textContent = '0.0 dB';
                }
                
                // Trigger automation recording if armed
                if (this.automationRecorders[idx] && this.automationRecorders[idx].isArmed && this.isRecording) {
                    if (!this.automationRecorders[idx].isRecording) {
                        this.automationRecorders[idx].start(this.sessionStartTime);
                    }
                    this.automationRecorders[idx].recordPoint(this.currentTime, 0.75);
                }
                return;
            }
            
            // Double-click master fader to set to 0.0 dB
            if (input.classList.contains('master-fader')) {
                input.value = 0.75; // 0.75 slider value = 0.0 dB
                this.setMasterVolume(0.75);
                return;
            }
            
            if (input.classList.contains('pan-knob')) {
                const idx = parseInt(input.dataset.idx);
                if (isNaN(idx)) return;
                
                input.value = 0;
                this.setPan(idx, 0);
                
                // Trigger automation recording if armed
                if (this.panAutomationRecorders[idx] && this.panAutomationRecorders[idx].isArmed && this.isRecording) {
                    if (!this.panAutomationRecorders[idx].isRecording) {
                        this.panAutomationRecorders[idx].start(this.sessionStartTime);
                    }
                    this.panAutomationRecorders[idx].recordPoint(this.currentTime, 0);
                }
            }
        });
        
        this.container.addEventListener('mouseup', (e) => {
            const input = e.target;
            const idx = parseInt(input.dataset.idx);
            if (isNaN(idx) || idx >= this.channels.length) return;
            
            if (input.classList.contains('volume-fader')) {
                this.handleFaderRelease(idx);
            } else if (input.classList.contains('pan-knob')) {
                this.handlePanRelease(idx);
            }
        });
        
        // Also handle mouse leaving while dragging
        document.addEventListener('mouseup', () => {
            // Release all touched controls
            this.isTouchingFader.forEach((touching, idx) => {
                if (touching) this.handleFaderRelease(idx);
            });
            this.isTouchingPan.forEach((touching, idx) => {
                if (touching) this.handlePanRelease(idx);
            });
        });
    }

    buildUI(trackCount, trackNames = []) {
        if (!this.container) {
            console.error('Mixer container not initialized. Call init() first.');
            return;
        }
        this.container.innerHTML = '';
        this.channels = [];
        this.automationRecorders = [];
        this.automationPlayers = [];
        this.panAutomationRecorders = [];
        this.panAutomationPlayers = [];
        this.muteAutomationRecorders = [];
        this.muteAutomationPlayers = [];
        this.isTouchingFader = [];
        this.isTouchingPan = [];

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
                <input type="range" orient="vertical" min="0" max="1" step="0.001" value="0.75" class="volume-fader master-fader" tabindex="-1">
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
        
        // Double-click master fader to reset to 0 dB
        masterFader.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            masterFader.value = 0.75;
            this.setMasterVolume(0.75);
        });
        
        masterFader.addEventListener('mousedown', (e) => {
            // Don't preventDefault - we need to allow dblclick events to register
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

        // Click master dB label to edit via typing
        const masterDbLabel = masterStrip.querySelector('.master-db-label');
        if (masterDbLabel) {
            masterDbLabel.addEventListener('click', () => {
                const currentDb = this.sliderToDb(parseFloat(masterFader.value));
                const currentValue = isFinite(currentDb) ? currentDb.toFixed(1) : '-∞';
                
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentValue;
                input.style.width = '100%';
                input.style.textAlign = 'center';
                input.style.padding = '2px';
                input.style.fontSize = '0.7rem';
                input.style.border = '1px solid var(--accent-primary)';
                input.style.background = 'var(--bg-panel)';
                input.style.color = 'var(--text-main)';
                
                masterDbLabel.textContent = '';
                masterDbLabel.appendChild(input);
                input.focus();
                input.select();
                
                const finishEdit = () => {
                    const dbValue = parseFloat(input.value);
                    if (!isNaN(dbValue)) {
                        // Find slider value that corresponds to this dB
                        let sliderVal = 0.75; // default
                        
                        // Use inverse interpolation to find slider value
                        for (let j = 1; j < this.dBCurve.length; ++j) {
                            const [x1, y1] = this.dBCurve[j-1];
                            const [x2, y2] = this.dBCurve[j];
                            if (dbValue >= y2 && dbValue <= y1) {
                                // Interpolate slider value
                                sliderVal = x1 + (x2 - x1) * (dbValue - y1) / (y2 - y1);
                                break;
                            }
                        }
                        
                        sliderVal = Math.max(0, Math.min(1, sliderVal));
                        masterFader.value = sliderVal;
                        this.setMasterVolume(sliderVal);
                    } else {
                        const db = this.sliderToDb(parseFloat(masterFader.value));
                        masterDbLabel.textContent = isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
                    }
                };
                
                input.addEventListener('blur', finishEdit);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        finishEdit();
                    } else if (e.key === 'Escape') {
                        const db = this.sliderToDb(parseFloat(masterFader.value));
                        masterDbLabel.textContent = isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
                    }
                });
            });
        }

        // Create channels
        for (let i = 0; i < trackCount; i++) {
            // Initialize automation for volume, pan, and mute
            this.automationRecorders[i] = new AutomationRecorder(i, 'volume');
            this.automationPlayers[i] = new AutomationPlayer([]);
            this.panAutomationRecorders[i] = new AutomationRecorder(i, 'pan');
            this.panAutomationPlayers[i] = new AutomationPlayer([]);
            this.muteAutomationRecorders[i] = new AutomationRecorder(i, 'mute');
            this.muteAutomationPlayers[i] = new AutomationPlayer([], 'step'); // Use step interpolation for mute
            this.isTouchingFader[i] = false;
            this.isTouchingPan[i] = false;

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
                    <input type="range" orient="vertical" min="0" max="1" step="0.001" value="0.75" data-idx="${i}" class="volume-fader">
                </div>
                <div class="channel-gain-box" data-idx="${i}">0.0 dB</div>
                <div class="pan-container">
                    <div class="pan-value-box" data-idx="${i}">${i % 2 === 0 ? 'L50' : 'R50'}</div>
                    <input type="range" min="-1" max="1" step="0.1" value="${i % 2 === 0 ? -1 : 1}" data-idx="${i}" class="pan-knob" title="Pan">
                </div>
            `;

            this.container.appendChild(strip);

            // Add stereo link icon after odd-numbered channels (channels 0, 2, 4, 6...)
            if (i % 2 === 0 && i + 1 < trackCount) {
                const linkIcon = document.createElement('div');
                linkIcon.className = 'stereo-link-icon';
                linkIcon.dataset.pairIndex = i;
                linkIcon.innerHTML = '🔗';
                linkIcon.title = `Link channels ${i + 1}-${i + 2} for stereo`;
                
                linkIcon.addEventListener('click', () => {
                    this.openStereoLinkModal(i);
                });
                
                const modeLabel = document.createElement('div');
                modeLabel.className = 'stereo-link-mode-label';
                modeLabel.dataset.pairIndex = i;
                linkIcon.appendChild(modeLabel);
                
                this.container.appendChild(linkIcon);
            }

            // Attach name edit listener
            // Professional dB curve mapping for fader
            const gainBox = strip.querySelector('.channel-gain-box');
            const fader = strip.querySelector('.volume-fader');
            // dB curve mapping points: [slider, dB]
            const dBCurve = [
                [1.00, 10],
                [0.75, 0],
                [0.50, -10],
                [0.40, -20],
                [0.30, -30],
                [0.20, -40],
                [0.10, -55],
                [0.05, -70],
                [0.02, -80],
                [0.00, -Infinity]
            ];
            // Update gain box and gain node
            const updateGainBoxAndNode = (sliderVal) => {
                const db = this.sliderToDb(sliderVal);
                gainBox.textContent = isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
                if (this.channels[i] && this.channels[i].gainNode) {
                    this.channels[i].gainNode.gain.value = this.sliderToGain(sliderVal);
                }
            };
            fader.addEventListener('input', (e) => {
                const sliderVal = parseFloat(e.target.value);
                updateGainBoxAndNode(sliderVal);
                
                // Sync even channel if this is a linked odd channel
                if (i % 2 === 0 && this.stereoLinks[i]) {
                    const evenChannelIndex = i + 1;
                    const evenFader = this.container.querySelector(`.volume-fader[data-idx="${evenChannelIndex}"]`);
                    const evenGainBox = this.container.querySelector(`.channel-gain-box[data-idx="${evenChannelIndex}"]`);
                    
                    if (evenFader) {
                        evenFader.value = sliderVal;
                        const db = this.sliderToDb(sliderVal);
                        if (evenGainBox) {
                            evenGainBox.textContent = isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
                        }
                        if (this.channels[evenChannelIndex] && this.channels[evenChannelIndex].gainNode) {
                            this.channels[evenChannelIndex].gainNode.gain.value = this.sliderToGain(sliderVal);
                        }
                    }
                }
            });
            // Initialize gain box and node
            updateGainBoxAndNode(parseFloat(fader.value));
            
            // Click gain box to edit via typing
            gainBox.addEventListener('click', () => {
                const currentDb = this.sliderToDb(parseFloat(fader.value));
                const currentValue = isFinite(currentDb) ? currentDb.toFixed(1) : '-∞';
                
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentValue;
                input.style.width = '100%';
                input.style.textAlign = 'center';
                input.style.padding = '2px';
                input.style.fontSize = '0.7rem';
                input.style.border = '1px solid var(--accent-primary)';
                input.style.background = 'var(--bg-panel)';
                input.style.color = 'var(--text-main)';
                
                gainBox.textContent = '';
                gainBox.appendChild(input);
                input.focus();
                input.select();
                
                const finishEdit = () => {
                    const dbValue = parseFloat(input.value);
                    if (!isNaN(dbValue)) {
                        // Find slider value that corresponds to this dB
                        let sliderVal = 0.75; // default
                        
                        // Use inverse interpolation to find slider value
                        for (let j = 1; j < this.dBCurve.length; ++j) {
                            const [x1, y1] = this.dBCurve[j-1];
                            const [x2, y2] = this.dBCurve[j];
                            if (dbValue >= y2 && dbValue <= y1) {
                                // Interpolate slider value
                                sliderVal = x1 + (x2 - x1) * (dbValue - y1) / (y2 - y1);
                                break;
                            }
                        }
                        
                        sliderVal = Math.max(0, Math.min(1, sliderVal));
                        fader.value = sliderVal;
                        updateGainBoxAndNode(sliderVal);
                    } else {
                        updateGainBoxAndNode(parseFloat(fader.value));
                    }
                };
                
                input.addEventListener('blur', finishEdit);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        finishEdit();
                    } else if (e.key === 'Escape') {
                        updateGainBoxAndNode(parseFloat(fader.value));
                    }
                });
            });
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
                automation: { volume: [], pan: [], mute: [] }
            });
        }


    }

    toggleArm(idx) {
        const recorder = this.automationRecorders[idx];
        const panRecorder = this.panAutomationRecorders[idx];
        const muteRecorder = this.muteAutomationRecorders[idx];
        const btn = this.container.querySelector(`.arm-btn[data-idx="${idx}"]`);

        // We use a custom property on the recorder to track "Armed" state
        // The recorder.isRecording property tracks actual recording (during playback)
        if (recorder.isArmed) {
            // Disarm volume, pan, and mute
            recorder.isArmed = false;
            panRecorder.isArmed = false;
            muteRecorder.isArmed = false;
            btn.classList.remove('active');

            // If currently recording, stop this track
            if (this.isRecording) {
                const points = recorder.stop();
                if (points.length > 0) {
                    this.channels[idx].automation.volume = points;
                    this.automationPlayers[idx].points = points;
                    this.updateAutomationUI(idx);
                }
                
                const panPoints = panRecorder.stop();
                if (panPoints.length > 0) {
                    this.channels[idx].automation.pan = panPoints;
                    this.panAutomationPlayers[idx].points = panPoints;
                }
                
                const mutePoints = muteRecorder.stop();
                console.log(`[Mute] Stopped mute recorder for channel ${idx}, points:`, mutePoints.length);
                if (mutePoints.length > 0) {
                    this.channels[idx].automation.mute = mutePoints;
                    this.muteAutomationPlayers[idx].points = mutePoints;
                    console.log(`[Mute] Saved ${mutePoints.length} mute automation points for channel ${idx}`);
                }
            }
        } else {
            // Arm volume, pan, and mute
            recorder.isArmed = true;
            panRecorder.isArmed = true;
            muteRecorder.isArmed = true;
            btn.classList.add('active');

            // If currently recording, start this track
            if (this.isRecording) {
                recorder.start(this.sessionStartTime);
                recorder.recordPoint(this.currentTime, this.channels[idx].volume);
                
                panRecorder.start(this.sessionStartTime);
                const panValue = this.channels[idx].panNode ? this.channels[idx].panNode.pan.value : 0;
                panRecorder.recordPoint(this.currentTime, panValue);
                
                muteRecorder.start(this.sessionStartTime);
                muteRecorder.recordPoint(this.currentTime, this.channels[idx].isMuted ? 1 : 0);
            }
        }
        
        // Update the arm all button state after individual arm/disarm
        this.updateArmAllButtonState();
    }

    clearAutomation(idx) {
        if (confirm(`Clear automation for Channel ${idx + 1}?`)) {
            // Clear volume, pan, and mute automation
            this.channels[idx].automation.volume = [];
            this.channels[idx].automation.pan = [];
            this.channels[idx].automation.mute = [];
            this.automationPlayers[idx].clear();
            this.panAutomationPlayers[idx].clear();
            this.muteAutomationPlayers[idx].clear();
            this.updateAutomationUI(idx);
        }
    }

    clearAllAutomation() {
        if (confirm(`Clear all automation on all ${this.channels.length} channels?`)) {
            for (let i = 0; i < this.channels.length; i++) {
                // Clear volume, pan, and mute automation
                this.channels[i].automation.volume = [];
                this.channels[i].automation.pan = [];
                this.channels[i].automation.mute = [];
                this.automationPlayers[i].clear();
                this.panAutomationPlayers[i].clear();
                this.muteAutomationPlayers[i].clear();
                this.updateAutomationUI(i);
            }
            console.log('Cleared all automation on all channels');
        }
    }

    toggleArmAll() {
        // Check if any channel is armed
        const anyArmed = this.automationRecorders.some(recorder => recorder.isArmed);
        
        // If any are armed, disarm all. Otherwise, arm all.
        const shouldArm = !anyArmed;
        
        for (let i = 0; i < this.channels.length; i++) {
            const recorder = this.automationRecorders[i];
            const panRecorder = this.panAutomationRecorders[i];
            const muteRecorder = this.muteAutomationRecorders[i];
            const btn = this.container.querySelector(`.arm-btn[data-idx="${i}"]`);
            
            if (shouldArm) {
                // Arm all
                if (!recorder.isArmed) {
                    recorder.isArmed = true;
                    panRecorder.isArmed = true;
                    muteRecorder.isArmed = true;
                    btn.classList.add('active');
                    
                    // If currently recording, start this track
                    if (this.isRecording) {
                        recorder.start(this.sessionStartTime);
                        recorder.recordPoint(this.currentTime, this.channels[i].volume);
                        
                        panRecorder.start(this.sessionStartTime);
                        const panValue = this.channels[i].panNode ? this.channels[i].panNode.pan.value : 0;
                        panRecorder.recordPoint(this.currentTime, panValue);
                        
                        muteRecorder.start(this.sessionStartTime);
                        muteRecorder.recordPoint(this.currentTime, this.channels[i].isMuted ? 1 : 0);
                    }
                }
            } else {
                // Disarm all
                if (recorder.isArmed) {
                    recorder.isArmed = false;
                    panRecorder.isArmed = false;
                    muteRecorder.isArmed = false;
                    btn.classList.remove('active');
                    
                    // If currently recording, stop this track
                    if (this.isRecording) {
                        const points = recorder.stop();
                        if (points.length > 0) {
                            this.channels[i].automation.volume = points;
                            this.automationPlayers[i].points = points;
                            this.updateAutomationUI(i);
                        }
                        
                        const panPoints = panRecorder.stop();
                        if (panPoints.length > 0) {
                            this.channels[i].automation.pan = panPoints;
                            this.panAutomationPlayers[i].points = panPoints;
                        }
                        
                        const mutePoints = muteRecorder.stop();
                        if (mutePoints.length > 0) {
                            this.channels[i].automation.mute = mutePoints;
                            this.muteAutomationPlayers[i].points = mutePoints;
                        }
                    }
                }
            }
        }
        
        // Update the button text
        this.updateArmAllButtonState();
        
        console.log(shouldArm ? 'Armed all channels' : 'Disarmed all channels');
    }

    updateArmAllButtonState() {
        const btn = document.getElementById('arm-all-btn');
        if (!btn) return;
        
        const anyArmed = this.automationRecorders.some(recorder => recorder.isArmed);
        btn.textContent = anyArmed ? 'Disarm All' : 'Arm All';
        btn.classList.toggle('active', anyArmed);
    }

    toggleMuteAll() {
        // Check if any channel is muted
        const anyMuted = this.channels.some(ch => ch.isMuted);
        
        // If any are muted, unmute all. Otherwise, mute all.
        const shouldMute = !anyMuted;
        
        for (let i = 0; i < this.channels.length; i++) {
            const ch = this.channels[i];
            const btn = this.container.querySelector(`.mute-btn[data-idx="${i}"]`);
            
            if (ch.isMuted !== shouldMute) {
                // Toggle this channel's mute state
                this.toggleMute(i, btn);
            }
        }
        
        // Update button text
        this.updateMuteAllButtonState();
        
        console.log(shouldMute ? 'Muted all channels' : 'Unmuted all channels');
    }

    updateMuteAllButtonState() {
        const btn = document.getElementById('mute-all-btn');
        if (!btn) return;
        
        const anyMuted = this.channels.some(ch => ch.isMuted);
        btn.textContent = anyMuted ? 'Unmute All' : 'Mute All';
        btn.classList.toggle('active', anyMuted);
    }

    updateAutomationUI(idx) {
        const fader = this.container.querySelector(`.volume-fader[data-idx="${idx}"]`);
        const hasAuto = this.channels[idx].automation.volume.length > 0 || 
                        this.channels[idx].automation.pan.length > 0 || 
                        this.channels[idx].automation.mute.length > 0;
        if (hasAuto) {
            fader.classList.add('has-automation');
        } else {
            fader.classList.remove('has-automation');
        }

        const clearBtn = this.container.querySelector(`.clear-auto-btn[data-idx="${idx}"]`);
        if (clearBtn) clearBtn.disabled = !hasAuto;
    }

    startRecording(startTime) {
        // Touch-write automation mode: Recording happens automatically when
        // armed controls are touched during playback.
        this.isRecording = true;
        this.currentTime = startTime;
        this.sessionStartTime = startTime; // Set session start time for all automation
        
        // Record initial state for all armed channels at the start time
        // Only if they haven't already recorded points (to preserve existing automation)
        if (!this.channels || !this.automationRecorders) return; // Safety check
        
        for (let i = 0; i < this.channels.length; i++) {
            // Volume automation - only record initial state if no points exist yet
            if (this.automationRecorders[i] && this.automationRecorders[i].isArmed && !this.automationRecorders[i].isRecording && this.automationRecorders[i].points.length === 0) {
                this.automationRecorders[i].start(startTime);
                this.automationRecorders[i].recordPoint(startTime, this.channels[i].volume);
            }
            
            // Pan automation - only record initial state if no points exist yet
            if (this.panAutomationRecorders[i] && this.panAutomationRecorders[i].isArmed && !this.panAutomationRecorders[i].isRecording && this.panAutomationRecorders[i].points.length === 0) {
                this.panAutomationRecorders[i].start(startTime);
                const panValue = this.channels[i].panNode ? this.channels[i].panNode.pan.value : 0;
                this.panAutomationRecorders[i].recordPoint(startTime, panValue);
            }
            
            // Mute automation - only record initial state if no points exist yet
            if (this.muteAutomationRecorders[i] && this.muteAutomationRecorders[i].isArmed && !this.muteAutomationRecorders[i].isRecording && this.muteAutomationRecorders[i].points.length === 0) {
                this.muteAutomationRecorders[i].start(startTime);
                this.muteAutomationRecorders[i].recordPoint(startTime, this.channels[i].isMuted ? 1 : 0);
                console.log(`[Mute] Recording initial state for channel ${i} at time ${startTime}: ${this.channels[i].isMuted ? 1 : 0}`);
            }
        }
    }

    stopRecording() {
        // Touch-write automation mode: Recording stops automatically when
        // controls are released. This method is called when playback stops.
        // Save all armed recorders' points to players for playback.
        this.isRecording = false;
        
        for (let i = 0; i < this.channels.length; i++) {
            // Volume automation
            if (this.automationRecorders[i].isArmed && this.automationRecorders[i].isRecording) {
                const points = this.automationRecorders[i].stop();
                if (points.length > 0) {
                    this.channels[i].automation.volume = points;
                    this.automationPlayers[i].points = points;
                    this.updateAutomationUI(i);
                }
            }
            
            // Pan automation
            if (this.panAutomationRecorders[i].isArmed && this.panAutomationRecorders[i].isRecording) {
                const points = this.panAutomationRecorders[i].stop();
                if (points.length > 0) {
                    this.channels[i].automation.pan = points;
                    this.panAutomationPlayers[i].points = points;
                }
            }
            
            // Mute automation
            if (this.muteAutomationRecorders[i].isArmed && this.muteAutomationRecorders[i].isRecording) {
                const points = this.muteAutomationRecorders[i].stop();
                console.log(`[Mute] Stopped recording for channel ${i}, points:`, points.length);
                if (points.length > 0) {
                    this.channels[i].automation.mute = points;
                    this.muteAutomationPlayers[i].points = points;
                    console.log(`[Mute] Saved ${points.length} mute automation points for channel ${i}`);
                }
            }
        }
    }

    updateAutomation(currentTime) {
        this.currentTime = currentTime;

        // Iterate through all channels to update all automation types
        for (let idx = 0; idx < this.channels.length; idx++) {
            // Skip even channels in stereo linked pairs - they follow the odd channel's automation
            const isEvenChannelInLink = (idx % 2 === 1) && this.stereoLinks[idx - 1];
            
            // Volume automation
            const recorder = this.automationRecorders[idx];
            if (!this.isTouchingFader[idx] || !recorder.isArmed) {
                const volumeVal = this.automationPlayers[idx].getValue(currentTime);
                if (volumeVal !== null && isFinite(volumeVal)) {
                    let effectiveVal = volumeVal;
                    
                    // If even channel in stereo link, use odd channel's automation value
                    if (isEvenChannelInLink) {
                        const oddChannelIndex = idx - 1;
                        const oddVolumeVal = this.automationPlayers[oddChannelIndex].getValue(currentTime);
                        if (oddVolumeVal !== null && isFinite(oddVolumeVal)) {
                            effectiveVal = oddVolumeVal;
                        }
                    }
                    
                    this.setVolume(idx, effectiveVal, true);
                    // Update volume fader UI
                    const volumeFader = this.container.querySelector(`.volume-fader[data-idx="${idx}"]`);
                    if (volumeFader && Math.abs(volumeFader.value - effectiveVal) > 0.01) {
                        volumeFader.value = effectiveVal;
                    }
                    // Update gain box display
                    const gainBox = this.container.querySelector(`.channel-gain-box[data-idx="${idx}"]`);
                    if (gainBox) {
                        const db = this.sliderToDb(effectiveVal);
                        gainBox.textContent = isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
                    }
                }
            }

            // Pan automation
            if (!this.isTouchingPan[idx] || (this.panAutomationRecorders[idx] && !this.panAutomationRecorders[idx].isArmed)) {
                const panVal = this.panAutomationPlayers[idx].getValue(currentTime);
                if (panVal !== null && isFinite(panVal)) {
                    this.setPan(idx, panVal);
                    // Update pan knob UI
                    const panKnob = this.container.querySelector(`.pan-knob[data-idx="${idx}"]`);
                    if (panKnob && Math.abs(panKnob.value - panVal) > 0.01) {
                        panKnob.value = panVal;
                    }
                }
            }

            // Mute automation always plays back (no touch override for mute)
            const muteVal = this.muteAutomationPlayers[idx].getValue(currentTime);
            if (muteVal !== null) {
                const shouldBeMuted = muteVal > 0.5;
                if (this.channels[idx].isMuted !== shouldBeMuted) {
                    console.log(`[Mute Playback] Channel ${idx} at time ${currentTime.toFixed(2)}: muteVal=${muteVal}, shouldBeMuted=${shouldBeMuted}, interpolationMode=${this.muteAutomationPlayers[idx].interpolationMode}, points:`, this.muteAutomationPlayers[idx].points);
                    // Directly set mute state (don't toggle)
                    this.channels[idx].isMuted = shouldBeMuted;
                    const muteBtn = this.container.querySelector(`.mute-btn[data-idx="${idx}"]`);
                    if (muteBtn) {
                        if (shouldBeMuted) {
                            muteBtn.classList.add('active');
                        } else {
                            muteBtn.classList.remove('active');
                        }
                    }
                    this.updateGains();
                    // Don't call onStateChange for automation mute - muting doesn't affect waveform visibility
                }
            }
        }
    }

    handleFaderRelease(idx) {
        if (!this.isTouchingFader[idx]) return;
        this.isTouchingFader[idx] = false;
        
        // If armed and was recording during touch, stop and save automation
        if (this.automationRecorders[idx] && this.automationRecorders[idx].isArmed && this.automationRecorders[idx].isRecording) {
            const points = this.automationRecorders[idx].stop();
            if (points.length > 0) {
                this.channels[idx].automation.volume = points;
                this.automationPlayers[idx].points = points;
                this.updateAutomationUI(idx);
            }
        }
    }

    handlePanRelease(idx) {
        if (!this.isTouchingPan[idx]) return;
        this.isTouchingPan[idx] = false;
        
        // If armed and was recording during touch, stop and save automation
        if (this.panAutomationRecorders[idx] && this.panAutomationRecorders[idx].isArmed && this.panAutomationRecorders[idx].isRecording) {
            const points = this.panAutomationRecorders[idx].stop();
            if (points.length > 0) {
                this.channels[idx].automation.pan = points;
                this.panAutomationPlayers[idx].points = points;
            }
        }
    }

    setVolume(idx, val, fromAutomation = false) {
        const ch = this.channels[idx];
        if (!ch || !isFinite(val)) {
            if (!isFinite(val)) console.warn(`setVolume: non-finite value ${val} for channel ${idx}`);
            return;
        }
        // Use the same dB curve as the fader UI
        ch.volume = val;
        if (ch.gainNode && this.audioCtx) {
            const dBCurve = [
                [1.00, 10],
                [0.75, 0],
                [0.50, -10],
                [0.40, -20],
                [0.30, -30],
                [0.20, -40],
                [0.10, -55],
                [0.05, -70],
                [0.02, -80],
                [0.00, -Infinity]
            ];
            function sliderToDb(slider) {
                if (slider <= 0) return -Infinity;
                for (let j = 1; j < dBCurve.length; ++j) {
                    if (slider >= dBCurve[j][0]) {
                        const [x1, y1] = dBCurve[j-1];
                        const [x2, y2] = dBCurve[j];
                        return y1 + (y2 - y1) * (slider - x1) / (x2 - x1);
                    }
                }
                return dBCurve[dBCurve.length-1][1];
            }
            function dbToGain(db) {
                if (!isFinite(db)) return 0;
                return Math.pow(10, db / 20);
            }
            const gainVal = ch.isMuted ? 0 : dbToGain(sliderToDb(val));
            // Smooth transition if from automation to avoid clicks
            const time = fromAutomation ? 0.02 : 0.005;
            ch.gainNode.gain.setTargetAtTime(gainVal, this.audioCtx.currentTime, time);
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
        // Use the same dB curve as the channel faders
        this.masterFaderLevel = val;
        const gainVal = this.dbToGain(this.sliderToDb(val));
        if (this.masterGain && this.audioCtx && !this.masterMuted) {
            this.masterGain.gain.setTargetAtTime(gainVal, this.audioCtx.currentTime, 0.005);
        }
        // Update dB label
        const dbLabel = this.container.querySelector('.master-db-label');
        if (dbLabel) {
            const db = this.sliderToDb(val);
            dbLabel.textContent = isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
        }
    }

    setPan(idx, val) {
        const ch = this.channels[idx];
        
        // Check if this channel is part of an MS linked pair
        const isOddChannelInMSPair = (idx % 2 === 0) && this.stereoLinkModes[idx] === 'ms';
        const isEvenChannelInMSPair = (idx % 2 === 1) && this.stereoLinkModes[idx - 1] === 'ms';
        
        if (isOddChannelInMSPair) {
            // Odd channel in MS mode: pan controls balance
            this.updateMSBalance(idx, val);
            const panValueBox = this.container.querySelector(`.pan-value-box[data-idx="${idx}"]`);
            if (panValueBox) {
                panValueBox.textContent = this.formatPanValue(val);
            }
        } else if (isEvenChannelInMSPair) {
            // Even channel in MS mode: pan controls width (0.0 to 2.0)
            const oddChannelIndex = idx - 1;
            this.updateMSWidth(oddChannelIndex, val);
            const panValueBox = this.container.querySelector(`.pan-value-box[data-idx="${idx}"]`);
            if (panValueBox) {
                // Display width as percentage (0-200)
                const width = (val + 1) * 100; // Maps -1→0, 0→100, 1→200
                panValueBox.textContent = Math.round(width).toString();
            }
        } else {
            // Normal mode: standard stereo panning
            if (ch.panNode) {
                ch.panNode.pan.value = val;
            }
            
            // Update pan display value
            const panValueBox = this.container.querySelector(`.pan-value-box[data-idx="${idx}"]`);
            if (panValueBox) {
                const displayVal = this.formatPanValue(val);
                panValueBox.textContent = displayVal;
            }
        }
    }
    
    formatPanValue(val) {
        // val ranges from -1 (left) to 1 (right)
        const absVal = Math.abs(val);
        if (absVal < 0.05) {
            return 'C'; // Center
        } else if (val < 0) {
            return `L${Math.round(Math.abs(val) * 100)}`; // Left percentage
        } else {
            return `R${Math.round(val * 100)}`; // Right percentage
        }
    }

    createMSDecoder(oddChannelIndex) {
        // Create MS decoder audio graph for a channel pair
        const evenChannelIndex = oddChannelIndex + 1;
        const oddCh = this.channels[oddChannelIndex];
        const evenCh = this.channels[evenChannelIndex];

        if (!oddCh || !evenCh || !this.audioCtx) return null;

        // Disconnect existing routing
        if (oddCh.analyserNode && oddCh.panNode) {
            oddCh.analyserNode.disconnect();
        }
        if (evenCh.analyserNode && evenCh.panNode) {
            evenCh.analyserNode.disconnect();
        }

        // Create MS decoder nodes
        // M and S signals go through splitters to create L and R
        const mSplitter = this.audioCtx.createChannelSplitter(1);
        const sSplitter = this.audioCtx.createChannelSplitter(1);

        // Gains for MS matrix: L = (M + w·S)/√2, R = (M - w·S)/√2
        const sqrt2 = Math.sqrt(2);
        const mToLGain = this.audioCtx.createGain();
        const mToRGain = this.audioCtx.createGain();
        const sToLGain = this.audioCtx.createGain();
        const sToRGain = this.audioCtx.createGain();

        mToLGain.gain.value = 1 / sqrt2;
        mToRGain.gain.value = 1 / sqrt2;
        sToLGain.gain.value = 1 / sqrt2; // Will be adjusted by width
        sToRGain.gain.value = -1 / sqrt2; // Negative for R channel, will be adjusted by width

        // Merger to combine M±S into stereo
        const lMerger = this.audioCtx.createChannelMerger(2);
        const rMerger = this.audioCtx.createChannelMerger(2);
        
        // Final merger to create stereo output
        const stereoMerger = this.audioCtx.createChannelMerger(2);

        // Balance panner (from M channel pan control)
        const balancePanner = this.audioCtx.createStereoPanner();
        balancePanner.pan.value = oddCh.panNode.pan.value;

        // Connect MS matrix:
        // M (odd channel): analyser → splitter → gains → mergers → stereo → balance → master
        oddCh.analyserNode.connect(mSplitter);
        mSplitter.connect(mToLGain, 0);
        mSplitter.connect(mToRGain, 0);

        // S (even channel): analyser → splitter → gains → mergers → stereo → balance → master
        evenCh.analyserNode.connect(sSplitter);
        sSplitter.connect(sToLGain, 0);
        sSplitter.connect(sToRGain, 0);

        // Combine M+S for L channel and M-S for R channel
        mToLGain.connect(lMerger, 0, 0);
        sToLGain.connect(lMerger, 0, 1);
        
        mToRGain.connect(rMerger, 0, 0);
        sToRGain.connect(rMerger, 0, 1);

        // Merge L and R into stereo
        lMerger.connect(stereoMerger, 0, 0);
        rMerger.connect(stereoMerger, 0, 1);

        // Apply balance and route to master
        stereoMerger.connect(balancePanner);
        balancePanner.connect(this.masterGain);

        // Store decoder nodes
        return {
            mSplitter,
            sSplitter,
            mToLGain,
            mToRGain,
            sToLGain,
            sToRGain,
            lMerger,
            rMerger,
            stereoMerger,
            balancePanner
        };
    }

    destroyMSDecoder(oddChannelIndex) {
        // Remove MS decoder and restore normal routing
        const evenChannelIndex = oddChannelIndex + 1;
        const oddCh = this.channels[oddChannelIndex];
        const evenCh = this.channels[evenChannelIndex];
        const decoder = this.msDecoderNodes[oddChannelIndex];

        if (!decoder || !oddCh || !evenCh) return;

        // Disconnect all MS decoder nodes
        try {
            decoder.mSplitter.disconnect();
            decoder.sSplitter.disconnect();
            decoder.mToLGain.disconnect();
            decoder.mToRGain.disconnect();
            decoder.sToLGain.disconnect();
            decoder.sToRGain.disconnect();
            decoder.lMerger.disconnect();
            decoder.rMerger.disconnect();
            decoder.stereoMerger.disconnect();
            decoder.balancePanner.disconnect();
        } catch (e) {
            console.error('Error disconnecting MS decoder:', e);
        }

        // Restore normal routing: analyser → pan → master
        if (oddCh.analyserNode && oddCh.panNode) {
            oddCh.analyserNode.connect(oddCh.panNode);
            oddCh.panNode.connect(this.masterGain);
        }
        if (evenCh.analyserNode && evenCh.panNode) {
            evenCh.analyserNode.connect(evenCh.panNode);
            evenCh.panNode.connect(this.masterGain);
        }

        // Remove from storage
        delete this.msDecoderNodes[oddChannelIndex];
    }

    updateMSWidth(oddChannelIndex, widthPanValue) {
        // Convert pan value (-1 to 1) to width (0 to 2)
        // Pan -1 (fully left) = width 0, Pan 0 (center) = width 1, Pan 1 (fully right) = width 2
        const width = widthPanValue + 1; // Maps -1→0, 0→1, 1→2

        const decoder = this.msDecoderNodes[oddChannelIndex];
        if (!decoder) return;

        const sqrt2 = Math.sqrt(2);
        
        // Update S channel gains with width parameter
        decoder.sToLGain.gain.value = width / sqrt2;
        decoder.sToRGain.gain.value = -width / sqrt2;
    }

    updateMSBalance(oddChannelIndex, balancePanValue) {
        // Update the balance panner from M channel pan control
        const decoder = this.msDecoderNodes[oddChannelIndex];
        if (!decoder) return;

        decoder.balancePanner.pan.value = balancePanValue;
    }

    toggleStereoLink(oddChannelIndex) {
        const evenChannelIndex = oddChannelIndex + 1;
        const linkIcon = this.container.querySelector(`.stereo-link-icon[data-pair-index="${oddChannelIndex}"]`);
        
        if (!linkIcon) return;
        
        if (this.stereoLinks[oddChannelIndex]) {
            // Unlink
            this.stereoLinks[oddChannelIndex] = false;
            delete this.stereoLinkModes[oddChannelIndex];
            linkIcon.classList.remove('linked', 'ms-linked');
        } else {
            // Link - set up stereo pair
            this.stereoLinks[oddChannelIndex] = true;
            this.stereoLinkModes[oddChannelIndex] = 'stereo';
            linkIcon.classList.add('linked');
            
            // Get the current fader value from odd channel
            const oddFader = this.container.querySelector(`.volume-fader[data-idx="${oddChannelIndex}"]`);
            const evenFader = this.container.querySelector(`.volume-fader[data-idx="${evenChannelIndex}"]`);
            
            if (oddFader && evenFader) {
                // Set even channel's gain to match odd channel
                evenFader.value = oddFader.value;
                const db = this.sliderToDb(parseFloat(oddFader.value));
                const gainBox = this.container.querySelector(`.channel-gain-box[data-idx="${evenChannelIndex}"]`);
                if (gainBox) {
                    gainBox.textContent = isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
                }
                if (this.channels[evenChannelIndex] && this.channels[evenChannelIndex].gainNode) {
                    this.channels[evenChannelIndex].gainNode.gain.value = this.sliderToGain(parseFloat(oddFader.value));
                }
            }
            
            // Set odd channel pan to L100 and even channel pan to R100
            this.setPan(oddChannelIndex, -1);
            this.setPan(evenChannelIndex, 1);
            
            // Update pan knobs
            const oddPanKnob = this.container.querySelector(`.pan-knob[data-idx="${oddChannelIndex}"]`);
            const evenPanKnob = this.container.querySelector(`.pan-knob[data-idx="${evenChannelIndex}"]`);
            if (oddPanKnob) oddPanKnob.value = -1;
            if (evenPanKnob) evenPanKnob.value = 1;
        }
    }

    openStereoLinkModal(oddChannelIndex) {
        this.selectedLinkPair = oddChannelIndex;
        const modal = document.getElementById('stereo-link-mode-modal');
        const currentMode = this.stereoLinkModes[oddChannelIndex] || 'unlinked';
        
        // Set the radio button to current mode
        const radios = modal.querySelectorAll('input[name="stereo-link-mode"]');
        radios.forEach(radio => {
            radio.checked = radio.value === currentMode;
        });
        
        modal.classList.add('active');
    }

    applyStereoLinkMode(mode) {
        if (this.selectedLinkPair === null) return;
        
        const oddChannelIndex = this.selectedLinkPair;
        const evenChannelIndex = oddChannelIndex + 1;
        const linkIcon = this.container.querySelector(`.stereo-link-icon[data-pair-index="${oddChannelIndex}"]`);
        const modeLabel = linkIcon ? linkIcon.querySelector('.stereo-link-mode-label') : null;
        
        if (!linkIcon) return;
        
        // Remove all mode classes and clear label
        linkIcon.classList.remove('linked', 'ms-linked');
        if (modeLabel) modeLabel.textContent = '';
        
        if (mode === 'unlinked') {
            this.stereoLinks[oddChannelIndex] = false;
            delete this.stereoLinkModes[oddChannelIndex];
            
            // Destroy MS decoder if it exists
            if (this.msDecoderNodes[oddChannelIndex]) {
                this.destroyMSDecoder(oddChannelIndex);
            }
            
            // Refresh even channel pan display to show standard L/R notation
            const evenPanValueBox = this.container.querySelector(`.pan-value-box[data-idx="${evenChannelIndex}"]`);
            if (evenPanValueBox) {
                const evenPanKnob = this.container.querySelector(`.pan-knob[data-idx="${evenChannelIndex}"]`);
                if (evenPanKnob) {
                    const displayVal = this.formatPanValue(parseFloat(evenPanKnob.value));
                    evenPanValueBox.textContent = displayVal;
                }
            }
        } else if (mode === 'stereo') {
            // Destroy MS decoder if switching from MS mode
            if (this.msDecoderNodes[oddChannelIndex]) {
                this.destroyMSDecoder(oddChannelIndex);
            }
            
            this.stereoLinks[oddChannelIndex] = true;
            this.stereoLinkModes[oddChannelIndex] = 'stereo';
            linkIcon.classList.add('linked');
            if (modeLabel) modeLabel.textContent = 'ST';
            
            // Sync gains and set panning
            const oddFader = this.container.querySelector(`.volume-fader[data-idx="${oddChannelIndex}"]`);
            const evenFader = this.container.querySelector(`.volume-fader[data-idx="${evenChannelIndex}"]`);
            
            if (oddFader && evenFader) {
                evenFader.value = oddFader.value;
                const db = this.sliderToDb(parseFloat(oddFader.value));
                const gainBox = this.container.querySelector(`.channel-gain-box[data-idx="${evenChannelIndex}"]`);
                if (gainBox) {
                    gainBox.textContent = isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
                }
                if (this.channels[evenChannelIndex] && this.channels[evenChannelIndex].gainNode) {
                    this.channels[evenChannelIndex].gainNode.gain.value = this.sliderToGain(parseFloat(oddFader.value));
                }
            }
            
            this.setPan(oddChannelIndex, -1);
            this.setPan(evenChannelIndex, 1);
            
            const oddPanKnob = this.container.querySelector(`.pan-knob[data-idx="${oddChannelIndex}"]`);
            const evenPanKnob = this.container.querySelector(`.pan-knob[data-idx="${evenChannelIndex}"]`);
            if (oddPanKnob) oddPanKnob.value = -1;
            if (evenPanKnob) evenPanKnob.value = 1;
        } else if (mode === 'ms') {
            this.stereoLinks[oddChannelIndex] = true;
            this.stereoLinkModes[oddChannelIndex] = 'ms';
            linkIcon.classList.add('ms-linked');
            if (modeLabel) modeLabel.textContent = 'MS';
            
            // Create MS decoder
            this.msDecoderNodes[oddChannelIndex] = this.createMSDecoder(oddChannelIndex);
            
            // Set initial pan values
            // Odd channel pan = balance (start at center)
            // Even channel pan = width (start at center = width 1.0)
            this.setPan(oddChannelIndex, 0);
            this.setPan(evenChannelIndex, 0);
            
            const oddPanKnob = this.container.querySelector(`.pan-knob[data-idx="${oddChannelIndex}"]`);
            const evenPanKnob = this.container.querySelector(`.pan-knob[data-idx="${evenChannelIndex}"]`);
            if (oddPanKnob) oddPanKnob.value = 0;
            if (evenPanKnob) evenPanKnob.value = 0;
            
            // Update pan labels to show function
            const oddPanLabel = this.container.querySelector(`.pan-value-box[data-idx="${oddChannelIndex}"]`);
            const evenPanLabel = this.container.querySelector(`.pan-value-box[data-idx="${evenChannelIndex}"]`);
            if (oddPanLabel) oddPanLabel.textContent = 'C'; // Balance
            if (evenPanLabel) evenPanLabel.textContent = '100'; // Width (1.0 * 100)
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
        if (this.isRecording && this.muteAutomationRecorders[index].isArmed) {
            if (!this.muteAutomationRecorders[index].isRecording) {
                // Start recording for this mute change - use session start time
                console.log(`[Mute] Starting mute automation recording for channel ${index}`);
                this.muteAutomationRecorders[index].start(this.sessionStartTime);
                
                // Record initial state at time 0 (the state BEFORE this change)
                const initialState = !ch.isMuted ? 1 : 0; // Opposite of current (about to be toggled) state
                this.muteAutomationRecorders[index].recordPoint(this.sessionStartTime, initialState);
                console.log(`[Mute] Recording initial state for channel ${index} at time ${this.sessionStartTime}: ${initialState}`);
            }
            console.log(`[Mute] Recording mute point: channel=${index}, time=${this.currentTime}, value=${ch.isMuted ? 1 : 0}`);
            this.muteAutomationRecorders[index].recordPoint(this.currentTime, ch.isMuted ? 1 : 0);
        }

        this.updateGains();
        // Don't call onStateChange for mute - muting doesn't affect waveform visibility anymore
        
        // Update Mute All button state
        this.updateMuteAllButtonState();
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
        // Call onStateChange for solo - solo DOES affect waveform visibility
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
                if (chState.automation.pan) {
                    this.panAutomationPlayers[index].points = chState.automation.pan;
                }
                if (chState.automation.mute) {
                    this.muteAutomationPlayers[index].points = chState.automation.mute;
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
