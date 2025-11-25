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
                    this.audioEngine.renderWaveform(canvas, this.audioEngine.buffer, this.mixer.channels);
                }
            }
        );
        this.mixer.init('mixer-container');
        this.fileIO = new FileIO();

        this.files = []; // Array of { fileHandle, metadata, fileObj }
        this.selectedIndices = new Set();
        this.lastSelectedIndex = -1; // For shift-click range selection
        this.columnOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // Default order
        this.sortColumn = null;
        this.sortDirection = 'asc';
        this.currentFileMetadata = null; // Store current file's metadata for timecode
        this.region = { start: null, end: null }; // Selected time region
        this.isLooping = false; // Loop mode state

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

        // Mixer save/load controls
        document.getElementById('save-mix-btn').addEventListener('click', () => this.saveMixerSettingsToFile());
        document.getElementById('load-mix-btn').addEventListener('click', () => this.loadMixerSettingsFromFile());


        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            // Spacebar for play/pause (only if not typing in an editable field)
            if (e.code === 'Space' && !this.isEditingText(e.target)) {
                e.preventDefault();
                this.togglePlay();
            }

            // Command/Ctrl + A for select all
            if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
                e.preventDefault();
                this.selectAll();
            }

            if ((e.key === 'Backspace' || e.key === 'Delete') && this.selectedIndices.size > 0) {
                // Optional: Allow delete key to remove
                // this.removeSelected(); 
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

        canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            wasPlaying = this.audioEngine.isPlaying;

            // Pause while dragging
            if (wasPlaying) {
                this.audioEngine.stop();
                document.getElementById('play-btn').textContent = '▶';
            }

            updatePlayheadPosition(e);
        });

        canvas.addEventListener('mousemove', (e) => {
            if (isDragging) {
                updatePlayheadPosition(e);
            }
        });

        canvas.addEventListener('mouseup', (e) => {
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

        // Region selection
        const regionSelector = document.getElementById('region-selector');
        const regionOverlay = document.getElementById('region-overlay');
        let isSelectingRegion = false;
        let regionStartX = 0;

        regionSelector.addEventListener('mousedown', (e) => {
            if (!this.audioEngine.buffer) return;

            const rect = regionSelector.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;

            // Check if clicking on existing region (to clear it)
            if (this.region.start !== null) {
                this.clearRegion();
                return;
            }

            // Start new region selection
            isSelectingRegion = true;
            regionStartX = x;
            this.region.start = percent * this.audioEngine.buffer.duration;
            this.region.end = this.region.start;

            this.updateRegionDisplay();
        });

        regionSelector.addEventListener('mousemove', (e) => {
            if (!isSelectingRegion || !this.audioEngine.buffer) return;

            const rect = regionSelector.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const percent = x / rect.width;

            this.region.end = percent * this.audioEngine.buffer.duration;
            this.updateRegionDisplay();
        });

        regionSelector.addEventListener('mouseup', () => {
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
            }
        });

        regionSelector.addEventListener('mouseleave', () => {
            if (isSelectingRegion) {
                isSelectingRegion = false;

                // Ensure start is before end
                if (this.region.start > this.region.end) {
                    [this.region.start, this.region.end] = [this.region.end, this.region.start];
                }
            }
        });

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
        // Check if the user is typing in an input, textarea, or contenteditable element
        return element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
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
        for (const handle of handles) {
            try {
                const file = await handle.getFile();
                const metadata = await this.metadataHandler.parseFile(file);
                this.files.push({ handle, metadata, file });
                this.addTableRow(this.files.length - 1, metadata);
            } catch (err) {
                console.error('Error processing file:', handle.name, err);
            }
        }
    }

    addTableRow(index, metadata) {
        const tbody = document.getElementById('file-list-body');
        const tr = document.createElement('tr');
        tr.dataset.index = index;

        const createCell = (key, val, editable = true) => {
            const td = document.createElement('td');
            td.textContent = val || '';
            if (editable) {
                td.contentEditable = true;
                td.addEventListener('blur', (e) => {
                    this.updateMetadata(index, key, e.target.textContent);
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
        const cells = [
            createCell('channels', metadata.channels, false),
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
    }

    async saveSelected() {
        if (this.selectedIndices.size === 0) return;

        let successCount = 0;
        for (const index of this.selectedIndices) {
            const item = this.files[index];
            try {
                console.log('Saving file:', item.metadata.filename);
                console.log('Has ixmlRaw?', !!item.metadata.ixmlRaw);
                if (item.metadata.ixmlRaw) {
                    console.log('ixmlRaw length:', item.metadata.ixmlRaw.length);
                }

                const newBlob = await this.metadataHandler.saveWav(item.file, item.metadata);

                if (item.handle.kind === 'file') {
                    const success = await this.fileIO.saveFile(item.handle, newBlob);
                    if (success) {
                        successCount++;
                        // Refresh the file object from the handle to prevent NotReadableError
                        item.file = await item.handle.getFile();
                    }
                } else {
                    // Fallback download (only for single file to avoid spam)
                    if (this.selectedIndices.size === 1) {
                        const url = URL.createObjectURL(newBlob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = item.metadata.filename;
                        a.click();
                        successCount++;
                    }
                }
            } catch (err) {
                console.error('Error saving file:', item.metadata.filename, err);
            }
        }

        if (successCount > 0) {
            alert(`Saved ${successCount} file(s) successfully!`);
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

        // Load Audio for the clicked file (if selected)
        if (this.selectedIndices.has(index)) {
            await this.loadAudioForFile(index);
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
        document.getElementById('batch-save-btn').disabled = !hasSelection;
        document.getElementById('batch-remove-btn').disabled = !hasSelection;
        document.getElementById('view-ixml-btn').disabled = this.selectedIndices.size !== 1;
        document.getElementById('view-bext-btn').disabled = this.selectedIndices.size !== 1;
        document.getElementById('normalize-btn').disabled = !hasSelection;
        document.getElementById('rename-btn').disabled = !hasSelection;
        document.getElementById('export-btn').disabled = !hasSelection;
        document.getElementById('save-mix-btn').disabled = this.selectedIndices.size !== 1;
        document.getElementById('load-mix-btn').disabled = this.selectedIndices.size !== 1;
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
        }

        this.closeBatchEditModal();

        console.log(`Applied ${Object.keys(updates).length} field(s) to ${this.selectedIndices.size} file(s)`);
    }

    async viewIXML() {
        if (this.selectedIndices.size !== 1) return;

        const index = Array.from(this.selectedIndices)[0];
        const item = this.files[index];

        try {
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
        try {
            console.log(`Loading audio file with ${item.metadata.channels || '?'} channels...`);
            const buffer = await this.audioEngine.loadAudio(await item.file.arrayBuffer());
            console.log(`Successfully decoded: ${buffer.numberOfChannels} channels, ${buffer.duration.toFixed(2)}s`);

            // Setup Mixer
            const trackCount = buffer.numberOfChannels;
            console.log(`Building mixer for ${trackCount} tracks...`);

            const canvas = document.getElementById('waveform-canvas');
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;

            this.mixer.buildUI(trackCount, item.metadata.trackNames,
                (trackIndex, newName) => {
                    // Update metadata
                    if (!item.metadata.trackNames) item.metadata.trackNames = [];
                    item.metadata.trackNames[trackIndex] = newName;
                    console.log(`Updated track ${trackIndex} name to: ${newName}`);

                    // Enable save button
                    document.getElementById('batch-save-btn').disabled = false;
                },
                () => {
                    // Mixer state changed (mute/solo), re-render waveform
                    this.audioEngine.renderWaveform(canvas, buffer, this.mixer.channels);
                }
            );

            // Render Waveform (initial)
            this.audioEngine.renderWaveform(canvas, buffer, this.mixer.channels);

            // Connect Mixer to Audio Engine
            const mixerNodes = this.mixer.getChannelNodes();
            this.audioEngine.setMixerNodes(mixerNodes);
            this.audioEngine.setupRouting(); // Initialize routing graph
            console.log('Mixer connected successfully');

            // Update Time Display
            document.getElementById('total-time').textContent = item.metadata.duration || '00:00:00';

            // Store metadata for timecode calculation
            this.currentFileMetadata = item.metadata;

            // Update Mixer Header
            const mixerFilename = document.getElementById('mixer-filename');
            if (mixerFilename) {
                mixerFilename.textContent = item.metadata.filename;
            }

        } catch (err) {
            console.error('Error loading audio:', err);
            console.error('File details:', {
                filename: item.metadata.filename,
                channels: item.metadata.channels,
                sampleRate: item.metadata.sampleRate,
                size: item.file.size,
                type: item.file.type,
                lastModified: item.file.lastModified
            });
            alert(`Failed to load audio: ${err.message}\nFile: ${item.metadata.filename}\nSize: ${(item.file.size / 1024 / 1024).toFixed(2)} MB`);
        }
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
    }

    clearRegion() {
        this.region.start = null;
        this.region.end = null;
        const regionOverlay = document.getElementById('region-overlay');
        regionOverlay.classList.remove('active');
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
        } else if (this.isStopped) {
            // Debugging: Check position when stopped
            const ph = document.getElementById('playhead');
            if (ph && !this._debugLogged) {
                console.log('DEBUG: Animation stopped. Playhead Left is:', ph.style.left);
                this._debugLogged = true; // Log once
            } else {
                this._debugLogged = false;
            }
        } else {
            this._debugLogged = false;
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
                console.log(`Normalizing ${item.metadata.filename}...`);

                // Read file
                const arrayBuffer = await item.file.arrayBuffer();

                // Normalize
                // Note: normalize modifies buffer in place or returns new one
                const normalizedBuffer = await this.audioProcessor.normalize(arrayBuffer, targetDb);

                // Save back to file
                // We use the file handle to write the raw WAV bytes directly
                const writable = await item.handle.createWritable();
                await writable.write(normalizedBuffer);
                await writable.close();

                // Refresh file object
                item.file = await item.handle.getFile();

                // If this is the currently loaded file, reload audio engine
                if (this.currentFileMetadata && this.currentFileMetadata.filename === item.metadata.filename) {
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

        const newName = this.generateFilename(file.metadata, pattern, sep1, sep2);
        document.getElementById('rename-preview').textContent = newName;
    }

    generateFilename(metadata, pattern, sep1, sep2) {
        const scene = metadata.scene || 'SCENE';
        const take = metadata.take || 'TAKE';
        const project = metadata.project || 'PROJECT';

        let name = '';
        if (pattern === 'project-scene-take') {
            name = `${project}${sep1}${scene}${sep2}${take}`;
        } else {
            name = `${scene}${sep2}${take}`;
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

            for (const index of indices) {
                const item = this.files[index];
                const newName = this.generateFilename(item.metadata, pattern, sep1, sep2);

                if (item.metadata.filename === newName) continue; // Skip if same

                console.log(`Renaming ${item.metadata.filename} to ${newName}`);

                if (item.handle.move) {
                    await item.handle.move(newName);
                    item.metadata.filename = newName;
                    item.file = await item.handle.getFile(); // Refresh file object
                    renamedCount++;
                } else {
                    console.warn('File System Access API "move" not supported on this handle.');
                    failedCount++;
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
        document.getElementById('export-modal').classList.add('active');
    }

    closeExportModal() {
        document.getElementById('export-modal').classList.remove('active');
    }

    async handleExport() {
        const format = document.getElementById('export-format').value;
        const selectedFiles = Array.from(this.selectedIndices).map(i => this.files[i]);

        if (selectedFiles.length === 0) return;

        this.closeExportModal();

        // For batch export, ask user to select output directory
        let outputDirHandle = null;
        if (selectedFiles.length > 1) {
            try {
                outputDirHandle = await window.showDirectoryPicker();
            } catch (err) {
                if (err.name !== 'AbortError') {
                    alert('Failed to select output directory: ' + err.message);
                }
                return;
            }
        }

        document.body.style.cursor = 'wait';
        let successCount = 0;
        let failCount = 0;

        try {
            for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
                const item = selectedFiles[fileIndex];

                // Show progress
                if (selectedFiles.length > 1) {
                    console.log(`Exporting ${fileIndex + 1} of ${selectedFiles.length}: ${item.metadata.filename}`);
                    // You could update a progress bar here
                }

                try {
                    // Load audio for this file
                    const arrayBuffer = await item.file.arrayBuffer();
                    let audioBuffer = await this.audioEngine.loadAudio(arrayBuffer);

                    // Extract region if one is selected (only for single file export)
                    let isRegionExport = false;
                    if (selectedFiles.length === 1 && this.region.start !== null && this.region.end !== null) {
                        const regionStart = Math.min(this.region.start, this.region.end);
                        const regionEnd = Math.max(this.region.start, this.region.end);
                        audioBuffer = this.audioEngine.extractRegion(audioBuffer, regionStart, regionEnd);
                        isRegionExport = true;
                    }

                    // Render stereo mix
                    const renderedBuffer = await this.audioEngine.renderStereoMix(audioBuffer, this.mixer.channels);

                    let blob = null;
                    let extension = '';

                    if (format === 'wav') {
                        const bitDepth = parseInt(document.getElementById('export-bitdepth').value);
                        const originalBuffer = await item.file.arrayBuffer();
                        const wavBuffer = this.audioProcessor.createWavFile(renderedBuffer, bitDepth, originalBuffer);
                        blob = new Blob([wavBuffer], { type: 'audio/wav' });
                        extension = 'wav';
                    } else if (format === 'mp3') {
                        if (typeof lamejs === 'undefined') {
                            alert('lamejs library not loaded. Please refresh the page.');
                            document.body.style.cursor = 'default';
                            return;
                        }

                        const bitrate = parseInt(document.getElementById('export-mp3-bitrate').value);
                        const mp3Encoder = new lamejs.Mp3Encoder(2, renderedBuffer.sampleRate, bitrate);

                        const samplesLeft = renderedBuffer.getChannelData(0);
                        const samplesRight = renderedBuffer.getChannelData(1);

                        const sampleBlockSize = 1152;
                        const mp3Data = [];

                        for (let i = 0; i < samplesLeft.length; i += sampleBlockSize) {
                            const leftChunk = samplesLeft.subarray(i, i + sampleBlockSize);
                            const rightChunk = samplesRight.subarray(i, i + sampleBlockSize);

                            const leftInt = new Int16Array(leftChunk.length);
                            const rightInt = new Int16Array(rightChunk.length);
                            for (let j = 0; j < leftChunk.length; j++) {
                                leftInt[j] = leftChunk[j] < 0 ? leftChunk[j] * 0x8000 : leftChunk[j] * 0x7FFF;
                                rightInt[j] = rightChunk[j] < 0 ? rightChunk[j] * 0x8000 : rightChunk[j] * 0x7FFF;
                            }

                            const mp3buf = mp3Encoder.encodeBuffer(leftInt, rightInt);
                            if (mp3buf.length > 0) mp3Data.push(mp3buf);
                        }

                        const mp3buf = mp3Encoder.flush();
                        if (mp3buf.length > 0) mp3Data.push(mp3buf);

                        blob = new Blob(mp3Data, { type: 'audio/mp3' });
                        extension = 'mp3';
                    }

                    if (blob) {
                        const baseName = item.metadata.filename.replace(/\.wav$/i, '');
                        const suffix = isRegionExport ? '_region_mix' : '_mix';
                        const outputFilename = `${baseName}${suffix}.${extension}`;

                        if (selectedFiles.length === 1) {
                            // Single file: use save picker
                            const handle = await window.showSaveFilePicker({
                                suggestedName: outputFilename,
                                types: [{
                                    description: 'Audio File',
                                    accept: { [`audio/${extension}`]: [`.${extension}`] },
                                }],
                            });

                            const writable = await handle.createWritable();
                            await writable.write(blob);
                            await writable.close();
                        } else {
                            // Batch: save to selected directory
                            const fileHandle = await outputDirHandle.getFileHandle(outputFilename, { create: true });
                            const writable = await fileHandle.createWritable();
                            await writable.write(blob);
                            await writable.close();
                        }

                        successCount++;
                    }
                } catch (err) {
                    console.error(`Failed to export ${item.metadata.filename}:`, err);
                    failCount++;
                }
            }

            // Show summary
            if (selectedFiles.length === 1) {
                alert('Export successful!');
            } else {
                alert(`Batch export complete!\nSuccessful: ${successCount}\nFailed: ${failCount}`);
            }

        } catch (err) {
            console.error('Export failed:', err);
            alert(`Export failed: ${err.message}`);
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    async saveMixerSettingsToFile() {
        if (this.selectedIndices.size !== 1) return;

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

        // Get FPS - use fpsExact if available, otherwise parse fps display value
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
}

const app = new App();
