# Large File Support Strategy (>2GB)
**Author:** GitHub Copilot  
**Date:** February 14, 2026  
**Status:** Phase 2 IMPLEMENTED (Core Streaming Complete)

## Implementation Progress

### ✅ Phase 1: Foundation (COMPLETED)
**Branch:** `feature/large-file-support`  
**Completion Date:** February 14, 2026

**Implemented:**
1. ✅ Feature flag system (`beta_streaming` in localStorage)
   - Default: disabled (opt-in for testing)
   - UI control in Settings modal
   - Console logging for debugging
2. ✅ PeakFileCache class ([peak-file-cache.js](../apps/web/peak-file-cache.js))
   - IndexedDB-based peak storage
   - Generates min/max peaks at 256 samples-per-peak
   - Reads files in 10MB chunks
   - Supports 16/24/32-bit audio
3. ✅ ChunkedAudioFile class ([chunked-audio-file.js](../apps/web/chunked-audio-file.js))
   - Reads files in configurable chunks (default 100MB)
   - Parses WAV/RF64 headers without full load
   - Streaming API for processing chunks
4. ✅ Enhanced RF64 support in MetadataHandler
   - `isRF64()` helper method
   - `readUint64LE()` for 64-bit size fields
   - `parseDS64Chunk()` for RF64 extended sizes
   - Updated parseWav() to use new helpers

### ✅ Phase 2: Core Streaming (COMPLETED)
**Completion Date:** February 14, 2026

**Implemented:**
1. ✅ Peak-based waveform rendering
   - `loadAudioWithStreaming()` - Streaming file load path
   - `renderWaveformFromPeaks()` - Renders waveform from peak data
   - `renderCueMarkersFromPeaks()` - Marker rendering without AudioBuffer
   - Respects mixer mute/solo state
2. ✅ AudioEngine streaming support
   - `playStreaming()` - Loads and plays audio in chunks
   - `isStreamingMode()` - Detects streaming vs legacy mode
   - `clearStreaming()` - Cleanup method
   - Streaming metadata storage (file, metadata, peaks)
3. ✅ Integrated playback
   - Updated `togglePlay()` to support both modes
   - Automatic mode detection
   - Mixer integration maintained
4. ✅ UI indicators
   - Shows "(Streaming Mode)" in player filename
   - Peak generation progress display
   - Maintains all existing UI controls

**Status:** BETA - Ready for testing with files <2GB. Files >2GB will load up to 2GB for playback.

**Limitations (Phase 2):**
- Grouped files not yet supported in streaming mode
- Large files (>2GB) load first 2GB only for playback
- No chunk pre-buffering (may have gaps on large files)
- No loop support in streaming mode yet

**Next Steps:** Phase 3 (Advanced Features - Splitting, Combining, Export)

---

## Executive Summary

Wave Agent X currently limits audio playback/waveform to files ≤2GB due to JavaScript's ArrayBuffer size limitation (~2GB in V8 engine). This affects both web and Electron versions. This document outlines strategies to support larger files, including RF64 format (>4GB WAV files), with associated risks and implementation complexity.

---

## Current Architecture Limitations

### 1. **JavaScript ArrayBuffer Limit (~2GB)**
- V8 engine (Chrome, Node.js, Electron) cannot allocate ArrayBuffer >~2GB
- Affects: `new ArrayBuffer()`, `new Uint8Array()`, all TypedArrays
- **Not browser-specific** - applies to Electron/Node.js as well
- Hard limit in V8 source code: `Smi::kMaxValue` (~2^30 bytes on 64-bit)

### 2. **Current Audio Pipeline**
```
File Load → ArrayBuffer (full file) → decodeAudioData() → AudioBuffer → Playback
```
- **Problem:** Entire file must fit in single ArrayBuffer
- Web Audio API `decodeAudioData()` expects complete audio data
- Waveform generation processes full PCM data
- Mixer assumes `AudioEngine.buffer` contains entire audio

### 3. **Files Currently Affected**
- WAV files >2GB (e.g., multichannel 192kHz 32-bit recordings)
- RF64 files (WAV variant for files >4GB - standard WAV limited to 4GB by 32-bit size field)
- Long-duration high-resolution audio

### 4. **Current Workaround**
- Files >2GB show "Metadata Only" mode
- Waveform/playback disabled
- Metadata viewing/editing still functional
- See: `apps/web/app.js` lines 2424-2490

