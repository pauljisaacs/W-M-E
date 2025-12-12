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
    static VERSION = "2.0";
    static NAMESPACE = "http://wav-agent-x/mix_automation/2.0";

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
            xml += `    <PAN>${ch.pan.toFixed(4)}</PAN>\n`;
            xml += `    <MUTE>${ch.isMuted}</MUTE>\n`;

            // Automation
            if (ch.automation && (ch.automation.volume?.length > 0 || ch.automation.pan?.length > 0 || ch.automation.mute?.length > 0)) {
                xml += `    <AUTOMATION>\n`;
                
                // Volume automation
                if (ch.automation.volume && ch.automation.volume.length > 0) {
                    xml += `      <VOLUME_AUTOMATION>\n`;
                    ch.automation.volume.forEach(pt => {
                        xml += `        <POINT time="${pt.time.toFixed(3)}" value="${pt.value.toFixed(4)}"/>\n`;
                    });
                    xml += `      </VOLUME_AUTOMATION>\n`;
                }
                
                // Pan automation
                if (ch.automation.pan && ch.automation.pan.length > 0) {
                    xml += `      <PAN_AUTOMATION>\n`;
                    ch.automation.pan.forEach(pt => {
                        xml += `        <POINT time="${pt.time.toFixed(3)}" value="${pt.value.toFixed(4)}"/>\n`;
                    });
                    xml += `      </PAN_AUTOMATION>\n`;
                }
                
                // Mute automation
                if (ch.automation.mute && ch.automation.mute.length > 0) {
                    xml += `      <MUTE_AUTOMATION>\n`;
                    ch.automation.mute.forEach(pt => {
                        xml += `        <POINT time="${pt.time.toFixed(3)}" value="${pt.value.toFixed(4)}"/>\n`;
                    });
                    xml += `      </MUTE_AUTOMATION>\n`;
                }
                
                xml += `    </AUTOMATION>\n`;
            }

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
            console.log('XML string length:', xmlString?.length);
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

            // Check for parse errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                console.error('XML parse error:', parseError.textContent);
                console.error('XML string (first 1000 chars):', xmlString?.substring(0, 1000));
                console.error('XML string (last 500 chars):', xmlString?.substring(xmlString.length - 500));
                return null;
            }

            // Look for MIXER_SETTINGS with or without namespace
            let mixerSettings = xmlDoc.querySelector('MIXER_SETTINGS');
            console.log('querySelector result:', mixerSettings);
            if (!mixerSettings) {
                // Try with namespace prefix in case it's namespaced
                mixerSettings = xmlDoc.getElementsByTagName('MIXER_SETTINGS')[0];
                console.log('getElementsByTagName result:', mixerSettings);
            }
            if (!mixerSettings) {
                console.error('MIXER_SETTINGS element not found in XML');
                return null;
            }

            const version = mixerSettings.getAttribute('version') || '1.0';
            const channelElements = mixerSettings.querySelectorAll('CHANNEL');
            const channels = [];

            channelElements.forEach(chEl => {
                const index = parseInt(chEl.getAttribute('index'));
                const volume = parseFloat(chEl.querySelector('VOLUME')?.textContent || '1.0');
                const pan = parseFloat(chEl.querySelector('PAN')?.textContent || '0.0');
                const mute = chEl.querySelector('MUTE')?.textContent === 'true';
                const solo = chEl.querySelector('SOLO')?.textContent === 'true';

                // Parse Automation
                const automation = { volume: [], pan: [], mute: [] };
                const autoEl = chEl.querySelector('AUTOMATION');
                if (autoEl) {
                    // Parse volume automation
                    const volAuto = autoEl.querySelector('VOLUME_AUTOMATION');
                    if (volAuto) {
                        volAuto.querySelectorAll('POINT').forEach(pt => {
                            automation.volume.push({
                                time: parseFloat(pt.getAttribute('time')),
                                value: parseFloat(pt.getAttribute('value'))
                            });
                        });
                    }
                    
                    // Parse pan automation
                    const panAuto = autoEl.querySelector('PAN_AUTOMATION');
                    if (panAuto) {
                        panAuto.querySelectorAll('POINT').forEach(pt => {
                            automation.pan.push({
                                time: parseFloat(pt.getAttribute('time')),
                                value: parseFloat(pt.getAttribute('value'))
                            });
                        });
                    }
                    
                    // Parse mute automation
                    const muteAuto = autoEl.querySelector('MUTE_AUTOMATION');
                    if (muteAuto) {
                        muteAuto.querySelectorAll('POINT').forEach(pt => {
                            automation.mute.push({
                                time: parseFloat(pt.getAttribute('time')),
                                value: parseFloat(pt.getAttribute('value'))
                            });
                        });
                    }
                }

                // Validate and clamp values
                channels[index] = {
                    volume: Math.max(0, Math.min(1, volume)),
                    pan: Math.max(-1, Math.min(1, pan)),
                    isMuted: mute,
                    isSoloed: solo,
                    automation: automation
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

            // Check for parser errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                console.warn('XML parser error detected:', parseError.textContent);
                console.warn('Attempting to inject mixer settings into raw XML...');
                
                // Remove existing MIXER_SETTINGS if present (using string manipulation)
                let cleanedXML = existingIXML;
                const mixerStartPattern = /<MIXER_SETTINGS[^>]*>/;
                const mixerEndPattern = /<\/MIXER_SETTINGS>/;
                
                const startMatch = cleanedXML.match(mixerStartPattern);
                if (startMatch) {
                    const startIndex = cleanedXML.indexOf(startMatch[0]);
                    const endMatch = cleanedXML.substring(startIndex).match(mixerEndPattern);
                    
                    if (endMatch) {
                        const endIndex = startIndex + cleanedXML.substring(startIndex).indexOf(endMatch[0]) + endMatch[0].length;
                        cleanedXML = cleanedXML.substring(0, startIndex) + cleanedXML.substring(endIndex);
                        // Clean up extra whitespace/newlines left behind
                        cleanedXML = cleanedXML.replace(/\n\s*\n\s*\n/g, '\n');
                    }
                }
                
                // Try to inject by string manipulation as fallback
                const closingBwfxml = '</BWFXML>';
                const closingIndex = cleanedXML.lastIndexOf(closingBwfxml);
                
                if (closingIndex !== -1) {
                    // Insert mixer settings before closing tag
                    return cleanedXML.substring(0, closingIndex) + 
                           '\n  ' + mixerXML + '\n' + 
                           cleanedXML.substring(closingIndex);
                } else {
                    console.error('Could not find closing BWFXML tag, wrapping entire content');
                    return `<?xml version="1.0" encoding="UTF-8"?>\n<BWFXML>\n${cleanedXML}\n  ${mixerXML}\n</BWFXML>`;
                }
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
