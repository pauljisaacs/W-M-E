// Sound Report Modal Logic
// Dynamically render 22 editable header items in 4 columns (6,6,6,4)

const SOUND_REPORT_HEADER_OPTIONS = [
  "Roll", "Project", "Date", "Director", "Producer", "Job No.", "Location", "Sound Mixer", "Phone", "Email", "Client", "Boom Operator", "Prod Company", "Prod Co. Phone", "Comments", "Media", "File Type", "Bit Depth", "Sample rate", "Frame Rate", "Tone Level"
];

// Fill to 22 with "None" options
while (SOUND_REPORT_HEADER_OPTIONS.length < 22) SOUND_REPORT_HEADER_OPTIONS.push("None");

function renderSoundReportHeaderFields() {
  const container = document.getElementById('report-header-fields');
  if (!container) return;
  container.innerHTML = '';
  // 4 columns: 6,6,6,4
  const colCounts = [6, 6, 6, 4];
  let fieldIdx = 0;
  for (let col = 0; col < 4; col++) {
    const colDiv = document.createElement('div');
    colDiv.className = 'report-header-col';
    for (let row = 0; row < colCounts[col]; row++, fieldIdx++) {
      const group = document.createElement('div');
      group.className = 'header-field-group';
      // Dropdown and input side by side
      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '0.5em';
      // Dropdown
      const select = document.createElement('select');
      select.className = 'header-field-select';
      SOUND_REPORT_HEADER_OPTIONS.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
      });
      select.value = SOUND_REPORT_HEADER_OPTIONS[fieldIdx] || 'None';
      // Text input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'header-field-input';
      input.maxLength = 128;
      label.appendChild(select);
      label.appendChild(input);
      group.appendChild(label);
      colDiv.appendChild(group);
    }
    container.appendChild(colDiv);
  }
}

function getMaxTrackNames(files) {
  let max = 0;
  for (const file of files) {
    const tracks = (file.metadata.trackNames || []);
    if (tracks.length > max) max = tracks.length;
  }
  return Math.min(max, 64);
}

function renderSoundReportTakeListTable() {
  const container = document.getElementById('report-take-list-table-container');
  if (!container || !window.app || !window.app.files) return;
  // Always show notes and track names columns, and always include them in the table
  // Clone and sort files by TC Start (ascending)
  const files = [...window.app.files];
  files.sort((a, b) => {
    const tcA = a.metadata.tcStart || '';
    const tcB = b.metadata.tcStart || '';
    return tcA.localeCompare(tcB, undefined, { numeric: true, sensitivity: 'base' });
  });
  // Determine max track names (always at least 1)
  let maxTracks = getMaxTrackNames(files);
  if (maxTracks < 1) maxTracks = 1;
  // Build table
  let html = '<table class="report-take-list-table"><thead><tr>';
  html += '<th>Filename</th><th>Scene</th><th>Take</th><th>TC Start</th><th>Duration</th>';
  for (let i = 0; i < maxTracks; i++) html += `<th>Track ${i+1}</th>`;
  html += '<th>Notes</th></tr></thead><tbody>';
  for (const file of files) {
    const md = file.metadata;
    html += '<tr>';
    html += `<td>${md.filename || ''}</td>`;
    html += `<td>${md.scene || ''}</td>`;
    html += `<td>${md.take || ''}</td>`;
    html += `<td>${md.tcStart || ''}</td>`;
    html += `<td>${md.duration || ''}</td>`;
    const tracks = md.trackNames || [];
    for (let i = 0; i < maxTracks; i++) {
      html += `<td>${tracks[i] || ''}</td>`;
    }
    html += `<td>${md.notes || ''}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// Attach event listeners for toggles
function setupReportTakeListToggles() {
  const notesToggle = document.getElementById('report-notes-newline');
  const tracksToggle = document.getElementById('report-tracks-newline');
  if (notesToggle) notesToggle.addEventListener('change', renderSoundReportTakeListTable);
  if (tracksToggle) tracksToggle.addEventListener('change', renderSoundReportTakeListTable);
}


// Expose to global for app.js
window.renderSoundReportHeaderFields = renderSoundReportHeaderFields;
window.renderSoundReportTakeListTable = renderSoundReportTakeListTable;

document.addEventListener('DOMContentLoaded', () => {
  renderSoundReportHeaderFields();
  renderSoundReportTakeListTable();
  setupReportTakeListToggles();
});