---

## RF64 Format Overview

### What is RF64?
- **RIFF64** - Extended WAV format supporting files >4GB
- Standard WAV uses 32-bit size field (4GB limit)
- RF64 uses 64-bit size fields via "ds64" chunk
- EBU Tech 3306 standard
- **Audio data format identical to WAV** - only headers differ

### RF64 Structure
```
Offset   Size   Field
------   ----   -----
0        4      "RF64" signature (not "RIFF")
4        4      0xFFFFFFFF (placeholder)
8        4      "WAVE"
12       ...    "ds64" chunk (contains 64-bit sizes)
...      ...    "fmt " chunk (format)
...      ...    "data" chunk (audio data)
```

### Current RF64 Support
- **Partially implemented** in `audio-engine.js` (manual decode path)
- Detection: Check for `0x52463634` ("RF64") signature
- Manual WAV decoder handles RF64 if decoding succeeds
- **Issue:** Still requires loading full file into ArrayBuffer

---

## Strategy 1: Streaming/Chunked Decoding ⭐ **RECOMMENDED**

### Overview
Break file into manageable chunks (~100-500MB), decode separately, manage array of AudioBuffers.

### Architecture Changes

#### 1.1 File Reading Layer
```javascript
// New class in audio-engine.js or new file
class ChunkedAudioFile {
  constructor(file, chunkSizeMB = 200) {
    this.file = file;
    this.chunkSize = chunkSizeMB * 1024 * 1024;
    this.chunks = [];
    this.metadata = null;
  }
  
  async loadChunk(index) {
    const start = index * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.file.size);
    const blob = this.file.slice(start, end);
    return await blob.arrayBuffer();
  }
  
  async loadAllChunks(onProgress) {
    const numChunks = Math.ceil(this.file.size / this.chunkSize);
    for (let i = 0; i < numChunks; i++) {
      const chunk = await this.loadChunk(i);
      this.chunks.push(chunk);
      onProgress((i + 1) / numChunks * 100);
    }
  }
}
```

#### 1.2 Audio Decoding
**Problem:** `decodeAudioData()` cannot decode partial WAV files (needs headers)

**Solution A: Header Replication**
- Parse WAV header once
- For each chunk, construct synthetic WAV file:
  ```
  WAV Header (44 bytes) + Chunk Audio Data
  ```
- Decode each synthetic WAV separately
- **Caveat:** Chunk boundaries must align with sample frames

**Solution B: Manual PCM Decoder**
- Extend `manualWavDecode()` in `audio-engine.js`
- Process PCM data directly without Web Audio API
- Create AudioBuffer manually from PCM samples
- **Benefit:** Full control over chunk processing
- **Drawback:** More complex, no hardware acceleration

#### 1.3 Playback Management
```javascript
// Modified AudioEngine
class AudioEngine {
  constructor() {
    this.buffers = []; // Array of AudioBuffers (one per chunk)
    this.chunkDurations = [];
    this.currentChunk = 0;
  }
  
  play() {
    this.playChunk(this.currentChunk, 0);
  }
  
  playChunk(chunkIndex, offsetInChunk) {
    const source = this.audioCtx.createBufferSource();
    source.buffer = this.buffers[chunkIndex];
    source.connect(this.mixer.masterGain);
    source.start(0, offsetInChunk);
    
    source.onended = () => {
      if (chunkIndex + 1 < this.buffers.length) {
        this.playChunk(chunkIndex + 1, 0);
      }
    };
  }
  
  seek(timeSeconds) {
    // Calculate which chunk contains this time
    let accumulated = 0;
    for (let i = 0; i < this.chunkDurations.length; i++) {
      if (accumulated + this.chunkDurations[i] > timeSeconds) {
        this.currentChunk = i;
        const offsetInChunk = timeSeconds - accumulated;
        this.playChunk(i, offsetInChunk);
        return;
      }
      accumulated += this.chunkDurations[i];
    }
  }
}
```

#### 1.4 Waveform Generation
- Process chunks sequentially
- Generate waveform segment per chunk
- Composite onto canvas in passes
- **Optimization:** Downsample aggressively for display (e.g., max 10k points per canvas width)

