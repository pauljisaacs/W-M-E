import { MetadataHandler } from './metadata-handler.js?v=2';
import { AudioEngine } from './audio-engine.js?v=3';
import { Mixer } from './mixer.js?v=4';
import { FileIO } from './file-io.js';
import { AudioProcessor } from './audio-processor.js';
import { MixerMetadata } from './mixer-metadata.js';





class App {
    constructor() {
        this.metadataHandler = new MetadataHandler();
        this.audioEngine = new AudioEngine();
        this.audioProcessor = new AudioProcessor();
        this.mixer = new Mixer(this.audioEngine.audioCtx,
            (index, name) => {
                console.log(`Track ${index} renamed to ${name}`);
            },
            () => {
                // On state change (mute/solo), re-render waveform
                const canvas = document.getElementById('waveform-canvas');
                if (this.audioEngine.buffer) {
                    this.audioEngine.renderWaveform(canvas, this.audioEngine.buffer, this.mixer.channels, this.cueMarkers, this.selectedCueMarkerId);
                }
            }
        );
        this.mixer.init('mixer-container');
        this.fileIO = new FileIO();

        this.files = []; // Array of { fileHandle, metadata, fileObj }
        this.selectedIndices = new Set();
        this.lastSelectedIndex = -1; // For shift-click range selection
        this.currentlyLoadedFileIndex = -1; // Track which file is currently loaded
        this.columnOrder = [3, 12, 11, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 13]; // Default order: Filename, Project, Tape...
        this.sortColumn = null;
        this.sortDirection = 'asc';
        this.currentFileMetadata = null; // Store current file's metadata for timecode
        this.region = { start: null, end: null }; // Selected time region
        this.isLooping = false; // Loop mode state
        
        // Cue Markers
        this.cueMarkers = new CueMarkerCollection();
        this.selectedCueMarkerId = null; // Track selected marker
        this.draggingCueMarkerId = null; // Track marker being dragged

        // Auto-save
        this.autoSaveEnabled = localStorage.getItem('autoSaveMetadata') === 'true';
        this.autoSaveDebounceTimer = null;
        this.autoSaveDelay = 1000; // 1 second debounce

        this.initEventListeners();
        this.initDragAndDrop();
        this.initColumnDragDrop();

        // Initialize mixer with 8 default channels
        this.mixer.buildUI(8);

        // Animation loop
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    initEventListeners() {
        console.log('Initializing event listeners...');
        document.getElementById('import-btn').addEventListener('click', () => this.handleImport());

        // Transport
        document.getElementById('play-btn').addEventListener('click', () => this.togglePlay());
        document.getElementById('stop-btn').addEventListener('click', () => {
            console.log('Stop button clicked');
            this.stop();
        });

        document.getElementById('loop-btn').addEventListener('click', () => {
            this.isLooping = !this.isLooping;
            const loopBtn = document.getElementById('loop-btn');
            loopBtn.style.backgroundColor = this.isLooping ? 'var(--accent-primary)' : '';
            loopBtn.style.color = this.isLooping ? '#000' : '';
            console.log('Loop mode:', this.isLooping);
        });

        // Batch Actions
        document.getElementById('batch-edit-btn').addEventListener('click', () => this.openBatchEditModal());
        document.getElementById('batch-save-btn').addEventListener('click', () => this.saveSelected());
        document.getElementById('batch-remove-btn').addEventListener('click', () => this.removeSelected());

        // File Operations
        document.getElementById('view-ixml-btn').addEventListener('click', () => this.viewIXML());
        document.getElementById('view-bext-btn').addEventListener('click', () => this.viewBEXT());

        // Modal controls
        document.getElementById('modal-close-btn').addEventListener('click', () => this.closeBatchEditModal());
        document.getElementById('batch-cancel-btn').addEventListener('click', () => this.closeBatchEditModal());
        document.getElementById('batch-apply-btn').addEventListener('click', () => this.applyBatchEdit());

        // iXML Modal controls
        document.getElementById('ixml-close-btn').addEventListener('click', () => this.closeIXMLModal());
        document.getElementById('ixml-modal-close-btn').addEventListener('click', () => this.closeIXMLModal());

        // bEXT Modal controls
        document.getElementById('bext-close-btn').addEventListener('click', () => this.closeBEXTModal());
        document.getElementById('bext-modal-close-btn').addEventListener('click', () => this.closeBEXTModal());

        // Close modal on outside click
        document.getElementById('batch-edit-modal').addEventListener('click', (e) => {
            if (e.target.id === 'batch-edit-modal') {
                this.closeBatchEditModal();
            }
        });

        document.getElementById('ixml-modal').addEventListener('click', (e) => {
            if (e.target.id === 'ixml-modal') {
                this.closeIXMLModal();
            }
        });

        document.getElementById('bext-modal').addEventListener('click', (e) => {
            if (e.target.id === 'bext-modal') {
                this.closeBEXTModal();
            }
        });

        // Normalize controls
        document.getElementById('normalize-btn').addEventListener('click', () => this.openNormalizeModal());
        document.getElementById('cancel-normalize-btn').addEventListener('click', () => this.closeNormalizeModal());
        document.getElementById('confirm-normalize-btn').addEventListener('click', () => this.applyNormalize());

        const normalizeModal = document.getElementById('normalize-modal');
        normalizeModal.querySelector('.close-modal').addEventListener('click', () => this.closeNormalizeModal());
        normalizeModal.addEventListener('click', (e) => {
            if (e.target.id === 'normalize-modal') {
                this.closeNormalizeModal();
            }
        });

        // Rename controls
        document.getElementById('rename-btn').addEventListener('click', () => this.openRenameModal());
        document.getElementById('cancel-rename-btn').addEventListener('click', () => this.closeRenameModal());
        document.getElementById('confirm-rename-btn').addEventListener('click', () => this.applyRename());

        const renameModal = document.getElementById('rename-modal');
        renameModal.querySelector('.close-modal').addEventListener('click', () => this.closeRenameModal());
        renameModal.addEventListener('click', (e) => {
            if (e.target.id === 'rename-modal') {
                this.closeRenameModal();
            }
        });

        // Rename Modal Inputs
        document.querySelectorAll('input[name="rename-pattern"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const isProject = e.target.value === 'project-scene-take';
                document.getElementById('sep1-group').style.display = isProject ? 'flex' : 'none';
                this.updateRenamePreview();
            });
        });
        document.getElementById('rename-sep1').addEventListener('change', () => this.updateRenamePreview());
        document.getElementById('rename-sep2').addEventListener('change', () => this.updateRenamePreview());

        // Export controls
        document.getElementById('export-btn').addEventListener('click', () => this.openExportModal());
        document.getElementById('cancel-export-btn').addEventListener('click', () => this.closeExportModal());
        document.getElementById('confirm-export-btn').addEventListener('click', () => this.handleExport());

        const exportModal = document.getElementById('export-modal');
        exportModal.querySelector('.close-modal').addEventListener('click', () => this.closeExportModal());
        exportModal.addEventListener('click', (e) => {
            if (e.target.id === 'export-modal') {
                this.closeExportModal();
            }
        });

        document.getElementById('export-format').addEventListener('change', (e) => {
            const format = e.target.value;
            document.getElementById('wav-options').style.display = format === 'wav' ? 'block' : 'none';
            document.getElementById('mp3-options').style.display = format === 'mp3' ? 'block' : 'none';
        });

        // Auto-save toggle
        const autoSaveCheckbox = document.getElementById('auto-save-checkbox');
        autoSaveCheckbox.checked = this.autoSaveEnabled;
        autoSaveCheckbox.addEventListener('change', (e) => {
            this.autoSaveEnabled = e.target.checked;
            localStorage.setItem('autoSaveMetadata', this.autoSaveEnabled);
            this.updateSaveButtonState();
        });

        // Mixer save/load controls
        document.getElementById('mute-all-btn').addEventListener('click', () => this.mixer.toggleMuteAll());
        document.getElementById('arm-all-btn').addEventListener('click', () => this.mixer.toggleArmAll());
        document.getElementById('clear-all-automation-btn').addEventListener('click', () => this.mixer.clearAllAutomation());
        document.getElementById('save-mix-btn').addEventListener('click', () => this.saveMixerSettingsToFile());
        document.getElementById('load-mix-btn').addEventListener('click', () => this.loadMixerSettingsFromFile());

        // Cue Marker Modal controls
        document.getElementById('cue-close-btn').addEventListener('click', () => this.closeCueMarkerModal());
        document.getElementById('cue-cancel-btn').addEventListener('click', () => this.closeCueMarkerModal());
        document.getElementById('cue-apply-btn').addEventListener('click', () => this.applyCueMarkerEdit());
        document.getElementById('cue-delete-btn').addEventListener('click', () => this.deleteCueMarkerFromModal());

        const cueMarkerModal = document.getElementById('cue-marker-modal');
        cueMarkerModal.addEventListener('click', (e) => {
            if (e.target.id === 'cue-marker-modal') {
                this.closeCueMarkerModal();
            }
        });

        // Combine Sibling Files controls
        document.getElementById('combine-btn').addEventListener('click', () => this.openCombineModal());
        document.getElementById('combine-close-btn').addEventListener('click', () => this.closeCombineModal());
        document.getElementById('combine-cancel-btn').addEventListener('click', () => this.closeCombineModal());
        document.getElementById('combine-confirm-btn').addEventListener('click', () => this.processCombineFiles());

        const combineModal = document.getElementById('combine-modal');
        combineModal.addEventListener('click', (e) => {
            if (e.target.id === 'combine-modal') {
                this.closeCombineModal();
            }
        });

        // Split Poly File controls
        document.getElementById('split-btn').addEventListener('click', () => this.openSplitModal());
        document.getElementById('split-close-btn').addEventListener('click', () => this.closeSplitModal());
        document.getElementById('split-cancel-btn').addEventListener('click', () => this.closeSplitModal());
        document.getElementById('split-folder-btn').addEventListener('click', () => this.selectSplitFolder());
        document.getElementById('split-confirm-btn').addEventListener('click', () => this.processSplitFile());

        const splitModal = document.getElementById('split-modal');
        splitModal.addEventListener('click', (e) => {
            if (e.target.id === 'split-modal') {
                this.closeSplitModal();
            }
        });

        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            // Arrow key navigation (only if not typing in an editable field)
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !this.isEditingText(e.target)) {
                e.preventDefault(); // Prevent page scrolling

                if (this.files.length === 0) return;

                // Blur any focused element to prevent focus traps
                if (document.activeElement && document.activeElement.blur) {
                    document.activeElement.blur();
                }

                let targetIndex = -1;

                if (this.lastSelectedIndex === -1) {
                    // No selection, start at first file
                    targetIndex = 0;
                } else {
                    if (e.key === 'ArrowDown') {
                        // Already at the end, don't process
                        if (this.lastSelectedIndex >= this.files.length - 1) return;
                        targetIndex = this.lastSelectedIndex + 1;
                    } else { // ArrowUp
                        // Already at the start, don't process
                        if (this.lastSelectedIndex <= 0) return;
                        targetIndex = this.lastSelectedIndex - 1;
                    }
                }

                console.log(`Arrow ${e.key === 'ArrowDown' ? 'Down' : 'Up'}: ${this.lastSelectedIndex} -> ${targetIndex}`);

                // Select the target file
                this.selectFile(targetIndex, { metaKey: false, ctrlKey: false, shiftKey: false });

                // Scroll the row into view
                const rows = document.querySelectorAll('#file-list-body tr');
                if (rows[targetIndex]) {
                    rows[targetIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }

            // Spacebar for play/pause (only if not typing in an editable field)
            if (e.code === 'Space' && !this.isEditingText(e.target)) {
                e.preventDefault();
                this.togglePlay();
            }

            // Command/Ctrl + A for select all (only if not typing in an editable field)
            if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !this.isEditingText(e.target)) {
                e.preventDefault();
                this.selectAll();
            }

            // Delete/Backspace to remove selected files or cue markers
            if ((e.key === 'Backspace' || e.key === 'Delete') && !this.isEditingText(e.target)) {
                e.preventDefault();
                
                // If a cue marker is selected, delete it
                if (this.selectedCueMarkerId !== null) {
                    this.deleteCueMarker(this.selectedCueMarkerId);
                }
                // Otherwise, remove selected files
                else if (this.selectedIndices.size > 0) {
                    this.removeSelected();
                }
            }
            
            // M key - Create cue marker at current playhead position
            if (e.key === 'm' && !this.isEditingText(e.target)) {
                e.preventDefault();
                if (this.audioEngine.buffer) {
                    const time = this.audioEngine.getCurrentTime();
                    if (time < this.audioEngine.buffer.duration) {
                        this.createCueMarker(time);
                    }
                }
            }
            
            // , key - Jump to previous cue marker
            if (e.key === ',' && !this.isEditingText(e.target)) {
                e.preventDefault();
                this.jumpToPreviousCue();
            }
            
            // . key - Jump to next cue marker
            if (e.key === '.' && !this.isEditingText(e.target)) {
                e.preventDefault();
                this.jumpToNextCue();
            }
        });

        // File Input Fallback
        document.getElementById('file-input').addEventListener('change', (e) => {
            const files = [...e.target.files];
            const fileList = files.map(file => ({
                kind: 'file',
                name: file.name,
                getFile: async () => file
            }));
            this.processFiles(fileList);
            e.target.value = ''; // Reset
        });

        // Waveform click and drag
        const canvas = document.getElementById('waveform-canvas');
        let isDragging = false;

        const updatePlayheadPosition = (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const percent = x / rect.width;

            if (this.audioEngine.buffer) {
                const time = percent * this.audioEngine.buffer.duration;

                // Update playhead position
                const playhead = document.getElementById('playhead');
                playhead.style.left = `${percent * 100}%`;

                // Update time display
                document.getElementById('current-time').textContent = this.formatTime(time);

                // Update timecode display
                const currentTimecode = document.getElementById('current-timecode');
                if (currentTimecode) {
                    currentTimecode.textContent = this.secondsToTimecode(time);
                }

                return { time, percent };
            }
            return null;
        };

        let wasPlaying = false;
        let isDraggingCueMarker = false;
        let draggedCueMarkerId = null;

        canvas.addEventListener('mousedown', (e) => {
            if (!this.audioEngine.buffer) return;

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;

            // Check if clicking on a cue marker
            const clickedMarker = this.cueMarkers.findAtCanvasPosition(
                x,
                rect.width,
                this.audioEngine.buffer.duration
            );

            if (clickedMarker) {
                // Start dragging cue marker
                isDraggingCueMarker = true;
                draggedCueMarkerId = clickedMarker.id;
                this.selectedCueMarkerId = clickedMarker.id;
                this.refreshWaveform();
                e.stopPropagation();
                return;
            }

            // Otherwise, start dragging playhead
            isDragging = true;
            wasPlaying = this.audioEngine.isPlaying;

            // Deselect any selected marker
            this.selectedCueMarkerId = null;
            this.refreshWaveform();

            // Pause while dragging
            if (wasPlaying) {
                this.audioEngine.stop();
                document.getElementById('play-btn').textContent = '▶';
            }

            updatePlayheadPosition(e);
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!this.audioEngine.buffer) return;

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;

            if (isDraggingCueMarker && draggedCueMarkerId) {
                // Update cue marker position
                const time = canvasXToTime(x, rect.width, this.audioEngine.buffer.duration);
                const clampedTime = Math.max(0, Math.min(time, this.audioEngine.buffer.duration));
                this.cueMarkers.updateTime(draggedCueMarkerId, clampedTime);
                this.refreshWaveform();
                return;
            }

            if (isDragging) {
                updatePlayheadPosition(e);
            }
        });

        canvas.addEventListener('mouseup', (e) => {
            if (isDraggingCueMarker) {
                // Finished dragging cue marker - save changes
                isDraggingCueMarker = false;
                draggedCueMarkerId = null;
                this.saveCueMarkers();
                return;
            }

            if (isDragging) {
                const result = updatePlayheadPosition(e);
                if (result) {
                    if (wasPlaying) {
                        this.audioEngine.play(result.time);
                        document.getElementById('play-btn').textContent = '⏸';
                    } else {
                        this.audioEngine.seek(result.time);
                    }
                }
                isDragging = false;
            }
        });

        canvas.addEventListener('mouseleave', (e) => {
            if (isDraggingCueMarker) {
                // Finished dragging cue marker
                isDraggingCueMarker = false;
                draggedCueMarkerId = null;
                this.saveCueMarkers();
                return;
            }

            if (isDragging) {
                const result = updatePlayheadPosition(e);
                if (result) {
                    if (wasPlaying) {
                        this.audioEngine.play(result.time);
                        document.getElementById('play-btn').textContent = '⏸';
                    } else {
                        this.audioEngine.seek(result.time);
                    }
                }
                isDragging = false;
            }
        });

        // Double-click to edit cue marker
        canvas.addEventListener('dblclick', (e) => {
            if (!this.audioEngine.buffer) return;

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;

            const clickedMarker = this.cueMarkers.findAtCanvasPosition(
                x,
                rect.width,
                this.audioEngine.buffer.duration
            );

            if (clickedMarker) {
                this.openCueMarkerModal(clickedMarker.id);
            }
        });

        // Region selection
        const regionSelector = document.getElementById('region-selector');
        const regionOverlay = document.getElementById('region-overlay');
        let isSelectingRegion = false;
        let regionStartX = 0;
        let isDraggingEdge = false;
        let draggingEdge = null; // 'start' or 'end'
        const regionTooltip = document.getElementById('region-tooltip');

        // Handle region edge dragging
        regionOverlay.addEventListener('mousedown', (e) => {
            if (!this.audioEngine.buffer) return;
            e.stopPropagation(); // Prevent region selector from handling this

            const rect = regionOverlay.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const edgeThreshold = 8; // pixels

            // Check if clicking near left edge (start)
            if (x < edgeThreshold) {
                isDraggingEdge = true;
                draggingEdge = 'start';
            }
            // Check if clicking near right edge (end)
            else if (x > rect.width - edgeThreshold) {
                isDraggingEdge = true;
                draggingEdge = 'end';
            }
            // Middle click clears the region
            else {
                this.clearRegion();
            }
        });

        regionSelector.addEventListener('mousedown', (e) => {
            if (!this.audioEngine.buffer) return;

            const rect = regionSelector.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;

            // Always start a new region, replacing any existing one
            isSelectingRegion = true;
            regionStartX = x;
            this.region.start = percent * this.audioEngine.buffer.duration;
            this.region.end = this.region.start;

            this.updateRegionDisplay();

            // Show tooltip at mouse position
            if (regionTooltip) {
                regionTooltip.style.display = 'block';
                regionTooltip.style.left = `${x - 110}px`;
                regionTooltip.style.top = '28px';
                updateRegionTooltip(this.region.start, this.region.end);
            }
        });

        // Listen to document for mousemove so we can track outside the element
        document.addEventListener('mousemove', (e) => {
            if (!this.audioEngine.buffer) return;

            const rect = regionSelector.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const percent = x / rect.width;
            const time = percent * this.audioEngine.buffer.duration;

            // Handle edge dragging
            if (isDraggingEdge) {
                if (draggingEdge === 'start') {
                    this.region.start = Math.min(time, this.region.end - 0.01); // Keep 0.01s minimum
                } else if (draggingEdge === 'end') {
                    this.region.end = Math.max(time, this.region.start + 0.01); // Keep 0.01s minimum
                }
                this.updateRegionDisplay();
                // Show and update tooltip while dragging edge
                if (regionTooltip) {
                    regionTooltip.style.display = 'block';
                    regionTooltip.style.left = `${x - 110}px`;
                    regionTooltip.style.top = '28px';
                    updateRegionTooltip(this.region.start, this.region.end);
                }
                return;
            }

            // Handle region selection
            if (isSelectingRegion) {
                this.region.end = time;
                this.updateRegionDisplay();
                // Update tooltip position and content
                if (regionTooltip) {
                    regionTooltip.style.display = 'block';
                    regionTooltip.style.left = `${x - 110}px`;
                    regionTooltip.style.top = '28px';
                    updateRegionTooltip(this.region.start, this.region.end);
                }
            }
        });

        // Listen to document for mouseup so we catch it even outside the element
        document.addEventListener('mouseup', () => {
            if (isDraggingEdge) {
                isDraggingEdge = false;
                draggingEdge = null;
                // Hide tooltip when done dragging edge
                if (regionTooltip) {
                    regionTooltip.style.display = 'none';
                }
                return;
            }

            if (isSelectingRegion) {
                isSelectingRegion = false;

                // Ensure start is before end
                if (this.region.start > this.region.end) {
                    [this.region.start, this.region.end] = [this.region.end, this.region.start];
                }

                // Clear if region is too small (less than 0.1 seconds)
                if (Math.abs(this.region.end - this.region.start) < 0.1) {
                    this.clearRegion();
                }
                // Hide tooltip
                if (regionTooltip) {
                    regionTooltip.style.display = 'none';
                }
            }
        });
        // Tooltip update helper
        function updateRegionTooltip(start, end) {
            if (!regionTooltip) return;
            const s = Math.min(start, end);
            const e = Math.max(start, end);
            const absStart = window.app.formatTime ? window.app.formatTime(s) : secondsToHMS(s);
            const absEnd = window.app.formatTime ? window.app.formatTime(e) : secondsToHMS(e);
            const tcStart = window.app.secondsToTimecode ? window.app.secondsToTimecode(s) : secondsToTC(s);
            const tcEnd = window.app.secondsToTimecode ? window.app.secondsToTimecode(e) : secondsToTC(e);
            regionTooltip.innerHTML = `<b>Start:</b> ${absStart} <span style="color:#aaa">(${tcStart})</span><br><b>End:</b> ${absEnd} <span style="color:#aaa">(${tcEnd})</span>`;
        }

        // Fallbacks if not on window.app
        function secondsToHMS(sec) {
            sec = Math.max(0, sec|0);
            const h = Math.floor(sec/3600);
            const m = Math.floor((sec%3600)/60);
            const s = Math.floor(sec%60);
            return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
        }
        function secondsToTC(sec) {
            // Default 30 fps
            const fps = 30;
            sec = Math.max(0, sec);
            const h = Math.floor(sec/3600);
            const m = Math.floor((sec%3600)/60);
            const s = Math.floor(sec%60);
            const f = Math.floor((sec - Math.floor(sec)) * fps);
            return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}:${f.toString().padStart(2,'0')}`;
        }

        // Toggle sections
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const section = e.target.closest('section');
                section.classList.toggle('expanded');
                if (!section.classList.contains('expanded')) {
                    section.querySelector('.section-content').style.display = 'none';
                } else {
                    section.querySelector('.section-content').style.display = 'block';
                }
            });
        });

        // Initialize section visibility on page load
        document.querySelectorAll('.collapsible').forEach(section => {
            const content = section.querySelector('.section-content');
            if (section.classList.contains('expanded')) {
                content.style.display = 'block';
            } else {
                content.style.display = 'none';
            }
        });
    }

    initDragAndDrop() {
        const dropZone = document.body;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.opacity = '0.8';
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.style.opacity = '1';
        });

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.style.opacity = '1';

            const items = [...e.dataTransfer.items];
            const fileList = [];

            // Process each item - get both File and Handle synchronously first
            // (DataTransferItems become invalid after async operations)
            const itemData = items.map(item => ({
                file: item.getAsFile(),
                handlePromise: 'getAsFileSystemHandle' in item ? item.getAsFileSystemHandle() : null
            }));

            for (let i = 0; i < itemData.length; i++) {
                try {
                    const { file, handlePromise } = itemData[i];

                    // Try FileSystemHandle first (it properly detects directories)
                    if (handlePromise) {
                        const handle = await handlePromise;

                        if (handle) {
                            if (handle.kind === 'directory') {
                                await this.fileIO.scanDirectory(handle, fileList);
                                continue;
                            } else if (handle.kind === 'file' && this.fileIO.isAudioFile(handle.name)) {
                                fileList.push(handle);
                                continue;
                            }
                        }
                    }

                    // Fallback to File object
                    if (file && this.fileIO.isAudioFile(file.name)) {
                        fileList.push({ kind: 'file', name: file.name, getFile: async () => file });
                    }
                } catch (err) {
                    console.error('Error processing dropped item:', err);
                }
            }

            this.processFiles(fileList);
        });
    }

    initColumnDragDrop() {
        const headers = document.querySelectorAll('#table-header th');
        let draggedColumnIndex = null;

        headers.forEach(header => {
            // Sort on click
            header.addEventListener('click', (e) => {
                if (header.dataset.sort) {
                    this.sortFiles(header.dataset.sort);
                } else {
                    const columnIndex = parseInt(header.dataset.column);
                    if (!isNaN(columnIndex)) {
                        this.sortFiles(columnIndex);
                    }
                }
            });

            header.addEventListener('dragstart', (e) => {
                draggedColumnIndex = parseInt(header.dataset.column);
                e.dataTransfer.effectAllowed = 'move';
                header.style.opacity = '0.5';
            });

            header.addEventListener('dragend', (e) => {
                header.style.opacity = '1';
                headers.forEach(h => h.classList.remove('drag-over'));
            });

            header.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                header.classList.add('drag-over');
            });

            header.addEventListener('dragleave', (e) => {
                header.classList.remove('drag-over');
            });

            header.addEventListener('drop', (e) => {
                e.preventDefault();
                const targetColumnIndex = parseInt(header.dataset.column);

                if (draggedColumnIndex !== null && draggedColumnIndex !== targetColumnIndex) {
                    this.reorderColumns(draggedColumnIndex, targetColumnIndex);
                }

                header.classList.remove('drag-over');
                draggedColumnIndex = null;
            });
        });
    }

    reorderColumns(fromIndex, toIndex) {
        // Find positions in columnOrder array
        const from = this.columnOrder.indexOf(fromIndex);
        const to = this.columnOrder.indexOf(toIndex);

        if (from === to) return;

        // Move column in order array
        const [removed] = this.columnOrder.splice(from, 1);
        this.columnOrder.splice(to, 0, removed);

        // Reorder header cells
        const headerRow = document.getElementById('table-header');
        const headers = Array.from(headerRow.children);
        const movedHeader = headers[from];
        const targetHeader = headers[to];

        // If moving forward (to > from), insert after target (before target.nextSibling)
        // If moving backward (to < from), insert before target
        // Note: When moving forward, we effectively want to place it at 'to', 
        // but since 'from' is removed, 'to' shifts. 
        // Actually, simpler logic: just use insertBefore with the correct reference.

        if (to >= headers.length - 1) {
            headerRow.appendChild(movedHeader);
        } else if (to > from) {
            headerRow.insertBefore(movedHeader, targetHeader.nextSibling);
        } else {
            headerRow.insertBefore(movedHeader, targetHeader);
        }

        // Reorder all body rows
        const tbody = document.getElementById('file-list-body');
        Array.from(tbody.children).forEach(row => {
            const cells = Array.from(row.children);
            const movedCell = cells[from];
            const targetCell = cells[to];

            if (to >= cells.length - 1) {
                row.appendChild(movedCell);
            } else if (to > from) {
                row.insertBefore(movedCell, targetCell.nextSibling);
            } else {
                row.insertBefore(movedCell, targetCell);
            }
        });
    }

    isEditingText(element) {
        // Check if the user is typing in an input, textarea, select, or contenteditable element
        return element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
            element.tagName === 'SELECT' ||
            element.isContentEditable;
    }

    async handleImport() {
        const handles = await this.fileIO.openFiles();
        if (handles === null) {
            // Fallback
            document.getElementById('file-input').click();
        } else if (handles.length > 0) {
            this.processFiles(handles);
        }
    }

    async processFiles(handles) {
        // Collect existing filenames to prevent duplicates
        const existingFilenames = new Set();
        for (const item of this.files) {
            if (item.isGroup) {
                item.siblings.forEach(s => existingFilenames.add(s.metadata.filename));
            } else {
                existingFilenames.add(item.metadata.filename);
            }
        }

        // Collect new file items first
        const newItems = [];
        for (const handle of handles) {
            try {
                const file = await handle.getFile();

                // Skip if already exists
                if (existingFilenames.has(file.name)) {
                    console.log(`Skipping duplicate file: ${file.name}`);
                    continue;
                }

                const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
                console.log(`Processing: ${file.name} (${fileSizeMB} MB)`);

                const metadata = await this.metadataHandler.parseFile(file);
                newItems.push({ handle, metadata, file });
                existingFilenames.add(file.name); // Add to set to prevent duplicates within the new batch too
            } catch (err) {
                console.error('Error processing file:', handle.name, err);
                const file = await handle.getFile();
                alert(`Failed to load "${file.name}". Error: ${err.message}`);
            }
        }

        // Combine with existing (ungrouped) files
        // We need to flatten current groups to re-evaluate groupings
        const allItems = [];
        for (const item of this.files) {
            if (item.isGroup) {
                allItems.push(...item.siblings);
            } else {
                allItems.push(item);
            }
        }
        allItems.push(...newItems);

        // Group files
        this.files = this.groupFiles(allItems);

        // Force full table refresh with latest metadata
        const tbody = document.getElementById('file-list-body');
        tbody.innerHTML = '';
        this.files.forEach((item, index) => {
            this.addTableRow(index, item.metadata);
        });

        // Auto-select first if fresh start
        if (allItems.length === newItems.length && this.files.length > 0) {
            // Delay selection slightly to ensure DOM reflow (required for canvas sizing)
            setTimeout(() => {
                this.selectFile(0);
            }, 50);
        }
    }

    groupFiles(items) {
        const buckets = new Map();

        // 1. Bucket by Audio Data Size + timeReference
        // Using audioDataSize is more robust than file.size because metadata chunks can vary in length
        // between Mix (L/R) and ISO tracks, but the actual audio payload should be identical.
        for (const item of items) {
            const timeRef = item.metadata.timeReference !== undefined ? item.metadata.timeReference : 'unknown';

            // Use audioDataSize if available, otherwise fallback to file size (for non-compliant files)
            const sizeKey = item.metadata.audioDataSize || item.file.size;

            const key = `${sizeKey}_${timeRef}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(item);
        }

        const result = [];

        // 2. Process buckets
        for (const [key, bucket] of buckets) {
            if (bucket.length === 1) {
                result.push(bucket[0]); // Single file
                continue;
            }

            console.log(`[Grouping] Checking bucket '${key}' with ${bucket.length} items.`);

            // Bucket has potential siblings
            // Group by Base Name (regex match)
            // Regex: BaseName + Underscore + (Number OR Letter(s)+Number OR Single/Multiple Letters) + .wav
            const regex = /^(.*)_([0-9]+|[A-Z]+[0-9]*|[A-Z])\.wav$/i;
            const groups = new Map(); // key: baseName, value: [items]
            const singles = [];

            for (const item of bucket) {
                const match = item.metadata.filename.match(regex);
                if (match) {
                    const baseName = match[1];
                    if (!groups.has(baseName)) groups.set(baseName, []);
                    groups.get(baseName).push(item);
                } else {
                    console.log(`[Grouping] File '${item.metadata.filename}' did not match sibling regex.`);
                    singles.push(item);
                }
            }

            // Add non-matching files
            result.push(...singles);

            // Process grouped siblings
            for (const [baseName, siblings] of groups) {
                if (siblings.length > 1) {
                    console.log(`[Grouping] Found sibling group: ${baseName} (${siblings.length} files)`);

                    // Sort siblings by filename (numeric suffix logic if possible)
                    siblings.sort((a, b) => {
                        return a.metadata.filename.localeCompare(b.metadata.filename, undefined, { numeric: true, sensitivity: 'base' });
                    });

                    // Create representative metadata
                    const repMetadata = { ...siblings[0].metadata }; // Shallow copy
                    repMetadata.filename = `${baseName}_X.wav`;
                    repMetadata.channels = siblings.length; // Override channel count

                    // Construct track names from suffixes or existing metadata
                    const trackNames = siblings.map(s => {
                        // Check for existing metadata first (iXML name)
                        if (s.metadata.trackNames && s.metadata.trackNames.length > 0 && s.metadata.trackNames[0]) {
                            return s.metadata.trackNames[0];
                        }

                        // Fallback to filename suffix (e.g. _1 -> Ch1)
                        const m = s.metadata.filename.match(regex);
                        return m ? `Ch${m[2]}` : 'Ch?';
                    });
                    repMetadata.trackNames = trackNames;

                    // Create Group Item
                    result.push({
                        isGroup: true,
                        siblings: siblings,
                        metadata: repMetadata,
                        // Keep reference to first file for compatibility
                        handle: siblings[0].handle,
                        file: siblings[0].file
                    });
                } else {
                    // Only 1 matching file in this group? Treat as single
                    result.push(siblings[0]);
                }
            }
        }

        return result;
    }

    addTableRow(index, metadata) {
        console.log(`[addTableRow] index=${index}, metadata:`, { scene: metadata.scene, take: metadata.take, notes: metadata.notes, tape: metadata.tape, project: metadata.project });

        const tbody = document.getElementById('file-list-body');
        const tr = document.createElement('tr');
        tr.dataset.index = index;

        const createCell = (key, val, editable = true) => {
            const td = document.createElement('td');

            // Special handling for FPS - dropdown
            if (key === 'fps') {
                const select = document.createElement('select');
                select.className = 'fps-select';
                select.dataset.fileIndex = index;

                const fpsOptions = ['23.98', '24', '25', '29.97', '29.97df', '30', '48', '50', '59.94', '60'];
                fpsOptions.forEach(fps => {
                    const option = document.createElement('option');
                    option.value = fps;
                    option.textContent = fps;
                    if (fps === val) option.selected = true;
                    select.appendChild(option);
                });

                select.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.dataset.fileIndex);
                    if (!this.pendingEdits) this.pendingEdits = {};
                    if (!this.pendingEdits[idx]) this.pendingEdits[idx] = {};
                    this.pendingEdits[idx].fps = e.target.value;
                    
                    // Trigger auto-save if enabled
                    if (this.autoSaveEnabled) {
                        this.scheduleAutoSave();
                    }
                });

                td.appendChild(select);
                return td;
            }

            // Special handling for TC Start - input field
            if (key === 'tcStart') {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'tc-input';
                input.value = val || '00:00:00:00';
                input.placeholder = 'HH:MM:SS:FF';
                input.dataset.fileIndex = index;

                // Validation on blur
                input.addEventListener('blur', (e) => {
                    const value = e.target.value;
                    if (this.validateTimecode(value)) {
                        const idx = parseInt(e.target.dataset.fileIndex);
                        if (!this.pendingEdits) this.pendingEdits = {};
                        if (!this.pendingEdits[idx]) this.pendingEdits[idx] = {};
                        this.pendingEdits[idx].tcStart = value;
                        e.target.classList.remove('invalid');
                        
                        // Trigger auto-save if enabled
                        if (this.autoSaveEnabled) {
                            this.scheduleAutoSave();
                        }
                    } else {
                        e.target.classList.add('invalid');
                        alert('Invalid timecode format. Please use HH:MM:SS:FF (e.g., 01:23:45:12)');
                        e.target.value = val || '00:00:00:00';
                    }
                });

                // Enter key to blur
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.target.blur();
                    }
                });

                td.appendChild(input);
                return td;
            }

            // Default handling for other fields
            td.textContent = val || '';
            if (editable) {
                td.contentEditable = true;
                td.addEventListener('blur', (e) => {
                    const newValue = e.target.textContent;
                    const oldValue = this.files[index].metadata[key] || '';
                    // Only update if value actually changed
                    if (newValue !== oldValue) {
                        this.updateMetadata(index, key, newValue);
                    }
                });
                td.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.target.blur();
                    }
                });
            }
            return td;
        };

        // Create all cells in original order (Draggable)
        // 0: Ch, 1: Bits, 2: Rate, 3: Filename, 4: Format, 5: Scene, 6: Take, 7: Duration, 8: TC Start, 9: FPS, 10: Notes, 11: Tape, 12: Project, 13: Date
        
        // Format channel display with Mono/Poly indicator
        const item = this.files[index];
        const channelCount = metadata.channels || 0;
        
        // For sibling groups, check if all siblings are mono (1 channel each)
        const isMonoGroup = item.isGroup && item.siblings && item.siblings.every(s => s.metadata.channels === 1);
        
        const channelDisplay = isMonoGroup ? `${channelCount} (Mono)` :
                               channelCount === 1 ? `${channelCount} (Mono)` : 
                               channelCount >= 2 ? `${channelCount} (Poly)` : 
                               channelCount;
        
        const cells = [
            createCell('channels', channelDisplay, false),
            createCell('bitDepth', metadata.bitDepth ? metadata.bitDepth : '', false),
            createCell('sampleRate', metadata.sampleRate ? (metadata.sampleRate / 1000) + 'k' : '', false),
            createCell('filename', metadata.filename, false),
            createCell('format', metadata.format, false),
            createCell('scene', metadata.scene),
            createCell('take', metadata.take),
            createCell('duration', metadata.duration, false),
            createCell('tcStart', metadata.tcStart, false),
            createCell('fps', metadata.fps, false),
            createCell('notes', metadata.notes),
            createCell('tape', metadata.tape),
            createCell('project', metadata.project),
            createCell('date', metadata.date)
        ];

        // Append in current column order
        this.columnOrder.forEach(colIndex => {
            if (cells[colIndex]) {
                tr.appendChild(cells[colIndex]);
            }
        });

        tr.addEventListener('click', (e) => this.selectFile(index, e));
        tbody.appendChild(tr);
    }


    validateTimecode(tc) {
        // Validate HH:MM:SS:FF format
        const pattern = /^([0-9]{2}):([0-5][0-9]):([0-5][0-9]):([0-9]{2})$/;
        return pattern.test(tc);
    }

    sortFiles(keyOrIndex) {
        let key;
        if (typeof keyOrIndex === 'number') {
            const keyMap = [
                'channels', 'bitDepth', 'sampleRate', 'filename', 'format', 'scene', 'take', 'duration', 'tcStart', 'fps', 'notes', 'tape', 'project', 'date'
            ];
            key = keyMap[keyOrIndex];
        } else {
            key = keyOrIndex;
        }

        if (this.sortColumn === key) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = key;
            this.sortDirection = 'asc';
        }

        this.files.sort((a, b) => {
            let valA = a.metadata[key] || '';
            let valB = b.metadata[key] || '';

            // Numeric sort for specific columns
            if (['take', 'sampleRate', 'channels', 'bitDepth'].includes(key)) {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            }

            if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        // Re-render
        const tbody = document.getElementById('file-list-body');
        tbody.innerHTML = '';
        this.files.forEach((file, i) => this.addTableRow(i, file.metadata));

        // Update header indicators
        document.querySelectorAll('#table-header th').forEach((th, i) => {
            th.classList.remove('sort-asc', 'sort-desc');
            // Map visual index to original index
            const originalIndex = this.columnOrder[i];
            if (originalIndex === columnIndex) {
                th.classList.add(this.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    updateMetadata(index, key, value) {
        this.files[index].metadata[key] = value;
        // Enable save button
        document.getElementById('batch-save-btn').disabled = false;
        
        // Trigger auto-save if enabled
        if (this.autoSaveEnabled) {
            this.scheduleAutoSave();
        }
    }

    scheduleAutoSave() {
        // Clear existing timer
        if (this.autoSaveDebounceTimer) {
            clearTimeout(this.autoSaveDebounceTimer);
        }
        
        // Show "Saving..." toast
        this.showToast('Saving...', 'info', 0); // 0 = persistent until replaced
        
        // Schedule save after delay
        this.autoSaveDebounceTimer = setTimeout(async () => {
            await this.performAutoSave();
        }, this.autoSaveDelay);
    }

    async performAutoSave() {
        if (this.selectedIndices.size === 0) {
            this.showToast('No files selected', 'warning');
            return;
        }

        try {
            await this.saveSelected();
            this.showToast('Saved', 'success');
        } catch (error) {
            console.error('Auto-save failed:', error);
            this.showToast('Auto-save failed', 'error');
        }
    }

    showToast(message, type = 'info', duration = 2000) {
        const toast = document.getElementById('toast-notification');
        toast.textContent = message;
        toast.className = `toast-notification ${type} show`;
        
        if (duration > 0) {
            setTimeout(() => {
                toast.classList.remove('show');
            }, duration);
        }
    }

    async saveSelected() {
        if (this.selectedIndices.size === 0) return;

        // Apply pending edits first
        if (this.pendingEdits) {
            for (const index of this.selectedIndices) {
                if (this.pendingEdits[index]) {
                    const edits = this.pendingEdits[index];
                    const metadata = this.files[index].metadata;

                    if (edits.fps) {
                        // Update FPS display value
                        metadata.fps = edits.fps;

                        // Update fpsExact for calculations
                        // Parse common frame rates
                        if (edits.fps === '23.98') {
                            metadata.fpsExact = { numerator: 24000, denominator: 1001 };
                        } else if (edits.fps === '29.97' || edits.fps === '29.97nd' || edits.fps === '29.97df') {
                            metadata.fpsExact = { numerator: 30000, denominator: 1001 };
                        } else {
                            const fpsNum = parseFloat(edits.fps);
                            metadata.fpsExact = { numerator: fpsNum, denominator: 1 };
                        }
                    }

                    if (edits.tcStart) {
                        // Update TC Start display value
                        metadata.tcStart = edits.tcStart;

                        // Ensure sampleRate and fpsExact are present
                        if (!metadata.sampleRate && this.files[index].metadata.sampleRate) {
                            metadata.sampleRate = this.files[index].metadata.sampleRate;
                        }
                        if (!metadata.fpsExact && this.files[index].metadata.fpsExact) {
                            metadata.fpsExact = this.files[index].metadata.fpsExact;
                        }

                        // Convert TC Start back to timeReference (samples) for bEXT
                        if (metadata.sampleRate && metadata.fpsExact) {
                            metadata.timeReference = this.metadataHandler.tcToSamples(
                                edits.tcStart,
                                metadata.sampleRate,
                                metadata.fpsExact
                            );
                        }
                    }
                }
            }
        }

        let successCount = 0;
        let totalFilesToSave = 0;

        for (const index of this.selectedIndices) {
            const item = this.files[index];
            const isGroup = item.isGroup;
            const targets = isGroup ? item.siblings : [item];

            totalFilesToSave += targets.length;

            for (let i = 0; i < targets.length; i++) {
                const target = targets[i];

                // Prepare metadata to save
                // Start with target's original metadata to preserve low-level details
                const metadataToSave = { ...target.metadata };

                // Fields to sync from the representative item (the one being edited in UI)
                const commonFields = ['scene', 'take', 'tape', 'project', 'notes', 'date', 'fps', 'fpsExact', 'tcStart', 'timeReference'];

                commonFields.forEach(key => {
                    if (item.metadata[key] !== undefined) {
                        metadataToSave[key] = item.metadata[key];
                    }
                });

                // Handle Track Names
                if (isGroup) {
                    // For groups, map specific track index to this sibling
                    if (item.metadata.trackNames && item.metadata.trackNames[i]) {
                        metadataToSave.trackNames = [item.metadata.trackNames[i]];
                    }
                } else {
                    // For single files, copy the full list (polyphonic)
                    if (item.metadata.trackNames) {
                        metadataToSave.trackNames = [...item.metadata.trackNames];
                    }
                }

                try {
                    console.log(`Saving file: ${target.metadata.filename} (Group: ${isGroup})`);

                    const newBlob = await this.metadataHandler.saveWav(target.file, metadataToSave);

                    if (target.handle.kind === 'file') {
                        const success = await this.fileIO.saveFile(target.handle, newBlob);
                        if (success) {
                            successCount++;
                            // Refresh the file object from the handle
                            target.file = await target.handle.getFile();

                            // Update metadata with what we just saved (instead of re-parsing)
                            // This ensures the UI shows exactly what was saved
                            target.metadata = { ...target.metadata, ...metadataToSave };
                        }
                    } else {
                        // Fallback download
                        // Only triggering download if it's a single file selection or small batch to avoid browser spam
                        if (this.selectedIndices.size === 1 && targets.length === 1) {
                            const url = URL.createObjectURL(newBlob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = target.metadata.filename;
                            a.click();
                            successCount++;
                        }
                    }
                } catch (err) {
                    console.error('Error saving file:', target.metadata.filename, err);
                }
            }
        }

        // Clear pending edits
        if (this.pendingEdits) {
            for (const index of this.selectedIndices) {
                delete this.pendingEdits[index];
            }
        }

        // Re-render table
        const tbody = document.getElementById('file-list-body');
        tbody.innerHTML = '';
        this.files.forEach((file, i) => this.addTableRow(i, file.metadata));
        this.updateSelectionUI();

        if (successCount > 0) {
            alert(`Saved ${successCount} files successfully!`);
        } else {
            alert('Failed to save files.');
        }
    }

    removeSelected() {
        if (this.selectedIndices.size === 0) return;

        // Stop playback to avoid playing removed files
        this.stop();

        // Sort indices descending to remove from end first
        const indices = Array.from(this.selectedIndices).sort((a, b) => b - a);

        indices.forEach(index => {
            if (index === this.currentlyLoadedFileIndex) {
                this.currentlyLoadedFileIndex = -1;
                // Also clear the waveform/mixer UI since the file is gone
                const canvas = document.getElementById('waveform-canvas');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
                const mixerContainer = document.getElementById('mixer-container');
                if (mixerContainer) mixerContainer.innerHTML = '';
            } else if (index < this.currentlyLoadedFileIndex) {
                // Shift index if a file above it was removed
                this.currentlyLoadedFileIndex--;
            }
            this.files.splice(index, 1);
        });

        this.selectedIndices.clear();
        this.lastSelectedIndex = -1;

        // Re-render list
        const tbody = document.getElementById('file-list-body');
        tbody.innerHTML = '';
        this.files.forEach((file, i) => this.addTableRow(i, file.metadata));

        // Clear player if empty or if we just removed the active file (simplification: always clear visual)
        // Since we don't track which file is active, clearing visuals is safer to avoid mismatch
        const canvas = document.getElementById('waveform-canvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Reset Mixer to default 8 channels
        this.mixer.buildUI(8);

        // Clear Audio Engine Buffer
        this.audioEngine.buffer = null;

        if (this.files.length === 0) {
            // Already stopped
        }

        this.updateSelectionUI();
    }

    selectAll() {
        this.selectedIndices.clear();
        this.files.forEach((_, i) => this.selectedIndices.add(i));
        this.updateSelectionUI();
    }

    async selectFile(index, event) {
        // Handle Multi-select
        if (event && (event.metaKey || event.ctrlKey)) {
            if (this.selectedIndices.has(index)) {
                this.selectedIndices.delete(index);
            } else {
                this.selectedIndices.add(index);
            }
            this.lastSelectedIndex = index;
        } else if (event && event.shiftKey && this.lastSelectedIndex !== -1) {
            const start = Math.min(this.lastSelectedIndex, index);
            const end = Math.max(this.lastSelectedIndex, index);
            this.selectedIndices.clear();
            for (let i = start; i <= end; i++) {
                this.selectedIndices.add(i);
            }
        } else {
            // Single select
            this.selectedIndices.clear();
            this.selectedIndices.add(index);
            this.lastSelectedIndex = index;
        }

        this.updateSelectionUI();

        // Clear region selection when switching takes
        this.clearRegion();


        // Load Audio for the clicked file (if selected and not already loaded)
        if (this.selectedIndices.has(index) && this.currentlyLoadedFileIndex !== index) {
            const item = this.files[index];
            const fileSizeGB = item.file.size / (1024 * 1024 * 1024);

            // Skip audio loading for files > 2GB (browser memory limit)
            if (item.file.size > 2 * 1024 * 1024 * 1024) {
                console.warn(`File ${item.metadata.filename} is ${fileSizeGB.toFixed(2)} GB - skipping audio loading (Metadata Only mode)`);

                // Update UI to show metadata-only mode
                const playerFilename = document.getElementById('player-filename');
                if (playerFilename) {
                    playerFilename.innerHTML = `${item.metadata.filename} <span style="color: #ffcf44; font-size: 0.8em;">(Metadata Only - ${fileSizeGB.toFixed(2)} GB)</span>`;
                }

                // Clear waveform with informative message
                const canvas = document.getElementById('waveform-canvas');
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#ffcf44';
                ctx.font = '16px Inter';
                ctx.fillText(`Playback unavailable - File too large (${fileSizeGB.toFixed(2)} GB)`, 20, 30);
                ctx.fillStyle = '#888';
                ctx.font = '14px Inter';
                ctx.fillText('You can still edit and save metadata for this file', 20, 55);

                this.currentlyLoadedFileIndex = index;
                // Update TC counter display to new take's TC Start
                const currentTimecode = document.getElementById('current-timecode');
                if (currentTimecode) {
                    // Show the TC Start for this file (if available)
                    if (item.metadata && item.metadata.tcStart) {
                        currentTimecode.textContent = item.metadata.tcStart;
                    } else {
                        currentTimecode.textContent = '00:00:00:00';
                    }
                }
            } else {
                await this.loadAudioForFile(index);
                this.currentlyLoadedFileIndex = index;
                // Update TC counter display to new take's TC Start
                const currentTimecode = document.getElementById('current-timecode');
                if (currentTimecode) {
                    if (item.metadata && item.metadata.tcStart) {
                        currentTimecode.textContent = item.metadata.tcStart;
                    } else {
                        currentTimecode.textContent = '00:00:00:00';
                    }
                }
            }
        }
    }

    updateSelectionUI() {
        const rows = document.querySelectorAll('#file-list-body tr');
        rows.forEach((r, i) => {
            if (this.selectedIndices.has(i)) {
                r.classList.add('selected');
            } else {
                r.classList.remove('selected');
            }
        });

        const hasSelection = this.selectedIndices.size > 0;
        document.getElementById('batch-edit-btn').disabled = !hasSelection;
        this.updateSaveButtonState();
        document.getElementById('batch-remove-btn').disabled = !hasSelection;
        document.getElementById('view-ixml-btn').disabled = this.selectedIndices.size !== 1;
        document.getElementById('view-bext-btn').disabled = this.selectedIndices.size !== 1;
        document.getElementById('normalize-btn').disabled = !hasSelection;
        document.getElementById('rename-btn').disabled = !hasSelection;
        document.getElementById('export-btn').disabled = !hasSelection;
        document.getElementById('save-mix-btn').disabled = this.selectedIndices.size !== 1;
        document.getElementById('load-mix-btn').disabled = this.selectedIndices.size !== 1;
        
        // Enable combine button if any sibling groups are detected AND no poly file is selected
        const hasSiblingGroups = this.files.some(item => item.isGroup);
        let isPolySelected = false;
        if (this.selectedIndices.size === 1) {
            const selectedIndex = Array.from(this.selectedIndices)[0];
            const selectedFile = this.files[selectedIndex];
            isPolySelected = selectedFile && 
                           selectedFile.metadata && 
                           selectedFile.metadata.channels > 1 && 
                           !selectedFile.isGroup;
        }
        document.getElementById('combine-btn').disabled = !hasSiblingGroups || isPolySelected;
        
        // Enable split button if exactly one poly file is selected (not a sibling group)
        document.getElementById('split-btn').disabled = !isPolySelected;
    }

    updateSaveButtonState() {
        const hasSelection = this.selectedIndices.size > 0;
        const saveBtn = document.getElementById('batch-save-btn');
        
        if (this.autoSaveEnabled) {
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.5';
            saveBtn.title = 'Auto-save is enabled';
        } else {
            saveBtn.disabled = !hasSelection;
            saveBtn.style.opacity = '';
            saveBtn.title = '';
        }
    }

    openBatchEditModal() {
        if (this.selectedIndices.size === 0) return;

        const modal = document.getElementById('batch-edit-modal');
        document.getElementById('selected-count').textContent = this.selectedIndices.size;

        // Clear form
        document.querySelectorAll('.apply-checkbox').forEach(cb => cb.checked = false);
        document.getElementById('batch-scene').value = '';
        document.getElementById('batch-take').value = '';
        document.getElementById('batch-project').value = '';
        document.getElementById('batch-tape').value = '';
        document.getElementById('batch-notes').value = '';

        modal.classList.add('active');
    }

    closeBatchEditModal() {
        const modal = document.getElementById('batch-edit-modal');
        modal.classList.remove('active');
    }

    applyBatchEdit() {
        const updates = {};

        // Collect checked fields
        if (document.getElementById('apply-scene').checked) {
            updates.scene = document.getElementById('batch-scene').value;
        }
        if (document.getElementById('apply-take').checked) {
            updates.take = document.getElementById('batch-take').value;
        }
        if (document.getElementById('apply-project').checked) {
            updates.project = document.getElementById('batch-project').value;
        }
        if (document.getElementById('apply-tape').checked) {
            updates.tape = document.getElementById('batch-tape').value;
        }
        if (document.getElementById('apply-notes').checked) {
            updates.notes = document.getElementById('batch-notes').value;
        }

        // Apply to selected files
        let updateCount = 0;
        for (const index of this.selectedIndices) {
            const file = this.files[index];
            Object.keys(updates).forEach(key => {
                file.metadata[key] = updates[key];
                updateCount++;
            });
        }

        // Re-render table
        const tbody = document.getElementById('file-list-body');
        tbody.innerHTML = '';
        this.files.forEach((file, i) => this.addTableRow(i, file.metadata));

        // Restore selection
        this.updateSelectionUI();

        // Enable save button
        if (updateCount > 0) {
            document.getElementById('batch-save-btn').disabled = false;
            
            // Trigger auto-save if enabled
            if (this.autoSaveEnabled) {
                this.scheduleAutoSave();
            }
        }

        this.closeBatchEditModal();

        console.log(`Applied ${Object.keys(updates).length} field(s) to ${this.selectedIndices.size} file(s)`);
    }

    async viewIXML() {
        if (this.selectedIndices.size !== 1) return;

        const index = Array.from(this.selectedIndices)[0];
        const item = this.files[index];

        try {
            // Refresh file from handle to ensure we read the latest version
            if (item.handle && item.handle.kind === 'file') {
                item.file = await item.handle.getFile();
            }
            
            const arrayBuffer = await item.file.arrayBuffer();
            const ixmlData = this.extractIXML(arrayBuffer);

            const modal = document.getElementById('ixml-modal');
            const content = document.getElementById('ixml-content');

            if (ixmlData) {
                content.textContent = ixmlData;
            } else {
                content.textContent = 'No iXML data found in this file.';
            }

            modal.classList.add('active');
        } catch (err) {
            console.error('Error reading iXML:', err);
            alert('Failed to read iXML data from file.');
        }
    }

    extractIXML(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        let offset = 12; // Skip RIFF header

        console.log('Searching for iXML chunk in file...');

        while (offset < view.byteLength - 8) {
            const chunkId = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3)
            );
            const chunkSize = view.getUint32(offset + 4, true);

            console.log(`Found chunk: "${chunkId}" with size: ${chunkSize} bytes at offset: ${offset}`);

            if (chunkId === 'iXML') {
                // Found iXML chunk
                console.log(`iXML chunk found! Size: ${chunkSize} bytes`);
                const ixmlBytes = new Uint8Array(arrayBuffer, offset + 8, chunkSize);
                const decoder = new TextDecoder('utf-8');
                let ixmlText = decoder.decode(ixmlBytes);

                // Remove null terminator if present
                ixmlText = ixmlText.replace(/\0+$/, '');

                console.log(`iXML text length: ${ixmlText.length} characters`);
                console.log('First 200 chars:', ixmlText.substring(0, 200));

                return ixmlText;
            }

            offset += 8 + chunkSize;
            if (offset % 2 !== 0) offset++; // Align to even byte
        }

        console.log('No iXML chunk found in file');
        return null; // No iXML chunk found
    }

    closeIXMLModal() {
        const modal = document.getElementById('ixml-modal');
        modal.classList.remove('active');
    }

    async viewBEXT() {
        if (this.selectedIndices.size !== 1) return;

        const index = Array.from(this.selectedIndices)[0];
        const item = this.files[index];

        try {
            const arrayBuffer = await item.file.arrayBuffer();
            const bextData = this.extractBEXT(arrayBuffer);

            const modal = document.getElementById('bext-modal');
            const content = document.getElementById('bext-content');

            if (bextData) {
                content.textContent = bextData;
            } else {
                content.textContent = 'No bEXT data found in this file.';
            }

            modal.classList.add('active');
        } catch (err) {
            console.error('Error reading bEXT:', err);
            alert('Failed to read bEXT data from file.');
        }
    }

    extractBEXT(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        let offset = 12; // Skip RIFF header

        while (offset < view.byteLength - 8) {
            const chunkId = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3)
            );
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId === 'bext') {
                // Found bEXT chunk
                const chunkOffset = offset + 8;

                // Helper to read string
                const readStr = (off, len) => {
                    let s = '';
                    for (let i = 0; i < len; i++) {
                        const c = view.getUint8(off + i);
                        if (c === 0) break;
                        s += String.fromCharCode(c);
                    }
                    return s;
                };

                const description = readStr(chunkOffset, 256);
                const originator = readStr(chunkOffset + 256, 32);
                const originatorRef = readStr(chunkOffset + 288, 32);
                const date = readStr(chunkOffset + 320, 10);
                const time = readStr(chunkOffset + 330, 8);

                const timeRefLow = view.getUint32(chunkOffset + 338, true);
                const timeRefHigh = view.getUint32(chunkOffset + 342, true);
                const timeRef = (BigInt(timeRefHigh) << 32n) | BigInt(timeRefLow);

                const version = view.getUint16(chunkOffset + 346, true);

                // Format output
                let output = `Description: ${description}\n`;
                output += `Originator: ${originator}\n`;
                output += `Originator Reference: ${originatorRef}\n`;
                output += `Origination Date: ${date}\n`;
                output += `Origination Time: ${time}\n`;
                output += `Time Reference: ${timeRef.toString()} samples\n`;
                output += `Version: ${version}\n`;

                // Coding History (starts at offset 602 if version 1, but technically variable)
                // For simplicity, we'll assume standard V1 size of 602 bytes before coding history
                if (chunkSize > 602) {
                    const history = readStr(chunkOffset + 602, chunkSize - 602);
                    if (history) {
                        output += `\nCoding History:\n${history}`;
                    }
                }

                return output;
            }

            offset += 8 + chunkSize;
            if (offset % 2 !== 0) offset++;
        }

        return null;
    }

    closeBEXTModal() {
        const modal = document.getElementById('bext-modal');
        modal.classList.remove('active');
    }

    async loadAudioForFile(index) {
        // Stop current playback and reset UI
        this.stop();

        const item = this.files[index];
        const isGroup = item.isGroup;
        const targetFiles = isGroup ? item.siblings : [item];

        // Calculate total size for progress
        const totalSize = targetFiles.reduce((acc, f) => acc + f.file.size, 0);
        const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

        // Show loading overlay for large files
        const loadingOverlay = document.getElementById('loading-overlay');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const loadingText = document.querySelector('.loading-text');

        console.log(`Loading ${isGroup ? 'Group' : 'Single File'}: ${totalSizeMB} MB total`);

        if (totalSize > 100 * 1024 * 1024) { // > 100MB
            loadingOverlay.style.display = 'flex';
            loadingText.textContent = isGroup ? `Loading ${targetFiles.length} files...` : 'Loading...';
            progressFill.style.width = '0%';
            progressText.textContent = '0%';
            await new Promise(resolve => setTimeout(resolve, 100)); // UI paint
        }

        try {
            const decodedBuffers = [];
            let loadedBytesTotal = 0;

            // Load and Decode each file sequentially
            for (let i = 0; i < targetFiles.length; i++) {
                const f = targetFiles[i];
                console.log(`Loading sibling ${i + 1}/${targetFiles.length}: ${f.file.name}`);

                // Load bytes with global progress
                const arrayBuffer = await this.loadFileWithProgress(f.file, (fileProgress) => {
                    if (loadingOverlay.style.display === 'flex') {
                        // Calculate contribution to total progress
                        // This approximation assumes equal file sizes or tracks loaded bytes
                        // Since loadFileWithProgress gives %, we need to know this file's chunk of total

                        // Simple approach: Split progress bar into slots
                        const slotSize = 100 / targetFiles.length;
                        const base = i * slotSize;
                        const total = base + (fileProgress * slotSize / 100);

                        progressFill.style.width = `${total}%`;
                        progressText.textContent = `${Math.round(total)}%`;
                    }
                });

                // Update text for decoding
                if (loadingOverlay.style.display === 'flex') {
                    loadingText.textContent = `Decoding file ${i + 1}/${targetFiles.length}...`;
                }

                // Decode
                const buffer = await this.audioEngine.decodeFile(arrayBuffer);
                decodedBuffers.push(buffer);
            }

            console.log(`✓ All ${decodedBuffers.length} files decoded.`);

            // Combine buffers into one multi-channel buffer
            let compositeBuffer;

            if (decodedBuffers.length === 1) {
                compositeBuffer = decodedBuffers[0];
            } else {
                // Determine dimensions
                const totalChannels = decodedBuffers.reduce((acc, b) => acc + b.numberOfChannels, 0);
                const length = Math.max(...decodedBuffers.map(b => b.length));
                const sampleRate = decodedBuffers[0].sampleRate; // Assume matching sample rates

                console.log(`Creating composite buffer: ${totalChannels} channels, ${length} frames, ${sampleRate} Hz`);
                compositeBuffer = this.audioEngine.audioCtx.createBuffer(totalChannels, length, sampleRate);

                // Copy channel data
                let channelOffset = 0;
                for (const buf of decodedBuffers) {
                    for (let c = 0; c < buf.numberOfChannels; c++) {
                        // Get data from source
                        const data = buf.getChannelData(c);
                        // Copy to destination
                        compositeBuffer.copyToChannel(data, channelOffset);
                        channelOffset++;
                    }
                }
            }

            // Set Engine Buffer
            this.audioEngine.buffer = compositeBuffer;
            const buffer = compositeBuffer; // Alias for below code

            // Finish Loading UI
            if (loadingOverlay.style.display === 'flex') {
                loadingText.textContent = 'Creating waveform...';
                progressFill.style.width = '100%';
            }

            // Setup Mixer
            const trackCount = buffer.numberOfChannels;
            console.log(`Building mixer for ${trackCount} tracks...`);

            const canvas = document.getElementById('waveform-canvas');
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;

            // Update mixer callbacks for this file (reuse existing mixer instance)
            this.mixer.onTrackNameChange = (trackIndex, newName) => {
                // Find the current item in the source of truth by filename
                // This is robust against sorting or index shifts
                const activeItem = this.files.find(f => f.metadata.filename === item.metadata.filename);

                if (activeItem) {
                    if (!activeItem.metadata.trackNames) activeItem.metadata.trackNames = [];
                    activeItem.metadata.trackNames[trackIndex] = newName;
                    console.log(`Track ${trackIndex} renamed to ${newName} for ${activeItem.metadata.filename}`);

                    // Enable save button
                    document.getElementById('batch-save-btn').disabled = false;
                    
                    // Trigger auto-save if enabled
                    if (this.autoSaveEnabled) {
                        this.scheduleAutoSave();
                    }
                } else {
                    console.warn('Mixer callback error: Loaded file not found in current file list', item.metadata.filename);
                }
            };

            this.mixer.onStateChange = () => {
                // Mixer state changed (mute/solo), re-render waveform
                this.audioEngine.renderWaveform(canvas, buffer, this.mixer.channels, this.cueMarkers, this.selectedCueMarkerId);
            };

            // Build mixer UI for this file (reuses existing mixer container)
            this.mixer.buildUI(trackCount, item.metadata.trackNames);

            // Render Waveform (initial)
            this.audioEngine.renderWaveform(canvas, buffer, this.mixer.channels, this.cueMarkers, this.selectedCueMarkerId);

            // Load cue markers from file
            await this.loadCueMarkers(item);

            // Re-render waveform with loaded markers
            this.audioEngine.renderWaveform(canvas, buffer, this.mixer.channels, this.cueMarkers, this.selectedCueMarkerId);

            // Connect Mixer to Audio Engine
            const mixerNodes = this.mixer.getChannelNodes();
            this.audioEngine.setMixerNodes(mixerNodes);
            this.audioEngine.setupRouting(); // Initialize routing graph
            console.log('Mixer connected successfully');

            // Update Time Display
            document.getElementById('total-time').textContent = item.metadata.duration || '00:00:00';

            // Store metadata for timecode calculation
            this.currentFileMetadata = item.metadata;

            // Update Player Header
            const playerFilename = document.getElementById('player-filename');
            if (playerFilename) {
                playerFilename.textContent = item.metadata.filename;
            }

        } catch (err) {
            console.error('Error loading audio:', err);

            // Handle large file errors gracefully
            const playerFilename = document.getElementById('player-filename');
            if (playerFilename) {
                playerFilename.innerHTML = `${item.metadata.filename} <span style="color: #ffcf44; font-size: 0.8em;">(Error)</span>`;
            }

            // Clear waveform
            const canvas = document.getElementById('waveform-canvas');
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#2a2a2a';
            ctx.font = '14px Inter';
            ctx.fillText('Playback unavailable', 20, 30);

            alert(`Error loading audio for "${item.metadata.filename}": ${err.message}`);
        } finally {
            // Hide loading overlay
            loadingOverlay.style.display = 'none';
        }
    }

    async loadFileWithProgress(file, onProgress) {
        const chunkSize = 10 * 1024 * 1024; // 10MB chunks
        const chunks = [];
        let loadedBytes = 0;

        for (let offset = 0; offset < file.size; offset += chunkSize) {
            const blob = file.slice(offset, Math.min(offset + chunkSize, file.size));
            const chunk = await blob.arrayBuffer();
            chunks.push(chunk);

            loadedBytes += chunk.byteLength;
            const progress = Math.round((loadedBytes / file.size) * 100);
            onProgress(progress);

            // Small delay to allow UI to update
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Combine all chunks into single ArrayBuffer
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const combined = new Uint8Array(totalLength);
        let position = 0;

        for (const chunk of chunks) {
            combined.set(new Uint8Array(chunk), position);
            position += chunk.byteLength;
        }

        return combined.buffer;
    }

    togglePlay() {
        if (this.files.length === 0) return;

        this.isStopped = false; // Allow animation

        if (this.audioEngine.isPlaying) {
            this.audioEngine.stop();
            this.mixer.stopRecording(); // Stop automation recording
            document.getElementById('play-btn').textContent = '▶';
        } else {
            // If no file loaded, load selected
            if (!this.audioEngine.buffer && this.selectedIndices.size > 0) {
                // ... logic to load ...
                // For now assume loaded
            }

            if (this.audioEngine.buffer) {
                // If region is selected, start from region start
                let startTime = this.audioEngine.pauseTime;
                if (this.region.start !== null && this.region.end !== null) {
                    startTime = Math.min(this.region.start, this.region.end);
                }

                this.audioEngine.play(startTime);
                this.mixer.startRecording(startTime); // Start automation recording
                document.getElementById('play-btn').textContent = '⏸';
            }
        }
    }

    stop() {
        console.log('Stop called');
        this.isStopped = true; // Block animation loop

        this.audioEngine.stop();
        this.mixer.stopRecording(); // Stop automation recording
        this.audioEngine.seek(0);
        document.getElementById('play-btn').textContent = '▶';

        const resetUI = () => {
            const oldPlayhead = document.getElementById('playhead');
            if (oldPlayhead) {
                // Clone and replace to force fresh state
                const newPlayhead = oldPlayhead.cloneNode(true);
                newPlayhead.style.left = '0%';
                oldPlayhead.parentNode.replaceChild(newPlayhead, oldPlayhead);
                console.log('Playhead replaced and reset to 0%');
            }

            const currentTime = document.getElementById('current-time');
            if (currentTime) {
                currentTime.textContent = '00:00:00.00';
            }

            const currentTimecode = document.getElementById('current-timecode');
            if (currentTimecode) {
                currentTimecode.textContent = this.secondsToTimecode(0);
            }
        };

        resetUI();
    }

    updateRegionDisplay() {
        const regionOverlay = document.getElementById('region-overlay');
        if (!this.audioEngine.buffer || this.region.start === null) {
            regionOverlay.classList.remove('active');
            this.updateExportButtonText();
            return;
        }

        const duration = this.audioEngine.buffer.duration;
        const startPercent = (this.region.start / duration) * 100;
        const endPercent = (this.region.end / duration) * 100;

        const left = Math.min(startPercent, endPercent);
        const width = Math.abs(endPercent - startPercent);

        regionOverlay.style.left = `${left}%`;
        regionOverlay.style.width = `${width}%`;
        regionOverlay.classList.add('active');
        this.updateExportButtonText();
    }

    clearRegion() {
        this.region.start = null;
        this.region.end = null;
        const regionOverlay = document.getElementById('region-overlay');
        regionOverlay.classList.remove('active');
        this.updateExportButtonText();
    }

    updateExportButtonText() {
        const exportBtn = document.getElementById('export-btn');
        const confirmExportBtn = document.getElementById('confirm-export-btn');
        const text = (this.region.start !== null && this.region.end !== null) ? 'Export Region' : 'Export';

        if (exportBtn) {
            exportBtn.textContent = text;
        }
        if (confirmExportBtn) {
            confirmExportBtn.textContent = text;
        }
    }

    animate() {
        if (this.audioEngine.isPlaying && !this.isStopped) {
            const time = this.audioEngine.getCurrentTime();

            // Update automation
            this.mixer.updateAutomation(time);

            const duration = this.audioEngine.buffer ? this.audioEngine.buffer.duration : 1;
            const percent = time / duration;

            // Check if we've reached the end of a region
            if (this.region.start !== null && this.region.end !== null) {
                const regionStart = Math.min(this.region.start, this.region.end);
                const regionEnd = Math.max(this.region.start, this.region.end);

                if (time >= regionEnd) {
                    if (this.isLooping) {
                        // Loop back to region start
                        console.log('Looping back from', time, 'to', regionStart);
                        this.audioEngine.seek(regionStart);
                        // Skip the rest of this frame to avoid playhead flicker
                        requestAnimationFrame(this.animate);
                        return;
                    } else {
                        // Stop at region end
                        this.audioEngine.stop();
                        this.audioEngine.seek(regionEnd);
                        document.getElementById('play-btn').textContent = '▶';
                    }
                }
            }

            // Update Playhead
            const playhead = document.getElementById('playhead');
            if (playhead) {
                playhead.style.left = `${percent * 100}%`;
            }

            // Update Time Display
            const currentTime = document.getElementById('current-time');
            if (currentTime) {
                currentTime.textContent = this.formatTime(time);
            }

            // Update Timecode Display
            const currentTimecode = document.getElementById('current-timecode');
            if (currentTimecode) {
                currentTimecode.textContent = this.secondsToTimecode(time);
            }
        }

        // Update Mixer Meters
        if (this.mixer) {
            this.mixer.updateMeters();
        }

        requestAnimationFrame(this.animate);
    }

    openNormalizeModal() {
        document.getElementById('normalize-modal').classList.add('active');
    }

    closeNormalizeModal() {
        document.getElementById('normalize-modal').classList.remove('active');
    }

    async applyNormalize() {
        const targetDb = parseFloat(document.getElementById('normalize-target').value);
        if (isNaN(targetDb) || targetDb > 0 || targetDb < -20) {
            alert('Please enter a valid target level between -20 and 0 dBFS.');
            return;
        }

        this.closeNormalizeModal();

        // Show loading state (cursor)
        document.body.style.cursor = 'wait';

        try {
            const indices = Array.from(this.selectedIndices);
            let processedCount = 0;

            for (const index of indices) {
                const item = this.files[index];
                const targets = item.isGroup ? item.siblings : [item];

                for (const target of targets) {
                    console.log(`Normalizing ${target.metadata.filename}...`);

                    // Read file
                    const arrayBuffer = await target.file.arrayBuffer();

                    // Normalize
                    // Note: normalize modifies buffer in place or returns new one
                    // Check if region is active (both start and end are not null)
                    const region = (this.region && this.region.start !== null && this.region.end !== null) ? this.region : null;
                    const normalizedBuffer = await this.audioProcessor.normalize(arrayBuffer, targetDb, region);

                    // Save back to file
                    // We use the file handle to write the raw WAV bytes directly
                    const writable = await target.handle.createWritable();
                    await writable.write(normalizedBuffer);
                    await writable.close();

                    // Refresh file object on the target (Sibling or Single)
                    // CRITICAL: This updates the reference so subsequent reads (like loadAudioForFile)
                    // use the valid, new file blob.
                    target.file = await target.handle.getFile();
                }

                // If Group, update the main item convenience ref too
                if (item.isGroup && item.siblings.length > 0) {
                    item.file = item.siblings[0].file;
                }

                // If this is the currently loaded file, reload audio engine
                // Use setTimeout to allow handle to settle if needed, though await above should suffice
                if (this.currentFileMetadata && this.currentFileMetadata.filename === item.metadata.filename) {
                    // Force reload of the updated file blobs
                    await this.loadAudioForFile(index);
                }

                processedCount++;
            }

            alert(`Successfully normalized ${processedCount} file(s).`);

        } catch (err) {
            console.error('Normalization failed:', err);
            alert('An error occurred during normalization. Check console for details.');
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    openRenameModal() {
        if (this.selectedIndices.size === 0) return;
        document.getElementById('rename-modal').classList.add('active');
        this.updateRenamePreview();
    }

    closeRenameModal() {
        document.getElementById('rename-modal').classList.remove('active');
    }

    updateRenamePreview() {
        if (this.selectedIndices.size === 0) return;

        const firstIndex = this.selectedIndices.values().next().value;
        const file = this.files[firstIndex];
        const pattern = document.querySelector('input[name="rename-pattern"]:checked').value;
        const sep1 = document.getElementById('rename-sep1').value;
        const sep2 = document.getElementById('rename-sep2').value;

        // Extract track suffix from original filename to show preview with suffix
        const originalName = file.metadata.filename;
        const trackSuffixMatch = originalName.match(/(_\d+)\.wav$/);
        const trackSuffix = trackSuffixMatch ? trackSuffixMatch[1] : '';

        const newName = this.generateFilename(file.metadata, pattern, sep1, sep2, trackSuffix);
        document.getElementById('rename-preview').textContent = newName;
    }

    generateFilename(metadata, pattern, sep1, sep2, trackSuffix = '') {
        const scene = metadata.scene || 'SCENE';
        const take = metadata.take || 'TAKE';
        const project = metadata.project || 'PROJECT';

        let name = '';
        if (pattern === 'project-scene-take') {
            name = `${project}${sep1}${scene}${sep2}${take}`;
        } else {
            name = `${scene}${sep2}${take}`;
        }

        // Append track suffix if provided (for sibling files)
        if (trackSuffix) {
            name += trackSuffix;
        }

        return `${name}.wav`;
    }

    async applyRename() {
        this.closeRenameModal();
        document.body.style.cursor = 'wait';

        try {
            const pattern = document.querySelector('input[name="rename-pattern"]:checked').value;
            const sep1 = document.getElementById('rename-sep1').value;
            const sep2 = document.getElementById('rename-sep2').value;

            const indices = Array.from(this.selectedIndices);
            let renamedCount = 0;
            let failedCount = 0;
            const renamedIndices = new Set();

            for (const index of indices) {
                const item = this.files[index];
                
                // Determine which files to rename: if it's a group, rename all siblings, otherwise just this file
                const targetFiles = item.isGroup ? item.siblings : [item];

                for (const targetItem of targetFiles) {
                    // Extract track suffix from original filename (e.g., '_1', '_2', '_3')
                    const originalName = targetItem.metadata.filename;
                    const trackSuffixMatch = originalName.match(/(_\d+)\.wav$/);
                    const trackSuffix = trackSuffixMatch ? trackSuffixMatch[1] : '';

                    const newName = this.generateFilename(targetItem.metadata, pattern, sep1, sep2, trackSuffix);

                    if (originalName === newName) continue; // Skip if same

                    console.log(`Renaming ${originalName} to ${newName}`);

                    if (targetItem.handle && targetItem.handle.move) {
                        await targetItem.handle.move(newName);
                        targetItem.metadata.filename = newName;
                        targetItem.file = await targetItem.handle.getFile(); // Refresh file object
                        renamedCount++;
                        renamedIndices.add(this.files.indexOf(targetItem));
                    } else {
                        console.warn(`File System Access API "move" not supported on ${originalName}.`);
                        failedCount++;
                    }
                }
            }

            // Refresh UI
            const tbody = document.getElementById('file-list-body');
            tbody.innerHTML = '';
            this.files.forEach((file, i) => this.addTableRow(i, file.metadata));
            this.updateSelectionUI();

            if (failedCount > 0) {
                alert(`Renamed ${renamedCount} files. Failed to rename ${failedCount} files (Browser may not support renaming local files directly).`);
            } else {
                alert(`Successfully renamed ${renamedCount} files.`);
            }

        } catch (err) {
            console.error('Rename failed:', err);
            alert('An error occurred during rename. Check console for details.');
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    openExportModal() {
        if (this.selectedIndices.size === 0) return;
        const count = this.selectedIndices.size;
        const modalHeader = document.querySelector('#export-modal .modal-header h3');
        modalHeader.textContent = count === 1 ? 'Export Mix' : `Export ${count} Files`;

        // Restore last selected mix mode
        const lastMixMode = localStorage.getItem('exportMixMode') || 'current';
        const radioBtn = document.querySelector(`input[name="mix-mode"][value="${lastMixMode}"]`);
        if (radioBtn) radioBtn.checked = true;

        // Check if automation exists when automation is selected
        document.querySelectorAll('input[name="mix-mode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.value === 'automation') {
                    const hasAutomation = this.mixer.channels.some(ch =>
                        ch.automation && ch.automation.volume && ch.automation.volume.length > 0
                    );

                    if (!hasAutomation) {
                        alert('No automation data found. Falling back to "Use Current Mix".');
                        document.querySelector('input[name="mix-mode"][value="current"]').checked = true;
                    }
                }
            });
        });

        document.getElementById('export-modal').classList.add('active');
    }

    closeExportModal() {
        document.getElementById('export-modal').classList.remove('active');
    }

    async handleExport() {
        const format = document.getElementById('export-format').value;
        const mixMode = document.querySelector('input[name="mix-mode"]:checked').value;
        const selectedFiles = Array.from(this.selectedIndices).map(i => this.files[i]);

        if (selectedFiles.length === 0) return;

        // Save mix mode preference
        localStorage.setItem('exportMixMode', mixMode);

        this.closeExportModal();

        // 1. Get Save Handle(s) FIRST (while we still have user gesture)
        let singleFileHandle = null;
        let outputDirHandle = null;
        let singleOutputFilename = '';

        try {
            if (selectedFiles.length === 1) {
                // Single file export - ask for save location immediately
                if (window.showSaveFilePicker) {
                    const item = selectedFiles[0];
                    const extension = format;
                    const isRegionExport = this.region.start !== null && this.region.end !== null;
                    const baseName = item.metadata.filename.replace(/\.wav$/i, '');
                    const suffix = isRegionExport ? '_region_mix' : '_mix';
                    singleOutputFilename = `${baseName}${suffix}.${extension}`;

                    try {
                        singleFileHandle = await window.showSaveFilePicker({
                            suggestedName: singleOutputFilename,
                            types: [{
                                description: extension.toUpperCase() + ' Audio',
                                accept: { [`audio/${extension}`]: [`.${extension}`] },
                            }],
                        });
                    } catch (err) {
                        if (err.name === 'AbortError') return; // User cancelled
                        throw err;
                    }
                }
            } else {
                // Batch export - ask for directory
                try {
                    outputDirHandle = await window.showDirectoryPicker();
                } catch (err) {
                    if (err.name === 'AbortError') return; // User cancelled
                    throw err;
                }
            }
        } catch (err) {
            console.error('Error getting save location:', err);
            alert(`Failed to get save location: ${err.message}`);
            return;
        }

        // 2. Start Processing
        document.body.style.cursor = 'wait';
        let successCount = 0;
        let failCount = 0;

        try {
            for (const item of selectedFiles) {
                // Show progress
                if (selectedFiles.length > 1) {
                    console.log(`Exporting ${successCount + failCount + 1} of ${selectedFiles.length}: ${item.metadata.filename}`);
                }

                // Load audio if needed
                let buffer = this.audioEngine.buffer;
                // If this is NOT the currently loaded file, we need to load it temporarily
                if (!this.currentFileMetadata || this.currentFileMetadata.filename !== item.metadata.filename) {
                    // For batch export to work properly, we MUST load the audio.
                    const arrayBuffer = await item.file.arrayBuffer();
                    buffer = await this.audioEngine.decodeAudio(arrayBuffer);
                }

                if (!buffer) {
                    console.error(`No audio data for ${item.metadata.filename}`);
                    failCount++;
                    continue;
                }

                // Render Mix
                let start = 0;
                let end = buffer.duration;
                let isRegionExport = false;
                let exportMetadata = null;

                // Only apply region if we are exporting the single currently loaded file
                if (selectedFiles.length === 1 && this.region.start !== null && this.region.end !== null) {
                    const regionStart = Math.min(this.region.start, this.region.end);
                    const regionEnd = Math.max(this.region.start, this.region.end);

                    // Calculate new timeReference for region export
                    // New TC Start = old TC Start + region offset in samples
                    const sampleRate = buffer.sampleRate;
                    const regionStartSamples = Math.round(regionStart * sampleRate);
                    const oldTimeReference = item.metadata.timeReference || 0;
                    const newTimeReference = oldTimeReference + regionStartSamples;

                    exportMetadata = {
                        timeReference: newTimeReference
                    };

                    // Extract region first
                    buffer = this.audioEngine.extractRegion(buffer, regionStart, regionEnd);
                    isRegionExport = true;
                }

                // Render stereo mix
                const renderedBuffer = await this.audioEngine.renderStereoMix(
                    buffer,
                    this.mixer.channels,
                    mixMode
                );

                // Encode
                let blob;
                let extension = format;

                if (format === 'wav') {
                    const bitDepth = parseInt(document.getElementById('export-bitdepth').value);
                    const originalBuffer = await item.file.arrayBuffer();
                    const wavBuffer = this.audioProcessor.createWavFile(renderedBuffer, bitDepth, originalBuffer, exportMetadata);
                    
                    // For region exports, append fresh iXML chunk with proper TIMESTAMP_SAMPLES_SINCE_MIDNIGHT
                    if (isRegionExport && exportMetadata) {
                        // Create new metadata for the exported region
                        const exportedMetadata = { ...item.metadata };
                        exportedMetadata.timeReference = exportMetadata.timeReference;
                        
                        // Use metadata handler to create proper iXML chunk
                        const ixmlChunk = this.metadataHandler.createIXMLChunk(exportedMetadata);
                        
                        // Append iXML chunk to the WAV file
                        const wavView = new DataView(wavBuffer);
                        const wavArray = new Uint8Array(wavBuffer);
                        
                        // Find the size of the RIFF file (excluding 8 bytes for 'RIFF' and size field)
                        const riffSize = wavView.getUint32(4, true);
                        const oldFileSize = riffSize + 8;
                        const newFileSize = oldFileSize + 8 + ixmlChunk.byteLength; // 8 bytes for 'iXML' and size
                        
                        // Create new buffer with iXML chunk
                        const newWavBuffer = new Uint8Array(newFileSize);
                        newWavBuffer.set(wavArray);
                        
                        // Write iXML chunk header at the end
                        const chunkOffset = oldFileSize;
                        newWavBuffer[chunkOffset] = 0x69;     // 'i'
                        newWavBuffer[chunkOffset + 1] = 0x58; // 'X'
                        newWavBuffer[chunkOffset + 2] = 0x4D; // 'M'
                        newWavBuffer[chunkOffset + 3] = 0x4C; // 'L'
                        const chunkView = new DataView(newWavBuffer.buffer);
                        chunkView.setUint32(chunkOffset + 4, ixmlChunk.byteLength, true);
                        newWavBuffer.set(new Uint8Array(ixmlChunk), chunkOffset + 8);
                        
                        // Update RIFF size
                        const newRiffSize = newFileSize - 8;
                        chunkView.setUint32(4, newRiffSize, true);
                        
                        blob = new Blob([newWavBuffer.buffer], { type: 'audio/wav' });
                    } else {
                        blob = new Blob([wavBuffer], { type: 'audio/wav' });
                    }
                } else if (format === 'mp3') {
                    if (typeof lamejs === 'undefined') {
                        alert('lamejs library not loaded. Please refresh the page.');
                        document.body.style.cursor = 'default';
                        return;
                    }
                    // Convert to MP3
                    const channels = renderedBuffer.numberOfChannels;
                    const sampleRate = renderedBuffer.sampleRate;
                    const mp3Encoder = new lamejs.Mp3Encoder(channels, sampleRate, 192); // 192kbps
                    const mp3Data = [];

                    // Get channel data
                    const left = renderedBuffer.getChannelData(0);
                    const right = channels > 1 ? renderedBuffer.getChannelData(1) : left;

                    // Process in chunks
                    const sampleBlockSize = 1152;
                    for (let i = 0; i < left.length; i += sampleBlockSize) {
                        const leftChunk = left.subarray(i, i + sampleBlockSize);
                        const rightChunk = right.subarray(i, i + sampleBlockSize);

                        // Convert float to int16
                        const leftInt = new Int16Array(leftChunk.length);
                        const rightInt = new Int16Array(rightChunk.length);

                        for (let j = 0; j < leftChunk.length; j++) {
                            leftInt[j] = leftChunk[j] < 0 ? leftChunk[j] * 0x8000 : leftChunk[j] * 0x7FFF;
                            rightInt[j] = rightChunk[j] < 0 ? rightChunk[j] * 0x8000 : rightChunk[j] * 0x7FFF;
                        }

                        const mp3buf = channels === 1
                            ? mp3Encoder.encodeBuffer(leftInt)
                            : mp3Encoder.encodeBuffer(leftInt, rightInt);

                        if (mp3buf.length > 0) mp3Data.push(mp3buf);
                    }

                    const mp3buf = mp3Encoder.flush();
                    if (mp3buf.length > 0) mp3Data.push(mp3buf);

                    blob = new Blob(mp3Data, { type: 'audio/mp3' });
                }

                if (blob) {
                    const baseName = item.metadata.filename.replace(/\.wav$/i, '');
                    const suffix = isRegionExport ? '_region_mix' : '_mix';
                    const outputFilename = `${baseName}${suffix}.${extension}`;

                    if (singleFileHandle) {
                        // Write to the handle we got earlier
                        const writable = await singleFileHandle.createWritable();
                        await writable.write(blob);
                        await writable.close();
                        successCount++;
                    } else if (outputDirHandle) {
                        // Batch export to directory
                        try {
                            const fileHandle = await outputDirHandle.getFileHandle(outputFilename, { create: true });
                            const writable = await fileHandle.createWritable();
                            await writable.write(blob);
                            await writable.close();
                            successCount++;
                        } catch (err) {
                            console.error(`Failed to save ${outputFilename}:`, err);
                            failCount++;
                        }
                    } else {
                        // Fallback download
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = outputFilename;
                        a.click();
                        successCount++;
                    }
                }
            }
        } catch (err) {
            console.error('Export process failed:', err);
            alert(`An error occurred during export: ${err.message}`);
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    async saveMixerSettingsToFile() {
        const index = this.selectedIndices.values().next().value;
        const item = this.files[index];

        if (!this.audioEngine.buffer) {
            alert('No audio loaded. Please wait for the file to load.');
            return;
        }

        try {
            document.body.style.cursor = 'wait';

            // Get current mixer state
            const mixerState = this.mixer.getMixerState();

            // Read existing file
            const arrayBuffer = await item.file.arrayBuffer();

            // Get existing iXML (if any)
            const existingIXML = this.metadataHandler.getIXMLChunk(arrayBuffer);

            // Inject mixer settings into iXML
            const newIXML = MixerMetadata.injectIntoIXML(existingIXML, mixerState);

            // Write updated iXML back to file
            await this.metadataHandler.updateIXMLChunk(item.handle, arrayBuffer, newIXML);

            // Refresh file object
            item.file = await item.handle.getFile();

            // Update in-memory metadata to include the new iXML (preserving mixer settings for future saves)
            item.metadata.ixmlRaw = newIXML;

            alert(`Mixer settings saved to ${item.metadata.filename}`);
        } catch (err) {
            console.error('Failed to save mixer settings:', err);
            alert(`Failed to save mixer settings: ${err.message}`);
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    async loadMixerSettingsFromFile() {
        if (this.selectedIndices.size !== 1) return;

        const index = this.selectedIndices.values().next().value;
        const item = this.files[index];

        try {
            document.body.style.cursor = 'wait';

            // Read file
            const arrayBuffer = await item.file.arrayBuffer();

            // Get iXML chunk
            const ixmlString = this.metadataHandler.getIXMLChunk(arrayBuffer);

            if (!ixmlString) {
                alert('No iXML metadata found in this file.');
                return;
            }

            // Extract mixer settings
            const mixerData = MixerMetadata.extractFromIXML(ixmlString);

            if (!mixerData || !mixerData.channels || mixerData.channels.length === 0) {
                alert('No mixer settings found in this file.');
                return;
            }

            // Apply to mixer
            this.mixer.setMixerState(mixerData.channels);

            // Store settings to reapply after audio loads (which rebuilds the mixer)
            this.pendingMixerSettings = mixerData.channels;
            setTimeout(() => {
                if (this.pendingMixerSettings) {
                    this.mixer.setMixerState(this.pendingMixerSettings);
                    this.pendingMixerSettings = null;
                }
            }, 500); // Wait for audio to load and mixer to rebuild

            alert(`Mixer settings loaded from ${item.metadata.filename}\nVersion: ${mixerData.version}`);
        } catch (err) {
            console.error('Failed to load mixer settings:', err);
            alert(`Failed to load mixer settings: ${err.message}`);
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    secondsToTimecode(seconds) {
        if (!this.currentFileMetadata || !this.currentFileMetadata.sampleRate) {
            return '00:00:00:00';
        }

        // Get FPS
        let fps = 24; // default
        if (this.currentFileMetadata.fpsExact) {
            fps = this.currentFileMetadata.fpsExact.numerator / this.currentFileMetadata.fpsExact.denominator;
        } else if (this.currentFileMetadata.fps) {
            fps = parseFloat(this.currentFileMetadata.fps) || 24;
        }

        // Convert seconds to samples
        const samples = Math.floor(seconds * this.currentFileMetadata.sampleRate);

        // Add TC start offset if available
        const tcStartSamples = this.currentFileMetadata.timeReference || 0;
        const totalSamples = samples + tcStartSamples;

        // Convert to timecode
        const totalFrames = Math.floor(totalSamples / this.currentFileMetadata.sampleRate * fps);

        const frames = totalFrames % Math.floor(fps);
        const totalSeconds = Math.floor(totalFrames / fps);
        const s = totalSeconds % 60;
        const m = Math.floor(totalSeconds / 60) % 60;
        const h = Math.floor(totalSeconds / 3600);

        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
    }

    // ===== Cue Marker Methods =====

    /**
     * Create a new cue marker at specified time
     */
    createCueMarker(time) {
        if (this.cueMarkers.isFull()) {
            alert('Maximum 100 cue markers reached');
            return;
        }

        const id = this.cueMarkers.add(time);
        if (id) {
            this.selectedCueMarkerId = id;
            this.saveCueMarkers(); // Auto-save
            this.refreshWaveform();
            console.log(`Created cue marker at ${time.toFixed(3)}s`);
        }
    }

    /**
     * Delete a cue marker by ID
     */
    deleteCueMarker(id) {
        if (this.cueMarkers.remove(id)) {
            this.selectedCueMarkerId = null;
            this.saveCueMarkers(); // Auto-save
            this.refreshWaveform();
            console.log(`Deleted cue marker #${id}`);
        }
    }

    /**
     * Jump to next cue marker
     */
    jumpToNextCue() {
        if (!this.audioEngine.buffer) return;

        const currentTime = this.audioEngine.getCurrentTime();
        const nextMarker = this.cueMarkers.getNextMarker(currentTime);

        let targetTime;
        if (nextMarker) {
            targetTime = nextMarker.time;
            this.audioEngine.seek(targetTime);
            this.selectedCueMarkerId = nextMarker.id;
            console.log(`Jumped to next cue marker #${nextMarker.id} at ${targetTime.toFixed(3)}s`);
        } else {
            // No next marker - jump to 0.1s before end
            targetTime = this.audioEngine.buffer.duration - 0.1;
            this.audioEngine.seek(Math.max(0, targetTime));
            this.selectedCueMarkerId = null;
            console.log('No next cue marker - jumped to end');
        }

        // Update playhead UI
        const percent = (targetTime / this.audioEngine.buffer.duration) * 100;
        const playhead = document.getElementById('playhead');
        if (playhead) {
            playhead.style.left = `${percent}%`;
        }
        document.getElementById('current-time').textContent = this.formatTime(targetTime);
        const currentTimecode = document.getElementById('current-timecode');
        if (currentTimecode) {
            currentTimecode.textContent = this.secondsToTimecode(targetTime);
        }

        this.refreshWaveform();
    }

    /**
     * Jump to previous cue marker
     */
    jumpToPreviousCue() {
        if (!this.audioEngine.buffer) return;

        const currentTime = this.audioEngine.getCurrentTime();
        const prevMarker = this.cueMarkers.getPreviousMarker(currentTime);

        let targetTime;
        if (prevMarker) {
            targetTime = prevMarker.time;
            this.audioEngine.seek(targetTime);
            this.selectedCueMarkerId = prevMarker.id;
            console.log(`Jumped to previous cue marker #${prevMarker.id} at ${targetTime.toFixed(3)}s`);
        } else {
            // No previous marker - jump to start
            targetTime = 0;
            this.audioEngine.seek(targetTime);
            this.selectedCueMarkerId = null;
            console.log('No previous cue marker - jumped to start');
        }

        // Update playhead UI
        const percent = (targetTime / this.audioEngine.buffer.duration) * 100;
        const playhead = document.getElementById('playhead');
        if (playhead) {
            playhead.style.left = `${percent}%`;
        }
        document.getElementById('current-time').textContent = this.formatTime(targetTime);
        const currentTimecode = document.getElementById('current-timecode');
        if (currentTimecode) {
            currentTimecode.textContent = this.secondsToTimecode(targetTime);
        }

        this.refreshWaveform();
    }

    /**
     * Refresh waveform rendering (to show updated cue markers)
     */
    refreshWaveform() {
        const canvas = document.getElementById('waveform-canvas');
        if (this.audioEngine.buffer && canvas) {
            this.audioEngine.renderWaveform(canvas, this.audioEngine.buffer, this.mixer.channels, this.cueMarkers, this.selectedCueMarkerId);
        }
    }

    /**
     * Save cue markers to WAV file(s)
     */
    async saveCueMarkers() {
        if (this.currentlyLoadedFileIndex === -1) {
            console.warn('No file loaded - cannot save cue markers');
            return;
        }

        const item = this.files[this.currentlyLoadedFileIndex];
        const isGroup = item.isGroup;
        const targets = isGroup ? item.siblings : [item];

        for (const target of targets) {
            try {
                const arrayBuffer = await target.file.arrayBuffer();
                const sampleRate = target.metadata.sampleRate;

                if (!sampleRate) {
                    console.error(`Cannot save cue markers: no sample rate for ${target.metadata.filename}`);
                    continue;
                }

                // Create cue chunk
                const cueChunk = this.metadataHandler.createCueChunk(
                    this.cueMarkers.getAllSorted(),
                    sampleRate
                );

                // Update iXML with sync points
                const existingIXML = this.metadataHandler.getIXMLChunk(arrayBuffer);
                const newIXML = this.metadataHandler.injectCuesIntoIXML(
                    existingIXML,
                    this.cueMarkers.getAllSorted(),
                    sampleRate
                );

                // Write both chunks to file
                await this.metadataHandler.updateCueMarkers(
                    target.handle,
                    arrayBuffer,
                    cueChunk,
                    newIXML
                );

                // Refresh file object
                target.file = await target.handle.getFile();

                console.log(`✓ Cue markers saved to ${target.metadata.filename}`);
            } catch (err) {
                console.error(`Failed to save cue markers to ${target.metadata.filename}:`, err);
            }
        }
    }

    /**
     * Load cue markers from WAV file
     */
    async loadCueMarkers(item) {
        this.cueMarkers.clear();
        this.selectedCueMarkerId = null;

        try {
            const arrayBuffer = await item.file.arrayBuffer();
            const sampleRate = item.metadata.sampleRate;

            if (!sampleRate) {
                console.warn('Cannot load cue markers: no sample rate');
                return;
            }

            // Try loading from iXML first (has labels)
            const ixmlString = this.metadataHandler.getIXMLChunk(arrayBuffer);
            if (ixmlString) {
                const syncPoints = this.metadataHandler.parseIXMLSyncPoints(ixmlString);
                if (syncPoints && syncPoints.length > 0) {
                    syncPoints.forEach(sp => {
                        const time = sp.samplePosition / sampleRate;
                        this.cueMarkers.add(time, sp.label || '');
                    });
                    console.log(`Loaded ${syncPoints.length} cue markers from iXML`);
                    return;
                }
            }

            // Fallback to cue chunk (no labels)
            const cuePoints = this.metadataHandler.parseCueChunk(arrayBuffer);
            if (cuePoints && cuePoints.length > 0) {
                cuePoints.forEach(cp => {
                    const time = cp.samplePosition / sampleRate;
                    this.cueMarkers.add(time, '');
                });
                console.log(`Loaded ${cuePoints.length} cue markers from cue chunk`);
            }
        } catch (err) {
            console.error('Error loading cue markers:', err);
        }
    }

    /**
     * Open cue marker edit modal
     */
    openCueMarkerModal(markerId) {
        const marker = this.cueMarkers.findById(markerId);
        if (!marker) return;

        this.editingCueMarkerId = markerId;

        document.getElementById('cue-label-input').value = marker.label || '';
        document.getElementById('cue-time-display').value = this.formatTime(marker.time);

        const modal = document.getElementById('cue-marker-modal');
        modal.classList.add('active');

        // Focus on label input
        setTimeout(() => {
            document.getElementById('cue-label-input').focus();
        }, 100);
    }

    /**
     * Close cue marker modal
     */
    closeCueMarkerModal() {
        const modal = document.getElementById('cue-marker-modal');
        modal.classList.remove('active');
        this.editingCueMarkerId = null;
    }

    /**
     * Apply cue marker label edit
     */
    applyCueMarkerEdit() {
        if (!this.editingCueMarkerId) return;

        const newLabel = document.getElementById('cue-label-input').value;
        this.cueMarkers.updateLabel(this.editingCueMarkerId, newLabel);
        this.saveCueMarkers();
        this.refreshWaveform();
        this.closeCueMarkerModal();
    }

    /**
     * Delete cue marker from modal
     */
    deleteCueMarkerFromModal() {
        if (!this.editingCueMarkerId) return;

        if (confirm('Delete this cue marker?')) {
            this.deleteCueMarker(this.editingCueMarkerId);
            this.closeCueMarkerModal();
        }
    }

    /**
     * Open combine sibling files modal
     */
    openCombineModal() {
        // Find all sibling groups
        const siblingGroups = this.files.filter(item => item.isGroup);
        
        if (siblingGroups.length === 0) {
            alert('No sibling file groups detected.');
            return;
        }

        const container = document.getElementById('combine-groups-container');
        container.innerHTML = '';

        // Store combine state
        this.combineGroups = siblingGroups.map((group, groupIndex) => {
            const baseName = group.metadata.filename.replace(/_X\.wav$/, '');
            
            return {
                groupIndex: groupIndex,
                baseName: baseName,
                siblings: group.siblings.map((sib, index) => ({
                    originalIndex: index,
                    handle: sib.handle,
                    file: sib.file,
                    metadata: sib.metadata,
                    order: index,
                    selected: true // All selected by default
                })),
                metadata: { ...group.metadata },
                destinationHandle: null // Will store directory handle
            };
        });

        // Render each group
        this.combineGroups.forEach((group, groupIndex) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'combine-group';
            groupDiv.dataset.groupIndex = groupIndex;

            const header = document.createElement('div');
            header.className = 'combine-group-header';
            header.innerHTML = `
                <h4>${group.baseName}</h4>
                <div class="combine-group-info">
                    ${group.siblings.length} files • 
                    ${group.metadata.sampleRate / 1000}kHz • 
                    ${group.metadata.bitDepth}-bit • 
                    ${group.metadata.duration}
                </div>
            `;

            const fileList = document.createElement('div');
            fileList.className = 'combine-file-list';
            fileList.dataset.groupIndex = groupIndex;

            group.siblings.forEach((sibling, index) => {
                const fileItem = document.createElement('div');
                fileItem.className = 'combine-file-item';
                fileItem.draggable = true;
                fileItem.dataset.groupIndex = groupIndex;
                fileItem.dataset.fileIndex = index;

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'combine-file-checkbox';
                checkbox.checked = true;
                checkbox.dataset.groupIndex = groupIndex;
                checkbox.dataset.fileIndex = index;
                checkbox.addEventListener('change', (e) => {
                    this.combineGroups[groupIndex].siblings[index].selected = e.target.checked;
                    // Update channel count preview
                    const selectedCount = this.combineGroups[groupIndex].siblings.filter(s => s.selected).length;
                    const countSpan = groupDiv.querySelector('.selected-count');
                    if (countSpan) {
                        countSpan.textContent = selectedCount;
                    }
                });

                const dragHandle = document.createElement('div');
                dragHandle.className = 'drag-handle';
                dragHandle.textContent = '⋮⋮';

                const fileName = document.createElement('div');
                fileName.className = 'file-name';
                fileName.textContent = sibling.metadata.filename;

                const channelLabel = document.createElement('div');
                channelLabel.className = 'channel-label';
                channelLabel.textContent = `Ch ${index + 1}`;

                fileItem.appendChild(checkbox);
                fileItem.appendChild(dragHandle);
                fileItem.appendChild(fileName);
                fileItem.appendChild(channelLabel);

                // Drag and drop handlers
                fileItem.addEventListener('dragstart', (e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', JSON.stringify({ groupIndex, fileIndex: index }));
                    fileItem.classList.add('dragging');
                });

                fileItem.addEventListener('dragend', (e) => {
                    fileItem.classList.remove('dragging');
                });

                fileItem.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const dragging = fileList.querySelector('.dragging');
                    if (dragging && dragging !== fileItem) {
                        const rect = fileItem.getBoundingClientRect();
                        const midpoint = rect.top + rect.height / 2;
                        if (e.clientY < midpoint) {
                            fileList.insertBefore(dragging, fileItem);
                        } else {
                            fileList.insertBefore(dragging, fileItem.nextSibling);
                        }
                    }
                });

                fileList.appendChild(fileItem);
            });

            const destination = document.createElement('div');
            destination.className = 'combine-destination';
            
            const outputRow = document.createElement('div');
            outputRow.className = 'combine-output-row';
            outputRow.innerHTML = `
                <label>Output filename:</label>
                <input type="text" class="combine-output-name" value="${group.baseName}_poly.wav" data-group-index="${groupIndex}">
            `;
            
            const destinationRow = document.createElement('div');
            destinationRow.className = 'combine-destination-row';
            destinationRow.innerHTML = `
                <label>Save to:</label>
                <button class="btn secondary combine-select-dir" data-group-index="${groupIndex}">Select Destination Folder</button>
                <span class="combine-dest-path" data-group-index="${groupIndex}">Same as source files</span>
            `;
            
            const dirButton = destinationRow.querySelector('.combine-select-dir');
            dirButton.addEventListener('click', async () => {
                try {
                    const dirHandle = await window.showDirectoryPicker();
                    this.combineGroups[groupIndex].destinationHandle = dirHandle;
                    const pathSpan = destinationRow.querySelector('.combine-dest-path');
                    pathSpan.textContent = dirHandle.name;
                    pathSpan.style.color = 'var(--accent-primary)';
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.error('Error selecting directory:', err);
                    }
                }
            });
            
            const selectionInfo = document.createElement('div');
            selectionInfo.className = 'combine-selection-info';
            selectionInfo.innerHTML = `
                Selected: <span class="selected-count">${group.siblings.length}</span> / ${group.siblings.length} files
            `;
            
            destination.appendChild(selectionInfo);
            destination.appendChild(outputRow);
            destination.appendChild(destinationRow);

            groupDiv.appendChild(header);
            groupDiv.appendChild(fileList);
            groupDiv.appendChild(destination);
            container.appendChild(groupDiv);
        });

        const modal = document.getElementById('combine-modal');
        modal.classList.add('active');
    }

    /**
     * Close combine modal
     */
    closeCombineModal() {
        const modal = document.getElementById('combine-modal');
        modal.classList.remove('active');
        this.combineGroups = null;
    }

    /**
     * Process combine operation for all groups
     */
    async processCombineFiles() {
        if (!this.combineGroups || this.combineGroups.length === 0) {
            console.error('No combine groups found');
            alert('No groups to combine. Please close and reopen the Combine modal.');
            return;
        }

        // Validate that all groups still exist in this.files
        const currentSiblingGroups = this.files.filter(item => item.isGroup);
        if (currentSiblingGroups.length === 0) {
            console.error('No sibling groups found in current files');
            alert('No sibling groups detected. Files may have been modified. Please close and reopen the Combine modal.');
            return;
        }

        // Store groups in local variable before closing modal (closing modal will null this.combineGroups)
        const groupsToProcess = this.combineGroups;

        // Collect current order from DOM and filter selected files
        groupsToProcess.forEach((group, groupIndex) => {
            // Ensure siblings is always an array
            if (!group.siblings || !Array.isArray(group.siblings)) {
                console.error(`Invalid siblings array for group ${groupIndex}`);
                group.siblings = [];
                return;
            }
            
            const fileList = document.querySelector(`.combine-file-list[data-group-index="${groupIndex}"]`) ||
                            document.querySelectorAll('.combine-file-list')[groupIndex];
            
            if (!fileList) {
                console.error(`Could not find file list for group ${groupIndex}`);
                group.siblings = []; // Ensure it's an empty array, not undefined
                return;
            }
            
            const fileItems = fileList.querySelectorAll('.combine-file-item');
            
            const newOrder = [];
            fileItems.forEach((item) => {
                const fileIndex = parseInt(item.dataset.fileIndex);
                const sibling = group.siblings[fileIndex];
                if (sibling && sibling.selected) {
                    newOrder.push(sibling);
                }
            });
            
            group.siblings = newOrder;
            
            // Get output filename
            const outputInput = document.querySelector(`.combine-output-name[data-group-index="${groupIndex}"]`) ||
                               document.querySelectorAll('.combine-output-name')[groupIndex];
            group.outputFilename = outputInput.value.trim();
            
            if (!group.outputFilename) {
                group.outputFilename = `${group.baseName}_poly.wav`;
            } else if (!group.outputFilename.toLowerCase().endsWith('.wav')) {
                group.outputFilename += '.wav';
            }
        });

        this.closeCombineModal();

        // Show progress overlay
        const progressOverlay = document.getElementById('loading-overlay');
        const progressText = document.getElementById('progress-text');
        const progressFill = document.getElementById('progress-fill');
        
        if (!progressOverlay || !progressText || !progressFill) {
            console.error('Progress overlay elements not found');
            alert('Error: Progress overlay elements not found. Please refresh the page.');
            return;
        }
        
        progressOverlay.style.display = 'flex';

        // Process each group
        let successCount = 0;
        let failCount = 0;
        const totalGroups = groupsToProcess.length;

        for (let i = 0; i < groupsToProcess.length; i++) {
            const group = groupsToProcess[i];
            
            // Validate group exists
            if (!group) {
                console.error(`Group at index ${i} is null or undefined`);
                failCount++;
                continue;
            }
            
            // Validate siblings array exists
            if (!group.siblings || !Array.isArray(group.siblings)) {
                console.error(`Invalid siblings array for group ${i}:`, group);
                this.showToast(`${group.baseName || 'Group'}: Invalid file data`, 'error', 3000);
                failCount++;
                continue;
            }
            
            // Validate at least 2 files selected
            if (group.siblings.length < 2) {
                this.showToast(`${group.baseName}: Need at least 2 files to combine (${group.siblings.length} selected)`, 'warning', 3000);
                failCount++;
                continue;
            }
            
            try {
                // Update progress
                const progress = Math.round((i / totalGroups) * 100);
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `${progress}%`;
                
                this.showToast(`Combining ${group.baseName} (${i + 1}/${totalGroups})...`, 'info', 0);

                // Load all file buffers
                const fileBuffers = await Promise.all(
                    group.siblings.map(sib => sib.file.arrayBuffer())
                );

                // Extract track names
                const trackNames = group.siblings.map((sib, i) => {
                    if (sib.metadata.trackNames && sib.metadata.trackNames.length > 0) {
                        return sib.metadata.trackNames[0];
                    }
                    return `Ch${i + 1}`;
                });

                // Combine audio files
                const combinedBlob = await this.audioProcessor.combineToPolyphonic(
                    fileBuffers,
                    trackNames,
                    group.metadata
                );

                // Prepare metadata for polyphonic file
                const polyMetadata = {
                    ...group.metadata,
                    filename: group.outputFilename,
                    channels: group.siblings.length,
                    trackNames: trackNames
                };

                // Add metadata to combined file
                const combinedArrayBuffer = await combinedBlob.arrayBuffer();
                const finalBlob = await this.metadataHandler.saveWav(
                    { arrayBuffer: async () => combinedArrayBuffer },
                    polyMetadata
                );

                // Save file
                const suggestedName = group.outputFilename;
                let handle;
                
                try {
                    if (group.destinationHandle) {
                        // Save to selected directory
                        handle = await group.destinationHandle.getFileHandle(suggestedName, { create: true });
                        
                        const writable = await handle.createWritable();
                        await writable.write(finalBlob);
                        await writable.close();
                    } else {
                        // Show save dialog
                        handle = await window.showSaveFilePicker({
                            suggestedName: suggestedName,
                            types: [{
                                description: 'WAV Audio',
                                accept: { 'audio/wav': ['.wav'] }
                            }]
                        });

                        const writable = await handle.createWritable();
                        await writable.write(finalBlob);
                        await writable.close();
                    }

                    console.log(`✓ Combined file saved: ${group.outputFilename}`);

                    // Auto-add to file list
                    const newFile = await handle.getFile();
                    const metadata = await this.metadataHandler.parseFile(newFile);
                    
                    // Add as individual file
                    this.files.push({
                        handle: handle,
                        metadata: metadata,
                        file: newFile,
                        isGroup: false
                    });

                    successCount++;
                } catch (err) {
                    console.error('Save failed:', err);
                    if (err.name === 'AbortError') {
                        // User cancelled
                        failCount++;
                    } else {
                        // Fallback: trigger download
                        const url = URL.createObjectURL(finalBlob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = suggestedName;
                        a.click();
                        URL.revokeObjectURL(url);
                        
                        successCount++;
                    }
                }

            } catch (err) {
                console.error(`Failed to combine ${group.baseName}:`, err);
                this.showToast(`Failed to combine ${group.baseName}: ${err.message}`, 'error', 5000);
                failCount++;
            }
        }

        // Hide progress overlay
        if (progressOverlay) {
            progressOverlay.style.display = 'none';
        }
        if (progressFill) {
            progressFill.style.width = '0%';
        }
        if (progressText) {
            progressText.textContent = '0%';
        }

        // Re-render table
        const tbody = document.getElementById('file-list-body');
        tbody.innerHTML = '';
        this.files.forEach((file, i) => this.addTableRow(i, file.metadata));
        this.updateSelectionUI();

        // Close modal to prevent stale data issues
        this.closeCombineModal();

        // Show summary
        if (successCount > 0) {
            this.showToast(`Successfully combined ${successCount} file group(s)`, 'success', 3000);
        }
        
        if (failCount > 0) {
            this.showToast(`${failCount} group(s) failed to combine`, 'error', 5000);
        }
    }

    /**
     * Open Split modal for the selected poly file
     */
    openSplitModal() {
        // Get the selected poly file
        if (this.selectedIndices.size !== 1) {
            alert('Please select exactly one poly file to split.');
            return;
        }

        const selectedIndex = Array.from(this.selectedIndices)[0];
        const selectedFile = this.files[selectedIndex];

        if (!selectedFile || !selectedFile.metadata || selectedFile.metadata.channels <= 1) {
            alert('Selected file is not a poly file.');
            return;
        }

        // Store the file to split
        this.splitFileData = {
            index: selectedIndex,
            file: selectedFile.file,
            handle: selectedFile.handle,
            metadata: selectedFile.metadata,
            destinationHandle: null
        };

        // Update modal info
        document.getElementById('split-filename').textContent = selectedFile.metadata.filename;
        // Show 'Same as source files' if no folder is selected
        document.getElementById('split-folder-path').textContent = 'Same as source files';
        document.getElementById('split-confirm-btn').disabled = true;

        // Show modal
        const modal = document.getElementById('split-modal');
        modal.classList.add('active');
    }

    /**
     * Close Split modal
     */
    closeSplitModal() {
        const modal = document.getElementById('split-modal');
        modal.classList.remove('active');
        this.splitFileData = null;
    }

    /**
     * Select destination folder for split files
     */
    async selectSplitFolder() {
        try {
            const dirHandle = await window.showDirectoryPicker();
            this.splitFileData.destinationHandle = dirHandle;
            document.getElementById('split-folder-path').textContent = dirHandle.name;
            document.getElementById('split-confirm-btn').disabled = false;
        } catch (err) {
            // If user cancels, revert to 'Same as source files'
            if (err.name === 'AbortError') {
                this.splitFileData.destinationHandle = null;
                document.getElementById('split-folder-path').textContent = 'Same as source files';
                document.getElementById('split-confirm-btn').disabled = true;
            } else {
                console.error('Error selecting folder:', err);
                alert('Failed to select folder');
            }
        }
    }

    /**
     * Process split operation
     */
    async processSplitFile() {
        if (!this.splitFileData || !this.splitFileData.destinationHandle) {
            alert('Please select a destination folder first.');
            return;
        }

        try {
            document.body.style.cursor = 'wait';
            this.showToast('Splitting file...', 'info', 2000);

            const { file, handle, metadata, destinationHandle } = this.splitFileData;
            const channels = metadata.channels;

            // Read the original file
            const arrayBuffer = await file.arrayBuffer();
            
            // Get track names from iXML BEFORE decoding (decoding detaches the buffer)
            const trackNames = [];
            const ixmlString = this.metadataHandler.getIXMLChunk(arrayBuffer);
            if (ixmlString) {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(ixmlString, 'text/xml');
                const tracks = xmlDoc.querySelectorAll('TRACK');
                tracks.forEach(track => {
                    const name = track.querySelector('NAME')?.textContent || '';
                    trackNames.push(name);
                });
            }
            
            // Decode audio using AudioEngine (handles both native and manual WAV decoding)
            // Note: This may detach the arrayBuffer
            const audioBuffer = await this.audioEngine.decodeFile(arrayBuffer);

            // Split each channel into a separate file
            const baseName = metadata.filename.replace(/\.wav$/i, '');
            
            for (let ch = 0; ch < channels; ch++) {
                // Create mono audio buffer for this channel
                const monoBuffer = this.audioEngine.audioCtx.createBuffer(
                    1,
                    audioBuffer.length,
                    audioBuffer.sampleRate
                );
                
                const channelData = audioBuffer.getChannelData(ch);
                monoBuffer.copyToChannel(channelData, 0);

                // Generate filename with track name or channel number
                const trackName = trackNames[ch] || `Ch${ch + 1}`;
                const sanitizedTrackName = trackName.replace(/[^a-zA-Z0-9_-]/g, '_');
                const outputFilename = `${baseName}_${sanitizedTrackName}.wav`;

                // Encode as WAV
                const wavBlob = await this.encodeWAV(monoBuffer);
                let wavArrayBuffer = await wavBlob.arrayBuffer();

                // Add iXML metadata with correct track name
                if (ixmlString) {
                    const updatedIXML = this.updateIXMLForMonoTrack(ixmlString, ch, trackName);
                    wavArrayBuffer = this.injectIXMLChunk(wavArrayBuffer, updatedIXML);
                }

                // Add bEXT metadata with track name
                const bextData = {
                    description: trackName,
                    originator: metadata.originator || '',
                    originatorReference: metadata.originatorReference || '',
                    originationDate: metadata.originationDate || '',
                    originationTime: metadata.originationTime || '',
                    timeReference: metadata.timeReference || 0
                };
                wavArrayBuffer = this.injectBextChunk(wavArrayBuffer, bextData);

                // Write file to destination
                const fileHandle = await destinationHandle.getFileHandle(outputFilename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(wavArrayBuffer);
                await writable.close();
            }

            this.showToast(`Successfully split into ${channels} mono files`, 'success', 3000);
            this.closeSplitModal();

        } catch (err) {
            console.error('Error splitting file:', err);
            this.showToast(`Failed to split file: ${err.message}`, 'error', 5000);
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    /**
     * Update iXML to contain only the track info for a specific channel
     */
    updateIXMLForMonoTrack(ixmlString, channelIndex, trackName) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(ixmlString, 'text/xml');
            
            // Find the TRACK_LIST
            const trackList = xmlDoc.querySelector('TRACK_LIST');
            if (trackList) {
                // Update track count to 1
                const trackCount = trackList.querySelector('TRACK_COUNT');
                if (trackCount) {
                    trackCount.textContent = '1';
                }

                // Keep only the track for this channel
                const tracks = trackList.querySelectorAll('TRACK');
                if (tracks[channelIndex]) {
                    // Remove all tracks
                    tracks.forEach(track => track.remove());
                    
                    // Add back only this channel's track with updated channel index
                    const singleTrack = xmlDoc.createElement('TRACK');
                    const channelIndexEl = xmlDoc.createElement('CHANNEL_INDEX');
                    channelIndexEl.textContent = '1';
                    const interleaveIndexEl = xmlDoc.createElement('INTERLEAVE_INDEX');
                    interleaveIndexEl.textContent = '1';
                    const nameEl = xmlDoc.createElement('NAME');
                    nameEl.textContent = trackName;
                    
                    singleTrack.appendChild(channelIndexEl);
                    singleTrack.appendChild(interleaveIndexEl);
                    singleTrack.appendChild(nameEl);
                    trackList.appendChild(singleTrack);
                }
            }

            const serializer = new XMLSerializer();
            return serializer.serializeToString(xmlDoc);
        } catch (err) {
            console.error('Error updating iXML for mono track:', err);
            return ixmlString;
        }
    }

    /**
     * Encode AudioBuffer to WAV blob
     */
    async encodeWAV(audioBuffer) {
        const numberOfChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        const bytesPerSample = bitDepth / 8;
        const blockAlign = numberOfChannels * bytesPerSample;
        
        const samples = audioBuffer.getChannelData(0);
        const dataLength = samples.length * blockAlign;
        const buffer = new ArrayBuffer(44 + dataLength);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, format, true);
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true); // byte rate
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, dataLength, true);

        // Write audio data
        const offset = 44;
        for (let i = 0; i < samples.length; i++) {
            const sample = Math.max(-1, Math.min(1, samples[i]));
            const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset + (i * 2), intSample, true);
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    /**
     * Inject iXML chunk into WAV buffer (returns new buffer)
     */
    injectIXMLChunk(originalBuffer, ixmlString) {
        const view = new DataView(originalBuffer);
        const chunks = [];
        let offset = 12;

        // Parse all chunks except iXML
        while (offset < view.byteLength - 8) {
            const chunkId = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3)
            );
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId !== 'iXML') {
                const chunkData = new Uint8Array(originalBuffer, offset, 8 + chunkSize + (chunkSize % 2));
                chunks.push(chunkData);
            }

            offset += 8 + chunkSize;
            if (chunkSize % 2 !== 0) offset++;
        }

        // Add new iXML chunk
        const ixmlBytes = new TextEncoder().encode(ixmlString);
        const ixmlChunkSize = ixmlBytes.length;
        const ixmlChunk = new Uint8Array(8 + ixmlChunkSize + (ixmlChunkSize % 2));
        const ixmlView = new DataView(ixmlChunk.buffer);

        ixmlView.setUint8(0, 'i'.charCodeAt(0));
        ixmlView.setUint8(1, 'X'.charCodeAt(0));
        ixmlView.setUint8(2, 'M'.charCodeAt(0));
        ixmlView.setUint8(3, 'L'.charCodeAt(0));
        ixmlView.setUint32(4, ixmlChunkSize, true);
        ixmlChunk.set(ixmlBytes, 8);

        chunks.push(ixmlChunk);

        // Calculate total size
        const totalDataSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const newFileSize = 12 + totalDataSize;
        const newBuffer = new Uint8Array(newFileSize);
        const newView = new DataView(newBuffer.buffer);

        // Write RIFF header
        newView.setUint8(0, 'R'.charCodeAt(0));
        newView.setUint8(1, 'I'.charCodeAt(0));
        newView.setUint8(2, 'F'.charCodeAt(0));
        newView.setUint8(3, 'F'.charCodeAt(0));
        newView.setUint32(4, newFileSize - 8, true);
        newView.setUint8(8, 'W'.charCodeAt(0));
        newView.setUint8(9, 'A'.charCodeAt(0));
        newView.setUint8(10, 'V'.charCodeAt(0));
        newView.setUint8(11, 'E'.charCodeAt(0));

        // Write all chunks
        let writeOffset = 12;
        for (const chunk of chunks) {
            newBuffer.set(chunk, writeOffset);
            writeOffset += chunk.byteLength;
        }

        return newBuffer.buffer;
    }

    /**
     * Inject bEXT chunk into WAV buffer (returns new buffer)
     */
    injectBextChunk(originalBuffer, bextData) {
        const view = new DataView(originalBuffer);
        const chunks = [];
        let offset = 12;

        // Parse all chunks except bext
        while (offset < view.byteLength - 8) {
            const chunkId = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3)
            );
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId !== 'bext') {
                const chunkData = new Uint8Array(originalBuffer, offset, 8 + chunkSize + (chunkSize % 2));
                chunks.push(chunkData);
            }

            offset += 8 + chunkSize;
            if (chunkSize % 2 !== 0) offset++;
        }

        // Create new bEXT chunk (minimum size is 602 bytes)
        const bextChunk = new Uint8Array(610); // 8 header + 602 data
        const bextView = new DataView(bextChunk.buffer);

        // Chunk ID and size
        bextView.setUint8(0, 'b'.charCodeAt(0));
        bextView.setUint8(1, 'e'.charCodeAt(0));
        bextView.setUint8(2, 'x'.charCodeAt(0));
        bextView.setUint8(3, 't'.charCodeAt(0));
        bextView.setUint32(4, 602, true);

        const encoder = new TextEncoder();

        // Description (256 bytes)
        if (bextData.description) {
            const descBytes = encoder.encode(bextData.description.substring(0, 255));
            bextChunk.set(descBytes, 8);
        }

        // Originator (32 bytes)
        if (bextData.originator) {
            const origBytes = encoder.encode(bextData.originator.substring(0, 31));
            bextChunk.set(origBytes, 8 + 256);
        }

        // Originator Reference (32 bytes)
        if (bextData.originatorReference) {
            const origRefBytes = encoder.encode(bextData.originatorReference.substring(0, 31));
            bextChunk.set(origRefBytes, 8 + 256 + 32);
        }

        // Origination Date (10 bytes, YYYY-MM-DD)
        if (bextData.originationDate) {
            const dateBytes = encoder.encode(bextData.originationDate.substring(0, 10));
            bextChunk.set(dateBytes, 8 + 256 + 32 + 32);
        }

        // Origination Time (8 bytes, HH:MM:SS)
        if (bextData.originationTime) {
            const timeBytes = encoder.encode(bextData.originationTime.substring(0, 8));
            bextChunk.set(timeBytes, 8 + 256 + 32 + 32 + 10);
        }

        // Time Reference (8 bytes, 64-bit unsigned int)
        const timeRef = bextData.timeReference || 0;
        bextView.setBigUint64(8 + 256 + 32 + 32 + 10 + 8, BigInt(timeRef), true);

        chunks.push(bextChunk);

        // Calculate total size
        const totalDataSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const newFileSize = 12 + totalDataSize;
        const newBuffer = new Uint8Array(newFileSize);
        const newView = new DataView(newBuffer.buffer);

        // Write RIFF header
        newView.setUint8(0, 'R'.charCodeAt(0));
        newView.setUint8(1, 'I'.charCodeAt(0));
        newView.setUint8(2, 'F'.charCodeAt(0));
        newView.setUint8(3, 'F'.charCodeAt(0));
        newView.setUint32(4, newFileSize - 8, true);
        newView.setUint8(8, 'W'.charCodeAt(0));
        newView.setUint8(9, 'A'.charCodeAt(0));
        newView.setUint8(10, 'V'.charCodeAt(0));
        newView.setUint8(11, 'E'.charCodeAt(0));

        // Write all chunks
        let writeOffset = 12;
        for (const chunk of chunks) {
            newBuffer.set(chunk, writeOffset);
            writeOffset += chunk.byteLength;
        }

        return newBuffer.buffer;
    }
}

