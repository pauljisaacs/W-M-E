# Implementation Plan - Fader Automation

## Objective
Add time-based automation for mixer faders (volume and pan), allowing users to record, edit, and play back dynamic mixer movements synchronized with audio playback.

## User Workflow

### Recording Automation
1. User loads a file and plays it
2. User clicks "Arm" button on a channel fader (turns red)
3. During playback, user moves the fader
4. Movements are recorded as automation points (time + value pairs)
5. User clicks "Arm" again to stop recording
6. Automation is saved to the file's iXML metadata

### Playing Back Automation
1. User loads a file with saved automation
2. During playback, faders move automatically according to saved automation
3. User can see automation curves on the waveform or in a dedicated automation lane

### Editing Automation
1. User can view automation as a curve overlay on the waveform
2. User can click to add/remove automation points
3. User can drag points to adjust timing and value
4. User can clear all automation for a channel
5. User can copy/paste automation between channels

## UI Design

### 1. Mixer Channel Additions
Each channel strip gets:
- **"A" (Arm) button** - Toggle automation recording (red when armed)
- **Automation mode dropdown** (future):
  - `Read` - Play back automation
  - `Write` - Record automation (overwrite existing)
  - `Touch` - Record only when touching fader
  - `Latch` - Record from first touch until playback stops
  - `Off` - Ignore automation

For MVP, we'll start with just:
- **Arm button** - When armed, records automation during playback
- **Clear button** - Clears all automation for this channel

### 2. Waveform Overlay (Optional for MVP)
- Show automation curves as colored lines over the waveform
- Different colors for volume vs pan automation
- Click to add points, drag to move, right-click to delete

### 3. Automation Panel (Future Enhancement)
- Dedicated panel showing automation curves
- Timeline-based editor
- Zoom/scroll controls
- Multi-channel view

## Data Structure

### Automation Format in iXML
```xml
<MIXER_SETTINGS xmlns="http://wav-metadata-editor/mixer/1.0" version="2.0">
  <CHANNEL index="0">
    <VOLUME>0.85</VOLUME>
    <PAN>-0.5</PAN>
    <MUTE>false</MUTE>
    <SOLO>false</SOLO>
    
    <!-- NEW: Automation data -->
    <AUTOMATION>
      <VOLUME_AUTOMATION>
        <POINT time="0.0" value="0.85"/>
        <POINT time="2.5" value="0.6"/>
        <POINT time="5.0" value="1.0"/>
        <POINT time="8.3" value="0.4"/>
      </VOLUME_AUTOMATION>
      
      <PAN_AUTOMATION>
        <POINT time="0.0" value="-0.5"/>
        <POINT time="3.0" value="0.5"/>
        <POINT time="6.0" value="-1.0"/>
      </PAN_AUTOMATION>
    </AUTOMATION>
  </CHANNEL>
</MIXER_SETTINGS>
```

### In-Memory Data Structure
```javascript
{
  channels: [
    {
      index: 0,
      volume: 0.85,
      pan: -0.5,
      isMuted: false,
      isSoloed: false,
      automation: {
        volume: [
          { time: 0.0, value: 0.85 },
          { time: 2.5, value: 0.6 },
          { time: 5.0, value: 1.0 },
          { time: 8.3, value: 0.4 }
        ],
        pan: [
          { time: 0.0, value: -0.5 },
          { time: 3.0, value: 0.5 },
          { time: 6.0, value: -1.0 }
        ]
      }
    }
  ]
}
```

## Technical Implementation

### 1. Automation Recording

**During Playback:**
```javascript
class AutomationRecorder {
  constructor(channel, parameter) {
    this.channel = channel;
    this.parameter = parameter; // 'volume' or 'pan'
    this.points = [];
    this.isRecording = false;
    this.lastRecordedTime = -1;
    this.recordInterval = 0.05; // Record every 50ms
  }

  start(startTime) {
    this.isRecording = true;
    this.points = [];
    this.lastRecordedTime = startTime;
  }

  recordPoint(currentTime, value) {
    if (!this.isRecording) return;
    
    // Only record if enough time has passed (avoid too many points)
    if (currentTime - this.lastRecordedTime >= this.recordInterval) {
      this.points.push({ time: currentTime, value });
      this.lastRecordedTime = currentTime;
    }
  }

  stop() {
    this.isRecording = false;
    // Simplify curve (remove redundant points)
    this.points = this.simplifyAutomation(this.points);
    return this.points;
  }

  simplifyAutomation(points) {
    // Remove points that are on a straight line between neighbors
    // (Douglas-Peucker algorithm or simple threshold-based)
    // This reduces file size and improves performance
  }
}
```