### Implementation Complexity
- **High** (3-4 weeks development)
- Requires refactoring AudioEngine, waveform renderer
- Extensive testing for chunk boundaries, seeking, looping

### Pros
- Works in both web and Electron
- No external dependencies
- True streaming - minimal memory overhead
- Can support files of any size (tested up to 50GB theoretically)

### Cons
- Complex playback state management
- Potential audio gaps at chunk boundaries (requires careful timing)
- Seeking may be slower
- Automation playback needs chunk-aware time indexing

---

## Strategy 2: External Processing (Electron Only)

### Overview
Use command-line tools (ffmpeg, sox) via `child_process` to pre-process large files.

### Architecture

#### 2.1 External Tool Integration
```javascript
// In Electron main process (main.ts)
import { spawn } from 'child_process';

ipcMain.handle('audio:decode-large-file', async (event, filePath) => {
  // Use ffmpeg to extract audio segments
  const ffmpeg = spawn('ffmpeg', [
    '-i', filePath,
    '-f', 's16le',        // Raw PCM 16-bit
    '-ar', '48000',       // Resample to 48kHz
    '-ac', '2',           // Stereo (adjust per file)
    'pipe:1'              // Output to stdout
  ]);
  
  const chunks = [];
  ffmpeg.stdout.on('data', (chunk) => {
    chunks.push(chunk);
  });
  
  return new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
});
```

#### 2.2 Waveform Cache
- Generate waveform data externally (e.g., audiowaveform tool)
- Cache to JSON file in temp directory
- Load cached waveform instead of regenerating
- **Format:** `{ samples: [...], duration: 123.45, channels: 8 }`

#### 2.3 Segment Caching
- Pre-decode file into 100MB segments
- Store in `~/.wave-agent-cache/[file-hash]/`
- Load segments on-demand for playback
- Clear cache when disk space low

### Implementation Complexity
- **Medium** (2-3 weeks)
- Requires bundling external tools or requiring user installation
- Only works in Electron (not web)

### Pros
- Leverages proven, optimized tools (ffmpeg)
- Can transcode/resample to reduce memory
- Hardware-accelerated decoding possible
- Easier waveform generation

### Cons
- **Electron-only** - web version still limited
- Requires bundling ffmpeg (~50MB) or user installation
- Platform-specific binaries (macOS/Windows/Linux)
- Security concerns (executing external processes)
- Potential licensing issues (ffmpeg GPL)

---

## Strategy 3: Partial/On-Demand Loading

### Overview
Load only the portion of file currently needed (e.g., visible waveform region, playback segment).

### Architecture

#### 3.1 Initial Load
- Load first 2GB for immediate playback
- Parse metadata from header (already implemented)
- Show waveform for loaded portion only

#### 3.2 On-Demand Segments
```javascript
class OnDemandAudioLoader {
  constructor(file) {
    this.file = file;
    this.cache = new Map(); // segment index -> ArrayBuffer
    this.segmentSize = 500 * 1024 * 1024; // 500MB
  }
  
  async getSegment(index) {
    if (this.cache.has(index)) {
      return this.cache.get(index);
    }
    
    const start = index * this.segmentSize;
    const end = Math.min(start + this.segmentSize, this.file.size);
    const blob = this.file.slice(start, end);
    const buffer = await blob.arrayBuffer();
    
    this.cache.set(index, buffer);
    
    // LRU cache eviction (keep max 3 segments = 1.5GB)
    if (this.cache.size > 3) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    return buffer;
  }
}
```

#### 3.3 Seek Behavior
- On seek, load segment containing target time
- Show loading indicator during load
- Cache 2-3 segments in memory (LRU)

#### 3.4 Waveform
- Generate low-resolution overview from samples (every Nth sample)
- Load full-resolution waveform for visible region only
- **Two-tier approach:**
  1. Overview: 10k samples for full file
  2. Detail: Full resolution for visible zoom region

### Implementation Complexity
- **Low-Medium** (1-2 weeks)
- Minimal changes to existing code
- Good incremental approach

### Pros
- Simpler than full streaming
- Works in web and Electron
- Progressive enhancement (load more as needed)
- Reasonable memory usage

### Cons
- Seeking has loading delay
- Not true large file support (still limited by memory for playback)
- Waveform incomplete without loading full file
- User experience degraded compared to full load

---

