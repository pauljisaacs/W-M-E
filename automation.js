/**
 * Automation - Handle recording and playback of fader automation
 */

export class AutomationRecorder {
    constructor(channelIndex, parameter = 'volume') {
        this.channelIndex = channelIndex;
        this.parameter = parameter;
        this.points = [];
        this.isRecording = false;
        this.startTime = 0;
    }

    start(currentTime) {
        this.isRecording = true;
        this.points = [];
        this.startTime = currentTime;
    }

    recordPoint(currentTime, value) {
        if (!this.isRecording) return;

        const relativeTime = currentTime - this.startTime;
        this.points.push({ time: relativeTime, value });
    }

    stop() {
        this.isRecording = false;
        // Simplify automation using Douglas-Peucker algorithm
        const simplified = this.simplifyAutomation(this.points, 0.01);
        console.log(`Automation recorded: ${this.points.length} points → ${simplified.length} points after simplification`);
        return simplified;
    }

    /**
     * Douglas-Peucker algorithm for curve simplification
     * @param {Array} points - Array of {time, value} points
     * @param {number} tolerance - Maximum deviation allowed (0.01 = 1%)
     * @returns {Array} Simplified points
     */
    simplifyAutomation(points, tolerance) {
        if (points.length <= 2) return points;

        // Find point with maximum distance from line between first and last
        let maxDistance = 0;
        let maxIndex = 0;
        const first = points[0];
        const last = points[points.length - 1];

        for (let i = 1; i < points.length - 1; i++) {
            const distance = this.perpendicularDistance(points[i], first, last);
            if (distance > maxDistance) {
                maxDistance = distance;
                maxIndex = i;
            }
        }

        // If max distance is greater than tolerance, recursively simplify
        if (maxDistance > tolerance) {
            const left = this.simplifyAutomation(points.slice(0, maxIndex + 1), tolerance);
            const right = this.simplifyAutomation(points.slice(maxIndex), tolerance);

            // Combine results (remove duplicate middle point)
            return left.slice(0, -1).concat(right);
        } else {
            // All points are within tolerance, just keep first and last
            return [first, last];
        }
    }

    /**
     * Calculate perpendicular distance from point to line
     */
    perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.time - lineStart.time;
        const dy = lineEnd.value - lineStart.value;

        if (dx === 0 && dy === 0) {
            // Line is a point
            return Math.abs(point.value - lineStart.value);
        }

        // Calculate perpendicular distance
        const numerator = Math.abs(
            dy * point.time - dx * point.value +
            lineEnd.time * lineStart.value -
            lineEnd.value * lineStart.time
        );
        const denominator = Math.sqrt(dx * dx + dy * dy);

        return numerator / denominator;
    }
}

export class AutomationPlayer {
    constructor(automationData) {
        this.points = automationData || [];
        this.isEnabled = true;
    }

    /**
     * Get interpolated value at given time
     * @param {number} currentTime - Current playback time in seconds
     * @returns {number|null} Interpolated value or null if no automation
     */
    getValue(currentTime) {
        if (!this.isEnabled || this.points.length === 0) return null;

        // Before first point
        if (currentTime < this.points[0].time) {
            return this.points[0].value;
        }

        // After last point
        if (currentTime > this.points[this.points.length - 1].time) {
            return this.points[this.points.length - 1].value;
        }

        // Find surrounding points
        for (let i = 0; i < this.points.length - 1; i++) {
            if (this.points[i].time <= currentTime && this.points[i + 1].time >= currentTime) {
                // Linear interpolation
                const t = (currentTime - this.points[i].time) /
                    (this.points[i + 1].time - this.points[i].time);
                return this.points[i].value + (this.points[i + 1].value - this.points[i].value) * t;
            }
        }

        return null;
    }

    setEnabled(enabled) {
        this.isEnabled = enabled;
    }

    hasAutomation() {
        return this.points.length > 0;
    }

    clear() {
        this.points = [];
    }
}