// Wait for DOM to load before initializing app
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.app = app;

    // Sound Report Modal open/close logic (guaranteed after DOM load)
    const reportBtn = document.getElementById('report-btn');
    if (reportBtn) {
        reportBtn.addEventListener('click', () => {
            const modal = document.getElementById('sound-report-modal');
            if (modal) {
                // Always re-render header fields and take list when opening
                if (window.renderSoundReportHeaderFields) window.renderSoundReportHeaderFields();
                if (window.renderSoundReportTakeListTable) window.renderSoundReportTakeListTable();
                modal.style.display = 'block';
                modal.classList.add('active');
                // Optional: focus first input
                const firstInput = modal.querySelector('input,select,textarea,button');
                if (firstInput) firstInput.focus();
            }
        });
    }
    // Close/Exit buttons for Sound Report Modal
    const closeBtn = document.getElementById('close-sound-report');
    if (closeBtn) {
        closeBtn.onclick = () => {
            const modal = document.getElementById('sound-report-modal');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('active');
            }
        };
    }
    const exitBtn = document.getElementById('exit-report-btn');
    if (exitBtn) {
        exitBtn.onclick = () => {
            const modal = document.getElementById('sound-report-modal');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('active');
            }
        };
    }
    // Optional: close on outside click
    const soundReportModal = document.getElementById('sound-report-modal');
    if (soundReportModal) {
        soundReportModal.addEventListener('click', (e) => {
            if (e.target === soundReportModal) {
                soundReportModal.style.display = 'none';
                soundReportModal.classList.remove('active');
            }
        });
    }
});
