/**
 * RenameManager - Shared utilities for file renaming across modals
 * Handles: Dedicated Rename Modal, Multi-Process Rename, Combine Modal Rename
 */
class RenameManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * Setup event listeners for rename fields in any modal
     * @param {string} fieldPrefix - ID prefix for fields (e.g., 'rename', 'mp-rename', 'combine-rename')
     * @param {Function} onUpdateCallback - Callback when fields change
     */
    setupRenameFieldListeners(fieldPrefix, onUpdateCallback) {
        const field1 = document.getElementById(`${fieldPrefix}-field1`);
        const field2 = document.getElementById(`${fieldPrefix}-field2`);
        const field3 = document.getElementById(`${fieldPrefix}-field3`);
        const custom1 = document.getElementById(`${fieldPrefix}-custom1`);
        const custom2 = document.getElementById(`${fieldPrefix}-custom2`);
        const custom3 = document.getElementById(`${fieldPrefix}-custom3`);
        const separator1 = document.getElementById(`${fieldPrefix}-separator1`);
        const separator2 = document.getElementById(`${fieldPrefix}-separator2`);

        // Handle custom field visibility
        const updateCustomFieldVisibility = () => {
            if (custom1) custom1.style.display = field1?.value === 'custom' ? 'block' : 'none';
            if (custom2) custom2.style.display = field2?.value === 'custom' ? 'block' : 'none';
            if (custom3) custom3.style.display = field3?.value === 'custom' ? 'block' : 'none';
        };

        // Attach listeners
        [field1, field2, field3].forEach(field => {
            if (field) {
                field.addEventListener('change', () => {
                    updateCustomFieldVisibility();
                    if (onUpdateCallback) onUpdateCallback();
                });
            }
        });

        [custom1, custom2, custom3].forEach(input => {
            if (input) {
                input.addEventListener('input', () => {
                    if (onUpdateCallback) onUpdateCallback();
                });
            }
        });

        [separator1, separator2].forEach(sep => {
            if (sep) {
                sep.addEventListener('change', () => {
                    if (onUpdateCallback) onUpdateCallback();
                });
            }
        });

        // Initialize visibility
        updateCustomFieldVisibility();
    }

    /**
     * Get rename configuration from modal fields
     * @param {string} fieldPrefix - ID prefix for fields
     * @returns {Object} Configuration object
     */
    getRenameConfig(fieldPrefix) {
        return {
            field1: document.getElementById(`${fieldPrefix}-field1`)?.value || 'none',
            field2: document.getElementById(`${fieldPrefix}-field2`)?.value || 'none',
            field3: document.getElementById(`${fieldPrefix}-field3`)?.value || 'none',
            separator1: document.getElementById(`${fieldPrefix}-separator1`)?.value || '',
            separator2: document.getElementById(`${fieldPrefix}-separator2`)?.value || '',
            custom1: document.getElementById(`${fieldPrefix}-custom1`)?.value || '',
            custom2: document.getElementById(`${fieldPrefix}-custom2`)?.value || '',
            custom3: document.getElementById(`${fieldPrefix}-custom3`)?.value || ''
        };
    }

    /**
     * Generate preview filename for a single file
     * @param {Object} metadata - File metadata
     * @param {Object} config - Rename configuration
     * @param {string} trackSuffix - Optional track suffix (e.g., '_1', '_2')
     * @returns {Promise<string>} Generated filename
     */
    async generatePreviewFilename(metadata, config, trackSuffix = '') {
        return await this.app.generateFlexibleFilename(
            metadata,
            config.field1,
            config.field2,
            config.field3,
            config.separator1,
            config.separator2,
            config.custom1,
            config.custom2,
            config.custom3,
            trackSuffix
        );
    }

    /**
     * Update preview display for a single file
     * @param {string} previewElementId - ID of preview element
     * @param {Object} fileOrMetadata - File object or metadata
     * @param {Object} config - Rename configuration
     */
    async updateSinglePreview(previewElementId, fileOrMetadata, config) {
        const previewElement = document.getElementById(previewElementId);
        if (!previewElement) return;

        const metadata = fileOrMetadata.metadata || fileOrMetadata;
        
        // Extract track suffix if present
        const originalName = metadata.filename || '';
        const trackSuffixMatch = originalName.match(/(_\d+)\.wav$/);
        const trackSuffix = trackSuffixMatch ? trackSuffixMatch[1] : '';

        const newName = await this.generatePreviewFilename(metadata, config, trackSuffix);
        previewElement.textContent = newName;
    }

    /**
     * Update multiple previews (for Combine modal)
     * @param {string} containerSelector - CSS selector for preview container
     * @param {Array} files - Array of file objects
     * @param {Object} config - Rename configuration
     */
    async updateMultiplePreviews(containerSelector, files, config) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const previewElements = container.querySelectorAll('.combine-file-preview');
        
        for (let i = 0; i < previewElements.length && i < files.length; i++) {
            const file = files[i];
            const metadata = file.metadata || file;
            
            // For combine modal, files don't have track suffixes yet
            const newName = await this.generatePreviewFilename(metadata, config, '');
            previewElements[i].textContent = newName;
        }
    }

    /**
     * Validate rename configuration
     * @param {Object} config - Rename configuration
     * @returns {boolean} True if valid
     */
    validateRenameConfig(config) {
        // At least one field must be set (not 'none')
        const hasField = config.field1 !== 'none' || 
                        config.field2 !== 'none' || 
                        config.field3 !== 'none';
        
        // If custom is selected, ensure text is provided
        if (config.field1 === 'custom' && !config.custom1) return false;
        if (config.field2 === 'custom' && !config.custom2) return false;
        if (config.field3 === 'custom' && !config.custom3) return false;

        return hasField;
    }

    /**
     * Apply rename to a single file
     * @param {Object} targetItem - File item with handle and metadata
     * @param {Object} config - Rename configuration
     * @param {string} trackSuffix - Optional track suffix
     * @returns {Promise<Object>} Result object {success, newName, error}
     */
    async renameSingleFile(targetItem, config, trackSuffix = '') {
        try {
            const originalName = targetItem.metadata.filename;
            
            const newName = await this.generatePreviewFilename(
                targetItem.metadata,
                config,
                trackSuffix
            );

            if (originalName === newName) {
                return { success: true, skipped: true, newName };
            }

            console.log(`Renaming ${originalName} to ${newName}`);

            if (targetItem.handle && targetItem.handle.move) {
                await targetItem.handle.move(newName);
                targetItem.metadata.filename = newName;
                targetItem.file = await targetItem.handle.getFile();
                return { success: true, newName };
            } else {
                return { 
                    success: false, 
                    error: 'File System Access API "move" not supported',
                    newName 
                };
            }
        } catch (err) {
            console.error('Rename failed:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Apply rename to selected files (for Dedicated Rename Modal)
     * @param {Array<number>} selectedIndices - Array of file indices
     * @param {Object} config - Rename configuration
     * @returns {Promise<Object>} Result summary {renamedCount, failedCount}
     */
    async applyRenameToSelected(selectedIndices, config) {
        let renamedCount = 0;
        let failedCount = 0;
        const renamedIndices = new Set();

        for (const index of selectedIndices) {
            const item = this.app.files[index];
            
            // Determine which files to rename: if it's a group, rename all siblings
            const targetFiles = item.isGroup ? item.siblings : [item];

            for (const targetItem of targetFiles) {
                // Extract track suffix from original filename
                const originalName = targetItem.metadata.filename;
                const trackSuffixMatch = originalName.match(/(_\d+)\.wav$/);
                const trackSuffix = trackSuffixMatch ? trackSuffixMatch[1] : '';

                const result = await this.renameSingleFile(targetItem, config, trackSuffix);
                
                if (result.success && !result.skipped) {
                    renamedCount++;
                    renamedIndices.add(this.app.files.indexOf(targetItem));
                } else if (!result.success) {
                    failedCount++;
                }
            }
            
            // Update representative metadata for groups
            if (item.isGroup && item.siblings && item.siblings.length > 0) {
                const firstSiblingFilename = item.siblings[0].metadata.filename;
                const baseNameMatch = firstSiblingFilename.match(/^(.+?)(_\d+)?\.wav$/);
                const newBaseName = baseNameMatch ? baseNameMatch[1] : firstSiblingFilename.replace(/\.wav$/, '');
                item.metadata.filename = `${newBaseName}_X.wav`;
            }
        }

        return { renamedCount, failedCount, renamedIndices };
    }
}

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RenameManager;
}
