/**
 * Cue Marker Module
 * Handles cue marker data structures, validation, and collection management
 */

// Constants
const MAX_MARKERS = 100;
const MAX_LABEL_LENGTH = 64;
const PROXIMITY_THRESHOLD_PX = 8; // pixels for click detection

/**
 * Individual Cue Marker
 */
export class CueMarker {
    constructor(id, time, label = '') {
        this.id = id; // Unique identifier
        this.time = time; // Position in seconds
        this.label = label.substring(0, MAX_LABEL_LENGTH); // Enforce max length
    }

    /**
     * Update marker label
     */
    setLabel(newLabel) {
        this.label = newLabel.substring(0, MAX_LABEL_LENGTH);
    }

    /**
     * Update marker time position
     */
    setTime(newTime) {
        this.time = Math.max(0, newTime);
    }
}

/**
 * Collection of Cue Markers with management methods
 */
export class CueMarkerCollection {
    constructor() {
        this.markers = []; // Array of CueMarker objects
        this.nextId = 1;
    }

    /**
     * Add a new marker
     * @param {number} time - Time in seconds
     * @param {string} label - Optional label
     * @returns {number} - ID of created marker
     */
    add(time, label = '') {
        if (this.markers.length >= MAX_MARKERS) {
            console.warn(`Cannot add marker: Maximum ${MAX_MARKERS} markers reached`);
            return null;
        }

        const id = this.nextId++;
        const marker = new CueMarker(id, time, label);
        this.markers.push(marker);
        
        // Keep sorted by time
        this.markers.sort((a, b) => a.time - b.time);
        
        console.log(`Added cue marker #${id} at ${time.toFixed(3)}s`);
        return id;
    }

    /**
     * Remove a marker by ID
     * @param {number} id - Marker ID
     * @returns {boolean} - Success status
     */
    remove(id) {
        const index = this.markers.findIndex(m => m.id === id);
        if (index === -1) {
            console.warn(`Cannot remove marker: ID ${id} not found`);
            return false;
        }

        this.markers.splice(index, 1);
        console.log(`Removed cue marker #${id}`);
        return true;
    }

    /**
     * Update marker label
     * @param {number} id - Marker ID
     * @param {string} label - New label
     * @returns {boolean} - Success status
     */
    updateLabel(id, label) {
        const marker = this.findById(id);
        if (!marker) {
            console.warn(`Cannot update label: ID ${id} not found`);
            return false;
        }

        marker.setLabel(label);
        console.log(`Updated marker #${id} label to "${label}"`);
        return true;
    }

    /**
     * Update marker time position
     * @param {number} id - Marker ID
     * @param {number} time - New time in seconds
     * @returns {boolean} - Success status
     */
    updateTime(id, time) {
        const marker = this.findById(id);
        if (!marker) {
            console.warn(`Cannot update time: ID ${id} not found`);
            return false;
        }

        marker.setTime(time);
        
        // Re-sort after time change
        this.markers.sort((a, b) => a.time - b.time);
        
        console.log(`Updated marker #${id} time to ${time.toFixed(3)}s`);
        return true;
    }

    /**
     * Find marker by ID
     * @param {number} id - Marker ID
     * @returns {CueMarker|null}
     */
    findById(id) {
        return this.markers.find(m => m.id === id) || null;
    }

    /**
     * Find marker nearest to a time position
     * @param {number} time - Time in seconds
     * @param {number} threshold - Maximum distance in seconds (default 0.05s)
     * @returns {CueMarker|null}
     */
    findNearestToTime(time, threshold = 0.05) {
        if (this.markers.length === 0) return null;

        let nearest = null;
        let minDistance = Infinity;

        for (const marker of this.markers) {
            const distance = Math.abs(marker.time - time);
            if (distance < minDistance && distance <= threshold) {
                minDistance = distance;
                nearest = marker;
            }
        }

        return nearest;
    }

    /**
     * Find marker at pixel position on canvas
     * @param {number} canvasX - X position in pixels
     * @param {number} canvasWidth - Canvas width in pixels
     * @param {number} duration - Audio duration in seconds
     * @returns {CueMarker|null}
     */
    findAtCanvasPosition(canvasX, canvasWidth, duration) {
        if (this.markers.length === 0 || !duration) return null;

        const clickTime = (canvasX / canvasWidth) * duration;
        const timeThreshold = (PROXIMITY_THRESHOLD_PX / canvasWidth) * duration;

        return this.findNearestToTime(clickTime, timeThreshold);
    }

