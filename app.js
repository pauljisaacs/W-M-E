// --- About Modal Logic ---
document.addEventListener('DOMContentLoaded', () => {
    // Add About menu item if not present
    let helpMenu = document.getElementById('help-menu');
    if (!helpMenu) {
        // If no help menu, add About button to header
        const header = document.querySelector('.app-header .header-controls');
        if (header) {
            const aboutBtn = document.createElement('button');
            aboutBtn.id = 'about-btn';
            aboutBtn.className = 'btn secondary';
            aboutBtn.textContent = 'About';
            aboutBtn.style.marginLeft = '1em';
            header.appendChild(aboutBtn);
            aboutBtn.addEventListener('click', () => {
                document.getElementById('about-modal').classList.add('active');
            });
            
            // Add sidebar toggle button
            const sidebarToggleBtn = document.createElement('button');
            sidebarToggleBtn.id = 'sidebar-toggle-btn';
            sidebarToggleBtn.innerHTML = '⊟'; // Sidebar panel icon
            sidebarToggleBtn.title = 'Toggle Info Sidebar';
            sidebarToggleBtn.style.marginLeft = '1em';
            sidebarToggleBtn.style.background = 'none';
            sidebarToggleBtn.style.border = 'none';
            sidebarToggleBtn.style.color = 'var(--text-main)';
            sidebarToggleBtn.style.fontSize = '1.5rem';
            sidebarToggleBtn.style.cursor = 'pointer';
            sidebarToggleBtn.style.padding = '0.0rem 0.0rem';
            sidebarToggleBtn.style.transition = 'color 0.2s';
            sidebarToggleBtn.style.transform = 'rotate(90deg)';
            sidebarToggleBtn.addEventListener('mouseenter', () => {
                sidebarToggleBtn.style.color = 'var(--accent-primary)';
            });
            sidebarToggleBtn.addEventListener('mouseleave', () => {
                sidebarToggleBtn.style.color = 'var(--text-main)';
            });
            header.appendChild(sidebarToggleBtn);
            sidebarToggleBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('info-sidebar');
                sidebar.classList.toggle('open');
            });
        }
    } else {
        // If help menu exists, add About item
        const aboutItem = document.createElement('li');
        aboutItem.textContent = 'About Wave Agent X';
        aboutItem.addEventListener('click', () => {
            document.getElementById('about-modal').classList.add('active');
        });
        helpMenu.appendChild(aboutItem);
    }

    // Close About modal
    document.getElementById('about-close-btn').addEventListener('click', () => {
        document.getElementById('about-modal').classList.remove('active');
    });
    document.getElementById('about-ok-btn').addEventListener('click', () => {
        document.getElementById('about-modal').classList.remove('active');
    });

    // Stereo Link Mode Modal
    document.getElementById('stereo-link-close-btn').addEventListener('click', () => {
        document.getElementById('stereo-link-mode-modal').classList.remove('active');
    });
    document.getElementById('stereo-link-cancel-btn').addEventListener('click', () => {
        document.getElementById('stereo-link-mode-modal').classList.remove('active');
    });
    document.getElementById('stereo-link-ok-btn').addEventListener('click', () => {
        const selectedMode = document.querySelector('input[name="stereo-link-mode"]:checked').value;
        if (window.app && window.app.mixer) {
            window.app.mixer.applyStereoLinkMode(selectedMode);
        }
        document.getElementById('stereo-link-mode-modal').classList.remove('active');
    });

    // Dynamically load version from manifest.json
    fetch('manifest.json')
        .then(response => response.json())
        .then(manifest => {
            document.getElementById('about-version').textContent = manifest.version || 'N/A';
        })
        .catch(() => {
            document.getElementById('about-version').textContent = 'N/A';
        });
});
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
        this.audioProcessor.metadataHandler = this.metadataHandler; // Link metadata handler
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
        this.renameManager = new RenameManager(this); // Initialize rename utilities

        this.files = []; // Array of { fileHandle, metadata, fileObj }
        this.selectedIndices = new Set();
        this.selectedChildren = new Map(); // Track selected child files: "parentIndex:siblingOrder" -> true
        this.lastSelectedIndex = -1; // For shift-click range selection
        this.currentlyLoadedFileIndex = -1; // Track which file is currently loaded
        this.isLoadingAudio = false; // Track if audio is currently loading
        this.columnOrder = [3, 12, 11, 0, 1, 2, 4, 5, 6, 7, 8, 13, 9, 10, 14]; // Default order: Filename, Project, Tape, Channels, BitDepth, SampleRate, Format, Scene, Take, Duration, TC Start, End TC, FPS, FileSize, Notes
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

        // Reset fader heights to default after initial mixer setup
        this.resetFaderHeights();

        // Initialize UI button states
        this.updateSelectionUI();

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
        document.getElementById('batch-delete-btn').addEventListener('click', () => this.openDeleteConfirmModal());

        // File Operations
        document.getElementById('auto-group-btn').addEventListener('click', () => {
            // Check if selected items are sibling groups
            const selectedGroups = Array.from(this.selectedIndices)
                .map(idx => this.files[idx])
                .filter(f => f && f.isGroup);
            
            if (selectedGroups.length > 0) {
                this.ungroupSiblings();
            } else {
                this.autoGroupByMetadata();
            }
        });
        document.getElementById('diagnostics-btn').addEventListener('click', () => this.openDiagnosticsModal());

        // Modal controls
        document.getElementById('modal-close-btn').addEventListener('click', () => this.closeBatchEditModal());
        document.getElementById('batch-cancel-btn').addEventListener('click', () => this.closeBatchEditModal());
        document.getElementById('batch-apply-btn').addEventListener('click', () => this.applyBatchEdit());

        // Delete confirmation modal controls
        document.getElementById('delete-modal-close-btn').addEventListener('click', () => this.closeDeleteConfirmModal());
        document.getElementById('delete-cancel-btn').addEventListener('click', () => this.closeDeleteConfirmModal());
        document.getElementById('delete-permanent-btn').addEventListener('click', () => this.handleDeleteFiles());

        // Diagnostics Modal controls
        document.getElementById('diagnostics-close-btn').addEventListener('click', () => this.closeDiagnosticsModal());
        document.getElementById('diagnostics-modal-close-btn').addEventListener('click', () => this.closeDiagnosticsModal());

        // Tab switching
        document.getElementById('ixml-tab-btn').addEventListener('click', () => this.switchToIXMLTab());
        document.getElementById('bext-tab-btn').addEventListener('click', () => this.switchToBEXTTab());
        document.getElementById('tools-tab-btn').addEventListener('click', () => this.switchToToolsTab());

        // Tools tab buttons
        document.getElementById('corrupt-ixml-modal-btn').addEventListener('click', () => {
            const corruptionType = prompt('Enter corruption type (missing-closing-tag, missing-xml-declaration, missing-speed-tag, invalid-root, empty, malformed-xml):', 'missing-closing-tag');
            if (corruptionType) {
                this.corruptIXMLForTesting(corruptionType);
            }
        });
        document.getElementById('repair-ixml-modal-btn').addEventListener('click', () => this.handleRepairIXML());

        // Close modal on outside click
        document.getElementById('batch-edit-modal').addEventListener('click', (e) => {
            if (e.target.id === 'batch-edit-modal') {
                this.closeBatchEditModal();
            }
        });

        document.getElementById('diagnostics-modal').addEventListener('click', (e) => {
            if (e.target.id === 'diagnostics-modal') {
                this.closeDiagnosticsModal();
            }
        });

        // Normalize controls
        document.getElementById('normalize-btn').addEventListener('click', () => this.openNormalizeModal());
        document.getElementById('cancel-normalize-btn').addEventListener('click', () => this.closeNormalizeModal());
        document.getElementById('confirm-normalize-btn').addEventListener('click', () => this.applyNormalize());

        // Clamp normalize target input to valid range (-20 to 0)
        const normalizeTarget = document.getElementById('normalize-target');
        if (normalizeTarget) {
            normalizeTarget.addEventListener('change', (e) => {
                let value = parseFloat(e.target.value);
                if (!isNaN(value)) {
                    value = Math.max(-20, Math.min(0, value));
                    e.target.value = value.toFixed(1);
                }
            });
        }

        const normalizeModal = document.getElementById('normalize-modal');
        normalizeModal.querySelector('.modal-close').addEventListener('click', () => this.closeNormalizeModal());
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
        renameModal.querySelector('.modal-close').addEventListener('click', () => this.closeRenameModal());
        renameModal.addEventListener('click', (e) => {
            if (e.target.id === 'rename-modal') {
                this.closeRenameModal();
            }
        });

        // Export controls
        document.getElementById('export-btn').addEventListener('click', () => this.openExportModal());
        document.getElementById('cancel-export-btn').addEventListener('click', () => this.closeExportModal());
        document.getElementById('confirm-export-btn').addEventListener('click', () => this.handleExport());

        const exportModal = document.getElementById('export-modal');
        exportModal.querySelector('.modal-close').addEventListener('click', () => this.closeExportModal());
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

        // Export TC Range controls
        document.getElementById('export-tc-range-btn').addEventListener('click', () => this.openExportTCRangeModal());
        document.getElementById('cancel-export-tc-range-btn').addEventListener('click', () => this.closeExportTCRangeModal());
        document.getElementById('confirm-export-tc-range-btn').addEventListener('click', () => this.handleExportTCRange());

        const exportTCRangeModal = document.getElementById('export-tc-range-modal');
        exportTCRangeModal.querySelector('.modal-close').addEventListener('click', () => this.closeExportTCRangeModal());
        exportTCRangeModal.addEventListener('click', (e) => {
            if (e.target.id === 'export-tc-range-modal') {
                this.closeExportTCRangeModal();
            }
        });

        document.getElementById('export-tc-format').addEventListener('change', (e) => {
            const format = e.target.value;
            document.getElementById('export-tc-wav-options').style.display = format === 'wav' ? 'block' : 'none';
            document.getElementById('export-tc-mp3-options').style.display = format === 'mp3' ? 'block' : 'none';
        });

        // Conform to CSV controls
        document.getElementById('conform-csv-btn').addEventListener('click', () => this.openConformCSVModal());
        document.getElementById('cancel-conform-csv-btn').addEventListener('click', () => this.closeConformCSVModal());
        document.getElementById('conform-csv-button').addEventListener('click', () => this.handleConformToCSV());
        document.getElementById('choose-csv-btn').addEventListener('click', () => this.handleChooseCSV());

        const conformCSVModal = document.getElementById('conform-csv-modal');
        conformCSVModal.querySelector('.modal-close').addEventListener('click', () => this.closeConformCSVModal());
        conformCSVModal.addEventListener('click', (e) => {
            if (e.target.id === 'conform-csv-modal') {
                this.closeConformCSVModal();
            }
        });

        // Multi-Process controls
        document.getElementById('multi-process-btn').addEventListener('click', () => this.openMultiProcessModal());
        document.getElementById('multi-process-exit-btn').addEventListener('click', () => this.closeMultiProcessModal());
        document.getElementById('multi-process-process-btn').addEventListener('click', () => this.handleMultiProcess());
        document.getElementById('mp-choose-csv-btn').addEventListener('click', () => this.handleMPChooseCSV());
        document.getElementById('mp-destination-btn').addEventListener('click', () => this.handleMPChooseDestination());
        document.getElementById('mp-channel-order-btn').addEventListener('click', () => this.openMPChannelOrderModal());

        const multiProcessModal = document.getElementById('multi-process-modal');
        multiProcessModal.querySelector('.modal-close').addEventListener('click', () => this.closeMultiProcessModal());
        multiProcessModal.addEventListener('click', (e) => {
            if (e.target.id === 'multi-process-modal') {
                this.closeMultiProcessModal();
            }
        });

        // Multi-Process Channel Order Modal
        const mpChannelOrderModal = document.getElementById('mp-channel-order-modal');
        document.getElementById('mp-channel-order-close-btn').addEventListener('click', () => this.closeMPChannelOrderModal());
        document.getElementById('mp-channel-order-close-btn-footer').addEventListener('click', () => this.closeMPChannelOrderModal());
        mpChannelOrderModal.addEventListener('click', (e) => {
            if (e.target.id === 'mp-channel-order-modal') {
                this.closeMPChannelOrderModal();
            }
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

        // Fader resize divider
        this.initFaderResizeDivider();

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

        // Combine destination folder selector
        document.getElementById('combine-select-dir-btn').addEventListener('click', async () => {
            try {
                const dirHandle = await window.showDirectoryPicker();
                this.combineDestinationHandle = dirHandle;
                const pathSpan = document.getElementById('combine-dest-path');
                pathSpan.textContent = dirHandle.name;
                pathSpan.style.color = 'var(--accent-primary)';
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error selecting directory:', err);
                }
            }
        });

        // Combine rename field event listeners using RenameManager
        this.renameManager.setupRenameFieldListeners('combine-rename', () => {
            this.updateCombineFilenamePreviews();
        });

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

                // Check if we're currently navigating within expanded child rows
                const focusedRow = document.activeElement;
                const isChildRow = focusedRow && focusedRow.classList && focusedRow.classList.contains('sibling-child-row');
                const isParentRow = focusedRow && focusedRow.dataset.index !== undefined && !focusedRow.dataset.parentIndex;
                
                console.log('[global-keydown] focused:', focusedRow?.tagName, 'isChild:', isChildRow, 'isParent:', isParentRow, 'key:', e.key);

                if (isChildRow) {
                    // Handle navigation within child rows
                    const parentIndex = parseInt(focusedRow.dataset.parentIndex);
                    const siblingOrder = parseInt(focusedRow.dataset.siblingOrder);
                    const parentGroup = this.files[parentIndex];
                    const siblingsCount = parentGroup.siblings ? parentGroup.siblings.length : 0;

                    console.log('[global-keydown] Child nav: parent:', parentIndex, 'sibling:', siblingOrder, 'total:', siblingsCount);

                    let nextParentIndex = parentIndex;
                    let nextSiblingOrder = siblingOrder;

                    if (e.key === 'ArrowDown') {
                        if (siblingOrder < siblingsCount - 1) {
                            // Next sibling
                            nextSiblingOrder = siblingOrder + 1;
                        } else {
                            // Last child, move to next parent group
                            let foundNext = false;
                            for (let i = parentIndex + 1; i < this.files.length; i++) {
                                if (!this.files[i].isChild) {
                                    this.selectFile(i, { metaKey: false, ctrlKey: false, shiftKey: false });
                                    // Focus the parent row
                                    const tbody = document.getElementById('file-list-body');
                                    const parentRow = tbody.querySelector(`tr[data-index="${i}"]:not([data-parent-index])`);
                                    if (parentRow) {
                                        setTimeout(() => parentRow.focus(), 0);
                                        parentRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                    }
                                    foundNext = true;
                                    break;
                                }
                            }
                            if (!foundNext) return;
                            return;
                        }
                    } else { // ArrowUp
                        if (siblingOrder > 0) {
                            // Previous sibling
                            nextSiblingOrder = siblingOrder - 1;
                        } else {
                            // First child, move to parent group
                            this.selectFile(parentIndex, { metaKey: false, ctrlKey: false, shiftKey: false });
                            // Focus the parent row
                            const tbody = document.getElementById('file-list-body');
                            const parentRow = tbody.querySelector(`tr[data-index="${parentIndex}"]:not([data-parent-index])`);
                            if (parentRow) {
                                setTimeout(() => parentRow.focus(), 0);
                                parentRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                            }
                            return;
                        }
                    }

                    // Select the next/prev child
                    this.selectChildFile(nextParentIndex, nextSiblingOrder, { metaKey: false, ctrlKey: false, shiftKey: false });
                    
                    // Scroll the row into view
                    const tbody = document.getElementById('file-list-body');
                    const nextRow = tbody.querySelector(`tr.sibling-child-row[data-parent-index="${nextParentIndex}"][data-sibling-order="${nextSiblingOrder}"]`);
                    if (nextRow) {
                        setTimeout(() => nextRow.focus(), 0); // Ensure focus after render
                        nextRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    }
                    return;
                }

                // Original parent row navigation logic
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
                        // Check if current selection is expanded group with children
                        const selectedFile = this.files[this.lastSelectedIndex];
                        if (selectedFile && selectedFile.isGroup && selectedFile.siblings && selectedFile.siblings.length > 0) {
                            const tbody = document.getElementById('file-list-body');
                            const firstChildRow = tbody.querySelector(`tr.sibling-child-row[data-parent-index="${this.lastSelectedIndex}"][data-sibling-order="0"]`);
                            if (firstChildRow) {
                                // Group is expanded, navigate to first child
                                this.selectChildFile(this.lastSelectedIndex, 0, { metaKey: false, ctrlKey: false, shiftKey: false });
                                firstChildRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                return;
                            }
                        }

                        // Already at the end, don't process
                        if (this.lastSelectedIndex >= this.files.length - 1) return;
                        targetIndex = this.lastSelectedIndex + 1;
                    } else { // ArrowUp
                        // Already at the start, don't process
                        if (this.lastSelectedIndex <= 0) return;
                        targetIndex = this.lastSelectedIndex - 1;
                        
                        // Check if the previous parent group is expanded with children
                        const previousFile = this.files[targetIndex];
                        if (previousFile && previousFile.isGroup && previousFile.siblings && previousFile.siblings.length > 0) {
                            const tbody = document.getElementById('file-list-body');
                            const lastChildOrder = previousFile.siblings.length - 1;
                            const lastChildRow = tbody.querySelector(`tr.sibling-child-row[data-parent-index="${targetIndex}"][data-sibling-order="${lastChildOrder}"]`);
                            if (lastChildRow) {
                                // Group is expanded, navigate to last child
                                this.selectChildFile(targetIndex, lastChildOrder, { metaKey: false, ctrlKey: false, shiftKey: false });
                                lastChildRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                return;
                            }
                        }
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

            // Spacebar for play/pause (only if not typing in an editable field and not loading)
            if (e.code === 'Space' && !this.isEditingText(e.target) && !this.isLoadingAudio) {
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
                isDragging = false; // Set this FIRST to prevent mouseleave from also firing
                const result = updatePlayheadPosition(e);
                if (result) {
                    if (wasPlaying) {
                        this.audioEngine.play(result.time);
                        document.getElementById('play-btn').textContent = '⏸';
                    } else {
                        this.audioEngine.seek(result.time);
                    }
                }
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
                isDragging = false; // Set this FIRST to prevent duplicate handling
                const result = updatePlayheadPosition(e);
                if (result) {
                    if (wasPlaying) {
                        this.audioEngine.play(result.time);
                        document.getElementById('play-btn').textContent = '⏸';
                    } else {
                        this.audioEngine.seek(result.time);
                    }
                }
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
        // Exclude range inputs (sliders) since they shouldn't block keyboard shortcuts
        if (element.tagName === 'INPUT' && element.type === 'range') {
            return false;
        }
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

        // Check if any files need iXML repair and notify user
        const filesNeedingRepair = this.files.filter(item => 
            (item.isGroup ? item.siblings.some(s => s.metadata.needsIXMLRepair) : item.metadata.needsIXMLRepair)
        );
        
        if (filesNeedingRepair.length > 0) {
            const count = filesNeedingRepair.length;
            alert(`⚠️ Import Complete\n\n${count} file(s) have incomplete or corrupted iXML metadata.\n\nFiles needing repair are highlighted in red in the file list.\n\nSelect a file and click "Repair iXML" to fix it.`);
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

    addTableRow(index, metadata, isChild = false, parentIndex = null) {
        console.log(`[addTableRow] index=${index}, metadata:`, { scene: metadata.scene, take: metadata.take, notes: metadata.notes, tape: metadata.tape, project: metadata.project });

        const tbody = document.getElementById('file-list-body');
        const tr = document.createElement('tr');
        tr.dataset.index = index;
        
        // Mark child rows
        if (isChild) {
            tr.classList.add('sibling-child-row');
            tr.dataset.parentIndex = parentIndex;
        }

        // Highlight red if file is missing iXML chunk
        if (!metadata.ixmlRaw) {
            tr.style.color = '#ff6b6b'; // Red text for files missing iXML
            tr.title = 'Missing iXML chunk - use Repair iXML to add it';
        }
        
        // Add indicator for large files that can't be edited
        const item = this.files[index];
        const isLargeFile = item.file && item.file.size > 2 * 1024 * 1024 * 1024;
        if (isLargeFile) {
            const fileSizeGB = (item.file.size / 1024 / 1024 / 1024).toFixed(2);
            tr.style.opacity = '0.7';
            tr.title = `Large file (${fileSizeGB} GB) - Metadata editing not supported (browser memory limitation)`;
        }

        const createCell = (key, val, editable = true) => {
            const td = document.createElement('td');
            
            // Check if this is a large file (>2GB) and disable editing
            if (isLargeFile) {
                editable = false;
            }

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
                // Make editable on double-click
                td.addEventListener('dblclick', () => {
                    td.contentEditable = true;
                    td.focus();
                    // Select all text for easy replacement
                    const range = document.createRange();
                    range.selectNodeContents(td);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                });
                td.addEventListener('blur', (e) => {
                    td.contentEditable = false;
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
        // Indices: 0: Channels, 1: BitDepth, 2: SampleRate, 3: Filename, 4: Format, 5: Scene, 6: Take, 7: Duration, 8: TCStart, 9: FPS, 10: FileSize, 11: Tape, 12: Project, 13: EndTC, 14: Notes
        
        // Format channel display with Mono/Poly indicator
        const channelCount = metadata.channels || 0;
        
        // For sibling groups, check if all siblings are mono (1 channel each)
        const isMonoGroup = item.isGroup && item.siblings && item.siblings.every(s => s.metadata.channels === 1);
        
        const channelDisplay = isMonoGroup ? `${channelCount} (Mono)` :
                               channelCount === 1 ? `${channelCount} (Mono)` : 
                               channelCount >= 2 ? `${channelCount} (Poly)` : 
                               channelCount;
        
        const cells = [];
        cells[0] = createCell('channels', channelDisplay, false);
        cells[1] = createCell('bitDepth', metadata.bitDepth ? metadata.bitDepth : '', false);
        cells[2] = createCell('sampleRate', metadata.sampleRate ? (metadata.sampleRate / 1000) + 'k' : '', false);
        
        // Special handling for filename cell - add expand/collapse icon for sibling groups
        const filenameCell = document.createElement('td');
        const filenameContainer = document.createElement('div');
        filenameContainer.style.display = 'flex';
        filenameContainer.style.alignItems = 'center';
        filenameContainer.style.gap = '6px';
        
        if (!isChild && item.isGroup && item.siblings && item.siblings.length > 0) {
            // Add expand/collapse icon
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'expand-toggle';
            toggleBtn.dataset.index = index;
            toggleBtn.innerHTML = '▶';
            toggleBtn.title = 'Expand siblings';
            toggleBtn.style.background = 'none';
            toggleBtn.style.border = 'none';
            toggleBtn.style.color = 'var(--accent-primary)';
            toggleBtn.style.cursor = 'pointer';
            toggleBtn.style.padding = '0';
            toggleBtn.style.fontSize = '0.8em';
            toggleBtn.style.width = '16px';
            toggleBtn.style.height = '16px';
            toggleBtn.style.display = 'flex';
            toggleBtn.style.alignItems = 'center';
            toggleBtn.style.justifyContent = 'center';
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSiblingExpand(index);
            });
            filenameContainer.appendChild(toggleBtn);
            tr.dataset.isGroup = 'true';
        } else if (isChild) {
            // Add spacer for child rows to align with expanded siblings
            const spacer = document.createElement('div');
            spacer.style.width = '16px';
            spacer.style.marginLeft = '8px';
            filenameContainer.appendChild(spacer);
        }
        
        const filenameText = document.createElement('span');
        filenameText.textContent = metadata.filename;
        filenameContainer.appendChild(filenameText);
        filenameCell.appendChild(filenameContainer);
        cells[3] = filenameCell;
        cells[4] = createCell('format', metadata.format, false);
        cells[5] = createCell('scene', metadata.scene);
        cells[6] = createCell('take', metadata.take);
        cells[7] = createCell('duration', metadata.duration, false);
        cells[8] = createCell('tcStart', metadata.tcStart, false);
        cells[9] = createCell('fps', metadata.fps, false);
        
        // File size: for sibling groups, sum all children; for individual files, show single size
        let fileSizeDisplay = '';
        if (item.isGroup && item.siblings && item.siblings.length > 0) {
            // Sum file sizes from all siblings
            const totalSize = item.siblings.reduce((sum, sibling) => sum + (sibling.metadata.fileSize || 0), 0);
            fileSizeDisplay = totalSize ? ((totalSize / 1000000).toFixed(2) + ' MB') : '';
        } else {
            // Single file size
            fileSizeDisplay = metadata.fileSize ? ((metadata.fileSize / 1000000).toFixed(2) + ' MB') : '';
        }
        cells[10] = createCell('fileSize', fileSizeDisplay, false);
        
        cells[11] = createCell('tape', metadata.tape);
        cells[12] = createCell('project', metadata.project);
        cells[13] = createCell('endTC', this.calculateEndTC(metadata), false);
        cells[14] = createCell('notes', metadata.notes);

        // Append in current column order
        this.columnOrder.forEach(colIndex => {
            if (cells[colIndex]) {
                tr.appendChild(cells[colIndex]);
            }
        });

        // Highlight files that need iXML repair
        if (metadata.needsIXMLRepair) {
            tr.style.color = '#ff6b6b'; // Red text for files needing repair
            tr.title = 'This file has an incomplete or missing iXML chunk. Use Repair iXML in Diagnostics to fix it.';
        }

        // Make parent rows focusable for keyboard navigation
        if (!isChild) {
            tr.tabIndex = 0;
        }

        tr.addEventListener('click', (e) => this.selectFile(index, e));
        tbody.appendChild(tr);
    }

    async selectChildFile(parentIndex, siblingOrder, e) {
        const key = `${parentIndex}:${siblingOrder}`;
        console.log('[selectChildFile] parentIndex:', parentIndex, 'siblingOrder:', siblingOrder, 'key:', key);
        
        if (e.ctrlKey || e.metaKey) {
            // Toggle selection with Ctrl/Cmd
            if (this.selectedChildren.has(key)) {
                this.selectedChildren.delete(key);
                console.log('[selectChildFile] Toggled OFF:', key);
            } else {
                this.selectedChildren.set(key, true);
                console.log('[selectChildFile] Toggled ON:', key);
            }
        } else if (e.shiftKey) {
            // Range selection not implemented for child rows yet
            this.selectedChildren.clear();
            this.selectedIndices.clear();
            this.selectedChildren.set(key, true);
            console.log('[selectChildFile] Shift-selected:', key);
        } else {
            // Single selection
            this.selectedChildren.clear();
            this.selectedIndices.clear();
            this.selectedChildren.set(key, true);
            console.log('[selectChildFile] Single-selected:', key);
        }
        
        console.log('[selectChildFile] selectedChildren Map:', this.selectedChildren);
        this.updateSelectionUI();
        
        // Focus the child row for keyboard navigation
        const tbody = document.getElementById('file-list-body');
        const childRow = tbody.querySelector(`tr.sibling-child-row[data-parent-index="${parentIndex}"][data-sibling-order="${siblingOrder}"]`);
        if (childRow) {
            childRow.focus();
        }
        
        // Clear region selection when switching files
        this.clearRegion();
        
        // Load the selected child file into waveform view and mixer
        if (this.selectedChildren.has(key)) {
            const groupItem = this.files[parentIndex];
            if (groupItem.isGroup && groupItem.siblings && groupItem.siblings[siblingOrder]) {
                const childSibling = groupItem.siblings[siblingOrder];
                
                // Create a temporary single-file structure and add it to this.files temporarily
                // so loadAudioForFile can find it by index
                const tempChildItem = {
                    isGroup: false,
                    handle: childSibling.handle,
                    file: childSibling.file,
                    metadata: childSibling.metadata
                };
                
                // Store the temp item and get its index
                const tempIndex = this.files.length;
                this.files.push(tempChildItem);
                
                // Load audio for this child file
                await this.loadAudioForFile(tempIndex);
                
                // Remove the temp item
                this.files.pop();
                
                this.currentlyLoadedFileIndex = -1; // Mark as child, not a regular file index
            }
        }
    }


    toggleSiblingExpand(groupIndex) {
        const tbody = document.getElementById('file-list-body');
        const groupRow = tbody.querySelector(`tr[data-index="${groupIndex}"]`);
        if (!groupRow) return;
        
        const toggleBtn = groupRow.querySelector('.expand-toggle');
        if (!toggleBtn) return;
        
        const isExpanded = groupRow.dataset.expanded === 'true';
        
        if (isExpanded) {
            // Collapse: remove child rows
            this.collapseGroup(groupIndex, tbody);
            toggleBtn.innerHTML = '▶';
            toggleBtn.title = 'Expand siblings';
            groupRow.dataset.expanded = 'false';
        } else {
            // Expand: insert child rows
            this.expandGroup(groupIndex, tbody);
            toggleBtn.innerHTML = '▼';
            toggleBtn.title = 'Collapse siblings';
            groupRow.dataset.expanded = 'true';
        }
    }
    
    expandGroup(groupIndex, tbody) {
        const groupItem = this.files[groupIndex];
        if (!groupItem.isGroup || !groupItem.siblings) return;
        
        const groupRow = tbody.querySelector(`tr[data-index="${groupIndex}"]`);
        if (!groupRow) return;
        
        // Insert child rows after the group row
        let insertAfter = groupRow;
        for (let i = 0; i < groupItem.siblings.length; i++) {
            const sibling = groupItem.siblings[i];
            const childRow = document.createElement('tr');
            childRow.classList.add('sibling-child-row');
            childRow.dataset.parentIndex = String(groupIndex);
            childRow.dataset.siblingOrder = String(i);
            childRow.tabIndex = 0; // Make focusable for keyboard navigation
            
            // Create cells for child row
            const createCell = (val, editable = true) => {
                const td = document.createElement('td');
                td.textContent = val || '';
                return td;
            };
            
            const cells = [];
            const childMetadata = sibling.metadata;
            const childChannelDisplay = childMetadata.channels === 1 ? '1 (Mono)' : `${childMetadata.channels} (Poly)`;
            
            cells[0] = createCell(childChannelDisplay);
            cells[1] = createCell(childMetadata.bitDepth ? childMetadata.bitDepth : '');
            cells[2] = createCell(childMetadata.sampleRate ? (childMetadata.sampleRate / 1000) + 'k' : '');
            
            // Filename with indentation
            const filenameCell = document.createElement('td');
            const filenameContainer = document.createElement('div');
            filenameContainer.style.display = 'flex';
            filenameContainer.style.alignItems = 'center';
            filenameContainer.style.paddingLeft = '36px';
            const filenameText = document.createElement('span');
            filenameText.textContent = childMetadata.filename;
            filenameContainer.appendChild(filenameText);
            filenameCell.appendChild(filenameContainer);
            cells[3] = filenameCell;
            
            cells[4] = createCell(childMetadata.format);
            cells[5] = createCell(childMetadata.scene);
            cells[6] = createCell(childMetadata.take);
            cells[7] = createCell(childMetadata.duration);
            cells[8] = createCell(childMetadata.tcStart);
            cells[9] = createCell(childMetadata.fps);
            cells[10] = createCell(childMetadata.fileSize ? ((childMetadata.fileSize / 1000000).toFixed(2) + ' MB') : '');
            cells[11] = createCell(childMetadata.tape);
            cells[12] = createCell(childMetadata.project);
            cells[13] = createCell(this.calculateEndTC(childMetadata));
            cells[14] = createCell(childMetadata.notes);
            
            // Append cells in column order
            this.columnOrder.forEach(colIndex => {
                if (cells[colIndex]) {
                    childRow.appendChild(cells[colIndex]);
                }
            });
            
            // Add selection handler for child row
            childRow.addEventListener('click', (e) => this.selectChildFile(groupIndex, i, e));
            
            // Insert after the previous row
            insertAfter.after(childRow);
            insertAfter = childRow;
        }
    }
    
    collapseGroup(groupIndex, tbody) {
        // Remove all child rows of this group
        const childRows = tbody.querySelectorAll(`tr.sibling-child-row[data-parent-index="${groupIndex}"]`);
        childRows.forEach(row => row.remove());
    }

    validateTimecode(tc) {
        // Validate HH:MM:SS:FF format
        const pattern = /^([0-9]{2}):([0-5][0-9]):([0-5][0-9]):([0-9]{2})$/;
        return pattern.test(tc);
    }

    parseTimecodeToSeconds(timecode) {
        // Parse HH:MM:SS:FF or HH:MM:SS format to seconds (ignoring frames)
        if (!timecode) return 0;
        const parts = timecode.split(':');
        if (parts.length < 3) return 0;
        
        const hours = parseInt(parts[0]) || 0;
        const minutes = parseInt(parts[1]) || 0;
        const seconds = parseInt(parts[2]) || 0;
        
        return hours * 3600 + minutes * 60 + seconds;
    }

    calculateEndTC(metadata) {
        // Calculate End TC from Start TC and duration
        // Returns HH:MM:SS:FF format
        if (!metadata.tcStart || !metadata.durationSec || !metadata.sampleRate) {
            return '00:00:00:00';
        }

        // Get FPS exact fraction
        const fpsExact = metadata.fpsExact || { numerator: 24, denominator: 1 };

        // Convert Start TC to samples
        const startSamples = this.metadataHandler.tcToSamples(
            metadata.tcStart,
            metadata.sampleRate,
            fpsExact
        );

        // Add duration in samples
        const durationSamples = Math.round(metadata.durationSec * metadata.sampleRate);
        const endSamples = startSamples + durationSamples;

        // Convert back to timecode
        const endTC = this.metadataHandler.samplesToTC(endSamples, metadata.sampleRate, fpsExact);

        return endTC;
    }

    addSecondsToTimecode(timecode, seconds) {
        // Add seconds to HH:MM:SS format timecode
        const totalSeconds = this.parseTimecodeToSeconds(timecode) + Math.floor(seconds);
        
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    tcToSeconds(timecode, fpsExact) {
        // Convert HH:MM:SS:FF to seconds, accounting for frame rate
        // This is frame-accurate, unlike parseTimecodeToSeconds which drops frames
        if (!timecode) return 0;
        const parts = timecode.split(':');
        if (parts.length < 3) return 0;
        
        const hours = parseInt(parts[0]) || 0;
        const minutes = parseInt(parts[1]) || 0;
        const seconds = parseInt(parts[2]) || 0;
        const frames = parseInt(parts[3]) || 0;
        
        // Get frame rate as decimal
        const frameRate = fpsExact.numerator / fpsExact.denominator;
        
        // Convert frames to seconds
        const frameSeconds = frames / frameRate;
        
        return hours * 3600 + minutes * 60 + seconds + frameSeconds;
    }

    validateTimeFormat(timeStr) {
        // Validate HH:MM:SS format
        const pattern = /^([0-9]{2}):([0-5][0-9]):([0-5][0-9])$/;
        return pattern.test(timeStr);
    }

    sortFiles(keyOrIndex) {
        let key;
        if (typeof keyOrIndex === 'number') {
            const keyMap = [
                'channels', 'bitDepth', 'sampleRate', 'filename', 'format', 'scene', 'take', 'duration', 'tcStart', 'fps', 'fileSize', 'tape', 'project', 'endTC', 'notes'
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
            
            // For endTC, calculate it since it's not stored directly in metadata
            if (key === 'endTC') {
                valA = this.calculateEndTC(a.metadata);
                valB = this.calculateEndTC(b.metadata);
                // Convert to seconds for numeric comparison
                valA = this.parseTimecodeToSeconds(valA) || 0;
                valB = this.parseTimecodeToSeconds(valB) || 0;
            }
            // Numeric sort for specific columns
            else if (['take', 'sampleRate', 'channels', 'bitDepth', 'fileSize'].includes(key)) {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            }
            // TC-based sort for timecode columns (convert to comparable format)
            else if (['tcStart'].includes(key)) {
                valA = this.parseTimecodeToSeconds(valA) || 0;
                valB = this.parseTimecodeToSeconds(valB) || 0;
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
        document.querySelectorAll('#table-header th').forEach((th) => {
            th.classList.remove('sort-asc', 'sort-desc');
            // Check if this header's sort key matches the current sort column
            if (th.dataset.sort === key || th.dataset.sort === this.sortColumn) {
                th.classList.add(this.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    updateMetadata(index, key, value) {
        this.files[index].metadata[key] = value;
        // Enable save button
        document.getElementById('batch-save-btn').disabled = false;
        
        // Refresh mixer if trackNames were updated and this file is currently loaded
        if (key === 'trackNames' && this.currentlyLoadedFileIndex === index) {
            const item = this.files[index];
            const trackNames = item.metadata.trackNames;
            
            // Preserve current fader height before rebuild
            const mixerContainer = document.getElementById('mixer-container');
            let currentHeight = 100; // Default
            if (mixerContainer) {
                const existingFaderContainer = mixerContainer.querySelector('.fader-container');
                if (existingFaderContainer) {
                    currentHeight = parseInt(getComputedStyle(existingFaderContainer).height) || 100;
                }
            }
            
            this.mixer.buildUI(item.metadata.channels || 1, trackNames);
            this.resetFaderHeights(currentHeight);
        }
        
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

        // Check for large files that can't be saved (>2GB browser memory limit)
        const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
        const largeFiles = [];
        
        for (const index of this.selectedIndices) {
            const item = this.files[index];
            const targets = item.isGroup ? item.siblings : [item];
            
            for (const target of targets) {
                if (target.file.size > MAX_FILE_SIZE) {
                    largeFiles.push({
                        name: target.metadata.filename,
                        size: (target.file.size / 1024 / 1024 / 1024).toFixed(2)
                    });
                }
            }
        }
        
        if (largeFiles.length > 0) {
            const fileList = largeFiles.map(f => `• ${f.name} (${f.size} GB)`).join('\n');
            alert(`Cannot save files larger than 2GB due to browser memory limitations:\n\n${fileList}\n\nMetadata editing is not supported for files over 2GB.`);
            return;
        }

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

                            // Re-parse the file to get the updated iXML/bEXT metadata
                            const freshMetadata = await this.metadataHandler.parseFile(target.file);
                            
                            // Merge the fresh metadata (especially iXML and bEXT chunks) with what we just saved
                            target.metadata = { ...target.metadata, ...metadataToSave, ...freshMetadata };
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

        // Update TC counter if the currently loaded file was modified
        if (this.currentlyLoadedFileIndex !== -1 && this.selectedIndices.has(this.currentlyLoadedFileIndex)) {
            const loadedFile = this.files[this.currentlyLoadedFileIndex];
            this.currentFileMetadata = loadedFile.metadata;
            
            const currentTimecode = document.getElementById('current-timecode');
            if (currentTimecode) {
                currentTimecode.textContent = this.secondsToTimecode(0);
            }
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
        // Clear child selections when selecting a parent row
        this.selectedChildren.clear();
        
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

        // Refresh diagnostics modal if it's open and selection changed
        if (document.getElementById('diagnostics-modal').classList.contains('active')) {
            this.refreshDiagnosticsDisplay();
        }

        // Load Audio for the clicked file (if selected and not already loaded)
        if (this.selectedIndices.has(index) && this.currentlyLoadedFileIndex !== index) {
            // Stop playback if currently playing
            if (this.audioEngine.isPlaying) {
                this.audioEngine.stop();
            }
            
            // Reset playback position to start
            this.audioEngine.seek(0);
            
            // Reset playhead visual cursor to start of waveform
            const playhead = document.getElementById('playhead');
            if (playhead) {
                playhead.style.left = '0%';
            }

            const item = this.files[index];
            const fileSizeGB = item.file.size / (1024 * 1024 * 1024);

            // Skip audio loading for files > 2GB (browser memory limit)
            if (item.file.size > 2 * 1024 * 1024 * 1024) {
                console.warn(`File ${item.metadata.filename} is ${fileSizeGB.toFixed(2)} GB - skipping audio loading (Metadata Only mode)`);

                // Clear the audio buffer so playback doesn't use old file's audio
                this.audioEngine.buffer = null;

                // Hide playback controls (not applicable for >2GB files)
                const playBtn = document.getElementById('play-btn');
                const stopBtn = document.getElementById('stop-btn');
                const loopBtn = document.getElementById('loop-btn');
                const timeDisplays = document.querySelectorAll('.time-display');
                
                if (playBtn) playBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'none';
                if (loopBtn) loopBtn.style.display = 'none';
                timeDisplays.forEach(el => el.style.display = 'none');

                // Update UI to show metadata-only mode
                const playerFilename = document.getElementById('player-filename');
                if (playerFilename) {
                    playerFilename.innerHTML = `${item.metadata.filename} <span style="color: #ffcf44; font-size: 0.8em;">(Metadata Only - ${fileSizeGB.toFixed(2)} GB)</span>`;
                }

                // Clear waveform with informative message
                const canvas = document.getElementById('waveform-canvas');
                const ctx = canvas.getContext('2d');
                
                // Ensure canvas has proper dimensions from its container
                const container = canvas.parentElement;
                const containerWidth = container.offsetWidth || container.clientWidth;
                const containerHeight = container.offsetHeight || container.clientHeight;
                
                // Set canvas dimensions to match container (prevent scaling/blur)
                if (containerWidth > 0 && containerHeight > 0) {
                    canvas.width = containerWidth;
                    canvas.height = containerHeight;
                } else {
                    // Fallback if container isn't sized yet
                    canvas.width = 800;
                    canvas.height = 200;
                }
                
                // Clear and draw message
                ctx.fillStyle = '#121212';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#ffcf44';
                ctx.font = '16px Inter';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Waveform and metadata editing unavailable for files > 2GB (browser limitation). You can still view metadata.', canvas.width / 2, canvas.height / 2);

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
            const index = parseInt(r.dataset.index);
            const isChildRow = r.classList.contains('sibling-child-row');
            
            if (isChildRow) {
                // Handle child row selection
                const parentIndex = parseInt(r.dataset.parentIndex);
                const siblingOrder = parseInt(r.dataset.siblingOrder);
                const key = `${parentIndex}:${siblingOrder}`;
                
                console.log('[updateSelectionUI] Child row:', { parentIndex, siblingOrder, key, hasKey: this.selectedChildren.has(key) });
                
                if (this.selectedChildren.has(key)) {
                    r.classList.add('selected');
                    console.log('[updateSelectionUI] Added selected class to child row:', key);
                } else {
                    r.classList.remove('selected');
                }
            } else {
                // Handle regular row selection
                if (this.selectedIndices.has(index)) {
                    r.classList.add('selected');
                } else {
                    r.classList.remove('selected');
                }
            }
        });

        const hasSelection = this.selectedIndices.size > 0 || this.selectedChildren.size > 0;
        
        // Update button states with null checks
        const safeSetDisabled = (id, disabled) => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = disabled;
        };
        
        safeSetDisabled('batch-edit-btn', !hasSelection);
        this.updateSaveButtonState();
        safeSetDisabled('batch-remove-btn', !hasSelection);
        safeSetDisabled('batch-delete-btn', !hasSelection);
        
        // Auto-Group button: enabled if selected files OR ungrouped files exist, OR if sibling groups selected
        const hasUngroupedFiles = this.files.some(f => !f.isGroup);
        const selectedGroups = Array.from(this.selectedIndices)
            .map(idx => this.files[idx])
            .filter(f => f && f.isGroup);
        const canUngroup = selectedGroups.length > 0;
        
        const autoGroupBtn = document.getElementById('auto-group-btn');
        if (autoGroupBtn) {
            autoGroupBtn.disabled = !hasSelection && !hasUngroupedFiles && !canUngroup;
            autoGroupBtn.textContent = canUngroup ? 'Ungroup Siblings' : 'Auto-Group';
        }
        safeSetDisabled('auto-group-btn', !hasSelection && !hasUngroupedFiles && !canUngroup);
        
        safeSetDisabled('diagnostics-btn', !hasSelection);
        safeSetDisabled('corrupt-ixml-modal-btn', this.selectedIndices.size !== 1);
        safeSetDisabled('normalize-btn', !hasSelection);
        safeSetDisabled('rename-btn', !hasSelection);
        safeSetDisabled('export-btn', !hasSelection);
        safeSetDisabled('save-mix-btn', this.selectedIndices.size !== 1);
        safeSetDisabled('load-mix-btn', this.selectedIndices.size !== 1);
        
        // Enable combine button if:
        // 1. Any sibling groups are detected AND no poly file is selected, OR
        // 2. Multiple individual mono files are selected that can be grouped by TC Start and audio size
        const hasSiblingGroups = this.files.some(item => item.isGroup);
        let isPolySelected = false;
        let canCombineSelectedMono = false;
        
        if (this.selectedIndices.size >= 1) {
            // Check if all selected files are poly (channels > 1) and not groups
            const selectedFiles = Array.from(this.selectedIndices).map(idx => this.files[idx]);
            const allPoly = selectedFiles.every(f => 
                f && 
                !f.isGroup && 
                f.metadata && 
                f.metadata.channels > 1
            );
            
            if (allPoly) {
                isPolySelected = true;
            } else if (this.selectedIndices.size === 1) {
                // Single selection: check if it's poly
                const selectedFile = selectedFiles[0];
                isPolySelected = selectedFile && 
                               selectedFile.metadata && 
                               selectedFile.metadata.channels > 1 && 
                               !selectedFile.isGroup;
            }
        }
        
        if (this.selectedIndices.size >= 2) {
            // Check if selected files are individual mono files that can be grouped
            const selectedFiles = Array.from(this.selectedIndices).map(idx => this.files[idx]);
            const allMono = selectedFiles.every(f => 
                f && 
                !f.isGroup && 
                f.metadata && 
                f.metadata.channels === 1
            );
            
            if (allMono) {
                // Group files by TC Start and audio size
                const groups = new Map();
                for (const file of selectedFiles) {
                    const key = `${file.metadata.tcStart}_${file.metadata.audioDataSize}`;
                    if (!groups.has(key)) {
                        groups.set(key, []);
                    }
                    groups.get(key).push(file);
                }
                
                // Enable combine if at least one group has 2+ files
                canCombineSelectedMono = Array.from(groups.values()).some(group => group.length >= 2);
            }
        }
        
        safeSetDisabled('combine-btn', (!hasSiblingGroups && !canCombineSelectedMono) || isPolySelected);
        
        // Enable export TC range button if one or more files are selected
        safeSetDisabled('export-tc-range-btn', this.selectedIndices.size === 0);
        
        // Enable conform to CSV button if one or more files are selected
        safeSetDisabled('conform-csv-btn', this.selectedIndices.size === 0);
        
        // Enable repair button if any selected file needs repair OR is missing iXML
        let needsRepair = false;
        for (const index of this.selectedIndices) {
            const selectedFile = this.files[index];
            const metadata = selectedFile && selectedFile.metadata;
            if (metadata && (metadata.needsIXMLRepair || !metadata.ixmlRaw)) {
                needsRepair = true;
                break;
            }
        }
        safeSetDisabled('repair-ixmlbtn', !needsRepair);
        safeSetDisabled('repair-ixml-modal-btn', !needsRepair);
        
        // Enable split button if exactly one poly file is selected (not a sibling group)
        safeSetDisabled('split-btn', !isPolySelected);
        
        // Update sidebar with selected files info
        this.updateSidebar();
    }

    updateSidebar() {
        const sidebarContent = document.getElementById('sidebar-content');
        if (!sidebarContent) return;

        // Collect all selected files (both parent and children)
        const selectedFiles = [];
        
        // Add parent files
        for (const index of this.selectedIndices) {
            const file = this.files[index];
            if (file) {
                selectedFiles.push({
                    file,
                    isChild: false,
                    index
                });
            }
        }
        
        // Add child files
        for (const [key, _] of this.selectedChildren) {
            const [parentIndexStr, siblingOrderStr] = key.split(':');
            const parentIndex = parseInt(parentIndexStr);
            const siblingOrder = parseInt(siblingOrderStr);
            const parent = this.files[parentIndex];
            
            if (parent && parent.isGroup && parent.siblingFiles && parent.siblingFiles[siblingOrder]) {
                selectedFiles.push({
                    file: parent.siblingFiles[siblingOrder],
                    isChild: true,
                    parentIndex,
                    siblingOrder
                });
            }
        }

        // Clear sidebar if no files selected
        if (selectedFiles.length === 0) {
            sidebarContent.innerHTML = '<p class="sidebar-empty">No takes selected</p>';
            return;
        }

        // Build sidebar HTML
        let html = '';
        selectedFiles.forEach(({ file, isChild, index, parentIndex, siblingOrder }) => {
            const metadata = file.metadata || {};
            const filename = metadata.filename || file.fileHandle?.name || file.fileObj?.name || 'Unknown';
            const uniqueId = `${index}-${siblingOrder || 0}`;
            
            html += `
                <div class="sidebar-take-item">
                    <div class="sidebar-take-title">${this.escapeHtml(filename)}</div>
                    <div class="sidebar-take-details">
                        ${metadata.scene ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">Scene:</span>
                            <span class="sidebar-detail-value editable-field" data-field="scene" data-file-index="${isChild ? parentIndex : index}">${this.escapeHtml(metadata.scene)}</span>
                        </div>` : ''}
                        ${metadata.take ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">Take:</span>
                            <span class="sidebar-detail-value editable-field" data-field="take" data-file-index="${isChild ? parentIndex : index}">${this.escapeHtml(metadata.take)}</span>
                        </div>` : ''}
                        ${metadata.channels ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">Channels:</span>
                            <span class="sidebar-detail-value">${metadata.channels}</span>
                        </div>` : ''}
                        ${metadata.sampleRate ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">Sample Rate:</span>
                            <span class="sidebar-detail-value">${metadata.sampleRate} Hz</span>
                        </div>` : ''}
                        ${metadata.bitDepth ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">Bit Depth:</span>
                            <span class="sidebar-detail-value">${metadata.bitDepth}-bit</span>
                        </div>` : ''}
                        ${metadata.duration ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">Duration:</span>
                            <span class="sidebar-detail-value">${metadata.duration}</span>
                        </div>` : ''}
                        ${metadata.tcStart ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">TC Start:</span>
                            <span class="sidebar-detail-value">${this.escapeHtml(metadata.tcStart)}</span>
                        </div>` : ''}
                        ${metadata.fps ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">FPS:</span>
                            <select class="sidebar-fps-select" data-file-index="${isChild ? parentIndex : index}" style="color: var(--text-main); background: var(--bg-primary); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; padding: 2px 4px; font-size: 0.85rem;">
                                <option value="">-- Select --</option>
                                <option value="23.98" ${metadata.fps === '23.98' ? 'selected' : ''}>23.98</option>
                                <option value="24" ${metadata.fps === '24' ? 'selected' : ''}>24</option>
                                <option value="25" ${metadata.fps === '25' ? 'selected' : ''}>25</option>
                                <option value="29.97" ${metadata.fps === '29.97' ? 'selected' : ''}>29.97</option>
                                <option value="30" ${metadata.fps === '30' ? 'selected' : ''}>30</option>
                                <option value="50" ${metadata.fps === '50' ? 'selected' : ''}>50</option>
                                <option value="59.94" ${metadata.fps === '59.94' ? 'selected' : ''}>59.94</option>
                                <option value="60" ${metadata.fps === '60' ? 'selected' : ''}>60</option>
                            </select>
                        </div>` : ''}
                        ${metadata.project ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">Project:</span>
                            <span class="sidebar-detail-value">${this.escapeHtml(metadata.project)}</span>
                        </div>` : ''}
                        ${metadata.tape ? `<div class="sidebar-detail-row">
                            <span class="sidebar-detail-label">Tape:</span>
                            <span class="sidebar-detail-value">${this.escapeHtml(metadata.tape)}</span>
                        </div>` : ''}
                        ${metadata.trackNames ? `<div class="sidebar-detail-row">
                            <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                                <span class="sidebar-detail-label">Track Names:</span>
                                <button class="track-names-toggle" data-track-id="${uniqueId}" style="background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 0.8em; padding: 0; line-height: 1; transform: rotate(-90deg); transition: transform 0.2s; margin-top: 0.15rem;">▼</button>
                            </div>
                            <span class="sidebar-detail-value track-names-content" id="track-names-${uniqueId}" style="display: none;">${Array.isArray(metadata.trackNames) ? metadata.trackNames.map((name, idx) => `<span class="editable-field track-name-item" data-field="trackName" data-track-index="${idx}" data-file-index="${isChild ? parentIndex : index}">${this.escapeHtml(name)}</span>`).join('<br/>') : `<span class="editable-field track-name-item" data-field="trackName" data-track-index="0" data-file-index="${isChild ? parentIndex : index}">${this.escapeHtml(metadata.trackNames)}</span>`}</span>
                        </div>` : ''}
                    </div>
                </div>
            `;
        });
        
        sidebarContent.innerHTML = html;
        
        // Attach click handlers for track names toggle buttons
        sidebarContent.querySelectorAll('.track-names-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const trackId = btn.dataset.trackId;
                const content = document.getElementById(`track-names-${trackId}`);
                const isHidden = content.style.display === 'none';
                content.style.display = isHidden ? '' : 'none';
                btn.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
            });
        });

        // Attach click handlers for editable scene field
        sidebarContent.querySelectorAll('.editable-field[data-field="scene"]').forEach(field => {
            field.addEventListener('click', (e) => {
                if (field.contentEditable === 'true') return; // Already editing
                field.contentEditable = true;
                field.focus();
                // Select all text for easy replacement
                const range = document.createRange();
                range.selectNodeContents(field);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            });

            field.addEventListener('blur', (e) => {
                field.contentEditable = false;
                const newValue = e.target.textContent.trim();
                const fileIndex = parseInt(field.dataset.fileIndex);
                const oldValue = this.files[fileIndex].metadata.scene || '';
                
                // Only update if value actually changed
                if (newValue !== oldValue) {
                    this.updateMetadata(fileIndex, 'scene', newValue);
                }
            });

            field.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    // Restore original value
                    const fileIndex = parseInt(field.dataset.fileIndex);
                    field.textContent = this.files[fileIndex].metadata.scene || '';
                    field.blur();
                }
            });
        });

        // Attach click handlers for editable take field
        sidebarContent.querySelectorAll('.editable-field[data-field="take"]').forEach(field => {
            field.addEventListener('click', (e) => {
                if (field.contentEditable === 'true') return;
                field.contentEditable = true;
                field.focus();
                const range = document.createRange();
                range.selectNodeContents(field);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            });

            field.addEventListener('blur', (e) => {
                field.contentEditable = false;
                const newValue = e.target.textContent.trim();
                const fileIndex = parseInt(field.dataset.fileIndex);
                const oldValue = this.files[fileIndex].metadata.take || '';
                
                if (newValue !== oldValue) {
                    this.updateMetadata(fileIndex, 'take', newValue);
                }
            });

            field.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    const fileIndex = parseInt(field.dataset.fileIndex);
                    field.textContent = this.files[fileIndex].metadata.take || '';
                    field.blur();
                }
            });
        });

        // Attach click handlers for editable track name fields
        sidebarContent.querySelectorAll('.editable-field[data-field="trackName"]').forEach(field => {
            field.addEventListener('click', (e) => {
                if (field.contentEditable === 'true') return;
                field.contentEditable = true;
                field.focus();
                const range = document.createRange();
                range.selectNodeContents(field);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            });

            field.addEventListener('blur', (e) => {
                field.contentEditable = false;
                const newValue = e.target.textContent.trim();
                const fileIndex = parseInt(field.dataset.fileIndex);
                const trackIndex = parseInt(field.dataset.trackIndex);
                const trackNames = this.files[fileIndex].metadata.trackNames;
                const oldValue = Array.isArray(trackNames) ? (trackNames[trackIndex] || '') : (trackNames || '');
                
                if (newValue !== oldValue) {
                    // Update the specific track name in the array
                    if (Array.isArray(trackNames)) {
                        const updatedTrackNames = [...trackNames];
                        updatedTrackNames[trackIndex] = newValue;
                        this.updateMetadata(fileIndex, 'trackNames', updatedTrackNames);
                    } else {
                        this.updateMetadata(fileIndex, 'trackNames', [newValue]);
                    }
                }
            });

            field.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    const fileIndex = parseInt(field.dataset.fileIndex);
                    const trackIndex = parseInt(field.dataset.trackIndex);
                    const trackNames = this.files[fileIndex].metadata.trackNames;
                    const originalValue = Array.isArray(trackNames) ? (trackNames[trackIndex] || '') : (trackNames || '');
                    field.textContent = originalValue;
                    field.blur();
                }
            });
        });

        // Attach change handler for FPS dropdown
        sidebarContent.querySelectorAll('.sidebar-fps-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const newValue = e.target.value;
                const fileIndex = parseInt(select.dataset.fileIndex);
                const oldValue = this.files[fileIndex].metadata.fps || '';
                
                if (newValue && newValue !== oldValue) {
                    this.updateMetadata(fileIndex, 'fps', newValue);
                }
            });
        });
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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

    openDeleteConfirmModal() {
        if (this.selectedIndices.size === 0) return;

        const modal = document.getElementById('delete-confirm-modal');
        document.getElementById('delete-count').textContent = this.selectedIndices.size;
        modal.classList.add('active');
    }

    closeDeleteConfirmModal() {
        const modal = document.getElementById('delete-confirm-modal');
        modal.classList.remove('active');
    }

    async handleDeleteFiles() {
        if (this.selectedIndices.size === 0) return;

        this.closeDeleteConfirmModal();
        document.body.style.cursor = 'wait';

        try {
            // Stop playback to avoid issues with deleted files
            this.stop();

            const indices = Array.from(this.selectedIndices).sort((a, b) => b - a);
            let successCount = 0;
            let failCount = 0;

            for (const index of indices) {
                const item = this.files[index];
                const targets = item.isGroup ? item.siblings : [item];

                for (const target of targets) {
                    try {
                        if (target.handle && target.handle.remove) {
                            // Permanently delete the file
                            // Note: Web browsers cannot move files to system Trash
                            await target.handle.remove({ recursive: false });
                            successCount++;
                        } else {
                            console.warn(`Cannot delete ${target.metadata.filename}: file handle does not support deletion`);
                            failCount++;
                        }
                    } catch (err) {
                        console.error(`Failed to delete ${target.metadata.filename}:`, err);
                        failCount++;
                    }
                }

                // Remove from files array
                this.files.splice(index, 1);
            }

            // Clear selection
            this.selectedIndices.clear();

            // Refresh UI
            const tbody = document.getElementById('file-list-body');
            tbody.innerHTML = '';
            this.files.forEach((file, i) => this.addTableRow(i, file.metadata));
            this.updateSelectionUI();

            // Show summary
            let message = `${successCount} file(s) permanently deleted`;
            if (failCount > 0) {
                message += `\n${failCount} file(s) could not be deleted`;
            }
            alert(message);

        } catch (err) {
            console.error('Delete operation failed:', err);
            alert(`Delete failed: ${err.message}`);
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    async applyBatchEdit() {
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

        this.closeBatchEditModal();

        // Save the files immediately to persist the changes to both bEXT and iXML
        if (updateCount > 0) {
            document.body.style.cursor = 'wait';
            try {
                await this.saveSelected();
                console.log(`Applied and saved ${Object.keys(updates).length} field(s) to ${this.selectedIndices.size} file(s)`);
            } catch (err) {
                console.error('Error saving batch edits:', err);
                alert('Error saving changes. Please try again.');
            } finally {
                document.body.style.cursor = 'default';
            }
        } else {
            console.log(`Applied ${Object.keys(updates).length} field(s) to ${this.selectedIndices.size} file(s)`);
        }
    }

    async viewIXML() {
        const item = this.getSelectedFileForDiagnostics();
        if (!item) return;

        const content = document.getElementById('ixml-content');

        // Display raw iXML metadata only
        const metadata = item ? item.metadata : null;

        let displayText = '';

        if (metadata && metadata.ixmlRaw) {
            displayText = this.formatXMLForDisplay(metadata.ixmlRaw);
        } else {
            displayText = 'No iXML data found in this file.';
        }

        content.textContent = displayText;

        // Note: Modal opening is handled by the caller
    }

    formatXMLForDisplay(xmlString) {
        // Pretty-print XML with proper indentation
        // Tags with only text content stay on one line: <TAG>content</TAG>
        // Container tags with nested elements break across lines
        
        let formatted = '';
        let indentLevel = 0;
        const indentStr = '  '; // 2 spaces per indent level

        // Split by tags while preserving them
        const regex = /(<[^>]+>)|([^<]+)/g;
        let match;
        let tokens = [];
        
        while ((match = regex.exec(xmlString)) !== null) {
            tokens.push(match[0]);
        }

        // Process tokens and format
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            
            if (token.startsWith('<')) {
                if (token.startsWith('<?')) {
                    // XML declaration
                    formatted += token + '\n';
                } else if (token.startsWith('</')) {
                    // Closing tag - decrease indent
                    indentLevel = Math.max(0, indentLevel - 1);
                    formatted += indentStr.repeat(indentLevel) + token + '\n';
                } else if (token.endsWith('/>')) {
                    // Self-closing tag
                    formatted += indentStr.repeat(indentLevel) + token + '\n';
                } else {
                    // Opening tag
                    // Check if next token is just text content (not another tag)
                    if (i + 1 < tokens.length && !tokens[i + 1].startsWith('<')) {
                        const textContent = tokens[i + 1].trim();
                        if (i + 2 < tokens.length && tokens[i + 2].startsWith('</')) {
                            // This is a simple text element: <TAG>text</TAG>
                            const closingTag = tokens[i + 2];
                            formatted += indentStr.repeat(indentLevel) + token + textContent + closingTag + '\n';
                            // Skip the next two tokens since we've already processed them
                            i += 2;
                        } else {
                            // Text content but more elements follow
                            formatted += indentStr.repeat(indentLevel) + token + '\n';
                            indentLevel++;
                        }
                    } else {
                        // Container tag with nested elements
                        formatted += indentStr.repeat(indentLevel) + token + '\n';
                        indentLevel++;
                    }
                }
            }
        }

        return formatted.trim();
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

    /**
     * Auto-group files by metadata (tcStart + audioDataSize)
     * Works on selected files if any, otherwise all ungrouped files
     */
    ungroupSiblings() {
        // Collect all sibling groups from selection
        const groupsToUngroup = [];
        const indicesToRemove = new Set();
        
        for (const idx of this.selectedIndices) {
            const item = this.files[idx];
            if (item && item.isGroup && item.siblings && item.siblings.length > 0) {
                groupsToUngroup.push({ group: item, index: idx });
                indicesToRemove.add(idx);
            }
        }
        
        if (groupsToUngroup.length === 0) {
            alert('No sibling groups selected to ungroup.');
            return;
        }
        
        const totalFiles = groupsToUngroup.reduce((sum, g) => sum + g.group.siblings.length, 0);
        const msg = `Ungroup ${groupsToUngroup.length} sibling group${groupsToUngroup.length > 1 ? 's' : ''} (${totalFiles} file${totalFiles > 1 ? 's' : ''}) back into individual files?`;
        
        if (!confirm(msg)) {
            return;
        }
        
        // Collect all individual files to re-insert
        const filesToReinsert = [];
        for (const { group, index } of groupsToUngroup) {
            // Re-create individual file objects from siblings
            for (const sibling of group.siblings) {
                filesToReinsert.push({
                    file: {
                        handle: sibling.handle,
                        file: sibling.file,
                        metadata: { ...sibling.metadata }
                    },
                    insertIndex: index
                });
            }
        }
        
        // Remove groups in reverse order
        const sortedIndices = Array.from(indicesToRemove).sort((a, b) => b - a);
        sortedIndices.forEach(idx => {
            this.files.splice(idx, 1);
        });
        
        // Re-insert individual files at appropriate positions
        filesToReinsert.sort((a, b) => a.insertIndex - b.insertIndex);
        let offset = 0;
        for (const { file, insertIndex } of filesToReinsert) {
            const adjustedIndex = insertIndex - Array.from(indicesToRemove).filter(i => i < insertIndex).length + offset;
            this.files.splice(adjustedIndex, 0, file);
            offset++;
        }
        
        // Clear selection and refresh table
        this.selectedIndices.clear();
        const tbody = document.getElementById('file-list-body');
        tbody.innerHTML = '';
        this.files.forEach((item, index) => {
            this.addTableRow(index, item.metadata);
        });
        
        this.updateSelectionUI();
        console.log(`✓ Ungrouped ${groupsToUngroup.length} sibling group${groupsToUngroup.length > 1 ? 's' : ''} into ${totalFiles} individual file${totalFiles > 1 ? 's' : ''}`);
    }

    async autoGroupByMetadata() {
        // Determine files to process
        let filesToProcess;
        let isSelection = false;
        
        if (this.selectedIndices.size > 0) {
            // Work on selected files
            filesToProcess = Array.from(this.selectedIndices)
                .map(idx => ({ file: this.files[idx], originalIndex: idx }))
                .filter(item => item.file && !item.file.isGroup); // Exclude already grouped files
            isSelection = true;
        } else {
            // Work on all ungrouped files
            filesToProcess = this.files
                .map((file, idx) => ({ file, originalIndex: idx }))
                .filter(item => !item.file.isGroup);
        }
        
        if (filesToProcess.length < 2) {
            alert('Need at least 2 ungrouped files to auto-group.');
            return;
        }
        
        // Group by tcStart + audioDataSize
        const groups = new Map();
        filesToProcess.forEach(item => {
            const key = `${item.file.metadata.tcStart}_${item.file.metadata.audioDataSize}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(item);
        });
        
        // Filter to only groups with 2+ files and all mono
        const validGroups = [];
        for (const [key, items] of groups.entries()) {
            if (items.length < 2) continue;
            
            // Check all files in group are mono
            const allMono = items.every(item => item.file.metadata.channels === 1);
            if (!allMono) {
                console.warn(`Skipping group with key ${key} - contains non-mono files`);
                continue;
            }
            
            validGroups.push(items);
        }
        
        if (validGroups.length === 0) {
            const msg = isSelection 
                ? 'No groupable files found in selection.\n\nFiles must:\n• Be monophonic (1 channel)\n• Have matching TC Start and duration\n• Have at least 2 files per group'
                : 'No groupable files found.\n\nFiles must:\n• Be monophonic (1 channel)\n• Have matching TC Start and duration\n• Have at least 2 files per group';
            alert(msg);
            return;
        }
        
        // Show confirmation
        const totalFiles = validGroups.reduce((sum, group) => sum + group.length, 0);
        const msg = isSelection
            ? `Create ${validGroups.length} sibling group${validGroups.length > 1 ? 's' : ''} from ${totalFiles} selected file${totalFiles > 1 ? 's' : ''}?`
            : `Create ${validGroups.length} sibling group${validGroups.length > 1 ? 's' : ''} from ${totalFiles} file${totalFiles > 1 ? 's' : ''}?`;
        
        if (!confirm(msg)) {
            return;
        }
        
        // Create sibling groups
        const indicesToRemove = new Set();
        const newGroups = [];
        
        for (const groupItems of validGroups) {
            // Sort by filename for consistent ordering
            groupItems.sort((a, b) => 
                a.file.metadata.filename.localeCompare(b.file.metadata.filename, undefined, { numeric: true, sensitivity: 'base' })
            );
            
            // Generate group name from Scene + Take metadata
            const firstFile = groupItems[0].file;
            let groupName;
            
            if (firstFile.metadata.scene && firstFile.metadata.take) {
                const scene = firstFile.metadata.scene;
                const take = firstFile.metadata.take;
                // Pad scene and take with leading zeros if numeric
                const scenePadded = /^\d+$/.test(scene) ? scene.padStart(2, '0') : scene;
                const takePadded = /^\d+$/.test(take) ? take.padStart(2, '0') : take;
                groupName = `${scenePadded}T${takePadded}_X.wav`;
            } else {
                // Fallback: use common base name
                const filenames = groupItems.map(item => item.file.metadata.filename);
                const baseName = this.getCommonBaseName(filenames);
                groupName = `${baseName}_X.wav`;
            }
            
            // Collect track names from all siblings
            const trackNames = groupItems.map((item, idx) => {
                if (item.file.metadata.trackNames && item.file.metadata.trackNames.length > 0) {
                    return item.file.metadata.trackNames[0];
                }
                return `Ch${idx + 1}`;
            });
            
            // Create sibling group object
            const siblingGroup = {
                isGroup: true,
                metadata: {
                    ...firstFile.metadata,
                    filename: groupName,
                    channels: groupItems.length, // Number of siblings (files in group)
                    trackNames: trackNames // Track names from all siblings
                },
                siblings: groupItems.map((item, idx) => ({
                    handle: item.file.handle,
                    file: item.file.file,
                    metadata: item.file.metadata,
                    order: idx
                })),
                // Keep reference to first file for compatibility
                handle: groupItems[0].file.handle,
                file: groupItems[0].file.file
            };
            
            newGroups.push({
                group: siblingGroup,
                insertIndex: Math.min(...groupItems.map(item => item.originalIndex))
            });
            
            // Mark original indices for removal
            groupItems.forEach(item => indicesToRemove.add(item.originalIndex));
        }
        
        // Remove individual files and insert groups
        // Sort indices in descending order to remove from end first
        const sortedIndices = Array.from(indicesToRemove).sort((a, b) => b - a);
        sortedIndices.forEach(idx => {
            this.files.splice(idx, 1);
        });
        
        // Insert groups at appropriate positions (adjust for removals)
        newGroups.sort((a, b) => a.insertIndex - b.insertIndex);
        let offset = 0;
        for (const { group, insertIndex } of newGroups) {
            // Calculate adjusted index accounting for previous removals
            const adjustedIndex = insertIndex - Array.from(indicesToRemove).filter(i => i < insertIndex).length + offset;
            this.files.splice(adjustedIndex, 0, group);
            offset++;
        }
        
        // Refresh table
        const tbody = document.getElementById('file-list-body');
        tbody.innerHTML = '';
        this.files.forEach((item, index) => {
            this.addTableRow(index, item.metadata);
        });
        
        // Clear selection and update UI
        this.selectedIndices.clear();
        this.updateSelectionUI();
        
        // Show success message
        this.showToast(`Created ${validGroups.length} sibling group${validGroups.length > 1 ? 's' : ''} from ${totalFiles} file${totalFiles > 1 ? 's' : ''}`, 'success', 3000);
    }

    openDiagnosticsModal() {
        console.log('Opening diagnostics modal');
        // Default to iXML tab and populate it
        this.switchToIXMLTab();
        this.viewIXML();
        // Update filename indicator for currently selected file
        this.updateDiagnosticsFilenameIndicator();
        document.getElementById('diagnostics-modal').classList.add('active');
    }

    getSelectedFileForDiagnostics() {
        // Helper method to get the selected file for diagnostics
        // Returns the file item and its metadata (handles both parent and child selections)
        
        // Check if a child is selected
        if (this.selectedChildren.size === 1) {
            const childKey = Array.from(this.selectedChildren.keys())[0];
            const [parentIndex, siblingOrder] = childKey.split(':').map(Number);
            const groupItem = this.files[parentIndex];
            
            if (groupItem.isGroup && groupItem.siblings && groupItem.siblings[siblingOrder]) {
                const childSibling = groupItem.siblings[siblingOrder];
                return {
                    handle: childSibling.handle,
                    file: childSibling.file,
                    metadata: childSibling.metadata
                };
            }
        }
        
        // Otherwise check if a parent is selected
        if (this.selectedIndices.size === 1) {
            const index = Array.from(this.selectedIndices)[0];
            return this.files[index];
        }
        
        return null;
    }

    refreshDiagnosticsDisplay() {
        // Update filename indicator
        this.updateDiagnosticsFilenameIndicator();
        
        // Check which tab is currently active and refresh that tab's content
        if (document.getElementById('ixml-tab-btn').classList.contains('active')) {
            this.viewIXML();
        } else if (document.getElementById('bext-tab-btn').classList.contains('active')) {
            this.viewBEXT();
        }
    }

    updateDiagnosticsFilenameIndicator() {
        const item = this.getSelectedFileForDiagnostics();
        const indicator = document.getElementById('diagnostics-filename-indicator');
        
        if (!indicator) return; // Modal might not be in DOM
        
        if (item && item.metadata) {
            indicator.textContent = `Viewing: ${item.metadata.filename}`;
        } else {
            indicator.textContent = 'No file selected';
        }
    }

    closeDiagnosticsModal() {
        const modal = document.getElementById('diagnostics-modal');
        modal.classList.remove('active');
    }

    switchToIXMLTab() {
        document.getElementById('ixml-tab-btn').classList.add('active');
        document.getElementById('bext-tab-btn').classList.remove('active');
        document.getElementById('tools-tab-btn').classList.remove('active');
        document.getElementById('ixml-tab-content').classList.add('active');
        document.getElementById('bext-tab-content').classList.remove('active');
        document.getElementById('tools-tab-content').classList.remove('active');
        // Populate iXML content when switching to this tab (only if modal is already open)
        if (document.getElementById('diagnostics-modal').classList.contains('active')) {
            this.viewIXML();
        }
    }

    switchToBEXTTab() {
        document.getElementById('bext-tab-btn').classList.add('active');
        document.getElementById('ixml-tab-btn').classList.remove('active');
        document.getElementById('tools-tab-btn').classList.remove('active');
        document.getElementById('bext-tab-content').classList.add('active');
        document.getElementById('ixml-tab-content').classList.remove('active');
        document.getElementById('tools-tab-content').classList.remove('active');
        // Populate bEXT content when switching to this tab (only if modal is already open)
        if (document.getElementById('diagnostics-modal').classList.contains('active')) {
            this.viewBEXT();
        }
    }

    switchToToolsTab() {
        document.getElementById('tools-tab-btn').classList.add('active');
        document.getElementById('ixml-tab-btn').classList.remove('active');
        document.getElementById('bext-tab-btn').classList.remove('active');
        document.getElementById('tools-tab-content').classList.add('active');
        document.getElementById('ixml-tab-content').classList.remove('active');
        document.getElementById('bext-tab-content').classList.remove('active');
        // No content to populate for tools tab
    }

    async viewBEXT() {
        const item = this.getSelectedFileForDiagnostics();
        if (!item) return;

        try {
            const content = document.getElementById('bext-content');
            
            // First try to use cached bEXT data from metadata
            if (item.metadata && item.metadata.bextRaw) {
                const bextData = this.metadataHandler.formatBEXTDisplay(item.metadata.bextRaw);
                content.textContent = bextData || 'No bEXT data found in this file.';
                return;
            }

            // For large files, only read the last portion (bEXT chunks are typically at the end)
            // For >3GB files, reading entire file will fail or be very slow
            const fileSize = item.file.size;
            const isLargeFile = fileSize > 2 * 1024 * 1024 * 1024; // > 2GB

            if (isLargeFile) {
                // For large files, read only the last 256KB (bEXT is usually much smaller)
                const tailSize = Math.min(256 * 1024, fileSize);
                const startPos = fileSize - tailSize;
                
                const slice = item.file.slice(startPos, fileSize);
                const arrayBuffer = await slice.arrayBuffer();
                
                // Parse from this tail section
                const bextData = this.metadataHandler.getBEXTChunk(arrayBuffer, true);
                
                if (bextData) {
                    content.textContent = bextData;
                } else {
                    content.textContent = 'No bEXT data found in this file.\n\n(File is >2GB - only checked last 256KB)';
                }
            } else {
                // For normal files, read the whole thing
                // Refresh file object from handle if available (in case file was modified)
                if (item.handle) {
                    try {
                        item.file = await item.handle.getFile();
                    } catch (err) {
                        console.warn('Could not refresh file from handle:', err);
                        // Continue with existing file reference
                    }
                }

                const arrayBuffer = await item.file.arrayBuffer();
                const bextData = this.metadataHandler.getBEXTChunk(arrayBuffer);

                if (bextData) {
                    content.textContent = bextData;
                } else {
                    content.textContent = 'No bEXT data found in this file.';
                }
            }

            // Note: Tab switching and modal opening is handled by the caller
        } catch (err) {
            console.error('Error reading bEXT:', err);
            const content = document.getElementById('bext-content');
            content.textContent = `Error reading bEXT: ${err.message}\n\nThis may occur on very large files or due to file access restrictions.`;
        }
    }

    // Debug function to corrupt iXML for testing repair functionality
    async corruptIXMLForTesting(corruptionType = 'missing-closing-tag') {
        if (this.selectedIndices.size !== 1) {
            alert('Please select exactly one file to corrupt.');
            return;
        }

        const selectedIndex = Array.from(this.selectedIndices)[0];
        const selectedFile = this.files[selectedIndex];

        if (!selectedFile.handle) {
            alert('File handle not available. Please re-import the file.');
            return;
        }

        try {
            const file = selectedFile.file;
            const arrayBuffer = await file.arrayBuffer();
            const corruptedBuffer = await this.corruptIXMLBuffer(arrayBuffer, corruptionType);

            // Write the corrupted file
            const writable = await selectedFile.handle.createWritable();
            await writable.write(corruptedBuffer);
            await writable.close();

            alert(`File corrupted with ${corruptionType}. Please re-import to test repair.`);

        } catch (err) {
            console.error('Corruption failed:', err);
            alert(`Corruption failed: ${err.message}`);
        }
    }

    async corruptIXMLBuffer(originalBuffer, corruptionType) {
        const view = new DataView(originalBuffer);
        let offset = 12; // Skip RIFF header
        let ixmlOffset = -1;
        let ixmlSize = 0;

        // Find iXML chunk
        while (offset < view.byteLength - 8) {
            const chunkId = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3)
            );
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId === 'iXML') {
                ixmlOffset = offset + 8;
                ixmlSize = chunkSize;
                break;
            }

            offset += 8 + chunkSize;
            if (chunkSize % 2 !== 0) offset++; // Pad byte
        }

        if (ixmlOffset === -1) {
            throw new Error('No iXML chunk found in file');
        }

        // Get current iXML content
        const ixmlBytes = new Uint8Array(originalBuffer, ixmlOffset, ixmlSize);
        let ixmlString = new TextDecoder('utf-8').decode(ixmlBytes).replace(/\0+$/, '');

        console.log('Original iXML:', ixmlString);

        // Apply corruption based on type
        let corruptedIXML;
        switch (corruptionType) {
            case 'missing-closing-tag':
                corruptedIXML = ixmlString.replace('</BWFXML>', '');
                break;
            case 'missing-xml-declaration':
                corruptedIXML = ixmlString.replace('<?xml version="1.0" encoding="UTF-8"?>\n', '');
                break;
            case 'missing-speed-tag':
                corruptedIXML = ixmlString.replace(/<SPEED[^>]*>[\s\S]*?<\/SPEED>\s*/g, '');
                break;
            case 'invalid-root':
                corruptedIXML = ixmlString.replace('<BWFXML>', '<INVALID>');
                break;
            case 'empty':
                corruptedIXML = '';
                break;
            case 'malformed-xml':
                corruptedIXML = ixmlString.replace('>', '> <unclosed');
                break;
            default:
                throw new Error(`Unknown corruption type: ${corruptionType}`);
        }

        console.log('Corrupted iXML:', corruptedIXML);

        // Create corrupted buffer
        const corruptedBytes = new TextEncoder().encode(corruptedIXML);
        const newBuffer = new Uint8Array(originalBuffer.byteLength - ixmlSize + corruptedBytes.length);
        const newView = new DataView(newBuffer.buffer);

        // Copy everything before iXML
        newBuffer.set(new Uint8Array(originalBuffer, 0, ixmlOffset), 0);

        // Copy corrupted iXML
        newBuffer.set(corruptedBytes, ixmlOffset);

        // Copy everything after iXML
        const afterIXML = originalBuffer.byteLength - (ixmlOffset + ixmlSize);
        if (afterIXML > 0) {
            newBuffer.set(new Uint8Array(originalBuffer, ixmlOffset + ixmlSize, afterIXML), ixmlOffset + corruptedBytes.length);
        }

        // Update iXML chunk size in header
        const chunkHeaderOffset = ixmlOffset - 8;
        newView.setUint32(chunkHeaderOffset + 4, corruptedBytes.length, true);

        // Update RIFF size if needed
        const sizeDiff = corruptedBytes.length - ixmlSize;
        if (sizeDiff !== 0) {
            const currentRiffSize = newView.getUint32(4, true);
            newView.setUint32(4, currentRiffSize + sizeDiff, true);
        }

        return newBuffer.buffer;
    }

    async loadAudioForFile(index) {
        const item = this.files[index];
        const targetFiles = item.isGroup ? item.siblings : [item];
        const isGroup = item.isGroup;
        const totalSize = targetFiles.reduce((acc, f) => acc + f.file.size, 0);
        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);

        // Mark as loading and disable play button
        this.isLoadingAudio = true;
        const playBtn = document.getElementById('play-btn');
        playBtn.disabled = true;

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
                // Apply track name change to all selected files in the batch
                // This allows editing one file and having the change propagate to all selected files
                let updatedCount = 0;
                
                for (const selectedIndex of this.selectedIndices) {
                    const selectedItem = this.files[selectedIndex];
                    if (!selectedItem) continue;
                    
                    // Handle both regular files and sibling groups
                    const targets = selectedItem.isGroup ? selectedItem.siblings : [selectedItem];
                    
                    for (const target of targets) {
                        // Only update files with the same channel count to avoid mismatches
                        if (target.metadata.channels === trackCount) {
                            if (!target.metadata.trackNames) target.metadata.trackNames = [];
                            target.metadata.trackNames[trackIndex] = newName;
                            updatedCount++;
                        }
                    }
                }
                
                console.log(`Track ${trackIndex} renamed to "${newName}" for ${updatedCount} file(s)`);

                // Enable save button
                document.getElementById('batch-save-btn').disabled = false;
                
                // Trigger auto-save if enabled
                if (this.autoSaveEnabled) {
                    this.scheduleAutoSave();
                }
            };

            this.mixer.onStateChange = () => {
                // Mixer solo state changed, refresh waveform to show only soloed channels
                this.audioEngine.renderWaveform(canvas, buffer, this.mixer.channels, this.cueMarkers, this.selectedCueMarkerId);
            };

            // Collect track names for mixer
            let trackNames;
            if (isGroup) {
                // For sibling groups, collect track names from each sibling
                trackNames = item.siblings.map((sib, idx) => {
                    if (sib.metadata.trackNames && sib.metadata.trackNames.length > 0) {
                        return sib.metadata.trackNames[0];
                    }
                    return `Ch${idx + 1}`;
                });
            } else {
                // For single files, use existing track names
                trackNames = item.metadata.trackNames;
            }

            // Preserve current fader height before rebuild
            const mixerContainer = document.getElementById('mixer-container');
            let currentHeight = 100; // Default
            if (mixerContainer) {
                const existingFaderContainer = mixerContainer.querySelector('.fader-container');
                if (existingFaderContainer) {
                    currentHeight = parseInt(getComputedStyle(existingFaderContainer).height) || 100;
                }
            }

            // Build mixer UI for this file (reuses existing mixer container)
            this.mixer.buildUI(trackCount, trackNames);

            // Restore fader heights after mixer rebuild
            this.resetFaderHeights(currentHeight);

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

            // Show playback controls (hidden for >2GB files)
            const playBtn = document.getElementById('play-btn');
            const stopBtn = document.getElementById('stop-btn');
            const loopBtn = document.getElementById('loop-btn');
            const timeDisplays = document.querySelectorAll('.time-display');
            
            if (playBtn) playBtn.style.display = 'flex';
            if (stopBtn) stopBtn.style.display = 'flex';
            if (loopBtn) loopBtn.style.display = 'flex';
            timeDisplays.forEach(el => el.style.display = 'flex');

            // Update Time Display
            document.getElementById('total-time').textContent = item.metadata.duration || '00:00:00';

            // Store metadata for timecode calculation
            this.currentFileMetadata = item.metadata;

            // Update Player Header
            const playerFilename = document.getElementById('player-filename');
            if (playerFilename) {
                playerFilename.textContent = item.metadata.filename;
            }

            // Mark loading complete and re-enable play button
            this.isLoadingAudio = false;
            playBtn.disabled = false;
            
            // Reset play button to show play icon (in case previous file was playing)
            playBtn.textContent = '▶';

        } catch (err) {
            console.error('Error loading audio:', err);

            // Mark loading complete and re-enable play button even if loading fails
            this.isLoadingAudio = false;
            playBtn.disabled = false;

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

    /**
     * Extract audio range from a source file and create WAV/MP3 with metadata
     * @param {Object} sourceFile - File object with { file, metadata }
     * @param {string} startTC - Start timecode in HH:MM:SS:FF format
     * @param {string} endTC - End timecode in HH:MM:SS:FF format
     * @param {Object} outputMetadata - Metadata for the output file (scene, take, etc.)
     * @param {string} outputFilename - Name for the output file
     * @param {Object} directoryHandle - Directory to save to
     * @param {string} format - 'wav' or 'mp3'
     * @param {number} bitDepth - Bit depth for WAV (16 or 24)
     * @returns {Object} { success: boolean, handle: FileHandle, error: string }
     */
    async extractAudioRange(sourceFile, startTC, endTC, outputMetadata, outputFilename, directoryHandle, format = 'wav', bitDepth = 24) {
        try {
            // Get FPS first to convert frames to seconds accurately
            let fpsExact = sourceFile.metadata.fpsExact;
            if (!fpsExact && sourceFile.metadata.fps) {
                // Convert fps string to fpsExact fraction
                if (sourceFile.metadata.fps === '23.98') {
                    fpsExact = { numerator: 24000, denominator: 1001 };
                } else if (sourceFile.metadata.fps === '29.97') {
                    fpsExact = { numerator: 30000, denominator: 1001 };
                } else {
                    const fpsNum = parseFloat(sourceFile.metadata.fps);
                    fpsExact = { numerator: fpsNum, denominator: 1 };
                }
            } else {
                fpsExact = fpsExact || { numerator: 24, denominator: 1 };
            }
            
            // Parse timecodes including frames using tcToSeconds which accounts for FPS
            const fileStartSeconds = this.tcToSeconds(sourceFile.metadata.tcStart || '00:00:00:00', fpsExact);
            const fileDurationSeconds = this.tcToSeconds(sourceFile.metadata.duration, fpsExact);
            const fileEndSeconds = fileStartSeconds + fileDurationSeconds;

            // Parse target range
            const rangeStartSeconds = this.tcToSeconds(startTC, fpsExact);
            const rangeEndSeconds = this.tcToSeconds(endTC, fpsExact);

            // Calculate overlap
            const actualStartSeconds = Math.max(rangeStartSeconds, fileStartSeconds);
            const actualEndSeconds = Math.min(rangeEndSeconds, fileEndSeconds);

            if (actualStartSeconds >= actualEndSeconds) {
                return { 
                    success: false, 
                    error: `Timecode range does not overlap with file ${sourceFile.metadata.filename}` 
                };
            }

            const sampleRate = sourceFile.metadata.sampleRate;
            const startSampleOffset = Math.round((actualStartSeconds - fileStartSeconds) * sampleRate);
            const endSampleOffset = Math.round((actualEndSeconds - fileStartSeconds) * sampleRate);
            const sampleCount = endSampleOffset - startSampleOffset;

            // Load file audio
            const arrayBuffer = await sourceFile.file.arrayBuffer();
            const audioBuffer = await this.audioEngine.audioCtx.decodeAudioData(arrayBuffer.slice(0));

            // Extract range using OfflineAudioContext
            const channels = audioBuffer.numberOfChannels;
            const OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            const offlineCtx = new OfflineAudioContext(channels, sampleCount, sampleRate);

            // Create a buffer source with the full decoded audio
            const bufferSource = offlineCtx.createBufferSource();
            bufferSource.buffer = audioBuffer;
            
            // Connect to destination and start from the offset
            bufferSource.connect(offlineCtx.destination);
            bufferSource.start(0, startSampleOffset / sampleRate, sampleCount / sampleRate);

            // Render the extracted portion
            const extractedBuffer = await offlineCtx.startRendering();

            // Calculate the actual start TC of the extracted audio (not the requested start)
            // Work with samples for frame-accurate timecode (important for 23.98 FPS)
            const fileStartSamples = this.metadataHandler.tcToSamples(sourceFile.metadata.tcStart || '00:00:00:00', sampleRate, fpsExact);
            const rangeStartSamples = this.metadataHandler.tcToSamples(startTC, sampleRate, fpsExact);
            const actualStartSamples = Math.max(rangeStartSamples, fileStartSamples);
            const actualStartTC = this.metadataHandler.samplesToTC(actualStartSamples, sampleRate, fpsExact);

            // Also calculate actual end for duration
            const rangeEndSamples = this.metadataHandler.tcToSamples(endTC, sampleRate, fpsExact);
            const fileEndSamples = fileStartSamples + Math.round(fileDurationSeconds * sampleRate);
            const actualEndSamples = Math.min(rangeEndSamples, fileEndSamples);

            // Prepare export metadata
            const exportMetadata = {
                ...sourceFile.metadata,
                ...outputMetadata,
                tcStart: actualStartTC,
                duration: this.secondsToDuration((actualEndSamples - actualStartSamples) / sampleRate),
                fpsExact: fpsExact,
                bitDepth: bitDepth,
                sampleRate: sampleRate,
                // Don't copy ixmlRaw and bextRaw so we create fresh chunks with correct metadata
                ixmlRaw: undefined,
                bextRaw: undefined
            };

            // If source has bEXT but no iXML, extract track names from bEXT description
            if (!sourceFile.metadata.ixmlRaw && sourceFile.metadata.description) {
                const bextTrackNames = this.metadataHandler.extractTrackNamesFromBext(sourceFile.metadata.description);
                if (bextTrackNames.length > 0) {
                    const trackNames = [];
                    for (let i = 0; i < sourceFile.metadata.channels; i++) {
                        trackNames[i] = bextTrackNames[i] || `Track ${i + 1}`;
                    }
                    exportMetadata.trackNames = trackNames;
                    console.log('[extractAudioRange] Using track names from bEXT:', trackNames);
                }
            }

            // Calculate timeReference from the actual TC Start
            exportMetadata.timeReference = actualStartSamples;

            // Create audio file
            let blob;
            if (format === 'wav') {
                const wavBuffer = this.audioProcessor.createWavFile(extractedBuffer, bitDepth, null, exportMetadata);
                
                // Create bEXT and iXML chunks with timecode information
                const bextChunk = this.metadataHandler.createBextChunk(exportMetadata);
                const ixmlChunk = this.metadataHandler.createIXMLChunk(exportMetadata);
                
                // Calculate padding and sizes
                const bextPadding = bextChunk.byteLength % 2 !== 0 ? 1 : 0;
                const ixmlPadding = ixmlChunk.byteLength % 2 !== 0 ? 1 : 0;
                const bextTotalSize = 8 + bextChunk.byteLength + bextPadding;
                const ixmlTotalSize = 8 + ixmlChunk.byteLength + ixmlPadding;
                
                // Calculate new file size
                const wavView = new DataView(wavBuffer);
                const wavArray = new Uint8Array(wavBuffer);
                const riffSize = wavView.getUint32(4, true);
                const oldFileSize = riffSize + 8;
                const newFileSize = oldFileSize + bextTotalSize + ixmlTotalSize;
                
                // Create new buffer with both chunks
                const newWavBuffer = new Uint8Array(newFileSize);
                newWavBuffer.set(wavArray);
                
                const chunkView = new DataView(newWavBuffer.buffer);
                
                // Write bEXT chunk
                let chunkOffset = oldFileSize;
                newWavBuffer[chunkOffset] = 0x62;     // 'b'
                newWavBuffer[chunkOffset + 1] = 0x65; // 'e'
                newWavBuffer[chunkOffset + 2] = 0x78; // 'x'
                newWavBuffer[chunkOffset + 3] = 0x74; // 't'
                chunkView.setUint32(chunkOffset + 4, bextChunk.byteLength, true);
                newWavBuffer.set(new Uint8Array(bextChunk), chunkOffset + 8);
                
                // Write iXML chunk
                chunkOffset = oldFileSize + bextTotalSize;
                newWavBuffer[chunkOffset] = 0x69;     // 'i'
                newWavBuffer[chunkOffset + 1] = 0x58; // 'X'
                newWavBuffer[chunkOffset + 2] = 0x4D; // 'M'
                newWavBuffer[chunkOffset + 3] = 0x4C; // 'L'
                chunkView.setUint32(chunkOffset + 4, ixmlChunk.byteLength, true);
                newWavBuffer.set(new Uint8Array(ixmlChunk), chunkOffset + 8);
                
                // Update RIFF size
                const newRiffSize = newFileSize - 8;
                chunkView.setUint32(4, newRiffSize, true);
                
                blob = new Blob([newWavBuffer.buffer], { type: 'audio/wav' });
            } else {
                const mp3Bitrate = parseInt(document.getElementById('export-tc-mp3-bitrate')?.value || 320);
                blob = await this.audioProcessor.encodeToMP3(extractedBuffer, mp3Bitrate, exportMetadata);
            }

            // Get file handle in the directory
            const handle = await directoryHandle.getFileHandle(outputFilename, { create: true });

            // Save file
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();

            return { success: true, handle: handle };

        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async handleExportTCRange() {
        const startTimeStr = document.getElementById('export-tc-start').value.trim();
        const endTimeStr = document.getElementById('export-tc-end').value.trim();
        const format = document.getElementById('export-tc-format').value;

        // Validate time format
        if (!this.validateTimeFormat(startTimeStr) || !this.validateTimeFormat(endTimeStr)) {
            alert('Invalid time format. Please use HH:MM:SS (e.g., 01:23:45)');
            return;
        }

        const startSeconds = this.parseTimecodeToSeconds(startTimeStr);
        const endSeconds = this.parseTimecodeToSeconds(endTimeStr);

        if (startSeconds >= endSeconds) {
            alert('Start time must be before end time.');
            return;
        }

        const selectedIndices = this.exportTCRangeIndices || Array.from(this.selectedIndices);
        const selectedFiles = selectedIndices.map(idx => this.files[idx]);

        this.closeExportTCRangeModal();
        document.body.style.cursor = 'wait';

        let successCount = 0;
        let failCount = 0;
        const exportedFiles = [];

        try {
            // Show directory picker once to establish destination for batch export
            const directoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });

            // Get bit depth for WAV format
            const bitDepth = format === 'wav' ? parseInt(document.getElementById('export-tc-bitdepth').value) : 16;

            for (const selectedFile of selectedFiles) {
                try {
                    // Create filename with _region appended
                    const nameWithoutExt = selectedFile.metadata.filename.replace(/\.[^/.]+$/, '');
                    const fileName = `${nameWithoutExt}_region.${format}`;

                    // Use the refactored extraction method
                    const startTC = startTimeStr + ':00'; // Add frame count
                    const endTC = endTimeStr + ':00';
                    
                    const result = await this.extractAudioRange(
                        selectedFile,
                        startTC,
                        endTC,
                        {}, // No metadata overrides for export TC range
                        fileName,
                        directoryHandle,
                        format,
                        bitDepth
                    );

                    if (result.success) {
                        // Auto-add to file list
                        const newFile = await result.handle.getFile();
                        const metadata = await this.metadataHandler.parseFile(newFile);
                        this.files.push({
                            handle: result.handle,
                            metadata: metadata,
                            file: newFile,
                            isGroup: false
                        });

                        exportedFiles.push(result.handle.name);
                        successCount++;
                    } else {
                        console.warn(result.error);
                        failCount++;
                    }

                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.error(`Export TC Range failed for ${selectedFile.metadata.filename}:`, err);
                        failCount++;
                    }
                }
            }

            // Refresh UI
            const tbody = document.getElementById('file-list-body');
            tbody.innerHTML = '';
            this.files.forEach((file, i) => this.addTableRow(i, file.metadata));
            this.updateSelectionUI();

            // Show summary
            if (successCount > 0 && failCount > 0) {
                alert(`Exported ${successCount} file(s) successfully.\n${failCount} file(s) failed.`);
            } else if (successCount > 0) {
                alert(`Successfully exported ${successCount} ${format.toUpperCase()} file(s).`);
            } else {
                alert('No files were exported.');
            }

        } catch (err) {
            console.error('Export TC Range failed:', err);
            alert(`Export failed: ${err.message}`);
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    async handleRepairIXML() {
        // Get the selected files
        if (this.selectedIndices.size === 0) {
            alert('Please select at least one file to repair.');
            return;
        }

        const selectedIndices = Array.from(this.selectedIndices);
        let successCount = 0;
        let failCount = 0;
        const failedFiles = [];

        try {
            document.body.style.cursor = 'wait';
            console.log(`[handleRepairIXML] Repairing ${selectedIndices.length} file(s)...`);
            
            // Process each selected file sequentially
            for (const selectedIndex of selectedIndices) {
                const selectedFile = this.files[selectedIndex];
                const metadata = selectedFile.metadata;

                try {
                    console.log(`[handleRepairIXML] Processing ${metadata.filename} (${successCount + failCount + 1}/${selectedIndices.length})`);
                    
                    // Check if file needs repair or is missing iXML entirely
                    const isMissingIXML = !metadata.ixmlRaw;
                    const needsIXMLRepair = metadata.needsIXMLRepair && metadata.ixmlRepairData;

                    if (!isMissingIXML && !needsIXMLRepair) {
                        console.log(`[handleRepairIXML] ${metadata.filename} does not need repair, skipping`);
                        continue;
                    }

                    // Get the file handle for writing
                    if (!selectedFile.handle) {
                        throw new Error('File handle not available. Please re-import the file.');
                    }

                    // Read the original file to get the full buffer
                    const file = selectedFile.file;
                    const originalBuffer = await file.arrayBuffer();

                    let repairData;
                    if (isMissingIXML) {
                        // Create a complete new iXML chunk from metadata
                        console.log('[handleRepairIXML] No iXML found, creating complete new iXML chunk');
                        
                        // Extract track names from bEXT description field (if present)
                        const bextTrackNames = this.metadataHandler.extractTrackNamesFromBext(metadata.description);
                        console.log('[handleRepairIXML] Track names from bEXT:', bextTrackNames);
                        
                        // If we found track names in bEXT, add them to metadata for iXML creation
                        if (bextTrackNames.length > 0) {
                            // Create trackNames array for iXML, filling in from bEXT
                            const trackNames = [];
                            for (let i = 0; i < metadata.channels; i++) {
                                trackNames[i] = bextTrackNames[i] || `Track ${i + 1}`;
                            }
                            metadata.trackNames = trackNames;
                            console.log('[handleRepairIXML] Using track names from bEXT:', trackNames);
                        }
                        
                        console.log('[handleRepairIXML] Metadata for iXML creation:', {
                            fpsExact: metadata.fpsExact,
                            fps: metadata.fps,
                            sampleRate: metadata.sampleRate,
                            bitDepth: metadata.bitDepth,
                            timeReference: metadata.timeReference,
                            project: metadata.project,
                            scene: metadata.scene,
                            take: metadata.take,
                            trackNames: metadata.trackNames
                        });
                        repairData = this.metadataHandler.createIXMLChunk(metadata);
                        console.log('[handleRepairIXML] Created new iXML:', new TextDecoder().decode(repairData).substring(0, 300));
                    } else {
                        // Repair the incomplete/corrupted iXML
                        console.log('[handleRepairIXML] Original iXML:', metadata.ixmlRaw?.substring(0, 200));
                        console.log('[handleRepairIXML] Repair data:', metadata.ixmlRepairData?.substring(0, 200));
                        repairData = metadata.ixmlRepairData;
                    }

                    // Repair the iXML in the file
                    await this.metadataHandler.repairIXMLInFile(
                        selectedFile.handle,
                        originalBuffer,
                        repairData
                    );

                    console.log('[handleRepairIXML] File write completed, re-reading to verify...');

                    // Re-read the file from disk to verify repair worked
                    const repairedFile = await selectedFile.handle.getFile();
                    const repairedBuffer = await repairedFile.arrayBuffer();
                    const repairedIXML = this.metadataHandler.getIXMLChunk(repairedBuffer);
                    
                    console.log('[handleRepairIXML] Re-read iXML:', repairedIXML?.substring(0, 200));
                    
                    // Validate that the repair worked
                    if (repairedIXML) {
                        const revalidation = this.metadataHandler.validateAndFixIXML(repairedIXML);
                        if (revalidation.needsRepair) {
                            throw new Error('File was written but may not have been properly repaired.');
                        }
                    }

                    // Update the file object in the files array with the freshly read file
                    // This is critical on macOS where file handles can become stale after write operations
                    selectedFile.file = repairedFile;

                    // Update metadata to mark as repaired
                    metadata.needsIXMLRepair = false;
                    metadata.ixmlRaw = repairedIXML;

                    const actionMsg = isMissingIXML ? 'added' : 'repaired';
                    console.log(`[handleRepairIXML] Successfully ${actionMsg} iXML for ${metadata.filename}`);
                    successCount++;

                } catch (err) {
                    console.error(`[handleRepairIXML] Failed to repair ${metadata.filename}:`, err);
                    failedFiles.push(`${metadata.filename}: ${err.message}`);
                    failCount++;
                }
            }

            // Refresh the table to remove red highlighting
            const tbody = document.getElementById('file-list-body');
            tbody.innerHTML = '';
            this.files.forEach((file, i) => this.addTableRow(i, file.metadata));
            this.updateSelectionUI();

            // Show summary
            let message = `✅ Successfully repaired ${successCount} file(s)`;
            if (failCount > 0) {
                message += `\n\n⚠️ Failed to repair ${failCount} file(s):\n${failedFiles.join('\n')}`;
            }
            alert(message);

        } catch (err) {
            console.error('iXML repair batch failed:', err);
            alert(`Repair batch failed: ${err.message}`);
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    secondsToDuration(seconds) {
        // Convert seconds to HH:MM:SS:FF format (assumes 24fps for frames)
        const totalSeconds = Math.floor(seconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        const frames = Math.round((seconds - totalSeconds) * 24);

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
    }

    /**
     * Parse Sound Devices 8-Series CSV file
     * @param {string} csvText - Raw CSV file content
     * @returns {Object} { valid: boolean, error: string, entries: Array }
     */
    parseCSVFile(csvText) {
        try {
            const lines = csvText.split(/\r?\n/).filter(line => line.trim());
            
            if (lines.length < 2) {
                return { valid: false, error: 'CSV file is empty or too short' };
            }

            // Validate first field contains "SOUND REPORT"
            const firstLine = lines[0];
            if (!firstLine.includes('SOUND REPORT')) {
                return { 
                    valid: false, 
                    error: 'CSV file is not valid. Please select a Sound Devices 8-Series CSV Sound Report file.' 
                };
            }

            // Find header row - search for the line containing "File Name"
            let headerLineIndex = -1;
            let headers = [];
            for (let i = 0; i < lines.length; i++) {
                const fields = this.parseCSVLine(lines[i]);
                if (fields.some(f => f.toLowerCase().includes('file name'))) {
                    headerLineIndex = i;
                    headers = fields;
                    break;
                }
            }

            if (headerLineIndex === -1) {
                return { 
                    valid: false, 
                    error: 'CSV file is not valid. Could not find column headers.' 
                };
            }

            // Find column indices (order may vary)
            const fileNameIdx = headers.findIndex(h => h.toLowerCase().includes('file name'));
            const sceneIdx = headers.findIndex(h => h.toLowerCase() === 'scene');
            const takeIdx = headers.findIndex(h => h.toLowerCase() === 'take');
            const lengthIdx = headers.findIndex(h => h.toLowerCase() === 'length');
            const startTCIdx = headers.findIndex(h => h.toLowerCase().includes('start tc'));

            // Validate required columns exist
            if (fileNameIdx === -1 || sceneIdx === -1 || takeIdx === -1 || 
                lengthIdx === -1 || startTCIdx === -1) {
                return { 
                    valid: false, 
                    error: 'CSV file is not valid. Missing required columns: File Name, Scene, Take, Length, Start TC.' 
                };
            }

            // Parse data rows (start from the row after header)
            const entries = [];
            for (let i = headerLineIndex + 1; i < lines.length; i++) {
                const fields = this.parseCSVLine(lines[i]);
                
                // Skip empty rows
                if (fields.length === 0 || !fields[fileNameIdx]) continue;

                const fileName = fields[fileNameIdx]?.trim();
                const scene = fields[sceneIdx]?.trim();
                const take = fields[takeIdx]?.trim();
                const length = fields[lengthIdx]?.trim();
                const startTC = fields[startTCIdx]?.trim();

                if (fileName && startTC && length) {
                    entries.push({
                        fileName,
                        scene: scene || '',
                        take: take || '',
                        length,
                        startTC
                    });
                }
            }

            if (entries.length === 0) {
                return { valid: false, error: 'No valid data rows found in CSV file' };
            }

            return { valid: true, entries };

        } catch (err) {
            return { valid: false, error: `Failed to parse CSV: ${err.message}` };
        }
    }

    /**
     * Parse a single CSV line handling quoted fields
     */
    parseCSVLine(line) {
        const fields = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    // Escaped quote
                    current += '"';
                    i++; // Skip next quote
                } else {
                    // Toggle quote mode
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                // Field delimiter
                fields.push(current);
                current = '';
            } else {
                current += char;
            }
        }

        // Add last field
        fields.push(current);

        return fields;
    }

    /**
     * Calculate end TC from start TC and length
     * @param {string} startTC - Start timecode HH:MM:SS:FF
     * @param {string} length - Length HH:MM:SS or HH:MM:SS:FF
     * @param {Object} fpsExact - FPS fraction {numerator, denominator}
     * @returns {string} End timecode HH:MM:SS:FF
     */
    calculateEndTCFromLength(startTC, length, fpsExact) {
        // Ensure length has frames field (pad with :00 if missing)
        let lengthWithFrames = length;
        if (length.split(':').length === 3) {
            lengthWithFrames = length + ':00';
        }
        
        const startSamples = this.metadataHandler.tcToSamples(startTC, 48000, fpsExact);
        const lengthSamples = this.metadataHandler.tcToSamples(lengthWithFrames, 48000, fpsExact);
        const endSamples = startSamples + lengthSamples;
        return this.metadataHandler.samplesToTC(endSamples, 48000, fpsExact);
    }

    /**
     * Find takes that fully contain the CSV time range
     * @param {string} csvStartTC - CSV entry start timecode
     * @param {string} csvEndTC - CSV entry end timecode
     * @param {Set} fileIndicesToSearch - Optional set of file indices to search (defaults to all files)
     * @returns {Array} Array of matching take indices
     */
    findMatchingTakes(csvStartTC, csvEndTC, fileIndicesToSearch = null) {
        const matches = [];

        // Use provided indices or search all files
        const indicesToCheck = fileIndicesToSearch ? Array.from(fileIndicesToSearch) : Array.from({length: this.files.length}, (_, i) => i);

        for (const i of indicesToCheck) {
            const file = this.files[i];
            const metadata = file.metadata;

            // Skip if no timecode info
            if (!metadata.tcStart || !metadata.durationSec) continue;

            // Calculate file's end TC
            const fileEndTC = this.calculateEndTC(metadata);

            // Get FPS for comparison
            let fpsExact = metadata.fpsExact || { numerator: 24, denominator: 1 };
            if (!metadata.fpsExact && metadata.fps) {
                if (metadata.fps === '23.98') {
                    fpsExact = { numerator: 24000, denominator: 1001 };
                } else if (metadata.fps === '29.97') {
                    fpsExact = { numerator: 30000, denominator: 1001 };
                } else {
                    const fpsNum = parseFloat(metadata.fps);
                    fpsExact = { numerator: fpsNum, denominator: 1 };
                }
            }

            // Convert to seconds for comparison
            const fileStartSec = this.tcToSeconds(metadata.tcStart, fpsExact);
            const fileEndSec = this.tcToSeconds(fileEndTC, fpsExact);
            const csvStartSec = this.tcToSeconds(csvStartTC, fpsExact);
            const csvEndSec = this.tcToSeconds(csvEndTC, fpsExact);

            // Check if file fully contains CSV range
            if (fileStartSec <= csvStartSec && fileEndSec >= csvEndSec) {
                matches.push(i);
            }
        }

        return matches;
    }

    /**
     * Generate disambiguated filename by inserting letter before take number
     * @param {string} csvFileName - Original CSV filename (e.g., "123AT01")
     * @param {number} matchIndex - Index of match (0, 1, 2, ...)
     * @returns {string} Disambiguated filename (e.g., "123ATa01.wav")
     */
    generateDisambiguatedFilename(csvFileName, matchIndex) {
        // Insert lowercase letter before the last digit sequence
        const letter = String.fromCharCode(97 + matchIndex); // a, b, c, ...
        
        // Find last digit sequence
        const match = csvFileName.match(/^(.*?)(\d+)$/);
        if (match) {
            return `${match[1]}${letter}${match[2]}.wav`;
        }
        
        // Fallback: append letter at end
        return `${csvFileName}${letter}.wav`;
    }

    async handleConformToCSV() {
        const csvEntries = this.conformCSVEntries;
        if (!csvEntries || csvEntries.length === 0) {
            alert('No CSV entries to process.');
            return;
        }

        this.closeConformCSVModal();
        document.body.style.cursor = 'wait';

        try {
            // Prompt for output directory
            const directoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });

            // Get selected bit depth and pre/post roll
            const bitDepth = parseInt(document.getElementById('conform-bitdepth').value);
            const prePostRoll = parseInt(document.getElementById('conform-prepost-roll').value);

            let totalRows = csvEntries.length;
            let filesCreated = 0;
            let rowsSkipped = 0;
            const createdFiles = [];

            // Show progress
            const progressModal = document.getElementById('conform-progress-modal');
            const progressBar = document.getElementById('conform-progress-bar');
            const progressText = document.getElementById('conform-progress-text');
            const progressStatus = document.getElementById('conform-progress-status');
            
            if (progressModal) {
                progressModal.classList.add('active');
            }

            for (let i = 0; i < csvEntries.length; i++) {
                const entry = csvEntries[i];
                
                // Update progress
                if (progressStatus) {
                    progressStatus.textContent = `Processing ${i + 1} of ${totalRows}: ${entry.fileName}`;
                }
                if (progressBar) {
                    const percent = Math.round(((i + 1) / totalRows) * 100);
                    progressBar.style.width = `${percent}%`;
                }
                if (progressText) {
                    progressText.textContent = `${Math.round(((i + 1) / totalRows) * 100)}%`;
                }

                // Infer FPS from first matched take
                let fpsExact = { numerator: 24, denominator: 1 };
                
                // Calculate end TC
                const csvEndTC = this.calculateEndTCFromLength(entry.startTC, entry.length, fpsExact);

                // Find matching takes (only in selected files)
                const matchIndices = this.findMatchingTakes(entry.startTC, csvEndTC, this.selectedIndices);

                if (matchIndices.length === 0) {
                    console.log(`Skipping CSV entry "${entry.fileName}": no matching takes found in selected files`);
                    rowsSkipped++;
                    continue;
                }

                // Use FPS from first matched take
                const firstMatch = this.files[matchIndices[0]];
                if (firstMatch.metadata.fpsExact) {
                    fpsExact = firstMatch.metadata.fpsExact;
                } else if (firstMatch.metadata.fps) {
                    if (firstMatch.metadata.fps === '23.98') {
                        fpsExact = { numerator: 24000, denominator: 1001 };
                    } else if (firstMatch.metadata.fps === '29.97') {
                        fpsExact = { numerator: 30000, denominator: 1001 };
                    } else {
                        const fpsNum = parseFloat(firstMatch.metadata.fps);
                        fpsExact = { numerator: fpsNum, denominator: 1 };
                    }
                }

                // Recalculate end TC with correct FPS
                const csvEndTCCorrect = this.calculateEndTCFromLength(entry.startTC, entry.length, fpsExact);

                // Apply pre/post roll to timecodes
                const sampleRate = 48000; // Use standard sample rate for TC calculations
                const csvStartSamples = this.metadataHandler.tcToSamples(entry.startTC, sampleRate, fpsExact);
                const csvEndSamples = this.metadataHandler.tcToSamples(csvEndTCCorrect, sampleRate, fpsExact);
                
                // Subtract pre-roll from start, add post-roll to end
                const prePostRollSamples = Math.round(prePostRoll * sampleRate);
                const adjustedStartSamples = Math.max(0, csvStartSamples - prePostRollSamples);
                const adjustedEndSamples = csvEndSamples + prePostRollSamples;
                
                const adjustedStartTC = this.metadataHandler.samplesToTC(adjustedStartSamples, sampleRate, fpsExact);
                const adjustedEndTC = this.metadataHandler.samplesToTC(adjustedEndSamples, sampleRate, fpsExact);

                // Process each matching take
                for (let matchIdx = 0; matchIdx < matchIndices.length; matchIdx++) {
                    const takeIndex = matchIndices[matchIdx];
                    const sourceTake = this.files[takeIndex];

                    // Generate output filename
                    const outputFilename = this.generateDisambiguatedFilename(entry.fileName, matchIdx);

                    // Check if file exists
                    let shouldCreate = true;
                    try {
                        await directoryHandle.getFileHandle(outputFilename, { create: false });
                        // File exists, prompt user
                        shouldCreate = confirm(`File "${outputFilename}" already exists. Overwrite?`);
                        if (!shouldCreate) continue;
                    } catch (err) {
                        // File doesn't exist, proceed
                    }

                    // Prepare metadata
                    const outputMetadata = {
                        scene: entry.scene,
                        take: entry.take,
                        filename: outputFilename
                    };

                    // Extract and create file (using adjusted TCs with pre/post roll)
                    const result = await this.extractAudioRange(
                        sourceTake,
                        adjustedStartTC,
                        adjustedEndTC,
                        outputMetadata,
                        outputFilename,
                        directoryHandle,
                        'wav',
                        bitDepth // Use selected bit depth for conformed files
                    );

                    if (result.success) {
                        filesCreated++;
                        createdFiles.push(outputFilename);

                        // Auto-add to file list
                        const newFile = await result.handle.getFile();
                        const metadata = await this.metadataHandler.parseFile(newFile);
                        this.files.push({
                            handle: result.handle,
                            metadata: metadata,
                            file: newFile,
                            isGroup: false
                        });
                    } else {
                        console.error(`Failed to create ${outputFilename}: ${result.error}`);
                    }
                }
            }

            // Close progress modal
            if (progressModal) {
                progressModal.classList.remove('active');
            }

            // Refresh UI
            const tbody = document.getElementById('file-list-body');
            tbody.innerHTML = '';
            this.files.forEach((file, i) => this.addTableRow(i, file.metadata));
            this.updateSelectionUI();

            // Show summary
            const summary = `Conform Complete\n\n` +
                `CSV rows processed: ${totalRows}\n` +
                `Files created: ${filesCreated}\n` +
                `Rows skipped (no match): ${rowsSkipped}`;
            
            alert(summary);

        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Conform to CSV failed:', err);
                alert(`Conform failed: ${err.message}`);
            }
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    openConformCSVModal() {
        const modal = document.getElementById('conform-csv-modal');
        if (modal) {
            modal.classList.add('active');
            // Reset state
            this.conformCSVEntries = null;
            document.getElementById('csv-filename-display').textContent = 'No file selected';
            document.getElementById('csv-preview-table').style.display = 'none';
            document.getElementById('conform-csv-button').disabled = true;
        }
    }

    closeConformCSVModal() {
        const modal = document.getElementById('conform-csv-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    // ========== Multi-Process Helper Methods ==========

    async getUniqueFileName(directoryHandle, baseFileName) {
        /**
         * Check if file exists, and if so, append a number suffix (_1, _2, etc.)
         * until a unique filename is found
         */
        try {
            // First try the base filename
            await directoryHandle.getFileHandle(baseFileName, { create: false });
            // If we get here, file exists, so we need to find a unique name
        } catch (err) {
            if (err.name === 'NotFoundError') {
                // File doesn't exist, base name is fine
                return baseFileName;
            }
            // Other error, log it but proceed with base name
            console.warn('Error checking file existence:', err);
            return baseFileName;
        }

        // File exists, append number suffix
        const nameParts = baseFileName.split('.');
        const extension = nameParts.pop();
        const nameWithoutExt = nameParts.join('.');

        let counter = 1;
        let uniqueName;
        let fileExists = true;

        while (fileExists) {
            uniqueName = `${nameWithoutExt}_${counter}.${extension}`;
            try {
                await directoryHandle.getFileHandle(uniqueName, { create: false });
                // File exists, increment counter
                counter++;
            } catch (err) {
                if (err.name === 'NotFoundError') {
                    // File doesn't exist, we found a unique name
                    fileExists = false;
                } else {
                    // Other error, use this name anyway
                    fileExists = false;
                }
            }
        }

        return uniqueName;
    }

    async getUniqueFileNameWithParens(directoryHandle, baseFileName) {
        /**
         * Check if file exists, and if so, append (1), (2), etc.
         * until a unique filename is found
         */
        try {
            // First try the base filename
            await directoryHandle.getFileHandle(baseFileName, { create: false });
            // If we get here, file exists, so we need to find a unique name
        } catch (err) {
            if (err.name === 'NotFoundError') {
                // File doesn't exist, base name is fine
                return baseFileName;
            }
            // Other error, log it but proceed with base name
            console.warn('Error checking file existence:', err);
            return baseFileName;
        }

        // File exists, append (number) suffix
        const nameParts = baseFileName.split('.');
        const extension = nameParts.pop();
        const nameWithoutExt = nameParts.join('.');

        let counter = 1;
        let uniqueName;
        let fileExists = true;

        while (fileExists) {
            uniqueName = `${nameWithoutExt} (${counter}).${extension}`;
            try {
                await directoryHandle.getFileHandle(uniqueName, { create: false });
                // File exists, increment counter
                counter++;
            } catch (err) {
                if (err.name === 'NotFoundError') {
                    // File doesn't exist, we found a unique name
                    fileExists = false;
                } else {
                    // Other error, use this name anyway
                    fileExists = false;
                }
            }
        }

        return uniqueName;
    }

    async generateFlexibleFilename(metadata, field1, field2, field3, sep1, sep2, custom1, custom2, custom3, trackSuffix = '', outputDirHandle = null) {
        /**
         * Generate filename using flexible field-based pattern:
         * <Field1><Sep1><Field2><Sep2><Field3>.wav
         * 
         * Field options: none, project, tape, scene, take, custom
         * Sep options: none (''), T, -, _, =, ~, +, comma, dot
         * 
         * If all metadata fields are missing, use DateTime (YYMMDD-HHMMSS-NN with counter)
         */
        
        const getFieldValue = (fieldType, customValue, fieldNum) => {
            if (fieldType === 'none') {
                return null;
            } else if (fieldType === 'custom') {
                return customValue || null;
            } else if (fieldType === 'project') {
                return metadata.project || null;
            } else if (fieldType === 'tape') {
                return metadata.tape || null;
            } else if (fieldType === 'scene') {
                // Pad scene with leading zeros to 2 digits if numeric
                const scene = metadata.scene;
                if (scene && /^\d+$/.test(scene)) {
                    return scene.padStart(2, '0');
                }
                return scene || null;
            } else if (fieldType === 'take') {
                // Pad take with leading zeros to 2 digits if numeric
                const take = metadata.take;
                if (take && /^\d+$/.test(take)) {
                    return take.padStart(2, '0');
                }
                return take || null;
            }
            return null;
        };

        const value1 = getFieldValue(field1, custom1, 1);
        const value2 = getFieldValue(field2, custom2, 2);
        const value3 = getFieldValue(field3, custom3, 3);

        // If all values are null/missing, use DateTime as fallback with incrementing counter
        if (!value1 && !value2 && !value3) {
            const now = new Date();
            const year = String(now.getFullYear()).slice(-2);
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            
            // Generate base filename with hyphens: YYMMDD-HHMMSS
            const dateTimeBase = `${year}${month}${day}-${hours}${minutes}${seconds}`;
            
            // If no output directory provided, return base format with counter 01
            if (!outputDirHandle) {
                return `${dateTimeBase}-01${trackSuffix}.wav`;
            }
            
            // Try counter from 01-99 to find a unique filename
            for (let counter = 1; counter <= 99; counter++) {
                const counterStr = String(counter).padStart(2, '0');
                const dateTimeWithCounter = `${dateTimeBase}-${counterStr}`;
                const testFilename = `${dateTimeWithCounter}${trackSuffix}.wav`;
                
                // Check if this filename would be unique
                try {
                    // Try to get the file - if it doesn't exist, we found our unique name
                    await outputDirHandle.getFileHandle(testFilename);
                    // File exists, continue to next counter
                } catch (err) {
                    // File doesn't exist, use this filename
                    return testFilename;
                }
            }
            
            // Fallback to counter 99 if all are taken (unlikely)
            return `${dateTimeBase}-99${trackSuffix}.wav`;
        }

        // Build filename with separators
        let parts = [];
        
        if (value1) parts.push(value1);
        
        if (value2) {
            if (parts.length > 0 && sep1) {
                parts.push(sep1);
            }
            parts.push(value2);
        }
        
        if (value3) {
            if (parts.length > 0 && sep2) {
                parts.push(sep2);
            }
            parts.push(value3);
        }

        const filename = parts.join('');
        return `${filename}${trackSuffix}.wav`;
    }

    /**
     * Show directory picker with standardized error handling
     * @returns {Promise<FileSystemDirectoryHandle|null>} Directory handle or null if cancelled
     */
    async pickDirectory() {
        try {
            return await window.showDirectoryPicker();
        } catch (err) {
            if (err.name === 'AbortError') {
                this.showToast('Directory selection cancelled', 'warning', 2000);
                return null;
            }
            throw err;
        }
    }

    /**
     * Get directory handle, prompting user if not provided
     * @param {FileSystemDirectoryHandle|null} currentHandle - Existing handle or null
     * @returns {Promise<FileSystemDirectoryHandle>} Directory handle
     * @throws {Error} If user cancels selection
     */
    async getOrPickDirectory(currentHandle) {
        if (currentHandle) return currentHandle;
        
        const handle = await this.pickDirectory();
        if (!handle) {
            throw new Error('Directory selection cancelled');
        }
        return handle;
    }

    // ========== End Multi-Process Helper Methods ==========

    openMultiProcessModal() {
        const modal = document.getElementById('multi-process-modal');
        if (modal) {
            modal.classList.add('active');
            
            // Set default TC Range values based on selected files
            this.setDefaultTCRange();
            
            // Initialize interactivity for checkboxes and radio buttons
            this.setupMultiProcessInteractivity();
        }
    }

    setDefaultTCRange() {
        /**
         * Set the default Start TC to the latest Start TC of selected files
         * and End TC to the earliest End TC of selected files (ignoring frames)
         */
        const selectedFiles = Array.from(this.selectedIndices).map(i => this.files[i]);
        
        if (selectedFiles.length === 0) return;

        let latestStartTC = null;
        let earliestEndTC = null;
        let latestStartSeconds = -Infinity;
        let earliestEndSeconds = Infinity;

        for (const fileObj of selectedFiles) {
            const metadata = fileObj.metadata;
            const tcStart = metadata.tcStart || '00:00:00:00';
            const duration = metadata.duration || '00:00:00';

            // Parse TC (HH:MM:SS:FF format) but ignore frames for comparison
            const tcStartWithoutFrames = tcStart.substring(0, 8); // HH:MM:SS
            const durationWithoutFrames = duration.substring(0, 8); // HH:MM:SS
            
            // Convert to seconds for comparison
            const startSeconds = this.parseTimecodeToSeconds(tcStartWithoutFrames);
            const durationSeconds = this.parseTimecodeToSeconds(durationWithoutFrames);
            const endSeconds = startSeconds + durationSeconds;

            // Track latest start
            if (startSeconds > latestStartSeconds) {
                latestStartSeconds = startSeconds;
                latestStartTC = tcStartWithoutFrames;
            }

            // Track earliest end
            if (endSeconds < earliestEndSeconds) {
                earliestEndSeconds = endSeconds;
                // Convert end seconds back to HH:MM:SS format directly
                const hours = Math.floor(endSeconds / 3600);
                const minutes = Math.floor((endSeconds % 3600) / 60);
                const seconds = Math.floor(endSeconds % 60);
                earliestEndTC = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }
        }

        // Set the form values
        if (latestStartTC) {
            document.getElementById('mp-tc-start').value = latestStartTC;
        }
        if (earliestEndTC) {
            document.getElementById('mp-tc-end').value = earliestEndTC;
        }
    }

    setupMultiProcessInteractivity() {
        // Handle Extract Audio checkbox
        const extractAudioCheckbox = document.getElementById('mp-extract-audio');
        const extractOptions = document.getElementById('mp-extract-options');
        
        // Handle Create Summed Mix checkbox and placement
        const createMixCheckbox = document.getElementById('mp-create-mix');
        const mixOptions = document.getElementById('mp-mix-options');
        const mixPlacementSelect = document.getElementById('mp-mix-placement');
        const combinePolyCheckbox = document.getElementById('mp-combine-poly');
        
        // Handle Normalize checkbox
        const normalizeCheckbox = document.getElementById('mp-normalize');
        const normalizeOptions = document.getElementById('mp-normalize-options');
        
        // Handle Rename checkbox
        const renameCheckbox = document.getElementById('mp-rename');
        const renameOptions = document.getElementById('mp-rename-options');
        
        // Radio buttons for Extract Audio mode
        const tcRangeRadio = document.getElementById('mp-tc-range');
        const conformCSVRadio = document.getElementById('mp-conform-csv');
        
        // Mix placement change handler
        const handleMixPlacementChange = () => {
            if (createMixCheckbox.checked && mixPlacementSelect.value === 'embed') {
                // Auto-enable Combine to Poly when embedding mix
                combinePolyCheckbox.checked = true;
                combinePolyCheckbox.disabled = true;
                combinePolyCheckbox.parentElement.style.opacity = '0.7';
                combinePolyCheckbox.parentElement.title = 'Required for embedding mix';
            } else {
                // Re-enable Combine to Poly
                combinePolyCheckbox.disabled = false;
                combinePolyCheckbox.parentElement.style.opacity = '1';
                combinePolyCheckbox.parentElement.title = '';
            }
        };
        
        // Add event listeners for mix checkbox and placement select
        createMixCheckbox.addEventListener('change', handleMixPlacementChange);
        mixPlacementSelect.addEventListener('change', handleMixPlacementChange);
        
        // Extract mode change handler (Rename is always available)
        const handleExtractModeChange = () => {
            // Rename is always available regardless of extract mode
            // CSV mode creates multiple groups that can benefit from consistent renaming
            renameCheckbox.disabled = false;
            renameCheckbox.parentElement.style.opacity = '1';
            renameCheckbox.parentElement.style.pointerEvents = 'auto';
        };
        
        // Add change listeners to radio buttons
        tcRangeRadio.addEventListener('change', handleExtractModeChange);
        conformCSVRadio.addEventListener('change', handleExtractModeChange);
        
        // Initialize state on modal open
        handleExtractModeChange();
        handleMixPlacementChange();
        
        // Handle custom field visibility for rename using RenameManager
        this.renameManager.setupRenameFieldListeners('mp-rename', null);
        
        // Note: CSS already handles the disabled state with :not(:checked) ~ selector
        // This is just for any additional JavaScript-based interactivity if needed
    }

    closeMultiProcessModal() {
        const modal = document.getElementById('multi-process-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    openMPChannelOrderModal() {
        // Initialize channel order if not already set
        if (!this.mpChannelOrder) {
            this.mpChannelOrder = [];
        }

        const container = document.getElementById('mp-channel-preview-container');
        container.innerHTML = '';

        let trackDisplayNames = [];
        let previewMode = 'none'; // 'none', 'selected-mono', 'sibling-group'

        if (this.selectedIndices.size > 0) {
            const selectedFiles = Array.from(this.selectedIndices).map(idx => this.files[idx]);
            
            // SCENARIO 1: Check if selected files are all individual mono files (pre-conform)
            const allIndividualMono = selectedFiles.every(f => 
                f && !f.isGroup && f.metadata && f.metadata.channels === 1
            );

            if (allIndividualMono && selectedFiles.length >= 2) {
                // User has selected individual mono files (likely pre-conform)
                previewMode = 'selected-mono';
                trackDisplayNames = selectedFiles.map((file, index) => {
                    // Use filename as identifier (track names may not exist yet)
                    const filename = file.metadata.filename.replace(/\.[^/.]+$/, '');
                    return `${filename} (Ch ${index + 1})`;
                });
            }

            // SCENARIO 2: Check for existing sibling groups (post-conform or auto-grouped)
            if (previewMode === 'none') {
                // Collect all mono files (expand groups if necessary)
                const monoFiles = [];
                selectedFiles.forEach(file => {
                    if (file && file.isGroup && file.siblings) {
                        // If it's a group, add all its siblings
                        file.siblings.forEach(sibling => {
                            if (sibling && sibling.metadata && sibling.metadata.channels === 1) {
                                monoFiles.push(sibling);
                            }
                        });
                    } else if (file && !file.isGroup && file.metadata && file.metadata.channels === 1) {
                        // If it's an individual mono file, add it
                        monoFiles.push(file);
                    }
                });
                
                if (monoFiles.length >= 2) {
                    // Group by TC Start + audioDataSize (same logic as combine)
                    const groups = new Map();
                    monoFiles.forEach(file => {
                        const key = `${file.metadata.tcStart}_${file.metadata.audioDataSize}`;
                        if (!groups.has(key)) {
                            groups.set(key, []);
                        }
                        groups.get(key).push(file);
                    });

                    // Get first group with 2+ files
                    const validGroups = Array.from(groups.values()).filter(group => group.length >= 2);
                    
                    if (validGroups.length > 0) {
                        previewMode = 'sibling-group';
                        const firstGroup = validGroups[0];
                        
                        // Extract track names from first group
                        trackDisplayNames = firstGroup.map((file, index) => {
                            let trackName = '';
                            if (file.metadata.trackNames && file.metadata.trackNames.length > 0) {
                                trackName = file.metadata.trackNames[0];
                            } else {
                                // Use filename as fallback
                                trackName = file.metadata.filename.replace(/\.[^/.]+$/, '');
                            }
                            return `${trackName} (Ch ${index + 1})`;
                        });
                    }
                }
            }
        }

        // Build UI based on mode
        let previewHTML;
        
        if (previewMode === 'none') {
            // No valid selection - show helpful message
            previewHTML = `
                <div style="padding: 1rem;">
                    <p style="margin-top: 0; margin-bottom: 1rem; font-weight: 600;">Channel Preview</p>
                    <div style="padding: 2rem; background: var(--bg-secondary); border-radius: 4px; text-align: center; color: var(--text-muted);">
                        <p style="margin: 0; color: orange; font-size: 0.95rem;">Select monophonic files (2+) to arrange channel order.</p>
                    </div>
                </div>
            `;
        } else {
            // Build draggable list
            let channelItemsHTML = '';
            for (let i = 0; i < trackDisplayNames.length; i++) {
                channelItemsHTML += `
                    <div class="mp-channel-item" draggable="true" data-channel="${i}" style="padding: 0.75rem; background: var(--bg-primary); border-radius: 4px; cursor: move; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-weight: 600; color: var(--accent-primary);">⋮⋮</span>
                        <span>${this.escapeHtml(trackDisplayNames[i])}</span>
                    </div>
                `;
            }

            const previewTitle = previewMode === 'selected-mono' 
                ? 'Channel Preview (from selected files)' 
                : 'Channel Preview (from first sibling group)';

            const warningBanner = previewMode === 'selected-mono' 
                ? `<div style="padding: 0.75rem; margin-bottom: 1rem; background: rgba(255, 207, 68, 0.1); border-left: 3px solid #ffcf44; border-radius: 4px; color: #ffcf44; font-size: 0.9em;">
                       ⚠️ This order will apply to <strong>all groups</strong> created after CSV conform
                   </div>` 
                : '';

            previewHTML = `
                <div style="padding: 1rem;">
                    <p style="margin-top: 0; margin-bottom: 1rem; font-weight: 600;">${previewTitle}</p>
                    ${warningBanner}
                    <div id="mp-channel-list" style="display: flex; flex-direction: column; gap: 0.5rem;">
                        ${channelItemsHTML}
                    </div>
                    <p style="font-size: 0.85rem; margin-top: 1rem; color: var(--text-muted);">Drag to reorder channels. This order will be applied to all groups.</p>
                </div>
            `;
        }

        container.innerHTML = previewHTML;

        // Add drag handlers (only if there are draggable items)
        if (previewMode !== 'none') {
            this.setupMPChannelDragHandlers();
        }

        const modal = document.getElementById('mp-channel-order-modal');
        modal.classList.add('active');
    }

    closeMPChannelOrderModal() {
        const modal = document.getElementById('mp-channel-order-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    showMPProgressBar() {
        const container = document.getElementById('mp-progress-container');
        if (container) {
            container.style.display = 'block';
            document.getElementById('mp-progress-bar').style.width = '0%';
            document.getElementById('mp-progress-percent').textContent = '0%';
            document.getElementById('mp-progress-text').textContent = 'Processing...';
        }
    }

    hideMPProgressBar() {
        const container = document.getElementById('mp-progress-container');
        if (container) {
            container.style.display = 'none';
        }
    }

    updateMPProgress(currentStep, totalSteps, stepText) {
        const percentage = Math.round((currentStep / totalSteps) * 100);
        const progressBar = document.getElementById('mp-progress-bar');
        const progressPercent = document.getElementById('mp-progress-percent');
        const progressText = document.getElementById('mp-progress-text');
        
        if (progressBar) progressBar.style.width = percentage + '%';
        if (progressPercent) progressPercent.textContent = percentage + '%';
        if (progressText) progressText.textContent = stepText;
    }

    setupMPChannelDragHandlers() {
        const channelList = document.getElementById('mp-channel-list');
        if (!channelList) return;

        const items = channelList.querySelectorAll('.mp-channel-item');

        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.dataset.channel);
                item.classList.add('dragging');
            });

            item.addEventListener('dragend', (e) => {
                item.classList.remove('dragging');
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const dragging = channelList.querySelector('.mp-channel-item.dragging');
                if (dragging && dragging !== item) {
                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    if (e.clientY < midpoint) {
                        channelList.insertBefore(dragging, item);
                    } else {
                        channelList.insertBefore(dragging, item.nextSibling);
                    }
                }
            });
        });
    }

    getMPChannelOrder() {
        // Get current channel order from the modal
        const channelList = document.getElementById('mp-channel-list');
        if (!channelList) return null;

        const items = Array.from(channelList.querySelectorAll('.mp-channel-item'));
        return items.map((item, newIndex) => ({
            originalIndex: parseInt(item.dataset.channel),
            newIndex: newIndex
        }));
    }

    async handleMultiProcess() {
        // Validate at least one process is selected
        const extractAudio = document.getElementById('mp-extract-audio').checked;
        const combineToPoly = document.getElementById('mp-combine-poly').checked;
        const normalize = document.getElementById('mp-normalize').checked;
        const rename = document.getElementById('mp-rename').checked;

        if (!extractAudio && !combineToPoly && !normalize && !rename) {
            alert('Please select at least one process to execute.');
            return;
        }

        // If Extract Audio is enabled, at least one file must be selected
        if (extractAudio && this.selectedIndices.size === 0) {
            alert('Please select at least one file.');
            return;
        }

        // Validate Extract Audio settings
        if (extractAudio) {
            const mode = document.querySelector('input[name="mp-extract-mode"]:checked').value;
            if (mode === 'tc-range') {
                const startTime = document.getElementById('mp-tc-start').value.trim();
                const endTime = document.getElementById('mp-tc-end').value.trim();
                if (!this.validateTimeFormat(startTime) || !this.validateTimeFormat(endTime)) {
                    alert('Invalid time format. Please use HH:MM:SS (e.g., 01:23:45)');
                    return;
                }
                const startSeconds = this.parseTimecodeToSeconds(startTime);
                const endSeconds = this.parseTimecodeToSeconds(endTime);
                if (startSeconds >= endSeconds) {
                    alert('Start time must be before end time.');
                    return;
                }
            } else if (mode === 'conform-csv') {
                // Validate CSV is loaded
                if (!this.mpCSVEntries || this.mpCSVEntries.length === 0) {
                    alert('Please choose a CSV file before proceeding.');
                    return;
                }
            }
        }

        this.closeMultiProcessModal();
        
        // Get destination folder
        let outputDirHandle = this.mpDestinationHandle;
        if (!outputDirHandle) {
            outputDirHandle = await this.pickDirectory();
            if (!outputDirHandle) {
                return; // User cancelled
            }
        }

        // Collect all options
        const options = {
            extractAudio,
            extractMode: extractAudio ? document.querySelector('input[name="mp-extract-mode"]:checked').value : null,
            tcStart: extractAudio ? document.getElementById('mp-tc-start').value : null,
            tcEnd: extractAudio ? document.getElementById('mp-tc-end').value : null,
            prePostRoll: extractAudio ? parseInt(document.getElementById('mp-prepost-roll').value) : 0,
            csvEntries: extractAudio && this.mpCSVEntries ? this.mpCSVEntries : null,
            createSummedMix: document.getElementById('mp-create-mix').checked,
            mixPlacement: document.getElementById('mp-mix-placement').value,
            combineToPoly,
            channelOrder: combineToPoly ? this.getMPChannelOrder() : null,
            normalize,
            normalizeLevel: normalize ? parseFloat(document.getElementById('mp-normalize-level').value) : -1.0,
            rename,
            renameField1: rename ? document.getElementById('mp-rename-field1').value : null,
            renameField2: rename ? document.getElementById('mp-rename-field2').value : null,
            renameField3: rename ? document.getElementById('mp-rename-field3').value : null,
            renameSeparator1: rename ? document.getElementById('mp-rename-separator1').value : '',
            renameSeparator2: rename ? document.getElementById('mp-rename-separator2').value : '',
            renameCustom1: rename ? document.getElementById('mp-rename-custom1').value : '',
            renameCustom2: rename ? document.getElementById('mp-rename-custom2').value : '',
            renameCustom3: rename ? document.getElementById('mp-rename-custom3').value : '',
            outputBitDepth: document.getElementById('mp-output-bitdepth').value,
            keepIntermediateFiles: document.getElementById('mp-keep-intermediate').checked,
            outputDirHandle
        };

        // Execute multi-process pipeline
        await this.executeMultiProcessPipeline(options);
    }

    async executeMultiProcessPipeline(options) {
        document.body.style.cursor = 'wait';
        let processedFiles = [];
        let successCount = 0;
        let failCount = 0;
        const intermediateFiles = []; // Track intermediate files for cleanup

        // Show progress bar and open modal
        this.showMPProgressBar();
        const modal = document.getElementById('multi-process-modal');
        modal.classList.add('active');

        try {
            let selectedFiles = Array.from(this.selectedIndices).map(i => this.files[i]);

            // STEP 0: Unwrap any group files to individual files (for all operations)
            // This ensures rename, normalize, and combine all work with individual files
            selectedFiles = selectedFiles.flatMap(file => {
                if (file.isGroup && file.siblings) {
                    // Unwrap sibling group into individual files
                    return file.siblings;
                }
                return file;
            });

            // STEP 1: Extract Audio
            if (options.extractAudio) {
                console.log('[MultiProcess] Step 1: Extracting Audio...');
                this.updateMPProgress(1, 5, 'Extracting Audio...');
                const extractedFiles = await this.mpExtractAudio(selectedFiles, options);
                successCount += extractedFiles.filter(f => f.success).length;
                failCount += extractedFiles.filter(f => !f.success).length;
                processedFiles = extractedFiles.filter(f => f.success).map(f => f.fileObj);
                
                // Mark as intermediate if more processing steps follow
                if (!options.keepIntermediateFiles && (options.combineToPoly || options.normalize || options.rename)) {
                    extractedFiles.forEach(f => {
                        if (f.success) intermediateFiles.push(f.fileObj);
                    });
                }
            } else {
                processedFiles = selectedFiles;
            }

            if (processedFiles.length === 0) {
                alert('No files available for further processing.');
                this.hideMPProgressBar();
                return;
            }

            // STEP 2: Create Summed Mono Mix (if enabled and multiple files)
            let mixFiles = null;
            if (options.createSummedMix && processedFiles.length > 1) {
                console.log('[MultiProcess] Step 2: Creating Summed Mono Mix...');
                this.updateMPProgress(2, 5, 'Creating Summed Mono Mix...');
                const mixResults = await this.mpCreateSummedMix(processedFiles, options);
                successCount += mixResults.filter(f => f.success).length;
                failCount += mixResults.filter(f => !f.success).length;
                
                // Store mix files for Combine step
                mixFiles = mixResults.filter(f => f.success);
                
                // Mark as intermediate if not keeping separate and more processing follows
                if (!options.keepIntermediateFiles && options.mixPlacement === 'embed' && options.combineToPoly) {
                    mixResults.forEach(f => {
                        if (f.success) intermediateFiles.push(f.fileObj);
                    });
                }
                
                // If mix placement is 'separate', add to processedFiles for further processing
                if (options.mixPlacement === 'separate') {
                    const mixFileObjs = mixResults.filter(f => f.success).map(f => f.fileObj);
                    processedFiles = [...processedFiles, ...mixFileObjs];
                }
            }

            // STEP 3: Combine to Poly (if enabled and multiple files)
            if (options.combineToPoly && processedFiles.length > 1) {
                console.log('[MultiProcess] Step 3: Combining to Poly...');
                this.updateMPProgress(3, 5, 'Combining to Poly...');
                const combined = await this.mpCombineToPoly(processedFiles, options, mixFiles);
                if (combined.success) {
                    // Mark previous files as intermediate when Combine runs
                    // (they are superseded by the combined output)
                    // ONLY mark if they're not the original selected files (i.e., they were created by Extract)
                    if (!options.keepIntermediateFiles && options.extractAudio) {
                        processedFiles.forEach(f => {
                            if (!intermediateFiles.includes(f)) {
                                intermediateFiles.push(f);
                            }
                        });
                    }
                    // Handle multiple created files (intelligent grouping)
                    processedFiles = combined.fileObjs || [combined.fileObj];
                    successCount += processedFiles.length;
                } else {
                    console.warn('[MultiProcess] Combine to Poly failed:', combined.error);
                    failCount++;
                }
            }

            // STEP 4: Normalize
            if (options.normalize) {
                console.log('[MultiProcess] Step 4: Normalizing Audio...');
                this.updateMPProgress(4, 5, 'Normalizing Audio...');
                const previousFiles = [...processedFiles]; // Save reference to previous files
                const normalized = await this.mpNormalize(processedFiles, options);
                successCount += normalized.filter(f => f.success).length;
                failCount += normalized.filter(f => !f.success).length;
                processedFiles = normalized.filter(f => f.success).map(f => f.fileObj);
                
                // Always mark previous files as intermediate when Normalize runs
                // (they are superseded by the normalized output)
                if (!options.keepIntermediateFiles) {
                    previousFiles.forEach(f => {
                        if (!intermediateFiles.includes(f)) {
                            intermediateFiles.push(f);
                        }
                    });
                }
            }

            // STEP 5: Rename
            if (options.rename) {
                console.log('[MultiProcess] Step 5: Renaming Files...');
                this.updateMPProgress(5, 5, 'Renaming Files...');
                const previousFiles = [...processedFiles]; // Save reference to previous files
                const renamed = await this.mpRename(processedFiles, options);
                successCount += renamed.filter(f => f.success).length;
                failCount += renamed.filter(f => !f.success).length;
                processedFiles = renamed.filter(f => f.success).map(f => f.fileObj);
                
                // Mark previous files as intermediate (rename creates new files)
                if (!options.keepIntermediateFiles) {
                    previousFiles.forEach(f => {
                        if (!intermediateFiles.includes(f)) {
                            intermediateFiles.push(f);
                        }
                    });
                }
            }

            // Clean up intermediate files if not keeping them
            if (!options.keepIntermediateFiles && intermediateFiles.length > 0) {
                console.log(`[MultiProcess] Cleaning up ${intermediateFiles.length} intermediate file(s)...`);
                this.updateMPProgress(5, 5, 'Cleaning up intermediate files...');
                for (const fileObj of intermediateFiles) {
                    try {
                        // Remove from file system
                        await fileObj.handle.remove();
                        
                        // Remove from this.files array
                        const index = this.files.findIndex(f => f.handle === fileObj.handle);
                        if (index !== -1) {
                            this.files.splice(index, 1);
                        }
                    } catch (err) {
                        console.warn(`Failed to delete intermediate file ${fileObj.metadata.filename}:`, err);
                    }
                }
            }

            // Show summary
            const message = options.keepIntermediateFiles 
                ? `Multi-Process Complete!\nSuccessfully processed: ${successCount}\nFailed: ${failCount}`
                : `Multi-Process Complete!\nFinal files created: ${processedFiles.length}\nIntermediate files cleaned: ${intermediateFiles.length}\nFailed: ${failCount}`;
            alert(message);

            // Refresh file list
            const tbody = document.getElementById('file-list-body');
            tbody.innerHTML = '';
            this.files.forEach((file, i) => this.addTableRow(i, file.metadata));
            this.updateSelectionUI();

        } catch (err) {
            console.error('[MultiProcess] Pipeline failed:', err);
            alert(`Multi-Process failed: ${err.message}`);
        } finally {
            document.body.style.cursor = 'default';
            this.hideMPProgressBar();
        }
    }

    async mpExtractAudio(selectedFiles, options) {
        const results = [];

        // Handle TC Range mode
        if (options.extractMode === 'tc-range') {
            for (const sourceFile of selectedFiles) {
                try {
                    const startTC = options.tcStart + ':00'; // Add frame count
                    const endTC = options.tcEnd + ':00';
                    const nameWithoutExt = sourceFile.metadata.filename.replace(/\.[^/.]+$/, '');
                    const baseFileName = `${nameWithoutExt}_extract.wav`;
                    
                    // Get unique filename (avoid overwriting existing files)
                    const fileName = await this.getUniqueFileName(options.outputDirHandle, baseFileName);

                    // Determine bit depth
                    let bitDepth = 24;
                    if (options.outputBitDepth !== 'same') {
                        bitDepth = options.outputBitDepth === '32f' ? 32 : parseInt(options.outputBitDepth);
                    } else {
                        bitDepth = sourceFile.metadata.bitDepth || 24;
                    }

                    const result = await this.extractAudioRange(
                        sourceFile,
                        startTC,
                        endTC,
                        {},
                        fileName,
                        options.outputDirHandle,
                        'wav',
                        bitDepth
                    );

                    if (result.success) {
                        const newFile = await result.handle.getFile();
                        const metadata = await this.metadataHandler.parseFile(newFile);
                        const fileObj = {
                            handle: result.handle,
                            metadata: metadata,
                            file: newFile,
                            isGroup: false
                        };
                        this.files.push(fileObj);
                        results.push({ success: true, fileObj, handle: result.handle });
                    } else {
                        results.push({ success: false, error: result.error });
                    }
                } catch (err) {
                    console.error(`[MultiProcess] Extract Audio failed for ${sourceFile.metadata.filename}:`, err);
                    results.push({ success: false, error: err.message });
                }
            }
        }
        // Handle Conform to CSV mode
        else if (options.extractMode === 'conform-csv') {
            const csvEntries = options.csvEntries;
            const selectedIndices = new Set(selectedFiles.map((_, idx) => 
                this.files.findIndex(f => f === selectedFiles[idx])
            ));

            for (const entry of csvEntries) {
                try {
                    // Infer FPS from first matched take
                    let fpsExact = { numerator: 24, denominator: 1 };
                    
                    // Calculate end TC from length
                    const csvEndTC = this.calculateEndTCFromLength(entry.startTC, entry.length, fpsExact);

                    // Find matching takes in selected files
                    const matchIndices = this.findMatchingTakes(entry.startTC, csvEndTC, selectedIndices);

                    if (matchIndices.length === 0) {
                        console.log(`[MultiProcess] Skipping CSV entry "${entry.fileName}": no matching takes found`);
                        results.push({ success: false, error: 'No matching takes found' });
                        continue;
                    }

                    // Use FPS from first matched take
                    const firstMatch = this.files[matchIndices[0]];
                    if (firstMatch.metadata.fpsExact) {
                        fpsExact = firstMatch.metadata.fpsExact;
                    } else if (firstMatch.metadata.fps) {
                        if (firstMatch.metadata.fps === '23.98') {
                            fpsExact = { numerator: 24000, denominator: 1001 };
                        } else if (firstMatch.metadata.fps === '29.97') {
                            fpsExact = { numerator: 30000, denominator: 1001 };
                        } else {
                            const fpsNum = parseFloat(firstMatch.metadata.fps);
                            fpsExact = { numerator: fpsNum, denominator: 1 };
                        }
                    }

                    // Recalculate end TC with correct FPS
                    const csvEndTCCorrect = this.calculateEndTCFromLength(entry.startTC, entry.length, fpsExact);

                    // Apply pre/post roll to timecodes
                    const sampleRate = 48000;
                    const csvStartSamples = this.metadataHandler.tcToSamples(entry.startTC, sampleRate, fpsExact);
                    const csvEndSamples = this.metadataHandler.tcToSamples(csvEndTCCorrect, sampleRate, fpsExact);
                    
                    const prePostRollSamples = Math.round(options.prePostRoll * sampleRate);
                    const adjustedStartSamples = Math.max(0, csvStartSamples - prePostRollSamples);
                    const adjustedEndSamples = csvEndSamples + prePostRollSamples;
                    
                    const adjustedStartTC = this.metadataHandler.samplesToTC(adjustedStartSamples, sampleRate, fpsExact);
                    const adjustedEndTC = this.metadataHandler.samplesToTC(adjustedEndSamples, sampleRate, fpsExact);

                    // Process each matching take
                    for (let matchIdx = 0; matchIdx < matchIndices.length; matchIdx++) {
                        const takeIndex = matchIndices[matchIdx];
                        const sourceTake = this.files[takeIndex];

                        // Generate output filename with disambiguation
                        const outputFilename = matchIndices.length > 1 
                            ? this.generateDisambiguatedFilename(entry.fileName, matchIdx)
                            : `${entry.fileName}.wav`;

                        // Get unique filename to avoid conflicts
                        const fileName = await this.getUniqueFileName(options.outputDirHandle, outputFilename);

                        // Determine bit depth
                        let bitDepth = 24;
                        if (options.outputBitDepth !== 'same') {
                            bitDepth = options.outputBitDepth === '32f' ? 32 : parseInt(options.outputBitDepth);
                        } else {
                            bitDepth = sourceTake.metadata.bitDepth || 24;
                        }

                        // Prepare metadata from CSV
                        const outputMetadata = {
                            scene: entry.scene,
                            take: entry.take,
                            filename: fileName
                        };

                        // Extract audio
                        const result = await this.extractAudioRange(
                            sourceTake,
                            adjustedStartTC,
                            adjustedEndTC,
                            outputMetadata,
                            fileName,
                            options.outputDirHandle,
                            'wav',
                            bitDepth
                        );

                        if (result.success) {
                            const newFile = await result.handle.getFile();
                            const metadata = await this.metadataHandler.parseFile(newFile);
                            const fileObj = {
                                handle: result.handle,
                                metadata: metadata,
                                file: newFile,
                                isGroup: false
                            };
                            this.files.push(fileObj);
                            results.push({ success: true, fileObj, handle: result.handle });
                        } else {
                            results.push({ success: false, error: result.error });
                        }
                    }
                } catch (err) {
                    console.error(`[MultiProcess] Conform CSV failed for entry "${entry.fileName}":`, err);
                    results.push({ success: false, error: err.message });
                }
            }
        }

        return results;
    }

    async mpCreateSummedMix(fileList, options) {
        /**
         * Create summed mono mix for each group of files
         * Groups are determined by TC Start + audioDataSize (matching takes)
         * Applies √N attenuation to prevent clipping
         */
        const results = [];

        try {
            // Group files by TC Start + audioDataSize (same as mpCombineToPoly)
            const groups = new Map();
            fileList.forEach(file => {
                const key = `${file.metadata.tcStart}_${file.metadata.audioDataSize}`;
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key).push(file);
            });

            // Filter to only groups with 2+ files (single file can't be mixed)
            const validGroups = Array.from(groups.values()).filter(group => group.length >= 2);

            if (validGroups.length === 0) {
                console.warn('[MultiProcess] No valid groups found for mixing (each group needs 2+ files)');
                return results;
            }

            console.log(`[MultiProcess] Creating summed mono mix for ${validGroups.length} group(s)...`);

            for (let groupIndex = 0; groupIndex < validGroups.length; groupIndex++) {
                const group = validGroups[groupIndex];
                const channelCount = group.length;
                
                console.log(`[MultiProcess] Mixing group ${groupIndex + 1}/${validGroups.length} (${channelCount} channels)...`);

                try {
                    // Load all audio buffers for this group
                    const audioBuffers = await Promise.all(
                        group.map(async (file) => {
                            const arrayBuffer = await file.file.arrayBuffer();
                            return await this.audioEngine.audioCtx.decodeAudioData(arrayBuffer.slice(0));
                        })
                    );

                    // Validate all buffers have same duration and sample rate
                    const firstBuffer = audioBuffers[0];
                    const sampleRate = firstBuffer.sampleRate;
                    const duration = firstBuffer.duration;
                    const length = firstBuffer.length;

                    const allMatch = audioBuffers.every(buf => 
                        buf.sampleRate === sampleRate && buf.length === length
                    );

                    if (!allMatch) {
                        console.error('[MultiProcess] Cannot mix - files have different sample rates or lengths');
                        results.push({ success: false, error: 'Mismatched sample rates or durations in group' });
                        continue;
                    }

                    // Create offline context for rendering
                    const OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                    const offlineCtx = new OfflineAudioContext(1, length, sampleRate); // Mono output

                    // Calculate attenuation: 0.9 / √N for safety headroom
                    const attenuation = 0.9 / Math.sqrt(channelCount);
                    console.log(`[MultiProcess] Applying attenuation: ${attenuation.toFixed(3)} (${(20 * Math.log10(attenuation)).toFixed(2)} dB) for ${channelCount} channels`);

                    // Create source nodes for each channel with attenuation
                    for (let i = 0; i < audioBuffers.length; i++) {
                        const source = offlineCtx.createBufferSource();
                        source.buffer = audioBuffers[i];
                        
                        const gainNode = offlineCtx.createGain();
                        gainNode.gain.value = attenuation;
                        
                        source.connect(gainNode);
                        gainNode.connect(offlineCtx.destination);
                        source.start(0);
                    }

                    // Render the mix
                    const mixedBuffer = await offlineCtx.startRendering();

                    // Determine bit depth
                    let bitDepth = 24;
                    if (options.outputBitDepth !== 'same') {
                        bitDepth = options.outputBitDepth === '32f' ? 32 : parseInt(options.outputBitDepth);
                    } else {
                        bitDepth = group[0].metadata.bitDepth || 24;
                    }

                    // Create output filename: SceneTake_mix.wav
                    const baseMetadata = group[0].metadata;
                    const scene = baseMetadata.scene || 'Scene';
                    const take = baseMetadata.take || 'Take';
                    const baseFileName = `${scene}${take}_mix.wav`;
                    const fileName = await this.getUniqueFileName(options.outputDirHandle, baseFileName);

                    // Prepare metadata (inherit from first file in group)
                    const mixMetadata = {
                        ...baseMetadata,
                        channels: 1,
                        trackNames: ['Mix'],
                        bitDepth: bitDepth,
                        filename: fileName,
                        isMixExport: true // Flag for metadata regeneration
                    };

                    // Create WAV file with metadata
                    const originalBuffer = await group[0].file.arrayBuffer();
                    const wavBuffer = this.audioProcessor.createWavFile(
                        mixedBuffer, 
                        bitDepth, 
                        originalBuffer, 
                        mixMetadata
                    );

                    const blob = new Blob([wavBuffer], { type: 'audio/wav' });

                    // Save file
                    const fileHandle = await options.outputDirHandle.getFileHandle(fileName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();

                    // Parse and create file object
                    const newFile = await fileHandle.getFile();
                    const metadata = await this.metadataHandler.parseFile(newFile);
                    const fileObj = {
                        handle: fileHandle,
                        metadata: metadata,
                        file: newFile,
                        isGroup: false,
                        mixGroup: group // Store reference to source files for combining
                    };

                    this.files.push(fileObj);
                    results.push({ success: true, fileObj, sourceGroup: group });

                    console.log(`[MultiProcess] Created mix: ${fileName}`);

                } catch (err) {
                    console.error(`[MultiProcess] Mix creation failed for group ${groupIndex + 1}:`, err);
                    results.push({ success: false, error: err.message });
                }
            }

            console.log(`[MultiProcess] Successfully created ${results.filter(r => r.success).length} mix file(s)`);
            return results;

        } catch (err) {
            console.error('[MultiProcess] Create Summed Mix failed:', err);
            return results;
        }
    }

    async mpCombineToPoly(fileList, options, mixFiles = null) {
        // Validate we have at least 2 files (or 1 if we have a mix to prepend)
        if (!mixFiles && fileList.length < 2) {
            console.warn('[MultiProcess] Cannot combine - need at least 2 files');
            return { success: false, error: 'Need at least 2 files to combine' };
        }

        try {
            // Validate all files are monophonic
            const allMono = fileList.every(f => f.metadata.channels === 1);
            if (!allMono) {
                return { success: false, error: 'All files must be monophonic (1 channel) to combine' };
            }

            // Intelligently group files by TC Start + audioDataSize (like dedicated Combine modal)
            const groups = new Map();
            fileList.forEach(file => {
                const key = `${file.metadata.tcStart}_${file.metadata.audioDataSize}`;
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key).push(file);
            });

            // Filter to only groups with 2+ files
            const validGroups = Array.from(groups.values()).filter(group => group.length >= 2);

            if (validGroups.length === 0) {
                console.warn('[MultiProcess] No valid groups found for combining (each group needs 2+ files)');
                return { success: false, error: 'No combinable groups found (need matching files by TC Start and duration)' };
            }

            console.log(`[MultiProcess] Found ${validGroups.length} group(s) to combine (${fileList.length} total files)`);

            // Create a map of mixFiles by their source group for quick lookup
            const mixFileMap = new Map();
            if (mixFiles && mixFiles.length > 0) {
                mixFiles.forEach(mixResult => {
                    if (mixResult.success && mixResult.sourceGroup) {
                        // Use same key as groups (TC Start + audioDataSize from first file)
                        const firstFile = mixResult.sourceGroup[0];
                        const key = `${firstFile.metadata.tcStart}_${firstFile.metadata.audioDataSize}`;
                        mixFileMap.set(key, mixResult.fileObj);
                    }
                });
            }

            // Process each group and collect results
            const createdFiles = [];

            for (let groupIndex = 0; groupIndex < validGroups.length; groupIndex++) {
                const group = validGroups[groupIndex];
                
                // Check if there's a mix file for this group
                const firstFile = group[0];
                const groupKey = `${firstFile.metadata.tcStart}_${firstFile.metadata.audioDataSize}`;
                const mixFile = mixFileMap.get(groupKey);
                
                const hashedChannelCount = mixFile ? group.length + 1 : group.length;
                console.log(`[MultiProcess] Combining group ${groupIndex + 1}/${validGroups.length} (${hashedChannelCount} channels${mixFile ? ' with mix on Ch 1' : ''})...`);

                // Prepare arrays for combining
                const fileBuffers = [];
                const trackNames = [];

                // If mix file exists, add it first (interleave 0 / Ch 1)
                if (mixFile) {
                    const mixBuffer = await mixFile.file.arrayBuffer();
                    fileBuffers.push(mixBuffer);
                    trackNames.push('Mix');
                }

                // Add all original group files
                for (let i = 0; i < group.length; i++) {
                    const fileBuffer = await group[i].file.arrayBuffer();
                    fileBuffers.push(fileBuffer);
                    
                    // Extract track name from metadata
                    const file = group[i];
                    if (file.metadata.trackNames && file.metadata.trackNames.length > 0) {
                        trackNames.push(file.metadata.trackNames[0]);
                    } else {
                        trackNames.push(`Ch${mixFile ? i + 2 : i + 1}`);
                    }
                }

                // Apply custom channel order if provided
                if (options.channelOrder && options.channelOrder.length > 0) {
                    const orderedBuffers = [];
                    const orderedTrackNames = [];
                    
                    // If mix file exists, it stays at position 0 (don't reorder it)
                    const startIdx = mixFile ? 1 : 0;
                    
                    options.channelOrder.forEach(orderMap => {
                        if (startIdx + orderMap.originalIndex < fileBuffers.length) {
                            orderedBuffers[startIdx + orderMap.newIndex] = fileBuffers[startIdx + orderMap.originalIndex];
                            orderedTrackNames[startIdx + orderMap.newIndex] = trackNames[startIdx + orderMap.originalIndex];
                        }
                    });
                    
                    // Replace with ordered arrays
                    if (mixFile) {
                        fileBuffers[0] = fileBuffers[0]; // Keep mix at position 0
                        fileBuffers.splice(1, group.length, ...orderedBuffers.slice(1));
                        trackNames.splice(1, group.length, ...orderedTrackNames.slice(1));
                    } else {
                        fileBuffers.splice(0, group.length, ...orderedBuffers);
                        trackNames.splice(0, group.length, ...orderedTrackNames);
                    }
                }

                // Use first file's metadata as base (or mix file if present)
                const baseMetadata = mixFile ? mixFile.metadata : group[0].metadata;

                // Combine audio files using existing audioProcessor method
                const combinedBlob = await this.audioProcessor.combineToPolyphonic(
                    fileBuffers,
                    trackNames,
                    baseMetadata
                );

                // Determine bit depth
                let bitDepth = 24;
                if (options.outputBitDepth !== 'same') {
                    bitDepth = options.outputBitDepth === '32f' ? 32 : parseInt(options.outputBitDepth);
                } else {
                    bitDepth = baseMetadata.bitDepth || 24;
                }

                // Prepare metadata for polyphonic file
                const polyMetadata = {
                    ...baseMetadata,
                    channels: fileBuffers.length,
                    trackNames: trackNames,
                    bitDepth: bitDepth
                };

                // Create output filename based on first file
                const nameWithoutExt = group[0].metadata.filename.replace(/\.[^/.]+$/, '');
                const baseFileName = `${nameWithoutExt}_poly.wav`;
                const fileName = await this.getUniqueFileName(options.outputDirHandle, baseFileName);

                // Add metadata to combined file
                const combinedArrayBuffer = await combinedBlob.arrayBuffer();
                const finalBlob = await this.metadataHandler.saveWav(
                    { arrayBuffer: async () => combinedArrayBuffer },
                    polyMetadata
                );

                // Save file
                const fileHandle = await options.outputDirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(finalBlob);
                await writable.close();

                // Parse and add to file list
                const newFile = await fileHandle.getFile();
                const metadata = await this.metadataHandler.parseFile(newFile);
                const newFileObj = {
                    handle: fileHandle,
                    metadata: metadata,
                    file: newFile,
                    isGroup: false
                };
                this.files.push(newFileObj);
                createdFiles.push(newFileObj);
            }

            console.log(`[MultiProcess] Successfully combined ${validGroups.length} group(s) into ${createdFiles.length} polyphonic file(s)`);
            return { success: true, fileObjs: createdFiles };

        } catch (err) {
            console.error('[MultiProcess] Combine to Poly failed:', err);
            return { success: false, error: err.message };
        }
    }

    async mpNormalize(fileList, options) {
        const results = [];

        for (const fileObj of fileList) {
            try {
                const targetDb = parseFloat(options.normalizeLevel);
                console.log(`[MultiProcess] Normalizing ${fileObj.metadata.filename} to ${targetDb} dBFS...`);
                
                // Read and decode the original file
                const arrayBuffer = await fileObj.file.arrayBuffer();
                const audioBuffer = await this.audioEngine.audioCtx.decodeAudioData(arrayBuffer.slice(0));

                // Apply normalization
                const sampleRate = audioBuffer.sampleRate;
                const channels = audioBuffer.numberOfChannels;
                const length = audioBuffer.length;

                // Find max amplitude across all channels
                let maxAmplitude = 0;
                for (let ch = 0; ch < channels; ch++) {
                    const data = audioBuffer.getChannelData(ch);
                    for (let i = 0; i < data.length; i++) {
                        maxAmplitude = Math.max(maxAmplitude, Math.abs(data[i]));
                    }
                }

                if (maxAmplitude === 0) {
                    results.push({ success: false, error: 'File is silent, cannot normalize' });
                    continue;
                }

                // Calculate gain needed to reach target level
                const targetLinear = Math.pow(10, targetDb / 20);
                const gainFactor = targetLinear / maxAmplitude;

                // Apply gain using OfflineAudioContext
                const OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);

                const source = offlineCtx.createBufferSource();
                source.buffer = audioBuffer;

                const gainNode = offlineCtx.createGain();
                gainNode.gain.value = gainFactor;

                source.connect(gainNode);
                gainNode.connect(offlineCtx.destination);

                source.start(0);
                const normalizedBuffer = await offlineCtx.startRendering();

                // Determine bit depth
                let bitDepth = 24;
                if (options.outputBitDepth !== 'same') {
                    bitDepth = options.outputBitDepth === '32f' ? 32 : parseInt(options.outputBitDepth);
                } else {
                    bitDepth = fileObj.metadata.bitDepth || 24;
                }

                // Create output filename
                const nameWithoutExt = fileObj.metadata.filename.replace(/\.[^/.]+$/, '');
                const baseFileName = `${nameWithoutExt}_normalized.wav`;
                
                // Get unique filename (avoid overwriting existing files)
                const fileName = await this.getUniqueFileName(options.outputDirHandle, baseFileName);

                // Prepare metadata - preserve all original metadata
                const exportMetadata = {
                    ...fileObj.metadata,
                    bitDepth: bitDepth
                };

                // Create base WAV file
                const wavBuffer = this.audioProcessor.createWavFile(normalizedBuffer, bitDepth, null, exportMetadata);
                
                // Create bEXT and iXML chunks with metadata
                const bextChunk = this.metadataHandler.createBextChunk(exportMetadata);
                const ixmlChunk = this.metadataHandler.createIXMLChunk(exportMetadata);
                
                // Calculate padding and sizes
                const bextPadding = bextChunk.byteLength % 2 !== 0 ? 1 : 0;
                const ixmlPadding = ixmlChunk.byteLength % 2 !== 0 ? 1 : 0;
                const bextTotalSize = 8 + bextChunk.byteLength + bextPadding;
                const ixmlTotalSize = 8 + ixmlChunk.byteLength + ixmlPadding;
                
                // Calculate new file size
                const wavView = new DataView(wavBuffer);
                const wavArray = new Uint8Array(wavBuffer);
                const riffSize = wavView.getUint32(4, true);
                const oldFileSize = riffSize + 8;
                const newFileSize = oldFileSize + bextTotalSize + ixmlTotalSize;
                
                // Create new buffer with metadata chunks
                const newWavBuffer = new Uint8Array(newFileSize);
                newWavBuffer.set(wavArray);
                
                const chunkView = new DataView(newWavBuffer.buffer);
                
                // Write bEXT chunk
                let chunkOffset = oldFileSize;
                newWavBuffer[chunkOffset] = 0x62;     // 'b'
                newWavBuffer[chunkOffset + 1] = 0x65; // 'e'
                newWavBuffer[chunkOffset + 2] = 0x78; // 'x'
                newWavBuffer[chunkOffset + 3] = 0x74; // 't'
                chunkView.setUint32(chunkOffset + 4, bextChunk.byteLength, true);
                newWavBuffer.set(new Uint8Array(bextChunk), chunkOffset + 8);
                chunkOffset += bextTotalSize;
                
                // Write iXML chunk
                newWavBuffer[chunkOffset] = 0x69;     // 'i'
                newWavBuffer[chunkOffset + 1] = 0x58; // 'X'
                newWavBuffer[chunkOffset + 2] = 0x4d; // 'M'
                newWavBuffer[chunkOffset + 3] = 0x4c; // 'L'
                chunkView.setUint32(chunkOffset + 4, ixmlChunk.byteLength, true);
                newWavBuffer.set(new Uint8Array(ixmlChunk), chunkOffset + 8);
                
                // Update RIFF file size
                chunkView.setUint32(4, newFileSize - 8, true);
                
                const blob = new Blob([newWavBuffer], { type: 'audio/wav' });

                // Save file
                const fileHandle = await options.outputDirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();

                // Parse and add to file list
                const newFile = await fileHandle.getFile();
                const metadata = await this.metadataHandler.parseFile(newFile);
                const newFileObj = {
                    handle: fileHandle,
                    metadata: metadata,
                    file: newFile,
                    isGroup: false
                };
                this.files.push(newFileObj);

                results.push({ success: true, fileObj: newFileObj });

            } catch (err) {
                console.error(`[MultiProcess] Normalize failed for ${fileObj.metadata.filename}:`, err);
                results.push({ success: false, error: err.message });
            }
        }

        return results;
    }

    async mpRename(fileList, options) {
        const results = [];
        
        // Build rename config from options
        const config = {
            field1: options.renameField1,
            field2: options.renameField2,
            field3: options.renameField3,
            separator1: options.renameSeparator1,
            separator2: options.renameSeparator2,
            custom1: options.renameCustom1,
            custom2: options.renameCustom2,
            custom3: options.renameCustom3,
            outputDirHandle: options.outputDirHandle
        };

        for (const fileObj of fileList) {
            try {
                // Extract track suffix from original filename (e.g., '_1', '_2', '_3')
                const originalName = fileObj.metadata.filename;
                const trackSuffixMatch = originalName.match(/(_\d+)\.wav$/);
                const trackSuffix = trackSuffixMatch ? trackSuffixMatch[1] : '';

                // Generate new filename using RenameManager
                const newFileName = await this.renameManager.generatePreviewFilename(
                    fileObj.metadata,
                    config,
                    trackSuffix
                );

                console.log(`[MultiProcess] Renaming ${originalName} to ${newFileName}`);

                // Check if filename is the same (no change needed)
                if (originalName === newFileName) {
                    console.log(`[MultiProcess] Filename unchanged for ${originalName}`);
                    results.push({ success: true, fileObj });
                    continue;
                }

                // Read the original file as a blob
                const fileBlob = fileObj.file;

                // Ensure unique filename to prevent overwrites with (1), (2), etc.
                const uniqueFileName = await this.getUniqueFileNameWithParens(config.outputDirHandle, newFileName);

                // Write to new file with the new name
                const newFileHandle = await config.outputDirHandle.getFileHandle(uniqueFileName, { create: true });
                const writable = await newFileHandle.createWritable();
                await writable.write(fileBlob);
                await writable.close();

                // Parse the new file and create file object
                const newFile = await newFileHandle.getFile();
                const metadata = await this.metadataHandler.parseFile(newFile);
                const newFileObj = {
                    handle: newFileHandle,
                    metadata: metadata,
                    file: newFile,
                    isGroup: false
                };

                // Add to files list
                this.files.push(newFileObj);

                results.push({ success: true, fileObj: newFileObj });

            } catch (err) {
                console.error(`[MultiProcess] Rename failed for ${fileObj.metadata.filename}:`, err);
                results.push({ success: false, error: err.message });
            }
        }

        return results;
    }

    // ========== End Multi-Process Modal Methods ==========

    async handleMPChooseCSV() {
        try {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{
                    description: 'CSV Files',
                    accept: { 'text/csv': ['.csv'] }
                }],
                multiple: false
            });

            const file = await fileHandle.getFile();
            const csvText = await file.text();

            // Parse and validate CSV
            const result = this.parseCSVFile(csvText);

            if (!result.valid) {
                alert(result.error);
                return;
            }

            // Store CSV entries
            this.mpCSVEntries = result.entries;
            
            // Update UI to show filename and entry count
            document.getElementById('mp-csv-filename').textContent = `${file.name} (${result.entries.length} entries)`;
            
            console.log(`[Multi-Process] Loaded CSV with ${result.entries.length} entries`);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Error choosing CSV file:', err);
                alert(`Failed to load CSV: ${err.message}`);
            }
        }
    }

    async handleMPChooseDestination() {
        const directoryHandle = await this.pickDirectory();
        if (directoryHandle) {
            document.getElementById('mp-destination-path').textContent = directoryHandle.name;
            this.mpDestinationHandle = directoryHandle;
        }
    }

    // ========== End Multi-Process Modal Methods ==========

    async handleChooseCSV() {
        try {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{
                    description: 'CSV Files',
                    accept: { 'text/csv': ['.csv'] }
                }],
                multiple: false
            });

            const file = await fileHandle.getFile();
            const csvText = await file.text();

            // Parse and validate CSV
            const result = this.parseCSVFile(csvText);

            if (!result.valid) {
                alert(result.error);
                return;
            }

            // Store entries
            this.conformCSVEntries = result.entries;

            // Update UI
            document.getElementById('csv-filename-display').textContent = file.name;
            
            // Populate preview table
            const tableBody = document.getElementById('csv-preview-body');
            tableBody.innerHTML = '';
            
            result.entries.forEach(entry => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${entry.fileName}</td>
                    <td>${entry.scene}</td>
                    <td>${entry.take}</td>
                    <td>${entry.length}</td>
                    <td>${entry.startTC}</td>
                `;
                tableBody.appendChild(row);
            });

            document.getElementById('csv-preview-table').style.display = 'table';
            document.getElementById('conform-csv-button').disabled = false;

        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Error choosing CSV:', err);
                alert(`Failed to load CSV: ${err.message}`);
            }
        }
    }

    secondsToDuration(seconds) {
        // Convert seconds to HH:MM:SS:FF format (assumes 24fps for frames)
        const totalSeconds = Math.floor(seconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        const frames = Math.round((seconds - totalSeconds) * 24);

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
    }

    animate() {
        const isPlaying = this.audioEngine.isPlaying;
        const isStopped = this.isStopped;
        
        if (isPlaying && !isStopped) {
            const time = this.audioEngine.getCurrentTime();
            const duration = this.audioEngine.buffer ? this.audioEngine.buffer.duration : 1;
            const percent = time / duration;

            // Update automation
            this.mixer.updateAutomation(time);

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
        } else if (!isPlaying && !isStopped) {
            // When not playing, cursor is frozen at pauseTime - don't update
            // But log state changes
            if (this._lastIsPlaying !== false) {
                console.log(`[animate] isPlaying changed to false`);
                this._lastIsPlaying = false;
            }
        }

        // Update Mixer Meters
        if (this.mixer) {
            this.mixer.updateMeters();
        }

        requestAnimationFrame(this.animate);
    }

    openNormalizeModal() {
        // Check if any selected files are MP3
        const selectedIndices = Array.from(this.selectedIndices);
        let hasMp3 = false;

        for (const index of selectedIndices) {
            const item = this.files[index];
            const targets = item.isGroup ? item.siblings : [item];

            for (const target of targets) {
                const format = target.metadata.format ? target.metadata.format.toLowerCase() : '';
                if (format.includes('mpeg') || format.includes('mp3')) {
                    hasMp3 = true;
                    break;
                }
            }
            if (hasMp3) break;
        }

        if (hasMp3) {
            alert('MP3 files cannot be normalized. Only WAV and RF64 files are supported for normalization.');
            return;
        }

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
        
        // Setup rename field listeners using shared utility
        this.renameManager.setupRenameFieldListeners('rename', () => {
            this.updateRenamePreview();
        });
        
        this.updateRenamePreview();
    }

    closeRenameModal() {
        document.getElementById('rename-modal').classList.remove('active');
    }

    async updateRenamePreview() {
        if (this.selectedIndices.size === 0) return;

        const firstIndex = this.selectedIndices.values().next().value;
        const file = this.files[firstIndex];
        const config = this.renameManager.getRenameConfig('rename');
        
        await this.renameManager.updateSinglePreview('rename-preview', file, config);
    }

    async applyRename() {
        this.closeRenameModal();
        document.body.style.cursor = 'wait';

        try {
            const config = this.renameManager.getRenameConfig('rename');
            const indices = Array.from(this.selectedIndices);
            
            const result = await this.renameManager.applyRenameToSelected(indices, config);
            const { renamedCount, failedCount } = result;

            // Refresh UI
            const tbody = document.getElementById('file-list-body');
            tbody.innerHTML = '';
            this.files.forEach((file, i) => this.addTableRow(i, file.metadata));
            this.updateSelectionUI();

            // Update player filename display if currently loaded file was renamed
            if (this.currentlyLoadedFileIndex !== null && indices.includes(this.currentlyLoadedFileIndex)) {
                const playerFilename = document.getElementById('player-filename');
                if (playerFilename) {
                    const loadedFile = this.files[this.currentlyLoadedFileIndex];
                    if (loadedFile && loadedFile.metadata) {
                        playerFilename.textContent = loadedFile.metadata.filename;
                    }
                }
            }

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

    async openExportModal() {
        if (this.selectedIndices.size === 0) return;
        const modalHeader = document.querySelector('#export-modal .modal-header h3');
        
        // Check if a region is drawn
        if (this.region.start !== null && this.region.end !== null && this.currentFileMetadata) {
            // Region is drawn - show filename with "Region"
            modalHeader.textContent = `Export ${this.currentFileMetadata.filename} Region`;
        } else {
            // No region drawn - show standard text
            const count = this.selectedIndices.size;
            modalHeader.textContent = count === 1 ? 'Export Mix' : `Export ${count} Files`;
        }

        // Restore last selected mix mode
        const lastMixMode = localStorage.getItem('exportMixMode') || 'current';
        const radioBtn = document.querySelector(`input[name="mix-mode"][value="${lastMixMode}"]`);
        if (radioBtn) radioBtn.checked = true;

        // Check if automation exists in selected files' iXML metadata
        let hasAutomationInFiles = false;
        const selectedFiles = Array.from(this.selectedIndices).map(i => this.files[i]);
        
        for (const item of selectedFiles) {
            try {
                const arrayBuffer = await item.file.arrayBuffer();
                const ixmlString = this.metadataHandler.getIXMLChunk(arrayBuffer);
                
                if (ixmlString) {
                    const mixerData = MixerMetadata.extractFromIXML(ixmlString);
                    if (mixerData && mixerData.channels && mixerData.channels.length > 0) {
                        // Check if any channel has automation data
                        const hasAutoData = mixerData.channels.some(ch =>
                            ch.automation && (
                                (ch.automation.volume && ch.automation.volume.length > 0) ||
                                (ch.automation.pan && ch.automation.pan.length > 0) ||
                                (ch.automation.mute && ch.automation.mute.length > 0)
                            )
                        );
                        if (hasAutoData) {
                            hasAutomationInFiles = true;
                            break;
                        }
                    }
                }
            } catch (err) {
                console.error(`Error checking automation in ${item.metadata.filename}:`, err);
            }
        }

        // Check if automation exists when automation is selected
        document.querySelectorAll('input[name="mix-mode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.value === 'automation') {
                    if (!hasAutomationInFiles) {
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

    openExportTCRangeModal() {
        if (this.selectedIndices.size === 0) {
            alert('Please select one or more files to export a timecode range.');
            return;
        }

        const selectedIndices = Array.from(this.selectedIndices);
        
        // Find the highest (latest) TC Start and earliest end TC across all selected files
        let highestTCStart = null;
        let earliestEndTC = null;
        let highestTCSeconds = -Infinity;
        let earliestEndTCSeconds = Infinity;

        for (const index of selectedIndices) {
            const file = this.files[index];
            const tcStart = file.metadata.tcStart || '00:00:00:00';
            const durationSeconds = this.parseTimecodeToSeconds(file.metadata.duration);
            
            // Convert TC to seconds for comparison
            const tcStartSeconds = this.parseTimecodeToSeconds(tcStart);
            const endTCSeconds = tcStartSeconds + durationSeconds;
            
            if (tcStartSeconds > highestTCSeconds) {
                highestTCSeconds = tcStartSeconds;
                highestTCStart = tcStart;
            }
            
            if (endTCSeconds < earliestEndTCSeconds) {
                earliestEndTCSeconds = endTCSeconds;
                // Calculate end TC from the start of this file
                const tcStartHMS = tcStart ? tcStart.split(':').slice(0, 3).join(':') : '00:00:00';
                earliestEndTC = this.addSecondsToTimecode(tcStartHMS, durationSeconds);
            }
        }

        // Convert to HH:MM:SS format (remove frames if present)
        const startTCHMS = highestTCStart ? highestTCStart.split(':').slice(0, 3).join(':') : '00:00:00';
        const endTCHMS = earliestEndTC || '00:00:00';
        
        document.getElementById('export-tc-start').value = startTCHMS;
        document.getElementById('export-tc-end').value = endTCHMS;
        
        // Store selected file indices for batch processing
        this.exportTCRangeIndices = selectedIndices;
        
        document.getElementById('export-tc-range-modal').classList.add('active');
    }

    closeExportTCRangeModal() {
        document.getElementById('export-tc-range-modal').classList.remove('active');
        this.exportTCRangeIndices = null;
    }

    async handleExport() {
        const format = document.getElementById('export-format').value;
        const mixMode = document.querySelector('input[name="mix-mode"]:checked').value;
        const channelMode = document.getElementById('export-channels').value;
        
        // If a region is drawn, only export the currently displayed file
        // Otherwise, export all selected files
        let selectedFiles;
        if (this.region.start !== null && this.region.end !== null && this.currentFileMetadata) {
            // Region export - only export the currently loaded file
            const currentFileIndex = Array.from(this.selectedIndices).find(i => 
                this.files[i].metadata.filename === this.currentFileMetadata.filename
            );
            selectedFiles = currentFileIndex !== undefined ? [this.files[currentFileIndex]] : [];
        } else {
            // No region - export all selected files
            selectedFiles = Array.from(this.selectedIndices).map(i => this.files[i]);
        }

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
                    buffer = await this.audioEngine.audioCtx.decodeAudioData(arrayBuffer.slice(0));
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

                // Render mix (mono or stereo)
                const renderedBuffer = channelMode === 'mono'
                    ? await this.audioEngine.renderMonoMix(
                        buffer,
                        this.mixer.channels,
                        mixMode,
                        this.mixer.masterFaderLevel
                    )
                    : await this.audioEngine.renderStereoMix(
                        buffer,
                        this.mixer.channels,
                        mixMode,
                        this.mixer.masterFaderLevel
                    );

                // Encode
                let blob;
                let extension = format;

                if (format === 'wav') {
                    const bitDepth = parseInt(document.getElementById('export-bitdepth').value);
                    const originalBuffer = await item.file.arrayBuffer();
                    
                    // Create updated metadata for mix export
                    const mixMetadata = { ...item.metadata };
                    if (exportMetadata) {
                        // Region export - update timeReference
                        mixMetadata.timeReference = exportMetadata.timeReference;
                    }
                    
                    // Update channel count and track names based on actual output
                    const outputChannels = renderedBuffer.numberOfChannels;
                    mixMetadata.channels = outputChannels;
                    if (outputChannels === 1) {
                        mixMetadata.trackNames = ['Mix'];
                    } else if (outputChannels === 2) {
                        mixMetadata.trackNames = ['Mix L', 'Mix R'];
                    }
                    
                    // Flag this as a mix export requiring metadata regeneration
                    mixMetadata.isMixExport = true;
                    
                    const wavBuffer = this.audioProcessor.createWavFile(renderedBuffer, bitDepth, originalBuffer, mixMetadata);
                    
                    blob = new Blob([wavBuffer], { type: 'audio/wav' });
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

            // Show success notification
            if (successCount > 0) {
                this.showToast('Export successful', 'success', 3000);
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

        // Convert seconds to samples
        const samples = Math.floor(seconds * this.currentFileMetadata.sampleRate);

        // Add TC start offset if available
        const tcStartSamples = this.currentFileMetadata.timeReference || 0;
        const totalSamples = samples + tcStartSamples;

        // Get exact FPS fraction or fall back to parsed fps
        let fpsExact = this.currentFileMetadata.fpsExact;
        
        if (!fpsExact) {
            // Create fpsExact from fps string (e.g., "23.976" -> {numerator: 24000, denominator: 1001})
            const fps = parseFloat(this.currentFileMetadata.fps) || 24;
            // Simple approximation for common frame rates
            if (Math.abs(fps - 23.976) < 0.01) {
                fpsExact = { numerator: 24000, denominator: 1001 };
            } else if (Math.abs(fps - 29.97) < 0.01) {
                fpsExact = { numerator: 30000, denominator: 1001 };
            } else if (Math.abs(fps - 59.94) < 0.01) {
                fpsExact = { numerator: 60000, denominator: 1001 };
            } else {
                fpsExact = { numerator: Math.round(fps), denominator: 1 };
            }
        }

        // Convert samples to total frames using exact fraction (matching samplesToTC logic)
        const totalSeconds = totalSamples / this.currentFileMetadata.sampleRate;
        const totalFrames = Math.floor(totalSeconds * fpsExact.numerator / fpsExact.denominator);

        // Calculate timecode components
        const framesPerSecond = Math.round(fpsExact.numerator / fpsExact.denominator);
        const framesPerMinute = framesPerSecond * 60;
        const framesPerHour = framesPerMinute * 60;

        const h = Math.floor(totalFrames / framesPerHour);
        const m = Math.floor((totalFrames % framesPerHour) / framesPerMinute);
        const s = Math.floor((totalFrames % framesPerMinute) / framesPerSecond);
        const f = totalFrames % framesPerSecond;

        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
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
        let siblingGroups = this.files.filter(item => item.isGroup);
        
        // Check if selected individual mono files can be combined
        let monoFileGroups = [];
        if (this.selectedIndices.size >= 2) {
            const selectedFiles = Array.from(this.selectedIndices).map(idx => this.files[idx]);
            const allMono = selectedFiles.every(f => 
                f && 
                !f.isGroup && 
                f.metadata && 
                f.metadata.channels === 1
            );
            
            if (allMono) {
                // Group files by TC Start and audio size
                const groups = new Map();
                selectedFiles.forEach((file, idx) => {
                    const key = `${file.metadata.tcStart}_${file.metadata.audioDataSize}`;
                    if (!groups.has(key)) {
                        groups.set(key, []);
                    }
                    groups.get(key).push({
                        file: file,
                        originalIndex: Array.from(this.selectedIndices)[idx]
                    });
                });
                
                // Only keep groups with 2+ files
                monoFileGroups = Array.from(groups.values())
                    .filter(group => group.length >= 2)
                    .map(group => ({
                        files: group.map(g => g.file),
                        fileIndices: group.map(g => g.originalIndex)
                    }));
            }
        }
        
        // If we have mono file groups, prioritize combining them
        if (monoFileGroups.length > 0) {
            this.combineGroups = monoFileGroups.map((group, groupIndex) => {
                const baseName = this.getCommonBaseName(group.files.map(f => f.metadata.filename));
                
                return {
                    groupIndex: groupIndex,
                    baseName: baseName,
                    siblings: group.files.map((file, index) => ({
                        originalIndex: index,
                        handle: file.handle,
                        file: file.file,
                        metadata: file.metadata,
                        order: index,
                        selected: true
                    })),
                    metadata: { ...group.files[0].metadata },
                    destinationHandle: null,
                    fileIndices: group.fileIndices // Track original indices
                };
            });
        } else if (siblingGroups.length === 0) {
            alert('No sibling file groups detected, and no compatible selected files to combine.');
            return;
        } else {
            // Use existing sibling groups
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
        }

        const container = document.getElementById('combine-groups-container');
        container.innerHTML = '';

        // Render each group
        this.combineGroups.forEach((group, groupIndex) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'combine-group';
            groupDiv.dataset.groupIndex = groupIndex;

            const header = document.createElement('div');
            header.className = 'combine-group-header';
            header.innerHTML = `
                <div class="combine-group-info">
                    ${group.siblings.length} files • 
                    ${group.metadata.sampleRate / 1000}kHz • 
                    ${group.metadata.bitDepth}-bit • 
                    ${group.metadata.duration}
                </div>
                <div class="combine-filename-preview" data-group-index="${groupIndex}" style="margin-top: 0.5em; padding: 0.5em; background: var(--bg-primary); border-radius: 4px; font-family: monospace; font-size: 0.9em; color: var(--accent-primary);">
                    Output: <span class="preview-name">Loading...</span>
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
            
            const selectionInfo = document.createElement('div');
            selectionInfo.className = 'combine-selection-info';
            selectionInfo.innerHTML = `
                Selected: <span class="selected-count">${group.siblings.length}</span> / ${group.siblings.length} files
            `;
            
            destination.appendChild(selectionInfo);

            groupDiv.appendChild(header);
            groupDiv.appendChild(fileList);
            groupDiv.appendChild(destination);
            container.appendChild(groupDiv);
        });

        // Initialize custom text field visibility based on selected values
        ['combine-rename-field1', 'combine-rename-field2', 'combine-rename-field3'].forEach((fieldId, index) => {
            const customIndex = index + 1;
            const field = document.getElementById(fieldId);
            const customInput = document.getElementById(`combine-rename-custom${customIndex}`);
            if (field.value === 'custom') {
                customInput.style.display = 'inline-block';
            } else {
                customInput.style.display = 'none';
            }
        });

        // Reset destination handle
        this.combineDestinationHandle = null;
        document.getElementById('combine-dest-path').textContent = 'Same as source files';
        document.getElementById('combine-dest-path').style.color = 'var(--text-muted)';

        // Update filename previews
        this.updateCombineFilenamePreviews();

        const modal = document.getElementById('combine-modal');
        modal.classList.add('active');
    }

    /**
     * Update filename previews for all groups in combine modal
     */
    async updateCombineFilenamePreviews() {
        if (!this.combineGroups || this.combineGroups.length === 0) {
            return;
        }

        // Get current config using RenameManager
        const config = this.renameManager.getRenameConfig('combine-rename');
        
        // Update each group's preview
        for (let groupIndex = 0; groupIndex < this.combineGroups.length; groupIndex++) {
            const group = this.combineGroups[groupIndex];
            const previewElement = document.querySelector(`.combine-filename-preview[data-group-index="${groupIndex}"] .preview-name`);
            if (!previewElement) continue;

            // Create metadata for poly file
            const polyMetadata = {
                ...group.metadata,
                channels: group.siblings.length
            };

            // Generate preview filename using RenameManager (await the Promise)
            const filename = await this.renameManager.generatePreviewFilename(polyMetadata, config, '');

            previewElement.textContent = filename;
        }
    }

    /**
     * Get common base name from file list
     */
    getCommonBaseName(filenames) {
        if (filenames.length === 0) return 'combined';
        
        // Remove file extensions
        const names = filenames.map(f => f.replace(/\.[^/.]+$/, ''));
        
        // Find common prefix before any underscore or suffix pattern
        let commonBase = names[0];
        
        for (const name of names.slice(1)) {
            while (commonBase.length > 0 && !name.startsWith(commonBase)) {
                commonBase = commonBase.slice(0, -1);
            }
        }
        
        // Remove trailing underscore if present
        commonBase = commonBase.replace(/_+$/, '');
        
        return commonBase || 'combined';
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

        // Validate that groups still exist (either as sibling groups or as valid individual files)
        const currentSiblingGroups = this.files.filter(item => item.isGroup);
        const hasValidGroups = this.combineGroups.every(group => {
            // If group has fileIndices, it's from selected individual mono files - validate they still exist
            if (group.fileIndices) {
                return group.fileIndices.every(idx => 
                    idx < this.files.length && 
                    this.files[idx] && 
                    !this.files[idx].isGroup &&
                    this.files[idx].metadata.channels === 1
                );
            }
            // Otherwise, it's a sibling group - check if it exists
            return currentSiblingGroups.some(sg => 
                sg.metadata.filename.replace(/_X\.wav$/, '') === group.baseName
            );
        });
        
        if (!hasValidGroups) {
            console.error('One or more combine groups are no longer valid');
            alert('Files may have been modified. Please close and reopen the Combine modal.');
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
            
            // Output filename will be generated using the shared format, not stored here
        });

        // Get shared destination handle
        let destinationHandle;
        try {
            destinationHandle = await this.getOrPickDirectory(this.combineDestinationHandle);
        } catch (err) {
            return; // User cancelled
        }
        
        // Collect filename format settings from modal using RenameManager
        const renameConfig = this.renameManager.getRenameConfig('combine-rename');
        renameConfig.outputDirHandle = destinationHandle;

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
                    channels: group.siblings.length,
                    trackNames: trackNames
                };

                // Generate output filename using RenameManager
                const outputFilename = await this.renameManager.generatePreviewFilename(
                    polyMetadata,
                    renameConfig,
                    '' // no track suffix for poly files
                );

                // Update metadata with generated filename
                polyMetadata.filename = outputFilename;

                // Add metadata to combined file
                const combinedArrayBuffer = await combinedBlob.arrayBuffer();
                const finalBlob = await this.metadataHandler.saveWav(
                    { arrayBuffer: async () => combinedArrayBuffer },
                    polyMetadata
                );

                // Save file to destination directory
                const suggestedName = outputFilename;
                let handle;
                
                try {
                    // destinationHandle is guaranteed to be set (was asked for at start if needed)
                    const uniqueFileName = await this.getUniqueFileNameWithParens(destinationHandle, suggestedName);
                    handle = await destinationHandle.getFileHandle(uniqueFileName, { create: true });
                    
                    const writable = await handle.createWritable();
                    await writable.write(finalBlob);
                    await writable.close();

                    console.log(`✓ Combined file saved: ${outputFilename}`);

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
        // Get the selected poly files
        if (this.selectedIndices.size === 0) {
            alert('Please select one or more poly files to split.');
            return;
        }

        // Get all selected poly files
        const polyFiles = [];
        for (const index of this.selectedIndices) {
            const file = this.files[index];
            if (file && file.metadata && file.metadata.channels > 1) {
                polyFiles.push({
                    index,
                    file: file.file,
                    handle: file.handle,
                    metadata: file.metadata
                });
            }
        }

        if (polyFiles.length === 0) {
            alert('Please select one or more poly files (files with channels > 1).');
            return;
        }

        // Store the files to split
        this.splitFileData = {
            files: polyFiles,
            destinationHandle: null,
            currentFileIndex: 0
        };

        // Update modal info
        const fileCount = polyFiles.length;
        const fileList = polyFiles.map(f => f.metadata.filename).join(', ');
        document.getElementById('split-filename').textContent = fileCount === 1 
            ? polyFiles[0].metadata.filename 
            : `${fileCount} files: ${fileList}`;
        // Show 'Same as source files' if no folder is selected
        document.getElementById('split-folder-path').textContent = 'Same as source files';
        document.getElementById('split-confirm-btn').disabled = false;

        // Update bit depth selector to show first file's bit depth
        const bitDepthSelect = document.getElementById('split-bitdepth');
        const firstFile = polyFiles[0];
        if (firstFile.metadata.bitDepth) {
            // Check if source bit depth is an option
            let hasMatch = false;
            for (const option of bitDepthSelect.options) {
                if (option.value === firstFile.metadata.bitDepth.toString()) {
                    hasMatch = true;
                    break;
                }
            }
            // If not matched, keep on "Preserve Original"
            bitDepthSelect.value = hasMatch ? firstFile.metadata.bitDepth.toString() : 'preserve';
        } else {
            bitDepthSelect.value = 'preserve';
        }

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
        const dirHandle = await this.pickDirectory();
        if (dirHandle) {
            this.splitFileData.destinationHandle = dirHandle;
            document.getElementById('split-folder-path').textContent = dirHandle.name;
            document.getElementById('split-confirm-btn').disabled = false;
        } else {
            // User cancelled - revert to 'Same as source files'
            this.splitFileData.destinationHandle = null;
            document.getElementById('split-folder-path').textContent = 'Same as source files';
            document.getElementById('split-confirm-btn').disabled = false;
        }
    }

    /**
     * Process split operation
     */
    async processSplitFile() {
        if (!this.splitFileData) {
            alert('No split data available.');
            return;
        }

        try {
            document.body.style.cursor = 'wait';
            const { files, destinationHandle } = this.splitFileData;
            const totalFiles = files.length;
            let successCount = 0;

            // If "Same as source files" mode, ask user once before processing all files
            let defaultSaveDirectory;
            try {
                defaultSaveDirectory = await this.getOrPickDirectory(destinationHandle);
            } catch (err) {
                return; // User cancelled
            }

            // Process each poly file
            for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
                const fileData = files[fileIdx];
                const { file, handle, metadata } = fileData;
                
                this.showToast(`Splitting file ${fileIdx + 1}/${totalFiles}: ${metadata.filename}...`, 'info', 1000);

                // Get selected bit depth from modal
                const bitDepthSelect = document.getElementById('split-bitdepth');
                let bitDepth = 16; // Default fallback
                if (bitDepthSelect.value === 'preserve') {
                    bitDepth = metadata.bitDepth || 16;
                } else {
                    bitDepth = parseInt(bitDepthSelect.value);
                }

                const channels = metadata.channels;

                // Read the original file
                const arrayBuffer = await file.arrayBuffer();
                
                // Get track names from iXML BEFORE decoding (decoding detaches the buffer)
                let trackNames = [];
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
                

                
                // If iXML track names are missing or all the same, try bEXT as fallback
                const allTrackNamesSame = trackNames.length > 0 && trackNames.every(name => name === trackNames[0]);
                if (trackNames.length === 0 || allTrackNamesSame) {
                    console.log('[Split] Track names are missing or identical, checking bEXT for identifiers');
                    const bextTrackNames = this.metadataHandler.extractTrackNamesFromBext(metadata.description);
                    if (bextTrackNames.length > 0) {
                        trackNames = bextTrackNames;
                        console.log('[Split] Using track names from bEXT:', trackNames);
                    }
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
                    
                    const monoChannelData = monoBuffer.getChannelData(0);

                    
                    // Check if data is all zeros (silence)
                    const hasAudio = channelData.some(s => Math.abs(s) > 0.0001);

                    // Get track name for metadata (not used in filename)
                    let trackName = trackNames[ch];
                    if (!trackName) {
                        // No track name in iXML for this channel, use Ch# format
                        trackName = `Ch${ch + 1}`;
                    }

                    // Generate filename with numeric suffix (1-indexed)
                    // Track name is preserved in metadata, not in filename
                    const outputFilename = `${baseName}_${ch + 1}.wav`;
                    
                    // Calculate stats before encoding (avoid spread operator on large arrays to prevent stack overflow)
                    let minVal = Infinity, maxVal = -Infinity, sumSquares = 0;
                    for (let i = 0; i < monoChannelData.length; i++) {
                        const sample = monoChannelData[i];
                        minVal = Math.min(minVal, sample);
                        maxVal = Math.max(maxVal, sample);
                        sumSquares += sample * sample;
                    }
                    const monoStats = {
                        length: monoChannelData.length,
                        min: minVal,
                        max: maxVal,
                        rms: Math.sqrt(sumSquares / monoChannelData.length)
                    };
                    
                    // Prepare metadata for the mono split file
                    const splitMetadata = {
                        ...metadata,
                        channels: 1,
                        trackNames: [trackName],
                        bitDepth: bitDepth
                    };
                    
                    // Create WAV file using audioProcessor
                    const wavArrayBuffer = this.audioProcessor.createWavFile(monoBuffer, bitDepth, null, splitMetadata);

                    // Convert to mutable copy for chunk injection
                    let wavBuffer = new Uint8Array(wavArrayBuffer);

                    // Add iXML metadata with correct track name
                    if (ixmlString) {
                        const updatedIXML = this.metadataHandler.updateIXMLForMonoTrack(ixmlString, ch, trackName);
                        wavBuffer = new Uint8Array(this.metadataHandler.injectIXMLChunk(wavBuffer.buffer, updatedIXML));
                    }

                    // Add bEXT metadata - preserve original description fields and update track name
                    let bextDescription = metadata.description || '';
                    
                    // Update sTRK1 to the current track's name (mono file only has one track)
                    // Remove all sTRKx fields from original description
                    bextDescription = bextDescription.replace(/sTRK\d+=[^\r\n]*/g, '').trim();
                    
                    // Add single sTRK1 field for this mono track
                    if (bextDescription) {
                        bextDescription += '\nsTRK1=' + trackName;
                    } else {
                        bextDescription = 'sTRK1=' + trackName;
                    }
                    
                    const bextData = {
                        description: bextDescription,
                        originator: metadata.originator || '',
                        originatorReference: metadata.originatorReference || '',
                        originationDate: metadata.originationDate || '',
                        originationTime: metadata.originationTime || '',
                        timeReference: metadata.timeReference || 0
                    };
                    wavBuffer = new Uint8Array(this.metadataHandler.injectBextChunk(wavBuffer.buffer, bextData));


                    // Write file to destination
                    let fileHandle;
                    if (defaultSaveDirectory) {
                        // Save to selected/determined directory
                        fileHandle = await defaultSaveDirectory.getFileHandle(outputFilename, { create: true });
                    }
                    
                    const writable = await fileHandle.createWritable();
                    await writable.write(wavBuffer);
                    await writable.close();
                }
                
                successCount++;
            }

            this.showToast(`Successfully split ${successCount}/${totalFiles} file${totalFiles > 1 ? 's' : ''} into mono files`, 'success', 3000);
            this.closeSplitModal();

        } catch (err) {
            console.error('Error splitting file:', err);
            this.showToast(`Error during split: ${err.message}`, 'error', 3000);
        } finally {
            document.body.style.cursor = 'default';
        }
    }

    /**
     * Update iXML to contain only the track info for a specific channel
     */
    resetFaderHeights(height = 100) {
        const mixerContainer = document.getElementById('mixer-container');
        if (!mixerContainer) return;

        const faderContainers = mixerContainer.querySelectorAll('.fader-container');
        const meterScales = mixerContainer.querySelectorAll('.meter-scale');
        const masterMeterCanvases = mixerContainer.querySelectorAll('.master-meter-left, .master-meter-right');

        faderContainers.forEach(el => {
            el.style.setProperty('height', `${height}px`, 'important');
        });

        meterScales.forEach(el => {
            el.style.setProperty('height', `${height}px`, 'important');
        });

        masterMeterCanvases.forEach(el => {
            el.style.setProperty('height', `${height}px`, 'important');
        });
    }

    initFaderResizeDivider() {
        const divider = document.getElementById('fader-resize-divider');
        const mixerContainer = document.getElementById('mixer-container');
        if (!divider || !mixerContainer) return;

        let isResizing = false;
        let startY = 0;
        let startHeight = 100;

        divider.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = parseInt(getComputedStyle(mixerContainer.querySelector('.fader-container')).height) || 160;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const deltaY = e.clientY - startY;
            let newHeight = startHeight - deltaY;

            // Clamp between 100px and 300px
            newHeight = Math.max(100, Math.min(300, newHeight));

            // Update all fader heights
            this.resetFaderHeights(newHeight);
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = 'auto';
            }
        });
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
});

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
