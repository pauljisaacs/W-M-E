/**
 * MixerMetadata - Handle serialization and parsing of mixer settings to/from iXML
 * 
 * Schema Version 1.0:
 * - Static channel settings: volume, pan, mute, solo
 * 
 * Future versions will support:
 * - Automation (time-based parameter changes)
 * - EQ settings per channel
 */

export class MixerMetadata {
    static VERSION = "1.0";
    static NAMESPACE = "http://wav-metadata-editor/mixer/1.0";

    /**
     * Serialize mixer channels to XML string
     * @param {Array} channels - Array of channel objects from mixer
     * @returns {string} XML string for MIXER_SETTINGS element
     */
    static serializeToXML(channels) {
        let xml = `<MIXER_SETTINGS xmlns="${this.NAMESPACE}" version="${this.VERSION}">\n`;

        channels.forEach((ch, index) => {
            xml += `  <CHANNEL index="${index}">\n`;
            xml += `    <VOLUME>${ch.volume.toFixed(4)}</VOLUME>\n`;
            xml += `    <PAN>${(ch.panNode ? ch.panNode.pan.value : 0).toFixed(4)}</PAN>\n`;
            xml += `    <MUTE>${ch.isMuted}</MUTE>\n`;
            xml += `    <SOLO>${ch.isSoloed}</SOLO>\n`;
            // Future: Add AUTOMATION and EQ elements here
            xml += `  </CHANNEL>\n`;
        });

        xml += `</MIXER_SETTINGS>`;
        return xml;
    }

    /**
     * Parse MIXER_SETTINGS XML and extract channel data
     * @param {string} xmlString - XML string containing MIXER_SETTINGS
     * @returns {Object|null} { version, channels: [...] } or null if not found
     */
    static parseFromXML(xmlString) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

            // Check for parse errors
            if (xmlDoc.querySelector('parsererror')) {
                console.error('XML parse error');
                return null;
            }

            const mixerSettings = xmlDoc.querySelector('MIXER_SETTINGS');
            if (!mixerSettings) return null;

            const version = mixerSettings.getAttribute('version') || '1.0';
            const channelElements = mixerSettings.querySelectorAll('CHANNEL');
            const channels = [];

            channelElements.forEach(chEl => {
                const index = parseInt(chEl.getAttribute('index'));
                const volume = parseFloat(chEl.querySelector('VOLUME')?.textContent || '1.0');
                const pan = parseFloat(chEl.querySelector('PAN')?.textContent || '0.0');
                const mute = chEl.querySelector('MUTE')?.textContent === 'true';
                const solo = chEl.querySelector('SOLO')?.textContent === 'true';

                // Validate and clamp values
                channels[index] = {
                    volume: Math.max(0, Math.min(1, volume)),
                    pan: Math.max(-1, Math.min(1, pan)),
                    isMuted: mute,
                    isSoloed: solo
                    // Future: Parse AUTOMATION and EQ here
                };
            });

            return { version, channels };
        } catch (err) {
            console.error('Failed to parse mixer settings:', err);
            return null;
        }
    }

    /**
     * Inject MIXER_SETTINGS into existing iXML string
     * @param {string} existingIXML - Existing iXML string (or null/empty)
     * @param {Array} mixerChannels - Mixer channel data
     * @returns {string} Updated iXML string
     */
    static injectIntoIXML(existingIXML, mixerChannels) {
        const mixerXML = this.serializeToXML(mixerChannels);

        if (!existingIXML || existingIXML.trim() === '') {
            // Create minimal iXML structure
            return `<?xml version="1.0" encoding="UTF-8"?>\n<BWFXML>\n  ${mixerXML}\n</BWFXML>`;
        }

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(existingIXML, 'text/xml');

            if (xmlDoc.querySelector('parsererror')) {
                console.warn('Existing iXML is invalid, creating new structure');
                return `<?xml version="1.0" encoding="UTF-8"?>\n<BWFXML>\n  ${mixerXML}\n</BWFXML>`;
            }

            let bwfxml = xmlDoc.querySelector('BWFXML');
            if (!bwfxml) {
                // Wrap in BWFXML
                const newDoc = parser.parseFromString(`<?xml version="1.0" encoding="UTF-8"?>\n<BWFXML></BWFXML>`, 'text/xml');
                bwfxml = newDoc.querySelector('BWFXML');
                // Copy existing content
                Array.from(xmlDoc.childNodes).forEach(node => {
                    bwfxml.appendChild(newDoc.importNode(node, true));
                });
            }

            // Remove existing MIXER_SETTINGS if present
            const oldMixerSettings = bwfxml.querySelector('MIXER_SETTINGS');
            if (oldMixerSettings) {
                oldMixerSettings.remove();
            }

            // Parse and append new MIXER_SETTINGS
            const mixerDoc = parser.parseFromString(mixerXML, 'text/xml');
            const newMixerSettings = xmlDoc.importNode(mixerDoc.documentElement, true);
            bwfxml.appendChild(newMixerSettings);

            // Serialize back to string
            const serializer = new XMLSerializer();
            return serializer.serializeToString(xmlDoc);
        } catch (err) {
            console.error('Failed to inject mixer settings:', err);
            // Fallback: create new structure
            return `<?xml version="1.0" encoding="UTF-8"?>\n<BWFXML>\n  ${mixerXML}\n</BWFXML>`;
        }
    }

    /**
     * Extract MIXER_SETTINGS from iXML string
     * @param {string} ixmlString - Full iXML string
     * @returns {Object|null} Parsed mixer settings or null
     */
    static extractFromIXML(ixmlString) {
        if (!ixmlString) return null;
        return this.parseFromXML(ixmlString);
    }
}
