# Wave Agent X: Mixer Automation Specification

## Executive Summary

This document describes the **automation recording and playback system** used in Wave Agent X for capturing and replaying real-time fader, pan, and mute movements during audio playback. This specification is intended for audio recorder developers who wish to implement compatible iXML automation data that can be replayed in this application.

---

## Overview

The automation system uses a **touch-write** (real-time) recording model paired with a **simplified curve storage** format. The three automation types are:

1. **Volume Automation** – Fader position changes (0.0–1.0 slider range)
2. **Pan Automation** – Pan knob changes (−1.0 = left, +1.0 = right, 0 = center)
3. **Mute Automation** – Mute on/off state (0 = unmuted, 1 = muted)

All automation data is **stored in iXML metadata** embedded within WAV file bEXT chunks, using a custom `MIXER_SETTINGS` element that includes per-channel automation points with absolute timestamps and values.

---

## Recording Algorithm: Touch-Write Automation

### 1. Recording Activation

Automation recording occurs in two phases:

#### Phase 1: Global Recording Start
When the user clicks **"Record Automation"** (playback begins):
- A **session start time** is established (at the audio context's playback start)
- All channels are initialized with an **initial state point** at the session start time
- This captures the fader, pan, and mute state at the instant recording begins

```
Session Start Time = t₀ = audioCtx.currentTime
For each armed channel:
  Record point: (time: t₀, value: current_fader_position)
  Record point: (time: t₀, value: current_pan_position)
  Record point: (time: t₀, value: current_mute_state)
```

#### Phase 2: Real-Time Touch-Write During Playback
As playback continues and user manipulates controls:
- **Fader Touch (Volume)**: Every `input` event while the user is dragging the fader records a point
- **Pan Touch (Pan)**: Every `input` event on the pan knob records a point
- **Mute Toggle (Mute)**: Every mute button click records a state change point

```
On fader/pan input or mute click:
  if (channel is ARMED && playback is ACTIVE):
    record point: (time: currentTime, value: new_value)
```

### 2. Recording Data Structure

During recording, each automation stream stores an array of points:

```javascript
// Volume Automation Points
[
  { time: 0.000, value: 0.750 },    // Initial position (0 dB)
  { time: 2.345, value: 0.500 },    // Fader moved down
  { time: 5.678, value: 0.600 },    // Fader moved back up
  { time: 8.912, value: 0.750 }     // Returned to 0 dB
]

// Pan Automation Points
[
  { time: 0.000, value: 0.000 },    // Centered
  { time: 3.200, value: 0.750 },    // Panned right
  { time: 6.500, value: -0.500 }    // Panned left
]

// Mute Automation Points (0 = unmuted, 1 = muted)
[
  { time: 0.000, value: 0 },        // Unmuted at start
  { time: 4.100, value: 1 },        // Muted at 4.1 sec
  { time: 7.200, value: 0 }         // Unmuted at 7.2 sec
]
```

**Key Properties:**
- **Absolute timestamps**: Times are referenced from session start (not relative to fader release)
- **Slider values** (not dB): Volume stored as 0.0–1.0 slider range; dB conversion happens only for display
- **Pan as stereo position**: −1.0 (full left) to +1.0 (full right)
- **Mute as binary state**: 0 (unmuted) or 1 (muted)
- **Frequency**: Sampled at **UI event rate** (browser `input` event frequency; typically 10–60 Hz depending on user interaction speed and browser refresh rate)

### 3. Curve Simplification (Douglas-Peucker Algorithm)

After recording stops, automation points are **simplified** using the **Douglas-Peucker algorithm** to reduce data storage while preserving curve shape:

```
Algorithm Overview:
1. Start with recorded points: [p₀, p₁, p₂, ..., pₙ]
2. Find the point farthest from the line connecting p₀ and pₙ
3. If distance > tolerance (0.01 = 1%):
   - Recursively simplify left half and right half
   - Combine results, removing duplicate middle point
4. Otherwise, discard all intermediate points, keep only p₀ and pₙ

Tolerance: 0.01 (1% deviation in value domain)
```

**Example:**
```
Original: 152 points
After simplification: 8 points
Reduction: 94.7% → ~20 KB per channel saved to iXML
```

**Perpendicular Distance Calculation:**
```
For a point P and line from A to B:
distance = |((B.y − A.y) × P.x − (B.x − A.x) × P.y + B.x×A.y − B.y×A.x)| 
           / sqrt((B.x − A.x)² + (B.y − A.y)²)
```

---

## iXML Storage Format

### 1. XML Structure

Automation data is stored within the iXML metadata as a `MIXER_SETTINGS` element. The file structure is:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<BWFXML>
  <!-- ... other iXML elements (PROJECT, SPEED, etc.) ... -->
  
  <MIXER_SETTINGS xmlns="http://wav-agent-x/mix_automation/2.0" version="2.0">
    <CHANNEL index="0">
      <VOLUME>0.7500</VOLUME>
      <PAN>0.0000</PAN>
      <MUTE>false</MUTE>
      
      <AUTOMATION>
        <VOLUME_AUTOMATION>
          <POINT time="0.000" value="0.7500"/>
          <POINT time="2.345" value="0.5000"/>
          <POINT time="5.678" value="0.6000"/>
          <POINT time="8.912" value="0.7500"/>
        </VOLUME_AUTOMATION>
        
        <PAN_AUTOMATION>
          <POINT time="0.000" value="0.0000"/>
          <POINT time="3.200" value="0.7500"/>
          <POINT time="6.500" value="-0.5000"/>
        </PAN_AUTOMATION>
        
        <MUTE_AUTOMATION>
          <POINT time="0.000" value="0"/>
          <POINT time="4.100" value="1"/>
          <POINT time="7.200" value="0"/>
        </MUTE_AUTOMATION>
      </AUTOMATION>
    </CHANNEL>
    
    <CHANNEL index="1">
      <!-- ... repeat structure for each channel ... -->
    </CHANNEL>
  </MIXER_SETTINGS>
</BWFXML>
```

### 2. Element Specifications

| Element | Parent | Purpose | Notes |
|---------|--------|---------|-------|
| `MIXER_SETTINGS` | `BWFXML` | Root automation container | Has `version="2.0"` and namespace URL |
| `CHANNEL` | `MIXER_SETTINGS` | Per-channel static & automation data | `index="0"`, `index="1"`, etc. |
| `VOLUME` | `CHANNEL` | Static volume level at file save time | 0.0–1.0 slider value, 4 decimals |
| `PAN` | `CHANNEL` | Static pan position at file save time | −1.0 to +1.0, 4 decimals |
| `MUTE` | `CHANNEL` | Static mute state at file save time | `true` or `false` |
| `AUTOMATION` | `CHANNEL` | Container for all automation types | Optional; omitted if no automation |
| `VOLUME_AUTOMATION` | `AUTOMATION` | Volume fader movement data | Optional |
| `PAN_AUTOMATION` | `AUTOMATION` | Pan knob movement data | Optional |
| `MUTE_AUTOMATION` | `AUTOMATION` | Mute toggle state data | Optional |
| `POINT` | `*_AUTOMATION` | Individual automation point | Attributes: `time` (seconds, 3 decimals), `value` (0–1 or −1 to +1, 4 decimals) |

### 3. Numeric Precision

- **Time**: Rounded to **3 decimal places** (millisecond precision)
  - Example: `time="12.345"`
- **Volume/Pan Value**: Rounded to **4 decimal places** (maintains slider UI precision)
  - Example: `value="0.7500"` or `value="-0.5000"`
- **Mute Value**: Integer `0` (unmuted) or `1` (muted)

### 4. Namespace & Version

```xml
xmlns="http://wav-agent-x/mix_automation/2.0"
version="2.0"
```

This namespace/version scheme allows future extensions (e.g., EQ, compression) without breaking compatibility.

---

## Playback Algorithm

### 1. Loading Automation Data

When a WAV file is opened:

1. Extract iXML metadata from the file (bEXT chunk)
2. Parse the `MIXER_SETTINGS` element
3. For each `CHANNEL`, load three automation point arrays:
   - `automation.volume` – Array of {time, value} for volume
   - `automation.pan` – Array of {time, value} for pan
   - `automation.mute` – Array of {time, value} for mute

```javascript
const parsed = MixerMetadata.parseFromXML(ixmlString);
// Result:
{
  version: "2.0",
  channels: [
    {
      volume: 0.75,
      pan: 0.0,
      isMuted: false,
      automation: {
        volume: [ {time: 0.0, value: 0.75}, ... ],
        pan: [ {time: 0.0, value: 0.0}, ... ],
        mute: [ {time: 0.0, value: 0}, ... ]
      }
    },
    // ... more channels
  ]
}
```

### 2. Interpolation During Playback

At every playback update (e.g., 30–60 Hz depending on UI refresh), the playback engine:

1. **Queries each automation player** for the current playback time
2. **Interpolates** the value between surrounding points
3. **Applies** the interpolated value to the corresponding control

#### Volume & Pan Interpolation (Linear)

For a given `currentTime` between two points `P₁` and `P₂`:

```
if currentTime < P₁.time:
  return P₁.value

if currentTime > Pₙ.time:
  return Pₙ.value

if P₁.time ≤ currentTime ≤ P₂.time:
  t = (currentTime − P₁.time) / (P₂.time − P₁.time)  // Normalized time 0–1
  interpolatedValue = P₁.value + (P₂.value − P₁.value) × t
  return interpolatedValue
```

**Example:**
```
Points: [{time: 0, value: 0.75}, {time: 5, value: 0.50}]
At time = 2.5 seconds (halfway):
  t = 2.5 / 5 = 0.5
  value = 0.75 + (0.50 − 0.75) × 0.5 = 0.625
```

#### Mute Interpolation (Step)

Mute uses **step interpolation** (no in-between values):

```
if currentTime < P₁.time:
  return P₁.value

if currentTime > Pₙ.time:
  return Pₙ.value

For any point between P₁ and P₂:
  return P₁.value  // Hold previous value until next point
```

**Rationale**: Mute is a binary state (on/off); smooth interpolation between 0 and 1 would be meaningless. Step interpolation ensures the mute state snaps at the recorded point time.

### 3. Touch-Write Override During Playback

The application implements **touch-write override**: If the user **manually manipulates** a control during playback, that control's automation is **temporarily disabled** while being touched:

```javascript
// Volume
if (user_is_dragging_fader && recorder_is_armed):
  use manual fader value  // Ignore automation
else:
  use interpolated automation value

// Pan
if (user_is_dragging_pan_knob && recorder_is_armed):
  use manual pan value   // Ignore automation
else:
  use interpolated automation value

// Mute
// Always playback automation; no touch override for mute button
use interpolated automation value
```

This allows a user to "ride" over automation during playback without fighting the automation system.

### 4. Playback Synchronization

Automation playback is **time-locked** to audio playback:

- The `currentTime` passed to `automationPlayer.getValue(currentTime)` is the **audio context's current playback position**
- Automation points use **absolute time** (not relative), so seeking in audio playback naturally aligns automation
- If the user seeks to 3.5 seconds, automation immediately jumps to the interpolated value at 3.5 seconds

---

## Frequency & Sampling Rate

### Recording Frequency

Automation points are sampled at the **UI event rate**:

- **Volume & Pan**: Sampled on every `input` event from the range slider/knob
  - Typical browser: 10–60 Hz (10–60 points per second depending on user interaction speed)
  - High-speed fader moves: ~60 Hz (one point per frame at 60 FPS)
  - Slow fader moves: 10–15 Hz

- **Mute**: Sampled on every button click
  - Typically 1–5 points per minute during normal operation
  - No time-continuous sampling; captured only at state transitions

### Post-Simplification Data Reduction

After Douglas-Peucker simplification:
- **Volume Automation**: 95–98% reduction in points (typically 3–8 key points for a typical recording)
- **Pan Automation**: 90–95% reduction in points
- **Mute Automation**: No simplification needed (already sparse; 1–5 points typical)

### Storage Example

For a stereo 4-channel recording with automation:
- **Raw recording**: ~200 points/channel × 4 channels = 800 points
- **After simplification**: ~8 points/channel × 4 channels = 32 points
- **XML size**: ~2–5 KB for all automation data (highly efficient)

---

## Serialization: Writing iXML from Your Recorder

To write compatible iXML automation data from an audio recorder:

### 1. Data Collection Phase

As the recorder runs and user manipulates faders/pans:

```
// Pseudo-code
channels = [
  { volume: 0.75, pan: 0.0, mute: false, automation: { volume: [], pan: [], mute: [] } },
  { volume: 0.75, pan: 0.0, mute: false, automation: { volume: [], pan: [], mute: [] } }
]

session_start_time = current_playback_time

// On user interaction:
on_fader_moved(channel_index, new_volume, current_time):
  channels[channel_index].automation.volume.append({
    time: current_time,
    value: new_volume
  })

on_pan_moved(channel_index, new_pan, current_time):
  channels[channel_index].automation.pan.append({
    time: current_time,
    value: new_pan
  })

on_mute_toggled(channel_index, is_muted, current_time):
  channels[channel_index].automation.mute.append({
    time: current_time,
    value: is_muted ? 1 : 0
  })
```

### 2. Simplification Phase

Before saving to iXML, apply Douglas-Peucker simplification:

```javascript
/**
 * Douglas-Peucker curve simplification
 * @param points Array of {time, value}
 * @param tolerance Maximum allowed deviation (0.01 = 1%)
 */
function simplifyAutomation(points, tolerance = 0.01) {
  if (points.length <= 2) return points;

  // Find point with max perpendicular distance from line P₀–Pₙ
  let maxDistance = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // Recursive case: split and recombine
  if (maxDistance > tolerance) {
    const left = simplifyAutomation(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyAutomation(points.slice(maxIndex), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    // Base case: return first and last only
    return [first, last];
  }
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.time - lineStart.time;
  const dy = lineEnd.value - lineStart.value;

  if (dx === 0 && dy === 0) {
    return Math.abs(point.value - lineStart.value);
  }

  const numerator = Math.abs(
    dy * point.time - dx * point.value +
    lineEnd.time * lineStart.value -
    lineEnd.value * lineStart.time
  );
  const denominator = Math.sqrt(dx * dx + dy * dy);

  return numerator / denominator;
}
```

### 3. XML Serialization Phase

Build the iXML string with proper formatting:

```javascript
function serializeToXML(channels) {
  let xml = `<MIXER_SETTINGS xmlns="http://wav-agent-x/mix_automation/2.0" version="2.0">\n`;

  channels.forEach((ch, index) => {
    xml += `  <CHANNEL index="${index}">\n`;
    xml += `    <VOLUME>${ch.volume.toFixed(4)}</VOLUME>\n`;
    xml += `    <PAN>${ch.pan.toFixed(4)}</PAN>\n`;
    xml += `    <MUTE>${ch.mute ? 'true' : 'false'}</MUTE>\n`;

    if (ch.automation.volume.length > 0 || 
        ch.automation.pan.length > 0 || 
        ch.automation.mute.length > 0) {
      xml += `    <AUTOMATION>\n`;
      
      // Volume automation
      if (ch.automation.volume.length > 0) {
        xml += `      <VOLUME_AUTOMATION>\n`;
        ch.automation.volume.forEach(pt => {
          xml += `        <POINT time="${pt.time.toFixed(3)}" value="${pt.value.toFixed(4)}"/>\n`;
        });
        xml += `      </VOLUME_AUTOMATION>\n`;
      }
      
      // Pan automation
      if (ch.automation.pan.length > 0) {
        xml += `      <PAN_AUTOMATION>\n`;
        ch.automation.pan.forEach(pt => {
          xml += `        <POINT time="${pt.time.toFixed(3)}" value="${pt.value.toFixed(4)}"/>\n`;
        });
        xml += `      </PAN_AUTOMATION>\n`;
      }
      
      // Mute automation
      if (ch.automation.mute.length > 0) {
        xml += `      <MUTE_AUTOMATION>\n`;
        ch.automation.mute.forEach(pt => {
          xml += `        <POINT time="${pt.time.toFixed(3)}" value="${pt.value}"/>\n`;
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
```

### 4. Inject into WAV iXML Chunk

After generating the XML, inject it into the WAV file's bEXT chunk (or create one):

```javascript
// Pseudo-code; exact implementation depends on your WAV library
function writeToWAV(wavBuffer, mixerSettingsXML) {
  // 1. Parse/create BWFXML structure
  let bwfxml = extractExistingBWFXML(wavBuffer) || createNewBWFXML();
  
  // 2. Remove any existing MIXER_SETTINGS element
  bwfxml.removeChild(bwfxml.querySelector('MIXER_SETTINGS'));
  
  // 3. Append new MIXER_SETTINGS
  bwfxml.appendChild(parsedNewMixerSettings);
  
  // 4. Convert back to string and embed in bEXT chunk
  const ixmlString = serializeToString(bwfxml);
  writeIXMLChunk(wavBuffer, ixmlString);
  
  return wavBuffer;
}
```

---

## Deserialization: Reading iXML in Your App

To read automation data saved by another application:

```javascript
function loadAutomation(ixmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(ixmlString, 'text/xml');
  
  if (xmlDoc.querySelector('parsererror')) {
    console.error('XML parse error');
    return null;
  }

  const mixerSettings = xmlDoc.querySelector('MIXER_SETTINGS');
  if (!mixerSettings) return null;

  const version = mixerSettings.getAttribute('version');
  const channelElements = mixerSettings.querySelectorAll('CHANNEL');
  const channels = [];

  channelElements.forEach(chEl => {
    const index = parseInt(chEl.getAttribute('index'));
    const volume = parseFloat(chEl.querySelector('VOLUME')?.textContent || '1.0');
    const pan = parseFloat(chEl.querySelector('PAN')?.textContent || '0.0');
    const mute = chEl.querySelector('MUTE')?.textContent === 'true';

    // Parse automation
    const automation = { volume: [], pan: [], mute: [] };
    const autoEl = chEl.querySelector('AUTOMATION');
    if (autoEl) {
      // Volume points
      autoEl.querySelector('VOLUME_AUTOMATION')?.querySelectorAll('POINT')
        .forEach(pt => {
          automation.volume.push({
            time: parseFloat(pt.getAttribute('time')),
            value: parseFloat(pt.getAttribute('value'))
          });
        });

      // Pan points
      autoEl.querySelector('PAN_AUTOMATION')?.querySelectorAll('POINT')
        .forEach(pt => {
          automation.pan.push({
            time: parseFloat(pt.getAttribute('time')),
            value: parseFloat(pt.getAttribute('value'))
          });
        });

      // Mute points
      autoEl.querySelector('MUTE_AUTOMATION')?.querySelectorAll('POINT')
        .forEach(pt => {
          automation.mute.push({
            time: parseFloat(pt.getAttribute('time')),
            value: parseFloat(pt.getAttribute('value'))
          });
        });
    }

    channels[index] = {
      volume: volume,
      pan: pan,
      isMuted: mute,
      automation: automation
    };
  });

  return { version, channels };
}
```

---

## Edge Cases & Best Practices

### 1. Empty Automation

If a channel has no automation recorded:
- **Omit** the entire `<AUTOMATION>` element
- Store only static `<VOLUME>`, `<PAN>`, `<MUTE>` values
- Playback will use static fader/pan values with no time-based changes

### 2. Sparse Automation

If only one automation type is recorded (e.g., only pan, no volume):
- Include only that `*_AUTOMATION` subelement
- Omit the others
- Playback will use static fader values while panning

```xml
<CHANNEL index="0">
  <VOLUME>0.7500</VOLUME>
  <PAN>0.0000</PAN>
  <MUTE>false</MUTE>
  <AUTOMATION>
    <!-- Only pan automation; no volume or mute -->
    <PAN_AUTOMATION>
      <POINT time="0.000" value="0.0000"/>
      <POINT time="3.200" value="0.7500"/>
    </PAN_AUTOMATION>
  </AUTOMATION>
</CHANNEL>
```

### 3. Seeking & Time References

- Always use **absolute time** from the session start, not relative time
- Seeking in playback should jump directly to the time value; no recalculation needed
- If recording multiple passes over the same file, **replace** the old automation (don't append)

### 4. Precision & Rounding

- **Time**: Always round to 3 decimals (millisecond precision)
- **Volume/Pan**: Always round to 4 decimals (0.0001 granularity)
- **Mute**: Use integer 0 or 1 (never fractional values)

### 5. Large Sessions

For very long sessions (>1 hour):
- Simplification reduces data dramatically (95%+ reduction typical)
- iXML chunk size typically remains <20 KB even for stereo 4-channel sessions with heavy automation
- No special optimizations needed for long audio files

### 6. Multi-Pass Recording

If the recorder allows multiple automation recording passes:
- Each save should **replace** the previous automation data (not append)
- Store the **most recent** version in the iXML chunk
- Previous versions are lost (no undo/version history at the iXML level)

---

## Implementation Checklist for Audio Recorder Developers

Use this checklist when implementing automation export in your recorder:

- [ ] **Recording Phase**
  - [ ] Capture fader position on every UI input event during playback
  - [ ] Capture pan position on every UI input event during playback
  - [ ] Capture mute state on every toggle during playback
  - [ ] Use **absolute timestamps** (seconds from session start)
  - [ ] Store as `{time: number, value: number}` pairs
  - [ ] Record **initial state** at session start (time=0)

- [ ] **Simplification Phase**
  - [ ] Implement Douglas-Peucker algorithm with tolerance = 0.01
  - [ ] Apply to volume and pan automation (mute usually stays as-is)
  - [ ] Verify 95%+ data reduction for typical sessions

- [ ] **Serialization Phase**
  - [ ] Create `MIXER_SETTINGS` element with namespace and version 2.0
  - [ ] For each channel, write `<CHANNEL index="N">` with volume, pan, mute
  - [ ] Write `<AUTOMATION>` subelements only if automation exists
  - [ ] Format times to 3 decimals, values to 4 decimals
  - [ ] Inject into WAV file's bEXT iXML chunk

- [ ] **Testing**
  - [ ] Export automation to a WAV file
  - [ ] Load the file in Wave Agent X
  - [ ] Verify fader, pan, and mute movements replay correctly
  - [ ] Verify file loads without iXML parse errors
  - [ ] Test with mono, stereo, 4-channel sessions
  - [ ] Test with sparse automation (pan only, volume only, etc.)

- [ ] **Error Handling**
  - [ ] Handle missing AUTOMATION element gracefully (use static values)
  - [ ] Clamp fader/pan values to valid ranges (0–1 for volume, −1 to +1 for pan)
  - [ ] Validate time ordering (each point's time ≥ previous point's time)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-01-30 | Initial specification; supports volume, pan, and mute automation; namespaced iXML |
| 1.0 | (Implied) | Original version; supported static channel settings only |

---

## References

- **Web Audio API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- **Douglas-Peucker Algorithm**: https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm
- **WAV Format (RF64/bEXT/iXML)**: https://tech.ebu.ch/publications/tech3285

---

## Contact & Support

For questions about this specification or compatibility issues with your recorder implementation, refer to the source code comments in:
- [mixer.js](mixer.js) – Recording and playback logic
- [automation.js](automation.js) – Recorder and player classes
- [mixer-metadata.js](mixer-metadata.js) – XML serialization and parsing
