export class MetadataHandler {
    constructor() {
        this.textDecoder = new TextDecoder('utf-8');
    }

    async parseFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const dataView = new DataView(arrayBuffer);

        if (this.isWav(dataView)) {
            return this.parseWav(dataView, file.name);
        } else {
            // Placeholder for MP3/AAC or fallback
            return {
                filename: file.name,
                format: file.type || 'unknown',
                duration: 'Unknown',
                trackCount: '?',
                // ... other defaults
            };
        }
    }

    isWav(view) {
        return view.getUint32(0, false) === 0x52494646 && // RIFF
            view.getUint32(8, false) === 0x57415645;   // WAVE
    }

    parseWav(view, filename) {
        const metadata = {
            filename: filename,
            format: 'WAV',
            fileSize: view.byteLength,
            chunks: {}
        };

        let offset = 12; // Skip RIFF header
        while (offset < view.byteLength) {
            const chunkId = this.getChunkId(view, offset);
            const chunkSize = view.getUint32(offset + 4, true);

            // Store chunk info for later writing
            metadata.chunks[chunkId] = { offset, size: chunkSize };

            if (chunkId === 'fmt ') {
                metadata.channels = view.getUint16(offset + 10, true);
                metadata.sampleRate = view.getUint32(offset + 12, true);
                metadata.bitDepth = view.getUint16(offset + 22, true);
            } else if (chunkId === 'bext') {
                this.parseBext(view, offset + 8, chunkSize, metadata);
            } else if (chunkId === 'iXML') {
                this.parseIXML(view, offset + 8, chunkSize, metadata);
            } else if (chunkId === 'data') {
                metadata.audioDataOffset = offset + 8;
                metadata.audioDataSize = chunkSize;
                // Calculate duration if fmt was parsed
                if (metadata.sampleRate && metadata.channels && metadata.bitDepth) {
                    const bytesPerSample = metadata.bitDepth / 8;
                    const totalSamples = chunkSize / (metadata.channels * bytesPerSample);
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
    }

    parseIXML(view, offset, size, metadata) {
        const xmlStr = this.readString(view, offset, size);

        // Store the original iXML for preservation
        metadata.ixmlRaw = xmlStr;

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlStr, "text/xml");

        metadata.scene = this.getXmlVal(xmlDoc, "SCENE");
        metadata.take = this.getXmlVal(xmlDoc, "TAKE");
        metadata.tape = this.getXmlVal(xmlDoc, "TAPE");
        metadata.project = this.getXmlVal(xmlDoc, "PROJECT");
        metadata.notes = this.getXmlVal(xmlDoc, "NOTE");

        // Parse FPS/Speed - the SPEED field often contains multiple values
        // Format: "24000/1001 24000/1001 NDF 24000/1001 48000 24 ..."
        // We want the first value and convert fractions to decimal FOR DISPLAY
        // But store the exact fraction for precise calculations
        const speedVal = this.getXmlVal(xmlDoc, "SPEED") || this.getXmlVal(xmlDoc, "FRAME_RATE");
        if (speedVal) {
            const firstValue = speedVal.trim().split(/\s+/)[0]; // Get first token
            if (firstValue.includes('/')) {
                // Store exact fraction for calculations
                const [num, den] = firstValue.split('/').map(Number);
                metadata.fpsExact = { numerator: num, denominator: den };
                metadata.fps = (num / den).toFixed(2); // Display value
            } else {
                const value = parseFloat(firstValue);
                metadata.fpsExact = { numerator: value, denominator: 1 };
                metadata.fps = value.toFixed(2);
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

    formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${this.pad(h)}:${this.pad(m)}:${this.pad(s)}`;
    }

    async saveWav(file, metadata) {
        const originalBuffer = await file.arrayBuffer();
        const view = new DataView(originalBuffer);

        // We need to reconstruct the file.
        // Strategy: Copy all chunks EXCEPT bext and iXML.
        // Append new bext and iXML chunks.
        // Update RIFF size.

        const newChunks = [];
        let offset = 12;

        // 1. Collect existing chunks we want to keep (fmt, data, etc.)
        while (offset < view.byteLength) {
            const chunkId = this.getChunkId(view, offset);
            const chunkSize = view.getUint32(offset + 4, true);

            if (chunkId !== 'bext' && chunkId !== 'iXML' && chunkId !== 'JUNK') {
                newChunks.push({
                    id: chunkId,
                    data: originalBuffer.slice(offset + 8, offset + 8 + chunkSize)
                });
            }

            offset += 8 + chunkSize;
            if (offset % 2 !== 0) offset++;
        }

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

        // Update Sound Devices style tags
        if (metadata.scene) updateTag('sSCENE', metadata.scene);
        if (metadata.take) updateTag('sTAKE', metadata.take);
        if (metadata.tape) updateTag('sTAPE', metadata.tape);
        if (metadata.notes !== undefined) updateTag('sNOTE', metadata.notes);

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
            console.log('Preserving original iXML. Original length:', metadata.ixmlRaw.length);

            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(metadata.ixmlRaw, "text/xml");

            // Update only the fields we allow editing
            this.updateXmlVal(xmlDoc, "PROJECT", metadata.project);
            this.updateXmlVal(xmlDoc, "SCENE", metadata.scene);
            this.updateXmlVal(xmlDoc, "TAKE", metadata.take);
            this.updateXmlVal(xmlDoc, "TAPE", metadata.tape);
            this.updateXmlVal(xmlDoc, "NOTE", metadata.notes);

            // Update track names if they exist
            if (metadata.trackNames && metadata.trackNames.length > 0) {
                const tracks = xmlDoc.querySelectorAll("TRACK");
                tracks.forEach((track, i) => {
                    if (i < metadata.trackNames.length) {
                        const nameEl = track.querySelector("NAME");
                        if (nameEl) {
                            nameEl.textContent = metadata.trackNames[i];
                        }
                    }
                });
            }

            // Serialize back to string
            const serializer = new XMLSerializer();
            xml = serializer.serializeToString(xmlDoc);

            console.log('Updated iXML length:', xml.length);
            console.log('First 500 chars of updated iXML:', xml.substring(0, 500));
        } else {
            console.log('No original iXML found, creating minimal version');
            // No original iXML, create minimal version (fallback)
            xml = '<BWFXML><PROJECT>' + (metadata.project || '') + '</PROJECT>';
            xml += '<SCENE>' + (metadata.scene || '') + '</SCENE>';
            xml += '<TAKE>' + (metadata.take || '') + '</TAKE>';
            xml += '<TAPE>' + (metadata.tape || '') + '</TAPE>';
            xml += '<NOTE>' + (metadata.notes || '') + '</NOTE>';

            if (metadata.trackNames && metadata.trackNames.length > 0) {
                xml += '<TRACK_LIST>';
                metadata.trackNames.forEach((name, i) => {
                    xml += `<TRACK><CHANNEL_INDEX>${i + 1}</CHANNEL_INDEX><NAME>${name}</NAME></TRACK>`;
                });
                xml += '</TRACK_LIST>';
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
                return this.textDecoder.decode(chunkData);
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
        await writable.close();
    }
}