## Strategy 4: Memory-Mapped Files (Electron Only, Advanced)

### Overview
Use Node.js file descriptors with `fs.read()` to access file segments without loading entire file.

### Architecture
```javascript
// In Electron main process
import fs from 'fs/promises';

class MemoryMappedAudio {
  async open(filePath) {
    this.fd = await fs.open(filePath, 'r');
    this.stat = await this.fd.stat();
  }
  
  async readRange(start, length) {
    const buffer = Buffer.allocUnsafe(length);
    await this.fd.read(buffer, 0, length, start);
    return buffer;
  }
  
  async close() {
    await this.fd.close();
  }
}
```

### Implementation Complexity
- **Very High** (4-6 weeks)
- Requires custom audio decoder (cannot use Web Audio API)
- Complex IPC for streaming data from main to renderer
- Need to implement PCM → AudioBuffer conversion

### Pros
- True zero-copy access (most efficient memory usage)
- Can handle arbitrarily large files
- Precise control over I/O

### Cons
- **Electron-only**
- Cannot leverage Web Audio API
- Must implement full audio pipeline manually
- Complex error handling
- Platform-specific optimizations needed

---

## RF64-Specific Considerations

### Parsing RF64 Headers
```javascript
// Extend metadata-handler.js
parseRF64(dataView) {
  // Check for RF64 signature
  const signature = String.fromCharCode(
    dataView.getUint8(0),
    dataView.getUint8(1),
    dataView.getUint8(2),
    dataView.getUint8(3)
  );
  
  if (signature !== 'RF64') return null;
  
  // Find ds64 chunk (contains 64-bit sizes)
  const ds64 = this.findChunk(dataView, 'ds64');
  if (!ds64) throw new Error('RF64 file missing ds64 chunk');
  
  // Read 64-bit sizes (little-endian)
  const riffSize = dataView.getBigUint64(ds64.offset, true);
  const dataSize = dataView.getBigUint64(ds64.offset + 8, true);
  const sampleCount = dataView.getBigUint64(ds64.offset + 16, true);
  
  return { riffSize, dataSize, sampleCount };
}
```

### RF64 + Chunking
- Parse ds64 chunk to get true file size (not 0xFFFFFFFF placeholder)
- Calculate chunk boundaries from 64-bit dataSize
- Ensure chunks start at sample-frame boundaries
- **Critical:** RF64 audio data identical to WAV - same PCM format

### Metadata in RF64
- bEXT, iXML chunks work identically to WAV
- Position may differ due to ds64 chunk
- Large files may have metadata at EOF (already handled in `metadata-handler.js`)

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Audio Gaps at Chunk Boundaries** | High | High | Precise sample-frame alignment, crossfading |
| **Memory Leaks in Chunk Management** | Medium | High | Rigorous testing, explicit cleanup, LRU cache |
| **Seeking Latency** | High | Medium | Pre-buffer adjacent chunks, async loading UI |
| **Data Corruption on Metadata Write** | Low | Critical | Validate writes, backup before save, atomic operations |
| **Cross-Platform Inconsistencies** | Medium | Medium | Extensive testing on Mac/Windows/Linux |
| **Performance Degradation** | Medium | Medium | Profiling, optimize hot paths, Web Worker offloading |
| **Incomplete Feature Parity** | High | Low | Clearly document limitations, graceful degradation |

### Development Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Scope Creep** | High | High | Phased implementation, MVP first |
| **Extended Timeline** | High | Medium | Allocate 4-6 weeks, buffer for unknowns |
| **Regression in Existing Features** | Medium | High | Comprehensive test suite, feature flags |
| **User Confusion** | Medium | Medium | Clear UI indicators (loading, limitations), documentation |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Limited User Base for >2GB Files** | Medium | Low | Survey users, prioritize based on demand |
| **Support Burden Increase** | Medium | Medium | Detailed error messages, troubleshooting docs |
| **Competing Priorities** | High | Medium | Evaluate ROI, consider deferring |

---

## Recommended Implementation Plan

### Phase 1: Foundation (Week 1-2)
1. **Extend RF64 parsing** in `metadata-handler.js`
   - Full ds64 chunk support
   - 64-bit size field handling
   - Test with sample RF64 files
   
2. **Implement ChunkedAudioFile class**
   - File slicing logic
   - Progress callbacks
   - Memory management

