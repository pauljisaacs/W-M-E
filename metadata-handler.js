export class MetadataHandler {
    constructor() {
        this.textDecoder = new TextDecoder('utf-8');
    }

    async parseFile(file) {
        // For large files, metadata can be at the beginning AND at the end (after data chunk)
        // Strategy: Read beginning until we hit 'data' chunk, then read the end of the file
        // Parse them separately to avoid creating invalid WAV structure

        let offset = 0;
        const chunkSize = 512 * 1024; // 512KB chunks
        let headerBuffer = new Uint8Array(0);
        let foundDataChunk = false;
        const maxMetadataSize = 50 * 1024 * 1024; // 50MB safety limit

        console.log(`Reading metadata from ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`);

        // For small files (< 50MB), read the entire file to ensure we get all metadata
        // For large files, read until we find the data chunk
        const isSmallFile = file.size <= maxMetadataSize;

        while (offset < file.size && offset < maxMetadataSize) {
            const blob = file.slice(offset, Math.min(offset + chunkSize, file.size));
            const chunk = await blob.arrayBuffer();

            // Append chunk to header buffer
            const newBuffer = new Uint8Array(headerBuffer.length + chunk.byteLength);
            newBuffer.set(headerBuffer);
            newBuffer.set(new Uint8Array(chunk), headerBuffer.length);
            headerBuffer = newBuffer;

            // Check if we've found the 'data' chunk
            foundDataChunk = this.hasDataChunk(headerBuffer);

            offset += chunkSize;

            // For large files, stop after finding data chunk
            // For small files, keep reading to get all metadata
            if (foundDataChunk && !isSmallFile) {
                break;
            }
        }

        console.log(`Read ${(headerBuffer.length / 1024).toFixed(2)} KB from beginning`);

        // Parse the header to get basic info
        const headerView = new DataView(headerBuffer.buffer);
        if (!this.isWav(headerView)) {
            return {
                filename: file.name,
                format: file.type || 'unknown',
                duration: 'Unknown',
                trackCount: '?',
            };
        }

        const metadata = this.parseWav(headerView, file.name, file.size);

        // Check if we found bEXT and iXML in the header
        const foundBext = metadata.timeReference !== undefined || metadata.description !== undefined;
        const foundIxml = metadata.ixmlRaw !== undefined;

        // Only read the END of the file if we didn't find bEXT/iXML at the beginning
        // (Some recorders put them at the end, after the data chunk)
        if (!foundBext || !foundIxml) {
            const endReadSize = Math.min(10 * 1024 * 1024, file.size); // Read last 10MB
            const endOffset = Math.max(0, file.size - endReadSize);

            if (endOffset > offset) {
                console.log(`Metadata chunks not found in header, reading last ${(endReadSize / 1024 / 1024).toFixed(2)} MB from end of file...`);
                const endBlob = file.slice(endOffset, file.size);
                const endBuffer = await endBlob.arrayBuffer();
                const endView = new DataView(endBuffer);

                // Parse chunks from the end buffer
                this.parseTrailingChunks(endView, metadata, endOffset);
            }
        } else {
            console.log(`Found metadata in header (bEXT: ${foundBext}, iXML: ${foundIxml})`);
        }

        console.log(`Final parsed metadata:`, metadata);

        return metadata;
    }

    parseTrailingChunks(view, metadata, fileOffset) {
        // Parse chunks from the end of the file (after data chunk)
        // fileOffset is the absolute position in the file where 'view' starts

        let offset = 0;

        // If we know where the data chunk ends, start searching there
        // This avoids interpreting audio data as chunk headers
        if (metadata.audioDataOffset !== undefined && metadata.audioDataSize !== undefined) {
            const dataEnd = metadata.audioDataOffset + metadata.audioDataSize;
            // Pad to even byte
            const nextChunkStart = dataEnd + (dataEnd % 2);

            if (nextChunkStart >= fileOffset) {
                offset = nextChunkStart - fileOffset;
                console.log(`Jumping to offset ${offset} in trailing buffer (based on data chunk end)`);
            } else {
                console.warn('Data chunk ends before trailing buffer starts - scanning might be unreliable');
            }
        }

        console.log(`Starting trailing chunk parse at offset ${offset} (buffer size: ${view.byteLength})`);

        let invalidChunkCount = 0;
        const MAX_INVALID_CHUNKS = 100; // Stop after 100 consecutive invalid chunks to prevent infinite loops

        while (offset < view.byteLength - 8) {
            try {
                const chunkId = this.getChunkId(view, offset);
                const chunkSize = view.getUint32(offset + 4, true);

                console.log(`Found chunk candidate at ${offset}: ${chunkId} (${chunkSize} bytes)`);

                // Safety check: if chunkSize is 0 or unreasonably large, this is likely corrupt data
                if (chunkSize === 0 || chunkSize > view.byteLength) {
                    console.log(`Invalid chunk size ${chunkSize}, stopping trailing chunk parse`);
                    break;
                }

                // Validate chunk ID (must be ASCII alphanumeric/space)
                if (!/^[a-zA-Z0-9 ]{4}$/.test(chunkId)) {
                    invalidChunkCount++;
                    if (invalidChunkCount > MAX_INVALID_CHUNKS) {
                        console.log(`Too many invalid chunks (${invalidChunkCount}), stopping parse to prevent infinite loop`);
                        break;
                    }
                    console.log(`Invalid chunk ID, skipping byte (${invalidChunkCount}/${MAX_INVALID_CHUNKS})`);
                    offset++;
                    continue;
                }

                // Reset invalid chunk counter when we find a valid one
                invalidChunkCount = 0;

                if (chunkId === 'bext') {
                    console.log(`Found bext chunk at end of file, size: ${chunkSize}`);
                    this.parseBext(view, offset + 8, chunkSize, metadata);
                } else if (chunkId === 'iXML') {
                    console.log(`Found iXML chunk at end of file, size: ${chunkSize}`);
                    this.parseIXML(view, offset + 8, chunkSize, metadata);
                }

                offset += 8 + chunkSize;
                // Pad to even byte
                if (chunkSize % 2 !== 0) offset++;
            } catch (e) {
                console.warn('Error parsing trailing chunk:', e);
                invalidChunkCount++;
                if (invalidChunkCount > MAX_INVALID_CHUNKS) {
                    console.log(`Too many errors (${invalidChunkCount}), stopping parse to prevent infinite loop`);
                    break;
                }
                // If we can't parse a chunk, move forward by 1 byte and try again
                offset++;
            }
        }

        // Recalculate timecode after parsing trailing chunks
        if (metadata.timeReference !== undefined && metadata.sampleRate) {
            const fpsExact = metadata.fpsExact || { numerator: 24, denominator: 1 };
            metadata.tcStart = this.samplesToTC(metadata.timeReference, metadata.sampleRate, fpsExact);
            console.log(`Recalculated TC Start: ${metadata.tcStart}`);
        }
    }

    hasDataChunk(buffer) {
        // Search for 'data' chunk signature in the buffer
        const view = new DataView(buffer.buffer || buffer);
        let offset = 12; // Skip RIFF header

        try {
            while (offset + 8 <= view.byteLength) {
                const chunkId = this.getChunkId(view, offset);
                const chunkSize = view.getUint32(offset + 4, true);

                if (chunkId === 'data') {
                    return true;
                }

                // Move to next chunk (8 bytes for header + chunk size)
                offset += 8 + chunkSize;

                // Align to even byte boundary
                if (chunkSize % 2 !== 0) offset++;
            }
        } catch (e) {
            // If we can't read properly, assume we haven't found it yet
            return false;
        }

        return false;
    }

    isWav(view) {
        const chunkId = view.getUint32(0, false);
        return (chunkId === 0x52494646 || chunkId === 0x52463634) && // RIFF or RF64
            view.getUint32(8, false) === 0x57415645;   // WAVE
    }

    parseWav(view, filename, actualFileSize = null) {
        const chunkIdHeader = view.getUint32(0, false);
        const isRF64 = chunkIdHeader === 0x52463634; // RF64

        const metadata = {
            filename: filename,
            format: isRF64 ? 'RF64 (WAV)' : 'WAV',
            fileSize: actualFileSize || view.byteLength,
            chunks: {}
        };

        let rf64DataSize = 0n;
        let offset = 12; // Skip RIFF/RF64 header

        while (offset < view.byteLength) {
            const chunkId = this.getChunkId(view, offset);
            let chunkSize = view.getUint32(offset + 4, true);

            // Store chunk info for later writing
            metadata.chunks[chunkId] = { offset, size: chunkSize };

            if (chunkId === 'ds64') {
                // Parse ds64 chunk (RF64 64-bit sizes)
                // RIFF Size (8), Data Size (8), Sample Count (8), Table Length (4)
                const ds64View = new DataView(view.buffer, view.byteOffset + offset + 8, chunkSize);
                // We primarily care about the Data Size (bytes 8-15)
                rf64DataSize = ds64View.getBigUint64(8, true);
                console.log(`Found ds64 chunk. Data Size: ${rf64DataSize}`);
            } else if (chunkId === 'fmt ') {
                metadata.channels = view.getUint16(offset + 10, true);
                metadata.sampleRate = view.getUint32(offset + 12, true);
                metadata.bitDepth = view.getUint16(offset + 22, true);
            } else if (chunkId === 'bext') {
                this.parseBext(view, offset + 8, chunkSize, metadata);
            } else if (chunkId === 'iXML') {
                this.parseIXML(view, offset + 8, chunkSize, metadata);
            } else if (chunkId === 'data') {
                metadata.audioDataOffset = offset + 8;

                // If RF64 and size is -1 (0xFFFFFFFF), use the size from ds64
                if (chunkSize === 0xFFFFFFFF && isRF64) {
                    metadata.audioDataSize = Number(rf64DataSize); // Convert to Number (safe up to 9PB)
                    console.log(`Using RF64 data size: ${metadata.audioDataSize}`);
                } else {
                    metadata.audioDataSize = chunkSize;
                }

                // Calculate duration if fmt was parsed
                if (metadata.sampleRate && metadata.channels && metadata.bitDepth) {
                    const bytesPerSample = metadata.bitDepth / 8;
                    const totalSamples = metadata.audioDataSize / (metadata.channels * bytesPerSample);
                    metadata.durationSec = totalSamples / metadata.sampleRate;
                    metadata.duration = this.formatDuration(metadata.durationSec);
                }
            }

            offset += 8 + chunkSize;
            // Pad to even byte
            if (offset % 2 !== 0) offset++;
        }

        // Calculate timecode after all chunks parsed (need both timeReference and fps)
        if (metadata.timeReference !== undefined && metadata.sampleRate) {
            // Use exact FPS fraction if available from iXML, otherwise default to 24/1
            const fpsExact = metadata.fpsExact || { numerator: 24, denominator: 1 };
            metadata.tcStart = this.samplesToTC(metadata.timeReference, metadata.sampleRate, fpsExact);
        }

        return metadata;
    }

    getChunkId(view, offset) {
        let id = '';
        for (let i = 0; i < 4; i++) {
            id += String.fromCharCode(view.getUint8(offset + i));
        }
        return id;
    }

    parseBext(view, offset, size, metadata) {
        // Store raw bEXT data for preservation
        metadata.bextRaw = new Uint8Array(view.buffer.slice(offset, offset + size));

        // Description (256), Originator (32), OriginatorReference (32), OriginationDate (10), OriginationTime (8)
        // TimeReference (8 bytes - uint64)

        metadata.description = this.readString(view, offset, 256);
        metadata.originator = this.readString(view, offset + 256, 32);
        metadata.originatorRef = this.readString(view, offset + 288, 32);
        metadata.date = this.readString(view, offset + 320, 10);
        metadata.time = this.readString(view, offset + 330, 8);

        const timeRefLow = view.getUint32(offset + 338, true);
        const timeRefHigh = view.getUint32(offset + 342, true);
        const timeRef = Number((BigInt(timeRefHigh) << 32n) | BigInt(timeRefLow));

        metadata.timeReference = timeRef;

        console.log('[parseBext] Description:', metadata.description);
        console.log('[parseBext] Current metadata before extraction:', { scene: metadata.scene, take: metadata.take, notes: metadata.notes, tape: metadata.tape });

        // Extract Sound Devices tags from Description field
        // Only set if not already populated (e.g., from iXML which takes priority)
        if (metadata.description) {
            const extractTag = (tag) => {
                const regex = new RegExp(`${tag}=([^\\r\\n]*)`);
                const match = metadata.description.match(regex);
                return match ? match[1].trim() : undefined;
            };

            const extractedScene = extractTag('sSCENE');
            const extractedTake = extractTag('sTAKE');
            const extractedTape = extractTag('sTAPE');
            const extractedNotes = extractTag('sNOTE');

            console.log('[parseBext] Extracted from Description:', { scene: extractedScene, take: extractedTake, tape: extractedTape, notes: extractedNotes });

            if (!metadata.scene) metadata.scene = extractedScene;
            if (!metadata.take) metadata.take = extractedTake;
            if (!metadata.tape) metadata.tape = extractedTape;
            if (!metadata.notes) metadata.notes = extractedNotes;
        }

        console.log('[parseBext] Final metadata after extraction:', { scene: metadata.scene, take: metadata.take, notes: metadata.notes, tape: metadata.tape });
    }

    parseIXML(view, offset, size, metadata) {

        // Use TextDecoder for proper UTF-8 handling
        const chunkData = new Uint8Array(view.buffer, view.byteOffset + offset, size);
        const decoder = new TextDecoder('utf-8');
        // Remove null terminators if any
        let xmlStr = decoder.decode(chunkData).replace(/\0+$/, '');

        // Validate iXML - detect if repair is needed but don't repair yet
        // Pass metadata so we can include proper SPEED tag in repair
        const validation = this.validateAndFixIXML(xmlStr, metadata);
        
        if (validation.needsRepair) {
            console.log('[parseIXML] File needs repair, marking for later');
            metadata.needsIXMLRepair = true;
            metadata.ixmlRepairData = validation.fixed; // Store the repaired version for later
        } else {
            metadata.needsIXMLRepair = false;
        }

        // Store the original iXML for preservation
        metadata.ixmlRaw = xmlStr;

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlStr, "text/xml");

        // Note: SPEED tag is now automatically added during iXML repair if missing,
        // so we no longer need to warn the user about it

        // check for parse errors
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            console.error('[parseIXML] XML Parsing Error:', parseError.textContent);
        }

        metadata.scene = this.getXmlVal(xmlDoc, "SCENE");
        metadata.take = this.getXmlVal(xmlDoc, "TAKE");
        metadata.tape = this.getXmlVal(xmlDoc, "TAPE");
        metadata.project = this.getXmlVal(xmlDoc, "PROJECT");
        metadata.notes = this.getXmlVal(xmlDoc, "NOTE");

        // --- TC Start Import Logic ---
        // 1. BWF_TIME_REFERENCE (samples)
        let bwfTimeRef = this.getXmlVal(xmlDoc, "BWF_TIME_REFERENCE");
        // 2. Fallback: use bEXT (handled elsewhere)

        if (bwfTimeRef && !isNaN(Number(bwfTimeRef)) && metadata.sampleRate && metadata.fpsExact) {
            metadata.tcStart = this.samplesToTC(Number(bwfTimeRef), metadata.sampleRate, metadata.fpsExact);
            metadata.timeReference = Number(bwfTimeRef);
        }

        // FPS/Speed parsing (unchanged)
        let speedVal = this.getXmlVal(xmlDoc, "SPEED MASTER_SPEED") ||
            this.getXmlVal(xmlDoc, "SPEED CURRENT_SPEED") ||
            this.getXmlVal(xmlDoc, "SPEED TIMECODE_RATE");
        if (!speedVal) {
            speedVal = this.getXmlVal(xmlDoc, "SPEED") || this.getXmlVal(xmlDoc, "FRAME_RATE");
        }
        if (speedVal) {
            const firstValue = speedVal.trim().split(/\s+/)[0];
            if (firstValue.includes('/')) {
                const [num, den] = firstValue.split('/').map(Number);
                metadata.fpsExact = { numerator: num, denominator: den };
                const fps = num / den;
                if (Math.abs(fps - 23.976) < 0.01) {
                    metadata.fps = "23.98";
                } else if (Math.abs(fps - 29.97) < 0.01) {
                    metadata.fps = "29.97";
                } else {
                    metadata.fps = fps.toFixed(2);
                    if (metadata.fps.endsWith('.00')) {
                        metadata.fps = metadata.fps.substring(0, metadata.fps.length - 3);
                    }
                }
            } else {
                const value = parseFloat(firstValue);
                metadata.fpsExact = { numerator: value, denominator: 1 };
                metadata.fps = value.toString();
            }
        }

        // Track names
        const trackNames = [];
        const tracks = xmlDoc.querySelectorAll("TRACK");
        tracks.forEach(t => {
            const name = t.querySelector("NAME")?.textContent;
            if (name) trackNames.push(name);
        });
        metadata.trackNames = trackNames;
    }

    /**
     * Validate and fix incomplete/invalid iXML chunks
     * @param {string} xmlStr - The iXML string to validate
     * @param {object} metadata - Metadata object with audio info (sampleRate, fps, etc)
     * @returns {object} - {isValid, needsRepair, fixed} where fixed is the corrected iXML
     */
    validateAndFixIXML(xmlStr, metadata = {}) {
        if (!xmlStr || xmlStr.trim() === '') {
            console.warn('[validateAndFixIXML] Empty iXML chunk detected');
            return {
                isValid: false,
                needsRepair: true,
                fixed: this.createMinimalIXML(metadata)
            };
        }

        let fixed = xmlStr;
        let needsRepair = false;

        // Check for missing XML declaration
        if (!fixed.trim().startsWith('<?xml')) {
            console.warn('[validateAndFixIXML] Missing XML declaration');
            needsRepair = true;
            fixed = '<?xml version="1.0" encoding="UTF-8"?>\n' + fixed;
        }

        // Check if closing BWFXML tag exists
        if (!fixed.includes('</BWFXML>')) {
            console.warn('[validateAndFixIXML] Missing closing </BWFXML> tag');
            needsRepair = true;
            
            // Remove any incomplete closing tags at the end
            fixed = fixed.replace(/<BWFXML[^>]*>[\s\S]*$/, match => {
                // Find the opening BWFXML tag and keep everything up to it
                const lastOpenTag = fixed.lastIndexOf('<BWFXML');
                if (lastOpenTag !== -1) {
                    const afterOpen = fixed.indexOf('>', lastOpenTag);
                    return fixed.substring(0, afterOpen + 1);
                }
                return match;
            });
            
            // Add closing tag
            fixed = fixed.trimEnd() + '\n</BWFXML>';
        }

        // Try to parse and validate
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(fixed, 'text/xml');
            
            // Check for parsing errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                console.warn('[validateAndFixIXML] XML parsing error detected');
                needsRepair = true;
                
                // Attempt to rebuild from extracted fields
                const minimized = this.rebuildIXMLFromText(fixed, metadata);
                return {
                    isValid: false,
                    needsRepair: true,
                    fixed: minimized
                };
            }
            
            // Validate required root element
            const rootElement = xmlDoc.documentElement;
            if (!rootElement || rootElement.tagName !== 'BWFXML') {
                console.warn('[validateAndFixIXML] Invalid root element');
                return {
                    isValid: false,
                    needsRepair: true,
                    fixed: this.createMinimalIXML(metadata)
                };
            }

            // Check if SPEED tag exists
            if (!xmlDoc.querySelector('SPEED')) {
                console.warn('[validateAndFixIXML] Missing SPEED tag, adding it');
                needsRepair = true;
                // Add SPEED tag before closing BWFXML
                const speedTag = this.createSpeedTag(metadata);
                fixed = fixed.replace('</BWFXML>', `${speedTag}</BWFXML>`);
            }
            
            return {
                isValid: !needsRepair,
                needsRepair: needsRepair,
                fixed: fixed
            };
        } catch (err) {
            console.error('[validateAndFixIXML] Exception during validation:', err);
            return {
                isValid: false,
                needsRepair: true,
                fixed: this.createMinimalIXML(metadata)
            };
        }
    }

    /**
     * Rebuild iXML structure from potentially corrupted text
     * @param {string} xmlStr - Corrupted XML string
     * @param {object} metadata - Metadata with audio info
     * @returns {string} - Rebuilt valid iXML
     */
    rebuildIXMLFromText(xmlStr, metadata = {}) {
        // Try to extract key fields using regex as fallback
        try {
            const extracted = {};
            
            const fields = ['PROJECT', 'SCENE', 'TAKE', 'TAPE', 'NOTE'];
            for (const field of fields) {
                const regex = new RegExp(`<${field}[^>]*>([^<]*)<\/${field}>`, 'i');
                const match = xmlStr.match(regex);
                if (match && match[1]) {
                    extracted[field] = match[1].trim();
                }
            }
            
            // Also try to extract BWF_TIME_REFERENCE and track info
            const timeRefMatch = xmlStr.match(/<BWF_TIME_REFERENCE>(\d+)<\/BWF_TIME_REFERENCE>/i);
            if (timeRefMatch) {
                extracted.timeReference = parseInt(timeRefMatch[1]);
            }
            
            // Extract SYNC_POINT_LIST if present
            const syncPointMatch = xmlStr.match(/<SYNC_POINT_LIST>[\s\S]*?<\/SYNC_POINT_LIST>/i);
            if (syncPointMatch) {
                extracted.syncPoints = syncPointMatch[0];
            }
            
            // Extract MIXER_SETTINGS if present
            const mixerMatch = xmlStr.match(/<MIXER_SETTINGS>[\s\S]*?<\/MIXER_SETTINGS>/i);
            if (mixerMatch) {
                extracted.mixerSettings = mixerMatch[0];
            }
            
            if (Object.keys(extracted).length > 0 || metadata.sampleRate) {
                console.log('[rebuildIXMLFromText] Recovered fields:', Object.keys(extracted));
                
                // Rebuild with recovered fields and proper standard structure
                let rebuilt = '<?xml version="1.0" encoding="UTF-8"?>\n<BWFXML>\n';
                rebuilt += '\t<IXML_VERSION>1.5</IXML_VERSION>\n';
                
                if (extracted.PROJECT) rebuilt += `\t<PROJECT>${this.escapeXML(extracted.PROJECT)}</PROJECT>\n`;
                if (extracted.SCENE) rebuilt += `\t<SCENE>${this.escapeXML(extracted.SCENE)}</SCENE>\n`;
                if (extracted.TAKE) rebuilt += `\t<TAKE>${this.escapeXML(extracted.TAKE)}</TAKE>\n`;
                if (extracted.TAPE) rebuilt += `\t<TAPE>${this.escapeXML(extracted.TAPE)}</TAPE>\n`;
                if (extracted.NOTE) rebuilt += `\t<NOTE>${this.escapeXML(extracted.NOTE)}</NOTE>\n`;
                
                // Add SPEED tag with proper structure
                rebuilt += '\t<SPEED>\n';
                rebuilt += '\t\t<NOTE></NOTE>\n';
                
                if (metadata.fps) {
                    const fpsMap = {
                        '23.98': '24000/1001', '24': '24/1', '25': '25/1', 
                        '29.97': '30000/1001', '29.97df': '30000/1001', '30': '30/1',
                        '48': '48/1', '50': '50/1', '59.94': '60000/1001', '60': '60/1'
                    };
                    const fpsVal = fpsMap[metadata.fps] || '25/1';
                    rebuilt += `\t\t<MASTER_SPEED>${fpsVal}</MASTER_SPEED>\n`;
                    rebuilt += `\t\t<CURRENT_SPEED>${fpsVal}</CURRENT_SPEED>\n`;
                    rebuilt += '\t\t<TIMECODE_FLAG>NDF</TIMECODE_FLAG>\n';
                    rebuilt += `\t\t<TIMECODE_RATE>${fpsVal}</TIMECODE_RATE>\n`;
                } else {
                    rebuilt += '\t\t<MASTER_SPEED>25/1</MASTER_SPEED>\n';
                    rebuilt += '\t\t<CURRENT_SPEED>25/1</CURRENT_SPEED>\n';
                    rebuilt += '\t\t<TIMECODE_FLAG>NDF</TIMECODE_FLAG>\n';
                    rebuilt += '\t\t<TIMECODE_RATE>25/1</TIMECODE_RATE>\n';
                }
                
                rebuilt += `\t\t<FILE_SAMPLE_RATE>${metadata.sampleRate || 48000}</FILE_SAMPLE_RATE>\n`;
                rebuilt += `\t\t<AUDIO_BIT_DEPTH>${metadata.bitDepth || 24}</AUDIO_BIT_DEPTH>\n`;
                rebuilt += `\t\t<DIGITIZER_SAMPLE_RATE>${metadata.sampleRate || 48000}</DIGITIZER_SAMPLE_RATE>\n`;
                rebuilt += `\t\t<TIMESTAMP_SAMPLE_RATE>${metadata.sampleRate || 48000}</TIMESTAMP_SAMPLE_RATE>\n`;
                rebuilt += '\t\t<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>0</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>\n';
                rebuilt += `\t\t<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>${extracted.timeReference || metadata.timeReference || 0}</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>\n`;
                rebuilt += '\t</SPEED>\n';
                
                // Add TRACK_LIST with channel information
                const channels = metadata.channels || 1;
                if (channels > 0) {
                    rebuilt += '\t<TRACK_LIST>\n';
                    rebuilt += `\t\t<TRACK_COUNT>${channels}</TRACK_COUNT>\n`;
                    for (let i = 0; i < channels; i++) {
                        const trackName = (metadata.trackNames && metadata.trackNames[i]) 
                            ? this.escapeXML(metadata.trackNames[i])
                            : `Track ${i + 1}`;
                        rebuilt += '\t\t<TRACK>\n';
                        rebuilt += `\t\t\t<CHANNEL_INDEX>${i + 1}</CHANNEL_INDEX>\n`;
                        rebuilt += `\t\t\t<INTERLEAVE_INDEX>${i + 1}</INTERLEAVE_INDEX>\n`;
                        rebuilt += `\t\t\t<NAME>${trackName}</NAME>\n`;
                        rebuilt += '\t\t</TRACK>\n';
                    }
                    rebuilt += '\t</TRACK_LIST>\n';
                }
                
                // Add back SYNC_POINT_LIST if it existed
                if (extracted.syncPoints) {
                    rebuilt += '\t' + extracted.syncPoints + '\n';
                }
                
                // Add back MIXER_SETTINGS if it existed
                if (extracted.mixerSettings) {
                    rebuilt += '\t' + extracted.mixerSettings + '\n';
                }
                
                rebuilt += '</BWFXML>';
                return rebuilt;
            }
        } catch (err) {
            console.error('[rebuildIXMLFromText] Error during field extraction:', err);
        }
        
        // Fallback to minimal structure with metadata
        return this.createMinimalIXML(metadata);
    }

    /**
     * Create a proper SPEED tag from metadata
     * @param {object} metadata - Metadata with sampleRate and fps
     * @returns {string} - SPEED tag XML
     */
    createSpeedTag(metadata = {}) {
        let speedTag = '  <SPEED>\n';
        speedTag += '    <NOTE></NOTE>\n';
        
        // MASTER_SPEED and CURRENT_SPEED in fractional format
        if (metadata.fps) {
            const fpsMap = {
                '23.98': '24000/1001', '24': '24/1', '25': '25/1', 
                '29.97': '30000/1001', '29.97df': '30000/1001', '30': '30/1',
                '48': '48/1', '50': '50/1', '59.94': '60000/1001', '60': '60/1'
            };
            const fpsVal = fpsMap[metadata.fps] || '30/1';
            speedTag += `    <MASTER_SPEED>${fpsVal}</MASTER_SPEED>\n`;
            speedTag += `    <CURRENT_SPEED>${fpsVal}</CURRENT_SPEED>\n`;
            speedTag += '    <TIMECODE_FLAG>NDF</TIMECODE_FLAG>\n';
            speedTag += `    <TIMECODE_RATE>${fpsVal}</TIMECODE_RATE>\n`;
        } else {
            speedTag += '    <MASTER_SPEED>25/1</MASTER_SPEED>\n';
            speedTag += '    <CURRENT_SPEED>25/1</CURRENT_SPEED>\n';
            speedTag += '    <TIMECODE_FLAG>NDF</TIMECODE_FLAG>\n';
            speedTag += '    <TIMECODE_RATE>25/1</TIMECODE_RATE>\n';
        }
        
        // Sample rate information
        if (metadata.sampleRate) {
            speedTag += `    <FILE_SAMPLE_RATE>${metadata.sampleRate}</FILE_SAMPLE_RATE>\n`;
        } else {
            speedTag += '    <FILE_SAMPLE_RATE>48000</FILE_SAMPLE_RATE>\n';
        }
        
        // Bit depth
        if (metadata.bitDepth) {
            speedTag += `    <AUDIO_BIT_DEPTH>${metadata.bitDepth}</AUDIO_BIT_DEPTH>\n`;
        } else {
            speedTag += '    <AUDIO_BIT_DEPTH>24</AUDIO_BIT_DEPTH>\n';
        }
        
        // Digitizer information (same as sample rate typically)
        if (metadata.sampleRate) {
            speedTag += `    <DIGITIZER_SAMPLE_RATE>${metadata.sampleRate}</DIGITIZER_SAMPLE_RATE>\n`;
            speedTag += `    <TIMESTAMP_SAMPLE_RATE>${metadata.sampleRate}</TIMESTAMP_SAMPLE_RATE>\n`;
        } else {
            speedTag += '    <DIGITIZER_SAMPLE_RATE>48000</DIGITIZER_SAMPLE_RATE>\n';
            speedTag += '    <TIMESTAMP_SAMPLE_RATE>48000</TIMESTAMP_SAMPLE_RATE>\n';
        }
        
        // Timestamp information
        speedTag += '    <TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>0</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>\n';
        if (metadata.timeReference !== undefined) {
            speedTag += `    <TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>${metadata.timeReference}</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>\n`;
        } else {
            speedTag += '    <TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>0</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>\n';
        }
        
        speedTag += '  </SPEED>\n';
        return speedTag;
    }

    /**
     * Create minimal valid iXML structure with proper standard formatting
     * @param {object} metadata - Metadata with audio info
     * @returns {string} - Minimal valid iXML matching iXML 1.5 standard
     */
    createMinimalIXML(metadata = {}) {
        let ixmlStr = '<?xml version="1.0" encoding="UTF-8"?>\n<BWFXML>\n';
        
        // Standard iXML version
        ixmlStr += '\t<IXML_VERSION>1.5</IXML_VERSION>\n';
        
        // Basic metadata
        if (metadata.project) ixmlStr += `\t<PROJECT>${this.escapeXML(metadata.project)}</PROJECT>\n`;
        if (metadata.scene) ixmlStr += `\t<SCENE>${this.escapeXML(metadata.scene)}</SCENE>\n`;
        if (metadata.take) ixmlStr += `\t<TAKE>${this.escapeXML(metadata.take)}</TAKE>\n`;
        if (metadata.tape) ixmlStr += `\t<TAPE>${this.escapeXML(metadata.tape)}</TAPE>\n`;
        if (metadata.notes) ixmlStr += `\t<NOTE>${this.escapeXML(metadata.notes)}</NOTE>\n`;
        
        // SPEED tag with complete structure
        ixmlStr += '\t<SPEED>\n';
        ixmlStr += '\t\t<NOTE></NOTE>\n';
        
        if (metadata.fps) {
            const fpsMap = {
                '23.98': '24000/1001', '24': '24/1', '25': '25/1', 
                '29.97': '30000/1001', '29.97df': '30000/1001', '30': '30/1',
                '48': '48/1', '50': '50/1', '59.94': '60000/1001', '60': '60/1'
            };
            const fpsVal = fpsMap[metadata.fps] || '25/1';
            ixmlStr += `\t\t<MASTER_SPEED>${fpsVal}</MASTER_SPEED>\n`;
            ixmlStr += `\t\t<CURRENT_SPEED>${fpsVal}</CURRENT_SPEED>\n`;
            ixmlStr += '\t\t<TIMECODE_FLAG>NDF</TIMECODE_FLAG>\n';
            ixmlStr += `\t\t<TIMECODE_RATE>${fpsVal}</TIMECODE_RATE>\n`;
        } else {
            ixmlStr += '\t\t<MASTER_SPEED>25/1</MASTER_SPEED>\n';
            ixmlStr += '\t\t<CURRENT_SPEED>25/1</CURRENT_SPEED>\n';
            ixmlStr += '\t\t<TIMECODE_FLAG>NDF</TIMECODE_FLAG>\n';
            ixmlStr += '\t\t<TIMECODE_RATE>25/1</TIMECODE_RATE>\n';
        }
        
        ixmlStr += `\t\t<FILE_SAMPLE_RATE>${metadata.sampleRate || 48000}</FILE_SAMPLE_RATE>\n`;
        ixmlStr += `\t\t<AUDIO_BIT_DEPTH>${metadata.bitDepth || 24}</AUDIO_BIT_DEPTH>\n`;
        ixmlStr += `\t\t<DIGITIZER_SAMPLE_RATE>${metadata.sampleRate || 48000}</DIGITIZER_SAMPLE_RATE>\n`;
        ixmlStr += `\t\t<TIMESTAMP_SAMPLE_RATE>${metadata.sampleRate || 48000}</TIMESTAMP_SAMPLE_RATE>\n`;
        ixmlStr += '\t\t<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>0</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>\n';
        ixmlStr += `\t\t<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>${metadata.timeReference || 0}</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>\n`;
        ixmlStr += '\t</SPEED>\n';
        
        // TRACK_LIST with channel information
        const channels = metadata.channels || 1;
        if (channels > 0) {
            ixmlStr += '\t<TRACK_LIST>\n';
            ixmlStr += `\t\t<TRACK_COUNT>${channels}</TRACK_COUNT>\n`;
            for (let i = 0; i < channels; i++) {
                const trackName = (metadata.trackNames && metadata.trackNames[i]) 
                    ? this.escapeXML(metadata.trackNames[i])
                    : `Track ${i + 1}`;
                ixmlStr += '\t\t<TRACK>\n';
                ixmlStr += `\t\t\t<CHANNEL_INDEX>${i + 1}</CHANNEL_INDEX>\n`;
                ixmlStr += `\t\t\t<INTERLEAVE_INDEX>${i + 1}</INTERLEAVE_INDEX>\n`;
                ixmlStr += `\t\t\t<NAME>${trackName}</NAME>\n`;
                ixmlStr += '\t\t</TRACK>\n';
            }
            ixmlStr += '\t</TRACK_LIST>\n';
        }
        
        ixmlStr += '</BWFXML>';
        return ixmlStr;
    }

    /**
     * Escape special XML characters
     * @param {string} str - String to escape
     * @returns {string} - Escaped string
     */
    escapeXML(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    readString(view, offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            const charCode = view.getUint8(offset + i);
            if (charCode === 0) break; // Null terminator
            str += String.fromCharCode(charCode);
        }
        return str;
    }

    getXmlVal(doc, tag) {
        return doc.querySelector(tag)?.textContent || '';
    }

    samplesToTC(samples, sampleRate, fpsExact) {
        // Convert samples to actual elapsed seconds
        const totalSeconds = samples / sampleRate;

        // Convert seconds to total frames using exact fraction
        // totalFrames = totalSeconds × (numerator / denominator)
        const totalFrames = Math.floor(totalSeconds * fpsExact.numerator / fpsExact.denominator);

        // Calculate timecode components
        // For drop-frame rates like 23.976 (24000/1001), the frame count rounds to 24
        const framesPerSecond = Math.round(fpsExact.numerator / fpsExact.denominator);
        const framesPerMinute = framesPerSecond * 60;
        const framesPerHour = framesPerMinute * 60;

        const h = Math.floor(totalFrames / framesPerHour);
        const m = Math.floor((totalFrames % framesPerHour) / framesPerMinute);
        const s = Math.floor((totalFrames % framesPerMinute) / framesPerSecond);
        const f = totalFrames % framesPerSecond;

        return `${this.pad(h)}:${this.pad(m)}:${this.pad(s)}:${this.pad(f)}`;
    }

    tcToSamples(tcString, sampleRate, fpsExact) {
        // Parse HH:MM:SS:FF format
        const parts = tcString.split(':');
        if (parts.length !== 4) return 0;

        const h = parseInt(parts[0]) || 0;
        const m = parseInt(parts[1]) || 0;
        const s = parseInt(parts[2]) || 0;
        const f = parseInt(parts[3]) || 0;

        // Calculate total frames
        const framesPerSecond = Math.round(fpsExact.numerator / fpsExact.denominator);
        const framesPerMinute = framesPerSecond * 60;
        const framesPerHour = framesPerMinute * 60;

        const totalFrames = (h * framesPerHour) + (m * framesPerMinute) + (s * framesPerSecond) + f;

        // Convert frames to seconds using exact FPS fraction
        const totalSeconds = totalFrames * fpsExact.denominator / fpsExact.numerator;

        // Convert seconds to samples
        const samples = Math.round(totalSeconds * sampleRate);

        return samples;
    }

    formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${this.pad(h)}:${this.pad(m)}:${this.pad(s)}`;
    }

    async saveWav(file, metadata) {
        // For files > 2GB, we need to read in chunks to avoid memory allocation errors
        const isLargeFile = file.size > 2 * 1024 * 1024 * 1024;

        let originalBuffer;
        if (isLargeFile) {
            console.log(`Large file detected (${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB), reading in chunks...`);
            // Read file in chunks and combine
            const chunkSize = 100 * 1024 * 1024; // 100MB chunks
            const chunks = [];

            for (let offset = 0; offset < file.size; offset += chunkSize) {
                const blob = file.slice(offset, Math.min(offset + chunkSize, file.size));
                const chunk = await blob.arrayBuffer();
                chunks.push(new Uint8Array(chunk));
            }

            // Combine chunks
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            const combined = new Uint8Array(totalLength);
            let position = 0;

            for (const chunk of chunks) {
                combined.set(chunk, position);
                position += chunk.byteLength;
            }

            originalBuffer = combined.buffer;
        } else {
            originalBuffer = await file.arrayBuffer();
        }

        const view = new DataView(originalBuffer);

        // We need to reconstruct the file.
        // Strategy: Copy essential chunks (fmt, data) and any other valid chunks EXCEPT bext and iXML.
        // Append new bext and iXML chunks.
        // Update RIFF size.

        const newChunks = [];
        let offset = 12;
        let dataChunkEnd = 0;

        // 1. Collect existing chunks we want to keep (fmt, data, etc.)
        // Stop at first invalid chunk or when we've passed the data chunk
        while (offset < view.byteLength - 8) {
            const chunkId = this.getChunkId(view, offset);
            const chunkSize = view.getUint32(offset + 4, true);

            // Validate chunk ID (must be 4 printable ASCII chars)
            const isValidChunkId = chunkId && chunkId.length === 4 && 
                                   /^[A-Za-z0-9_\- ]{4}$/.test(chunkId);

            if (!isValidChunkId || chunkSize < 0 || chunkSize > view.byteLength) {
                console.log(`Invalid chunk at offset ${offset}: "${chunkId}" (size: ${chunkSize}), stopping chunk collection`);
                break;
            }

            // Keep essential chunks, skip metadata chunks
            if (chunkId !== 'bext' && chunkId !== 'iXML' && chunkId !== 'JUNK') {
                console.log(`Keeping chunk: ${chunkId} (${chunkSize} bytes)`);
                newChunks.push({
                    id: chunkId,
                    data: originalBuffer.slice(offset + 8, offset + 8 + chunkSize)
                });

                // Track where data chunk ends
                if (chunkId === 'data') {
                    dataChunkEnd = offset + 8 + chunkSize;
                }
            } else {
                console.log(`Skipping chunk: ${chunkId} (${chunkSize} bytes)`);
            }

            offset += 8 + chunkSize;
            if (offset % 2 !== 0) offset++;

            // Safety: if we've gone past data chunk end by a lot, stop
            if (dataChunkEnd > 0 && offset > dataChunkEnd + 100 * 1024 * 1024) {
                console.log(`Passed data chunk by 100MB, stopping at offset ${offset}`);
                break;
            }
        }

        console.log(`Collected ${newChunks.length} chunks to keep`);

        // 2. Create new BEXT chunk
        const bextData = this.createBextChunk(metadata);
        newChunks.push({ id: 'bext', data: bextData });

        // 3. Create new iXML chunk
        const ixmlData = this.createIXMLChunk(metadata);
        newChunks.push({ id: 'iXML', data: ixmlData });

        // 4. Calculate total size
        let totalSize = 4; // "WAVE"
        for (const chunk of newChunks) {
            totalSize += 8 + chunk.data.byteLength;
            if (chunk.data.byteLength % 2 !== 0) totalSize++; // Pad
        }

        // 5. Write new file
        const newBuffer = new Uint8Array(totalSize + 8);
        const newView = new DataView(newBuffer.buffer);

        // RIFF Header
        this.writeString(newView, 0, 'RIFF');
        newView.setUint32(4, totalSize, true);
        this.writeString(newView, 8, 'WAVE');

        let writeOffset = 12;
        for (const chunk of newChunks) {
            this.writeString(newView, writeOffset, chunk.id);
            newView.setUint32(writeOffset + 4, chunk.data.byteLength, true);
            writeOffset += 8;

            newBuffer.set(new Uint8Array(chunk.data), writeOffset);
            writeOffset += chunk.data.byteLength;

            if (chunk.data.byteLength % 2 !== 0) {
                newView.setUint8(writeOffset, 0);
                writeOffset++;
            }
        }

        return new Blob([newBuffer], { type: 'audio/wav' });
    }

    createBextChunk(metadata) {
        let buffer;
        let view;

        if (metadata.bextRaw) {
            console.log('Preserving original bEXT. Length:', metadata.bextRaw.length);
            // Copy original data
            buffer = new ArrayBuffer(metadata.bextRaw.length);
            new Uint8Array(buffer).set(metadata.bextRaw);
            view = new DataView(buffer);
        } else {
            console.log('Creating new bEXT chunk');
            buffer = new ArrayBuffer(602); // Fixed size for BEXT V1 usually
            view = new DataView(buffer);
            // Version (2) - default to 1 if creating new
            view.setUint16(346, 1, true);
        }

        // Overwrite/Set fields with current metadata

        // Sync Scene/Take/Tape/Notes into Description if they exist
        // Sound Devices Format: sSCENE=SCENE sTAKE=TAKE sTAPE=TAPE sNOTE=NOTE
        let desc = metadata.description || '';
        console.log('Initial bEXT Description:', desc);
        console.log('Syncing metadata:', { scene: metadata.scene, take: metadata.take, tape: metadata.tape, notes: metadata.notes });

        // Helper to update or append a tag in the description
        const updateTag = (tag, val) => {
            if (!val && val !== '') return; // Allow empty string updates if tag exists

            // Regex to match tag=VALUE (until newline or end of string)
            // Sound Devices uses newlines often, so we match until \n or end
            const regex = new RegExp(`${tag}=[^\\r\\n]*`);

            if (regex.test(desc)) {
                desc = desc.replace(regex, `${tag}=${val}`);
            } else if (val) {
                // Append if not found and we have a value
                // Check if desc ends with newline
                const separator = (desc.endsWith('\n') || desc.endsWith('\r')) ? '' : '\r\n';
                desc = desc ? `${desc}${separator}${tag}=${val}` : `${tag}=${val}`;
            }
        };

        // Update Sound Devices style tags (always write, even if undefined - use empty string)
        updateTag('sSCENE', metadata.scene || '');
        updateTag('sTAKE', metadata.take || '');
        updateTag('sTAPE', metadata.tape || '');
        updateTag('sNOTE', metadata.notes || '');

        // Update sSPEED tag if FPS changed
        if (metadata.fps) {
            // Format FPS for Sound Devices (e.g., 023.976-ND, 025.000-ND)
            let fpsStr = parseFloat(metadata.fps).toFixed(3).padStart(7, '0');

            // Determine drop frame suffix
            let suffix = '-ND'; // Default to Non-Drop
            if (metadata.fps === '29.97df' || metadata.fps === '29.97' && metadata.fpsExact && metadata.fpsExact.denominator === 1001) {
                // Check if it's explicitly drop frame or implied
                if (metadata.fps === '29.97df') suffix = '-DF';
            }

            // Special handling for 23.98 -> 023.976
            if (metadata.fps === '23.98') {
                fpsStr = '023.976';
            }

            updateTag('sSPEED', `${fpsStr}${suffix}`);
            console.log(`Updated sSPEED in bEXT: ${fpsStr}${suffix}`);
        }

        // Also check for generic s= t= just in case (optional, but good for compatibility)
        // But since we saw sSCENE, we prioritize that.

        console.log('Final bEXT Description:', desc);

        // Update the metadata description so it persists
        metadata.description = desc;

        // Description (256)
        this.writeString(view, 0, desc, 256);
        // Originator (32)
        this.writeString(view, 256, metadata.originator || 'WebWavPlayer', 32);
        // OriginatorRef (32)
        this.writeString(view, 288, metadata.originatorRef || '', 32);
        // Date (10)
        this.writeString(view, 320, metadata.date || '', 10);
        // Time (8)
        this.writeString(view, 330, metadata.time || '', 8);

        // TimeReference (Low/High)
        const timeRef = BigInt(metadata.timeReference || 0);
        view.setUint32(338, Number(timeRef & 0xFFFFFFFFn), true);
        view.setUint32(342, Number(timeRef >> 32n), true);

        // Note: We preserve Version, UMID, Loudness, Reserved, and Coding History
        // by virtue of copying the raw buffer first.

        return buffer;
    }

    createIXMLChunk(metadata) {
        let xml;

        // If we have original iXML, preserve it and update only edited fields
        if (metadata.ixmlRaw) {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(metadata.ixmlRaw, "text/xml");

            this.updateXmlVal(xmlDoc, "PROJECT", metadata.project);
            this.updateXmlVal(xmlDoc, "SCENE", metadata.scene);
            this.updateXmlVal(xmlDoc, "TAKE", metadata.take);
            this.updateXmlVal(xmlDoc, "TAPE", metadata.tape);
            this.updateXmlVal(xmlDoc, "NOTE", metadata.notes);

            // --- TC Start Save Logic ---
            // No longer write TIMECODE_START (non-standard)
            // Write BWF_TIME_REFERENCE (samples)
            if (metadata.timeReference !== undefined) {
                this.updateXmlVal(xmlDoc, "BWF_TIME_REFERENCE", metadata.timeReference.toString());
            }

            // Always write a complete SPEED tag
            let speedEl = xmlDoc.querySelector("SPEED");
            if (!speedEl) {
                speedEl = xmlDoc.createElement("SPEED");
                if (xmlDoc.documentElement) xmlDoc.documentElement.appendChild(speedEl);
            }
            // Helper to set or create a child element
            function setSpeedChild(tag, value) {
                let el = speedEl.querySelector(tag);
                if (!el) {
                    el = xmlDoc.createElement(tag);
                    speedEl.appendChild(el);
                }
                el.textContent = value == null ? '' : value;
            }
            // NOTE (empty)
            setSpeedChild('NOTE', '');
            // MASTER_SPEED and CURRENT_SPEED (FPS as fraction)
            let fpsFrac = metadata.fpsExact ? `${metadata.fpsExact.numerator}/${metadata.fpsExact.denominator}` : '';
            setSpeedChild('MASTER_SPEED', fpsFrac);
            setSpeedChild('CURRENT_SPEED', fpsFrac);
            // TIMECODE_FLAG (always NDF for now)
            setSpeedChild('TIMECODE_FLAG', 'NDF');
            // TIMECODE_RATE (FPS as fraction)
            setSpeedChild('TIMECODE_RATE', fpsFrac);
            // FILE_SAMPLE_RATE
            setSpeedChild('FILE_SAMPLE_RATE', metadata.sampleRate || '');
            // AUDIO_BIT_DEPTH
            setSpeedChild('AUDIO_BIT_DEPTH', metadata.bitDepth || '');
            // DIGITIZER_SAMPLE_RATE
            setSpeedChild('DIGITIZER_SAMPLE_RATE', metadata.sampleRate || '');
            // TIMESTAMP_SAMPLE_RATE
            setSpeedChild('TIMESTAMP_SAMPLE_RATE', metadata.sampleRate || '');
            // TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI/LO
            let hi = '0', lo = '0';
            if (metadata.timeReference !== undefined) {
                const timeRef = BigInt(metadata.timeReference);
                hi = (timeRef >> 32n).toString();
                lo = (timeRef & 0xFFFFFFFFn).toString();
            }
            setSpeedChild('TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI', hi);
            setSpeedChild('TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO', lo);

            // Track names (unchanged)
            if (metadata.trackNames && metadata.trackNames.length > 0) {
                let trackList = xmlDoc.querySelector("TRACK_LIST");
                if (!trackList) {
                    trackList = xmlDoc.createElement("TRACK_LIST");
                    if (xmlDoc.documentElement) {
                        xmlDoc.documentElement.appendChild(trackList);
                    }
                }
                const existingTracks = Array.from(trackList.querySelectorAll("TRACK"));
                const maxCount = Math.max(existingTracks.length, metadata.trackNames.length);
                for (let i = 0; i < maxCount; i++) {
                    if (i < existingTracks.length) {
                        if (i < metadata.trackNames.length) {
                            const track = existingTracks[i];
                            let nameEl = track.querySelector("NAME");
                            if (!nameEl) {
                                nameEl = xmlDoc.createElement("NAME");
                                track.appendChild(nameEl);
                            }
                            nameEl.textContent = metadata.trackNames[i];
                        }
                    } else if (i < metadata.trackNames.length) {
                        const newTrack = xmlDoc.createElement("TRACK");
                        const channelIndex = xmlDoc.createElement("CHANNEL_INDEX");
                        channelIndex.textContent = (i + 1).toString();
                        newTrack.appendChild(channelIndex);
                        const nameEl = xmlDoc.createElement("NAME");
                        nameEl.textContent = metadata.trackNames[i];
                        newTrack.appendChild(nameEl);
                        trackList.appendChild(newTrack);
                    }
                }
            }

            const serializer = new XMLSerializer();
            xml = serializer.serializeToString(xmlDoc);
        } else {
            // No original iXML, create new
            xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
            xml += '<BWFXML>\n';
            xml += '  <PROJECT>' + (metadata.project || '') + '</PROJECT>\n';
            xml += '  <SCENE>' + (metadata.scene || '') + '</SCENE>\n';
            xml += '  <TAKE>' + (metadata.take || '') + '</TAKE>\n';
            xml += '  <TAPE>' + (metadata.tape || '') + '</TAPE>\n';
            xml += '  <NOTE>' + (metadata.notes || '') + '</NOTE>\n';
            if (metadata.tcStart) {
                // Do not write TIMECODE_START (non-standard)
            }
            if (metadata.timeReference !== undefined) {
                xml += '  <BWF_TIME_REFERENCE>' + metadata.timeReference + '</BWF_TIME_REFERENCE>\n';
            }
            if (metadata.sampleRate) {
                xml += '  <SPEED>\n';
                xml += '    <MASTER_SPEED>' + metadata.sampleRate + '</MASTER_SPEED>\n';
                xml += '    <CURRENT_SPEED>' + metadata.sampleRate + '</CURRENT_SPEED>\n';
                if (metadata.fps) {
                    const fpsMap = {
                        '23.98': '24', '24': '24', '25': '25', 
                        '29.97': '30', '29.97df': '30DF', '30': '30',
                        '48': '48', '50': '50', '59.94': '60', '60': '60'
                    };
                    xml += '    <TIMECODE_RATE>' + (fpsMap[metadata.fps] || '30') + '</TIMECODE_RATE>\n';
                    xml += '    <TIMECODE_FLAG>NDF</TIMECODE_FLAG>\n';
                }
                xml += '  </SPEED>\n';
            }
            const numChannels = metadata.channels || 1;
            if (numChannels > 0) {
                xml += '  <TRACK_LIST>\n';
                for (let i = 0; i < numChannels; i++) {
                    const trackName = (metadata.trackNames && metadata.trackNames[i]) 
                        ? metadata.trackNames[i] 
                        : `Track ${i + 1}`;
                    xml += '    <TRACK>\n';
                    xml += '      <CHANNEL_INDEX>' + (i + 1) + '</CHANNEL_INDEX>\n';
                    xml += '      <INTERLEAVE_INDEX>' + (i + 1) + '</INTERLEAVE_INDEX>\n';
                    xml += '      <NAME>' + trackName + '</NAME>\n';
                    xml += '    </TRACK>\n';
                }
                xml += '  </TRACK_LIST>\n';
            }
            xml += '</BWFXML>';
        }
        return new TextEncoder().encode(xml).buffer;
    }

    updateXmlVal(xmlDoc, tag, value) {
        // Update or create XML element with given tag and value
        let element = xmlDoc.querySelector(tag);
        if (element) {
            element.textContent = value || '';
        } else if (value) {
            // Create element if it doesn't exist and we have a value
            const root = xmlDoc.documentElement;
            if (root) {
                const newEl = xmlDoc.createElement(tag);
                newEl.textContent = value;
                root.appendChild(newEl);
            }
        }
    }

    writeString(view, offset, str, length = null) {
        for (let i = 0; i < str.length; i++) {
            if (length && i >= length) break;
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    pad(n) {
        return n.toString().padStart(2, '0');
    }

    /**
     * Extract raw iXML chunk from WAV file
     * @param {ArrayBuffer} arrayBuffer - WAV file buffer
     * @returns {string|null} iXML string or null if not found
     */
    getIXMLChunk(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        let offset = 12; // Skip RIFF header

        while (offset < view.byteLength - 8) {
            const chunkId = this.getChunkId(view, offset);
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId === 'iXML') {
                const chunkData = new Uint8Array(arrayBuffer, offset + 8, chunkSize);
                let xmlString = this.textDecoder.decode(chunkData);
                
                // Find the actual end of XML content (after closing BWFXML tag)
                const endTag = '</BWFXML>';
                const endIndex = xmlString.lastIndexOf(endTag);
                if (endIndex !== -1) {
                    xmlString = xmlString.substring(0, endIndex + endTag.length);
                }
                
                return xmlString.trim();
            }

            offset += 8 + chunkSize;
            if (chunkSize % 2 !== 0) offset++; // Pad byte
        }

        return null;
    }

    /**
     * Update iXML chunk in WAV file
     * @param {FileSystemFileHandle} fileHandle - File handle to write to
     * @param {ArrayBuffer} originalBuffer - Original WAV file buffer
     * @param {string} newIXMLString - New iXML content
     */
    async updateIXMLChunk(fileHandle, originalBuffer, newIXMLString) {
        const view = new DataView(originalBuffer);
        const chunks = [];
        let offset = 12;

        // Parse all chunks except iXML
        while (offset < view.byteLength - 8) {
            const chunkId = this.getChunkId(view, offset);
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId !== 'iXML') {
                // Copy chunk (including header)
                const chunkData = new Uint8Array(originalBuffer, offset, 8 + chunkSize);
                chunks.push({ id: chunkId, data: chunkData });
            }

            offset += 8 + chunkSize;
            if (chunkSize % 2 !== 0) offset++; // Pad byte
        }

        // Add new iXML chunk
        const ixmlBytes = new TextEncoder().encode(newIXMLString);
        const ixmlChunkSize = ixmlBytes.length;
        const ixmlChunk = new Uint8Array(8 + ixmlChunkSize + (ixmlChunkSize % 2));
        const ixmlView = new DataView(ixmlChunk.buffer);

        // Chunk ID
        ixmlView.setUint8(0, 'i'.charCodeAt(0));
        ixmlView.setUint8(1, 'X'.charCodeAt(0));
        ixmlView.setUint8(2, 'M'.charCodeAt(0));
        ixmlView.setUint8(3, 'L'.charCodeAt(0));
        // Chunk Size
        ixmlView.setUint32(4, ixmlChunkSize, true);
        // Chunk Data
        ixmlChunk.set(ixmlBytes, 8);

        chunks.push({ id: 'iXML', data: ixmlChunk });

        // Calculate total size
        const totalDataSize = chunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0);
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
            newBuffer.set(chunk.data, writeOffset);
            writeOffset += chunk.data.byteLength;
        }

        // Write to file
        const writable = await fileHandle.createWritable();
        await writable.write(newBuffer);
        await writable.truncate(newFileSize);
        await writable.close();
    }

    /**
     * Parse cue chunk from WAV file
     * @param {ArrayBuffer} arrayBuffer - WAV file buffer
     * @returns {Array|null} - Array of cue points {id, samplePosition} or null if not found
     */
    parseCueChunk(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        let offset = 12; // Skip RIFF header

        while (offset < view.byteLength - 8) {
            const chunkId = this.getChunkId(view, offset);
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId === 'cue ') {
                console.log('Found cue chunk at offset', offset);
                const cuePoints = [];
                const numCuePoints = view.getUint32(offset + 8, true);
                
                let cueOffset = offset + 12; // After chunk header + num cue points
                
                for (let i = 0; i < numCuePoints; i++) {
                    const cueId = view.getUint32(cueOffset, true);
                    const playOrder = view.getUint32(cueOffset + 4, true);
                    const dataChunkId = this.getChunkId(view, cueOffset + 8);
                    const chunkStart = view.getUint32(cueOffset + 12, true);
                    const blockStart = view.getUint32(cueOffset + 16, true);
                    const sampleOffset = view.getUint32(cueOffset + 20, true); // Actual sample position
                    
                    console.log(`Cue point ${i}: id=${cueId}, samplePosition=${sampleOffset}`);
                    
                    cuePoints.push({
                        id: cueId,
                        samplePosition: sampleOffset
                    });
                    
                    cueOffset += 24; // Each cue point is 24 bytes
                }
                
                console.log(`Parsed ${cuePoints.length} cue points`);
                return cuePoints;
            }

            offset += 8 + chunkSize;
            if (chunkSize % 2 !== 0) offset++; // Pad byte
        }

        return null;
    }

    /**
     * Create cue chunk binary data
     * @param {Array} markers - Array of markers with {time} property
     * @param {number} sampleRate - Sample rate in Hz
     * @returns {Uint8Array} - Binary cue chunk data (including header)
     */
    createCueChunk(markers, sampleRate) {
        if (!markers || markers.length === 0) {
            return null;
        }

        const numCuePoints = markers.length;
        const chunkDataSize = 4 + (numCuePoints * 24); // 4 bytes for count + 24 bytes per cue point
        const totalSize = 8 + chunkDataSize; // 8 byte header + data
        const paddedSize = totalSize + (chunkDataSize % 2); // Pad to even byte
        
        const buffer = new Uint8Array(paddedSize);
        const view = new DataView(buffer.buffer);
        
        // Write chunk ID 'cue '
        view.setUint8(0, 'c'.charCodeAt(0));
        view.setUint8(1, 'u'.charCodeAt(0));
        view.setUint8(2, 'e'.charCodeAt(0));
        view.setUint8(3, ' '.charCodeAt(0));
        
        // Write chunk size
        view.setUint32(4, chunkDataSize, true);
        
        // Write number of cue points
        view.setUint32(8, numCuePoints, true);
        
        // Write each cue point
        let offset = 12;
        markers.forEach((marker, index) => {
            const samplePosition = Math.round(marker.time * sampleRate);
            
            view.setUint32(offset, index + 1, true);        // Cue point ID
            view.setUint32(offset + 4, samplePosition, true); // Position in samples
            view.setUint8(offset + 8, 'd'.charCodeAt(0));   // fccChunk 'data'
            view.setUint8(offset + 9, 'a'.charCodeAt(0));
            view.setUint8(offset + 10, 't'.charCodeAt(0));
            view.setUint8(offset + 11, 'a'.charCodeAt(0));
            view.setUint32(offset + 12, 0, true);            // chunkStart
            view.setUint32(offset + 16, 0, true);            // blockStart
            view.setUint32(offset + 20, samplePosition, true); // sampleOffset
            
            offset += 24;
        });
        
        console.log(`Created cue chunk with ${numCuePoints} markers`);
        return buffer;
    }

    /**
     * Parse sync points from iXML string
     * @param {string} ixmlString - iXML XML string
     * @returns {Array|null} - Array of sync points {time, label} or null
     */
    parseIXMLSyncPoints(ixmlString) {
        if (!ixmlString) return null;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(ixmlString, 'text/xml');
            
            const syncPointList = xmlDoc.querySelector('SYNC_POINT_LIST');
            if (!syncPointList) return null;
            
            const syncPoints = [];
            const syncPointNodes = syncPointList.querySelectorAll('SYNC_POINT');
            
            syncPointNodes.forEach(node => {
                const lowNode = node.querySelector('SYNC_POINT_LOW');
                const highNode = node.querySelector('SYNC_POINT_HIGH');
                const commentNode = node.querySelector('SYNC_POINT_COMMENT');
                
                if (lowNode && highNode) {
                    const low = parseInt(lowNode.textContent);
                    const high = parseInt(highNode.textContent);
                    const samplePosition = (high * 0x100000000) + low; // Combine 64-bit value
                    
                    // We need sample rate to convert to time - will be provided separately
                    syncPoints.push({
                        samplePosition,
                        label: commentNode ? commentNode.textContent : ''
                    });
                }
            });
            
            console.log(`Parsed ${syncPoints.length} sync points from iXML`);
            return syncPoints.length > 0 ? syncPoints : null;
        } catch (err) {
            console.error('Error parsing iXML sync points:', err);
            return null;
        }
    }

    /**
     * Inject cue markers into iXML as SYNC_POINT entries
     * @param {string} existingIXML - Existing iXML string (or null to create new)
     * @param {Array} markers - Array of markers with {time, label} properties
     * @param {number} sampleRate - Sample rate in Hz
     * @returns {string} - Updated iXML string
     */
    injectCuesIntoIXML(existingIXML, markers, sampleRate) {
        let xmlDoc;
        
        if (existingIXML) {
            // Parse existing iXML
            const parser = new DOMParser();
            xmlDoc = parser.parseFromString(existingIXML, 'text/xml');
        } else {
            // Create minimal iXML structure
            xmlDoc = document.implementation.createDocument(null, 'BWFXML', null);
        }
        
        // Find or create SYNC_POINT_LIST
        let syncPointList = xmlDoc.querySelector('SYNC_POINT_LIST');
        if (!syncPointList) {
            syncPointList = xmlDoc.createElement('SYNC_POINT_LIST');
            xmlDoc.documentElement.appendChild(syncPointList);
        }
        
        // Clear existing sync points
        while (syncPointList.firstChild) {
            syncPointList.removeChild(syncPointList.firstChild);
        }
        
        // Add new sync points
        markers.forEach((marker, index) => {
            const samplePosition = Math.round(marker.time * sampleRate);
            const low = samplePosition & 0xFFFFFFFF;
            const high = Math.floor(samplePosition / 0x100000000);
            
            const syncPoint = xmlDoc.createElement('SYNC_POINT');
            
            const typeNode = xmlDoc.createElement('SYNC_POINT_TYPE');
            typeNode.textContent = 'CUE';
            syncPoint.appendChild(typeNode);
            
            const functionNode = xmlDoc.createElement('SYNC_POINT_FUNCTION');
            functionNode.textContent = 'MARKER';
            syncPoint.appendChild(functionNode);
            
            if (marker.label) {
                const commentNode = xmlDoc.createElement('SYNC_POINT_COMMENT');
                commentNode.textContent = marker.label;
                syncPoint.appendChild(commentNode);
            }
            
            const lowNode = xmlDoc.createElement('SYNC_POINT_LOW');
            lowNode.textContent = low.toString();
            syncPoint.appendChild(lowNode);
            
            const highNode = xmlDoc.createElement('SYNC_POINT_HIGH');
            highNode.textContent = high.toString();
            syncPoint.appendChild(highNode);
            
            syncPointList.appendChild(syncPoint);
        });
        
        // Serialize back to string
        const serializer = new XMLSerializer();
        const xmlString = serializer.serializeToString(xmlDoc);
        
        console.log(`Injected ${markers.length} cue markers into iXML`);
        return xmlString;
    }

    /**
     * Update WAV file with cue chunk and updated iXML
     * @param {FileSystemFileHandle} fileHandle - File handle to write to
     * @param {ArrayBuffer} originalBuffer - Original WAV file buffer
     * @param {Uint8Array} cueChunk - Binary cue chunk data (or null to skip)
     * @param {string} newIXMLString - New iXML content (or null to skip)
     */
    async updateCueMarkers(fileHandle, originalBuffer, cueChunk, newIXMLString) {
        const view = new DataView(originalBuffer);
        const chunks = [];
        let offset = 12;

        // Parse all chunks except 'cue ' and 'iXML'
        while (offset < view.byteLength - 8) {
            const chunkId = this.getChunkId(view, offset);
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId !== 'cue ' && chunkId !== 'iXML') {
                // Copy chunk (including header)
                const chunkData = new Uint8Array(originalBuffer, offset, 8 + chunkSize + (chunkSize % 2));
                chunks.push({ id: chunkId, data: chunkData });
            }

            offset += 8 + chunkSize;
            if (chunkSize % 2 !== 0) offset++; // Pad byte
        }

        // Add new cue chunk if provided
        if (cueChunk) {
            chunks.push({ id: 'cue ', data: cueChunk });
        }

        // Add new iXML chunk if provided
        if (newIXMLString) {
            const ixmlBytes = new TextEncoder().encode(newIXMLString);
            const ixmlChunkSize = ixmlBytes.length;
            const ixmlChunk = new Uint8Array(8 + ixmlChunkSize + (ixmlChunkSize % 2));
            const ixmlView = new DataView(ixmlChunk.buffer);

            ixmlView.setUint8(0, 'i'.charCodeAt(0));
            ixmlView.setUint8(1, 'X'.charCodeAt(0));
            ixmlView.setUint8(2, 'M'.charCodeAt(0));
            ixmlView.setUint8(3, 'L'.charCodeAt(0));
            ixmlView.setUint32(4, ixmlChunkSize, true);
            ixmlChunk.set(ixmlBytes, 8);

            chunks.push({ id: 'iXML', data: ixmlChunk });
        }

        // Calculate total size
        const totalDataSize = chunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0);
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
            newBuffer.set(chunk.data, writeOffset);
            writeOffset += chunk.data.byteLength;
        }

        // Write to file
        const writable = await fileHandle.createWritable();
        await writable.write(newBuffer);
        await writable.close();
        
        console.log('Successfully updated cue markers in WAV file');
    }

    /**
     * Repair iXML metadata in a file
     * @param {FileSystemFileHandle} fileHandle - File handle to write to
     * @param {ArrayBuffer} originalBuffer - Original WAV file buffer
     * @param {string} repairedIXML - The repaired iXML content
     */
    async repairIXMLInFile(fileHandle, originalBuffer, repairedIXML) {
        console.log('[repairIXMLInFile] Starting repair');
        console.log('[repairIXMLInFile] Repaired iXML length:', repairedIXML.length);
        console.log('[repairIXMLInFile] Original buffer size:', originalBuffer.byteLength);
        
        // Use the existing updateIXMLChunk method to write the repaired iXML
        await this.updateIXMLChunk(fileHandle, originalBuffer, repairedIXML);
        
        console.log('[repairIXMLInFile] Successfully wrote repaired iXML to file');
    }
}

