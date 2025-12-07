# Refactoring Strategy for Wave Agent X

Overview: Consolidate and refactor `app.js` (currently ~2300 lines) into smaller, single-responsibility modules to improve maintainability, readability, and troubleshooting.

## Current Architecture
- **`app.js`**: Functions as a "God Object", handling UI, State, File I/O, App Logic, and Integration.
- **`mixer.js`, `audio-engine.js`, `metadata-handler.js`**: Well-defined, cohesive classes.

## Proposed Module Structure

We will extract logic from `app.js` into the following new modules:

### 1. `export-manager.js` (Phase 1)
**Responsibility:** Handling the complex "Export Mix" logic, including Modal management and the Export Process loop.
**Content:**
- `openExportModal()`, `closeExportModal()`
- `handleExport()` (The massive export function)
- `saveMixerSettingsToFile()`
- `loadMixerSettingsFromFile()`
**Dependencies:** Needs access to `AudioEngine`, `Mixer`, `AudioProcessor`, and `Files` array. We will pass these in the constructor or method calls.

### 2. `ui-manager.js` (Phase 2)
**Responsibility:** DOM manipulation and View management.
**Content:**
- `buildTable()`
- `addTableRow()`
- `updateSelectionUI()`
- `updateTimeDisplay()`
- Event listeners setup (some of it)

### 3. `file-manager.js` (Phase 3)
**Responsibility:** Managing the application state regarding files.
**Content:**
- `files` array
- `selectedIndices`
- `processFiles()` (Import logic)
- `groupFiles()` (Grouping logic)
- `sortFiles()`

### 4. `utils.js` (Phase 4)
**Responsibility:** Pure helper functions.
**Content:**
- `formatTime()`
- `secondsToTimecode()`
- `pad()`

## Implementation Steps

### Step 1: Create `export-manager.js`
This is the highest value / lowest risk step, as the Export logic is fairly self-contained and was the source of recent bugs.
1. Create `export-manager.js`.
2. Move `handleExport` and related functions into a class `ExportManager`.
3. Update `app.js` to import and use `ExportManager`.

### Step 2: Create `utils.js`
Extract the simple time formatting helpers to clean up the bottom of `app.js`.

### Step 3: Progressive Refactoring
Once the above are stable, proceed to extracting `UIManager` and `FileManager`.

## Troubleshooting Benefits
- **Isolation:** Bugs in Export will be confined to `export-manager.js`.
- **Readability:** `app.js` will become a high-level orchestrator (Controller), making the app flow easier to understand.
- **Testing:** Smaller modules are easier to unit test.