3. **Feature flag system**
   - `localStorage` setting to enable/disable large file support
   - UI toggle in Settings modal
   - Default: disabled (opt-in during beta)

### Phase 2: Audio Decoding (Week 3-4)
1. **Header replication for chunks**
   - Construct valid WAV headers
   - Sample-frame boundary alignment
   - Test decode accuracy

2. **Multi-buffer AudioEngine**
   - Array of AudioBuffers
   - Chunk duration calculation
   - Seamless playback transitions

3. **Error handling**
   - Graceful fallback to metadata-only
   - User-facing error messages
   - Logging for diagnostics

### Phase 3: Playback & Seeking (Week 5)
1. **Chunk-aware playback**
   - `onended` chaining
   - Loop handling across chunks
   - Automation sync with chunked time

2. **Seeking implementation**
   - Binary search for chunk
   - Offset calculation
   - Smooth transitions

3. **Performance optimization**
   - Pre-buffer next chunk
   - LRU cache for decoded chunks
   - Web Worker for decoding (non-blocking)

### Phase 4: Waveform & Polish (Week 6)
1. **Chunked waveform generation**
   - Incremental canvas updates
   - Progress indicator
   - Downsample strategy

2. **UI enhancements**
   - Loading states
   - Chunk boundaries visualization (debug mode)
   - File size warnings

3. **Testing & Documentation**
   - Create test files (2GB, 5GB, 10GB, RF64)
   - Update user guide
   - Document limitations

### Phase 5: Beta Testing (Week 7-8)
1. **Internal testing**
   - All features with large files
   - Edge cases (boundary seeks, rapid seeks)
   - Memory profiling

2. **User beta**
   - Select power users
   - Collect feedback
   - Monitor error reports

3. **Iteration**
   - Fix critical bugs
   - Performance tuning
   - UX improvements

---

## Testing Strategy

### Unit Tests
- RF64 header parsing
- Chunk boundary calculations
- Sample-frame alignment
- Buffer management

### Integration Tests
- End-to-end file load → decode → playback
- Seeking across chunks
- Automation with chunked files
- Metadata write to large files

### Performance Tests
- Memory usage profiling (should stay <2GB regardless of file size)
- Decode time for 5GB file
- Seek latency
- Waveform generation time

### Test Files Needed
1. **2.5GB WAV** (just over limit) - 8ch, 24-bit, 48kHz, 90 min
2. **5GB RF64** - 16ch, 32-bit, 96kHz, 60 min
3. **10GB RF64** - 32ch, 32-bit, 192kHz, 30 min
4. **Edge case:** RF64 with metadata at EOF
5. **Edge case:** Corrupted RF64 (invalid ds64)

---

## Alternative: Do Not Implement

### Why This May Be Acceptable
1. **Limited user base** - Most professional recordings <2GB
   - 8ch × 24-bit × 48kHz = ~8 hours before hitting 2GB
   - 16ch × 32-bit × 96kHz = ~2 hours before hitting 2GB
   
2. **Current workaround functional** - Metadata editing still works
   
3. **External tools available** - Users can pre-process with Audacity, Reaper
   
4. **Development cost high** - 6-8 weeks for risky feature
   
5. **Maintenance burden** - Complex code to maintain long-term

### When to Reconsider
- Multiple user requests (data-driven decision)
- Competitive pressure (competing apps support it)
- New browser APIs (e.g., File System Access with streaming)
- V8 engine updates (unlikely to remove 2GB limit, but possible optimizations)

---

## Conclusion

**Recommended Strategy:** **Strategy 1 (Streaming/Chunked Decoding)** with **Strategy 3 (Partial Loading)** as MVP.

### MVP Scope (Weeks 1-4)
- RF64 header parsing
- Load first 2GB for immediate playback
- On-demand segment loading with LRU cache
- Clear UI indicators for partial loading
- Feature flag (opt-in beta)

### Full Implementation (Weeks 5-8)
- True streaming with chunk management
- Seamless playback across chunks
- Full waveform generation
- Production-ready error handling

### Decision Point
After MVP testing, evaluate:
- User feedback and adoption
- Technical stability
- Performance metrics
- ROI vs. other priorities

**Next Step:** Discuss with stakeholders, create GitHub issue for tracking, begin proof-of-concept with simple chunked file reading.
