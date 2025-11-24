# WAV Metadata & Player App - Design Document

## 1. Project Overview
The goal is to build a web-based application capable of importing polyphonic and broadcast .wav (BWF) files, as well as **.mp3 and .aac** audio files. The app will parse and display extensive metadata (bEXT, iXML, ID3), provide audio playback with waveform visualization, and offer a multi-channel mixer. Crucially, it will support **editing metadata** (single and batch) and saving the modified files back to disk.

**Deployment**: The app will be designed as a **Progressive Web App (PWA)**. This ensures it can be hosted on a standard web server but also installed on a user's machine to run offline without an internet connection, functioning as a standalone desktop application.

## 2. User Interface Design
The application will feature a modern, dark-themed UI with a focus on data visibility and audio control.

### 2.1 Layout
The interface is divided into three main vertical sections:

1.  **Header & Import Area**
    *   App Title.
    *   "Import Audio Files" button (and Drag & Drop zone). **Supports recursive directory scanning.**
    *   **Batch Actions Toolbar**: "Edit Selected", "Save Selected".

2.  **Metadata List (Top Section)**
    *   A scrollable table/grid displaying imported files.
    *   **Columns**: Filename, Format, Scene, Take, Duration, TC Start, FPS, Track Count, Notes, Tape, Project, Date/Time.
    *   **Interaction**:
        *   Click row: Select for playback.
        *   Cmd/Ctrl+Click: Multi-select for batch operations.
        *   Double-click cell: Inline edit (where applicable).

3.  **Player & Waveform (Middle Section - Collapsible)**
    *   **Waveform View**: A high-performance Canvas-based waveform renderer.
        *   Visualizes the audio data.
        *   Draggable playhead cursor.
        *   Zoom controls (optional but good for "navigation").
    *   **Transport Controls**: Play, Stop, Loop, Timecode Display (Current / Total).

4.  **Channel Mixer (Bottom Section - Collapsible)**
    *   Dynamically generated channel strips based on the track count of the selected file.
    *   **Channel Strip Components**:
        *   Track Name (from iXML/bEXT if available, else "Ch 1", "Ch 2"...).
        *   Mute (M) and Solo (S) buttons.
        *   Pan Knob/Slider.
        *   Volume Fader.
        *   Level Meter (visual feedback).

### 2.2 Aesthetics
*   **Theme**: Dark mode (Deep grays/blacks) to reduce eye strain and mimic professional DAW software.
*   **Accents**: Vibrant colors for active states (e.g., Green for Play, Red for Record/Solo, Yellow for Mute, Blue for Waveforms).
*   **Typography**: Monospace fonts for Timecode/Metadata, clean Sans-Serif for UI elements.

## 3. Technical Architecture

### 3.1 Tech Stack
*   **Core**: HTML5, CSS3 (Flexbox/Grid), JavaScript (ES6+).
*   **PWA**: Service Workers (for offline caching), Web App Manifest (for installability).
*   **Audio**: Web Audio API (AudioContext, AudioBufferSourceNode, ChannelSplitterNode, GainNode, StereoPannerNode).
*   **Parsing/Writing**:
    *   Custom RIFF parser/writer for WAV (bEXT, iXML).
    *   ID3 parser/writer for MP3/AAC (e.g., using a library or custom implementation if simple).
*   **File I/O**: File System Access API (`showSaveFilePicker`, `showDirectoryPicker`) for direct saving, with fallback to Blob download.

### 3.2 Modules

#### A. MetadataHandler (Parser & Writer)
Responsible for reading and writing binary data.
*   **WAV Support**:
    *   Reads/Writes RIFF headers.
    *   Decodes/Encodes `bext` chunk (ASCII/Binary).
    *   Decodes/Encodes `iXML` chunk (XML parsing/serialization).
*   **MP3/AAC Support**:
    *   Reads/Writes ID3v2 tags.
*   **Audio Data**: Extracts raw audio blob for playback.

#### B. FileIO
*   Manages file handles using File System Access API.
*   Handles "Save" operations: Reconstructs the file with new metadata chunks + original audio data.

#### B. AudioEngine
Manages the `AudioContext`.
*   **Loading**: Decodes selected file audio.
*   **Routing**:
    *   Source -> ChannelSplitter -> [Per-Channel Gain/Pan] -> ChannelMerger -> Destination.
*   **Mixer Logic**:
    *   Maintains state for Volume/Pan/Mute/Solo per channel.
    *   Solo Logic: If any track is Soloed, mute all non-soloed tracks.

#### C. WaveformRenderer
*   Uses an HTML5 `<canvas>`.
*   Draws amplitude peaks.
*   Optimized for performance (downsampling large buffers).

#### D. UIManager
*   Handles DOM generation for the file list.
*   Updates the Mixer UI when a new file is selected.
*   Syncs Playhead position with `AudioContext.currentTime`.

## 4. Data Flow
1.  **User** drops files -> **FileHandler** reads headers -> **WavParser** extracts metadata -> **UI** updates List.
2.  **User** selects file -> **AudioEngine** decodes full audio -> **WaveformRenderer** draws data -> **Mixer** builds channel strips.
3.  **User** hits Play -> **AudioEngine** starts playback -> **UI** updates cursor via `requestAnimationFrame`.

## 5. Metadata Mapping
*   **Start Timecode**: Calculated from `bEXT.TimeReference` (samples) / `SampleRate`. Formatted as HH:MM:SS:FF based on detected Frame Rate (or default).
*   **Track Names**: Parsed from iXML `<TRACK_LIST>` -> `<TRACK>` -> `<NAME>`.

## 6. Implementation Steps
1.  **Setup**: Basic HTML structure and CSS styling.
2.  **Parser/Writer**: Implement RIFF/bEXT/iXML and ID3 reading/writing logic.
3.  **UI - List**: Build the metadata grid with multi-select and inline editing.
4.  **Audio**: Implement Web Audio playback (WAV/MP3/AAC) and waveform rendering.
5.  **Mixer**: Implement multi-channel splitting and UI controls.
6.  **File I/O**: Implement "Save" functionality using File System Access API.
7.  **Refinement**: Polish UI, batch edit modals, test with various formats.
