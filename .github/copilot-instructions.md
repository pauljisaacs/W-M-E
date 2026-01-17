# Wave Agent X – AI Coding Guidelines

## Project Overview
Wave Agent X is a professional **audio metadata and file management PWA** for production sound workflows. It runs entirely in-browser with offline support via Service Worker, enabling audio analysis, editing, and batch operations without server dependencies.

## Architecture Layers

### 1. **Core Audio Pipeline** (audio-engine.js, audio-processor.js)
- **AudioEngine**: Manages Web Audio API context, decoding, playback, and mixer node connections
  - Handles large files (>2GB) and RF64 format via manual WAV decoding
  - Falls back to manual decoder if native `decodeAudioData()` fails
  - **Pattern**: Route through `this.audioCtx.destination` via mixer's master gain
- **AudioProcessor**: Waveform analysis and audio manipulation (normalization, region analysis)
  - Works with raw PCM data at sample-level precision
  - **Key method**: `normalize(arrayBuffer, targetDb, region)` – operates on byte-level WAV data

### 2. **Metadata Layer** (metadata-handler.js, mixer-metadata.js)
- **MetadataHandler**: Parses WAV headers, bEXT (Broadcast Extension), iXML chunks
  - For large files (>50MB), reads header first, then scans end for trailing metadata
  - Safely handles metadata before/after audio data without corrupting WAV structure
- **MixerMetadata**: Stores automation, fader states, cue markers per mixer session
- **Patterns**:
  - Parse WAV at chunk boundaries using DataView (little-endian)
  - Store metadata as JSON separate from audio data
  - Check `isSmallFile` flag to determine reading strategy

### 3. **Mixing & Automation** (mixer.js, automation.js, cue-marker.js)
- **Mixer**: Web Audio routing, per-channel mute/solo, master gain, automation record/playback
  - Uses event delegation for fader interaction (mute, solo, arm buttons)
  - **Touch-write automation**: Records fader movements during playback when armed
  - Triggers `onStateChange` callback to re-render waveform when mute/solo changes
- **AutomationRecorder/Player**: Douglas-Peucker curve simplification for smooth automation replay
- **CueMarkerCollection**: Manages ≤100 markers with time positions and labels

### 4. **File I/O & State** (file-io.js, app.js)
- **FileIO**: File System Access API wrapper + fallback to `<input>` for browser/file:// contexts
  - Recursively scans directories, filters audio files, strips macOS metadata (._* files)
- **App class**: Central orchestrator
  - Maintains `this.files` array of `{fileHandle, metadata, fileObj}`
  - Tracks UI selection state: `selectedIndices`, `selectedChildren` (for nested selections)
  - Auto-save metadata with 1-second debounce via `localStorage`
  - **Batch operations**: Coordinate metadata edits across selected files

### 5. **UI & Rendering** (index.html, style.css, app.js)
- **Waveform canvas rendering**: Triggered by mixer state changes
- **Table columns**: Dynamically reorderable via `columnOrder` array (indices map to metadata fields)
- **Modals**: About, batch-edit dialogs (see DOM element IDs in index.html)
- **PWA offline**: Service Worker caches all ASSETS; uses cache-first strategy

## Critical Patterns & Conventions

### Data Flow
1. **File Import** → FileIO API → MetadataHandler → App.files array → Table render
2. **Audio Playback** → AudioEngine.loadAudio() → decode → play via mixer nodes
3. **Metadata Edit** → Auto-save to storage + write to file (via FileIO.saveFile)

### Module Coupling
- **app.js** imports all modules and wires callbacks:
  ```javascript
  this.mixer = new Mixer(audioCtx, onTrackNameChange, onStateChange);
  this.mixer.init('mixer-container');
  ```
- **Metadata auto-linking**: `audioProcessor.metadataHandler = metadataHandler` allows cross-module access
- **State sync**: Mixer notifies app via `onStateChange` callback to re-render waveforms

### Large File Handling
- **RF64 detection**: Check header bytes `0x52463634` for RF64 signature
- **Manual decode strategy**: Skip native `decodeAudioData()` for files >2GB (memory overhead)
- **Metadata at EOF**: Read last 10MB separately if metadata not found in header

### Automation Workflow
- **Recording**: Arm channel → fader touch triggers start + recordPoint at each input event
- **Time reference**: Absolute timestamps (not relative to playback start) ensure correct replay
- **Simplification**: Douglas-Peucker algorithm reduces point density (tolerance 0.01)

### Browser Compatibility
- Fallback chain: File System Access API → `<input type="file">` → error message
- Service Worker cache invalidation via `CACHE_NAME` version string (e.g., `v71`)

## File Organization
```
app.js                      # Main App class, orchestration
audio-engine.js             # Web Audio API wrapper, decoding
audio-processor.js          # Waveform analysis, normalization
mixer.js                    # Channel mixing, automation UI
metadata-handler.js         # WAV parsing, bEXT/iXML extraction
file-io.js                  # File System Access API
cue-marker.js               # Marker collection management
automation.js               # Automation recording/playback
mixer-metadata.js           # Automation state persistence
renameUtilities.js          # Batch rename helpers
sound-report.js/.html       # Audio analysis export
index.html                  # UI markup, modals
style.css                   # Dark theme styling
sw.js                       # Service Worker, offline cache
manifest.json               # PWA metadata
```

## Common Tasks for AI Agents

### Adding a Feature
1. **New metadata field**: Add parser in `MetadataHandler.parseWav()` → expose in `app.files[i].metadata`
2. **Mixer automation**: Extend `AutomationRecorder` + update `mixer.js` UI event handlers
3. **UI column**: Add to `columnOrder` array + table renderer in app.js

### Debugging
- **Waveform not rendering**: Check mixer's `onStateChange` callback is invoked (mute/solo)
- **Metadata not saved**: Verify auto-save debounce timer cleared; check FileIO.saveFile error logs
- **Playback stalling**: Ensure automation playback time synced with current playback position

### Performance Considerations
- Large file decode is blocking; consider Web Worker for manual decode fallback
- Waveform canvas rendering on every state change—consider throttling for many channels
- Service Worker cache size: monitor ASSETS list for bloat

## Versioning & PWA
- **Manifest version**: Update `manifest.json` version → triggers SW cache refresh
- **Cache invalidation**: Increment `CACHE_NAME` in sw.js to force asset reload
- **Build/run**: No build step; files are ES modules loaded directly via `<script type="module">`