**Integration with Mixer:**
- When fader is moved during playback AND armed, call `recorder.recordPoint()`
- Use `requestAnimationFrame` or playback timer to get current time
- Store recorded points in channel's automation data

### 2. Automation Playback

**During Playback:**
```javascript
class AutomationPlayer {
  constructor(channel, automationData) {
    this.channel = channel;
    this.volumePoints = automationData.volume || [];
    this.panPoints = automationData.pan || [];
  }

  update(currentTime) {
    // Interpolate volume
    const volume = this.interpolate(this.volumePoints, currentTime);
    if (volume !== null) {
      this.channel.setVolume(volume, true); // true = from automation
    }

    // Interpolate pan
    const pan = this.interpolate(this.panPoints, currentTime);
    if (pan !== null) {
      this.channel.setPan(pan, true);
    }
  }

  interpolate(points, time) {
    if (points.length === 0) return null;
    if (points.length === 1) return points[0].value;

    // Find surrounding points
    let before = null, after = null;
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].time <= time && points[i + 1].time >= time) {
        before = points[i];
        after = points[i + 1];
        break;
      }
    }

    if (!before || !after) {
      // Before first point or after last point
      if (time < points[0].time) return points[0].value;
      if (time > points[points.length - 1].time) return points[points.length - 1].value;
    }

    // Linear interpolation
    const t = (time - before.time) / (after.time - before.time);
    return before.value + (after.value - before.value) * t;
  }
}
```

**Integration with Playback Loop:**
- In `app.js` playback animation loop, call `automationPlayer.update(currentTime)` for each channel
- Update fader UI to reflect automated values
- Prevent user input on faders during automation playback (unless in "Touch" mode)

### 3. Metadata Storage

**Update `mixer-metadata.js`:**
```javascript
static serializeToXML(channels) {
  let xml = `<MIXER_SETTINGS xmlns="${this.NAMESPACE}" version="2.0">\n`;
  
  channels.forEach((ch, index) => {
    xml += `  <CHANNEL index="${index}">\n`;
    xml += `    <VOLUME>${ch.volume.toFixed(4)}</VOLUME>\n`;
    xml += `    <PAN>${ch.pan.toFixed(4)}</PAN>\n`;
    xml += `    <MUTE>${ch.isMuted}</MUTE>\n`;
    xml += `    <SOLO>${ch.isSoloed}</SOLO>\n`;
    
    // Automation
    if (ch.automation) {
      xml += `    <AUTOMATION>\n`;
      
      if (ch.automation.volume && ch.automation.volume.length > 0) {
        xml += `      <VOLUME_AUTOMATION>\n`;
        ch.automation.volume.forEach(pt => {
          xml += `        <POINT time="${pt.time.toFixed(3)}" value="${pt.value.toFixed(4)}"/>\n`;
        });
        xml += `      </VOLUME_AUTOMATION>\n`;
      }
      
      if (ch.automation.pan && ch.automation.pan.length > 0) {
        xml += `      <PAN_AUTOMATION>\n`;
        ch.automation.pan.forEach(pt => {
          xml += `        <POINT time="${pt.time.toFixed(3)}" value="${pt.value.toFixed(4)}"/>\n`;
        });
        xml += `      </PAN_AUTOMATION>\n`;
      }
      
      xml += `    </AUTOMATION>\n`;
    }
    
    xml += `  </CHANNEL>\n`;
  });
  
  xml += `</MIXER_SETTINGS>`;
  return xml;
}
```

### 4. UI Updates

**Mixer Channel HTML:**
```html
<div class="channel-strip">
  <div class="channel-header">
    <span class="channel-name">Ch 1</span>
    <button class="arm-btn" title="Arm for automation recording">A</button>
    <button class="clear-auto-btn" title="Clear automation">×</button>
  </div>
  <!-- existing fader, pan, mute, solo -->
</div>
```

**CSS:**
```css
.arm-btn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #333;
  color: #fff;
  border: 1px solid #555;
}

.arm-btn.active {
  background: #e74c3c;
  border-color: #c0392b;
  box-shadow: 0 0 10px rgba(231, 76, 60, 0.5);
}

.clear-auto-btn {
  width: 20px;
  height: 20px;
  opacity: 0.5;
}

.clear-auto-btn:hover {
  opacity: 1;
  color: #e74c3c;
}

/* Fader with automation indicator */
.volume-fader.has-automation {
  background: linear-gradient(to top, #3498db, #2980b9);
}
```