    /**
     * Get next marker after current time
     * @param {number} currentTime - Current playhead time
     * @returns {CueMarker|null}
     */
    getNextMarker(currentTime) {
        // Find first marker after current time (with small epsilon for exact matches)
        const epsilon = 0.001; // 1ms tolerance
        return this.markers.find(m => m.time > currentTime + epsilon) || null;
    }

    /**
     * Get previous marker before current time
     * @param {number} currentTime - Current playhead time
     * @returns {CueMarker|null}
     */
    getPreviousMarker(currentTime) {
        // Find last marker before current time (with small epsilon for exact matches)
        const epsilon = 0.001; // 1ms tolerance
        const filtered = this.markers.filter(m => m.time < currentTime - epsilon);
        return filtered.length > 0 ? filtered[filtered.length - 1] : null;
    }

    /**
     * Get all markers sorted by time
     * @returns {CueMarker[]}
     */
    getAllSorted() {
        // Already maintained in sorted order, but ensure it
        return [...this.markers].sort((a, b) => a.time - b.time);
    }

    /**
     * Clear all markers
     */
    clear() {
        this.markers = [];
        this.nextId = 1;
        console.log('Cleared all cue markers');
    }

    /**
     * Get marker count
     * @returns {number}
     */
    count() {
        return this.markers.length;
    }

    /**
     * Check if collection is at maximum capacity
     * @returns {boolean}
     */
    isFull() {
        return this.markers.length >= MAX_MARKERS;
    }

    /**
     * Validate collection state
     * @returns {object} - Validation result {valid: boolean, errors: string[]}
     */
    validate() {
        const errors = [];

        // Check marker count
        if (this.markers.length > MAX_MARKERS) {
            errors.push(`Too many markers: ${this.markers.length} (max ${MAX_MARKERS})`);
        }

        // Check each marker
        this.markers.forEach((marker, index) => {
            if (!marker.id) {
                errors.push(`Marker at index ${index} has no ID`);
            }
            if (typeof marker.time !== 'number' || marker.time < 0) {
                errors.push(`Marker #${marker.id} has invalid time: ${marker.time}`);
            }
            if (marker.label.length > MAX_LABEL_LENGTH) {
                errors.push(`Marker #${marker.id} label exceeds ${MAX_LABEL_LENGTH} characters`);
            }
        });

        // Check for duplicate IDs
        const ids = this.markers.map(m => m.id);
        const uniqueIds = new Set(ids);
        if (ids.length !== uniqueIds.size) {
            errors.push('Duplicate marker IDs detected');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Export markers to plain object array (for serialization)
     * @returns {Array}
     */
    toArray() {
        return this.markers.map(m => ({
            id: m.id,
            time: m.time,
            label: m.label
        }));
    }

    /**
     * Import markers from plain object array
     * @param {Array} data - Array of marker objects
     */
    fromArray(data) {
        this.clear();
        
        if (!Array.isArray(data)) {
            console.warn('Invalid data for marker import');
            return;
        }

        data.forEach(item => {
            if (typeof item.time === 'number' && item.time >= 0) {
                const id = this.nextId++;
                const marker = new CueMarker(id, item.time, item.label || '');
                this.markers.push(marker);
            }
        });

        // Ensure sorted
        this.markers.sort((a, b) => a.time - b.time);
        
        console.log(`Imported ${this.markers.length} cue markers`);
    }
}

/**
 * Utility: Convert time to pixel position on canvas
 * @param {number} time - Time in seconds
 * @param {number} duration - Total duration in seconds
 * @param {number} canvasWidth - Canvas width in pixels
 * @returns {number} - X position in pixels
 */
export function timeToCanvasX(time, duration, canvasWidth) {
    if (!duration || duration === 0) return 0;
    return (time / duration) * canvasWidth;
}

/**
 * Utility: Convert pixel position to time
 * @param {number} canvasX - X position in pixels
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} duration - Total duration in seconds
 * @returns {number} - Time in seconds
 */
export function canvasXToTime(canvasX, canvasWidth, duration) {
    if (!canvasWidth || canvasWidth === 0) return 0;
    return (canvasX / canvasWidth) * duration;
}