## Workflow Examples

### Example 1: Recording Volume Fade
1. User loads 10-second audio file
2. User clicks "Arm" button on Channel 1 (turns red)
3. User clicks Play
4. At 0s: Fader is at 100%
5. At 3s: User starts dragging fader down
6. At 5s: Fader reaches 0%
7. Playback continues, user releases fader
8. User clicks Stop
9. Automation points saved: `[(0, 1.0), (3.0, 1.0), (5.0, 0.0)]`
10. User clicks "Save Mix to File" - automation saved to iXML

### Example 2: Playing Back Automation
1. User loads file with saved automation
2. User clicks "Load Mix from File"
3. Mixer loads, faders show initial positions
4. User clicks Play
5. Faders move automatically according to saved automation
6. User can see automation indicator (blue highlight on fader)

### Example 3: Editing Automation (Future)
1. User clicks "Show Automation" button
2. Waveform displays volume automation as overlay curve
3. User clicks on curve to add a point at 7.5s
4. User drags point to adjust value
5. User right-clicks point to delete
6. Changes are immediately reflected in playback

## Performance Considerations

1. **Point Reduction**: Use Douglas-Peucker or similar algorithm to reduce automation points
   - Target: Max 100 points per parameter per channel
   - Threshold: Remove points with < 0.01 deviation from linear interpolation

2. **Interpolation**: Use linear interpolation for simplicity and performance
   - Future: Add bezier curves for smoother automation

3. **Update Rate**: Update automation at 60fps (requestAnimationFrame)
   - Only update UI if value changed by > 0.001

4. **Memory**: Store automation in efficient format
   - Use Float32Array for large automation data sets
   - Compress time values (store as offsets from previous point)

## Compatibility & Versioning

- **Version 1.0**: Static mixer settings (current)
- **Version 2.0**: Adds automation support
- **Backward Compatibility**: v1.0 files load in v2.0 (no automation)
- **Forward Compatibility**: v2.0 files load in v1.0 (automation ignored, static values used)

## Future Enhancements

1. **Automation Modes**:
   - Read, Write, Touch, Latch, Off

2. **Curve Types**:
   - Linear (MVP)
   - Bezier (smooth curves)
   - Step (instant changes)

3. **Visual Editor**:
   - Dedicated automation lane below waveform
   - Rubber-band selection
   - Copy/paste automation regions

4. **Advanced Features**:
   - Automation trimming (offset all points by time)
   - Automation scaling (multiply all values)
   - Automation templates (save/load curves)
   - LFO/pattern-based automation

## Questions to Resolve

1. **Recording Behavior**: Should recording overwrite existing automation or merge with it?
   - **Proposal**: Overwrite by default, add "Merge" option later

2. **Playback Behavior**: Should faders be locked during automation playback?
   - **Proposal**: Yes, show visual indicator that fader is automated

3. **Automation Granularity**: How often should we record points?
   - **Proposal**: Every 50ms during recording, then simplify to ~1 point per second on average

4. **UI Complexity**: Should automation editing be in-line or in a separate panel?
   - **Proposal**: Start with simple arm/clear buttons, add visual editor later

5. **Export Behavior**: Should exported mixes "bake in" automation or preserve it?
   - **Proposal**: Export always bakes automation into the mix (it's a mixdown)

## Implementation Phases

### Phase 1: MVP (Core Functionality)
- Arm button per channel
- Record volume automation during playback
- Play back volume automation
- Save/load automation to/from iXML
- Clear automation button

### Phase 2: Pan Automation
- Extend to pan parameter
- Support both volume and pan simultaneously

### Phase 3: Visual Feedback
- Show automation indicator on faders
- Display automation curve on waveform

### Phase 4: Editing
- Click to add points
- Drag to move points
- Delete points

### Phase 5: Advanced Features
- Automation modes (Touch, Latch)
- Curve types (Bezier)
- Copy/paste automation

## Estimated Complexity
- **Phase 1 (MVP)**: Medium - ~8 hours
- **Phase 2**: Low - ~2 hours
- **Phase 3**: Medium - ~4 hours
- **Phase 4**: High - ~8 hours
- **Phase 5**: High - ~12+ hours

---

## Next Steps
1. Review and approve this plan
2. Discuss any modifications to workflow or UI
3. Decide on Phase 1 scope
4. Begin implementation
