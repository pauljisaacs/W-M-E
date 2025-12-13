// Sound Report Export Logic
// Requires jsPDF (for PDF) and window.app.files

// Utility: get current header field values
function getSoundReportHeaderValues() {
  const fields = [];
  document.querySelectorAll('#report-header-fields .header-field-group').forEach(group => {
    const select = group.querySelector('select');
    const input = group.querySelector('input');
    fields.push({ label: select.value, value: input.value });
  });
  return fields;
}

// Utility: get take list data (sorted, with max track count)
function getSoundReportTakeListData() {
  const files = [...(window.app?.files || [])];
  files.sort((a, b) => {
    const tcA = a.metadata.tcStart || '';
    const tcB = b.metadata.tcStart || '';
    return tcA.localeCompare(tcB, undefined, { numeric: true, sensitivity: 'base' });
  });
  let maxTracks = 0;
  for (const file of files) {
    const tracks = (file.metadata.trackNames || []);
    if (tracks.length > maxTracks) maxTracks = tracks.length;
  }
  maxTracks = Math.min(maxTracks, 64);
  return { files, maxTracks };
}

// CSV Export
function exportSoundReportCSV() {
  const headerFields = getSoundReportHeaderValues();
  const { files, maxTracks } = getSoundReportTakeListData();
  // CSV header
  let csv = headerFields.map(f => f.label).join(',') + '\n';
  csv += ['Filename','Scene','Take','TC Start','Duration']
    .concat(Array.from({length:maxTracks},(_,i)=>`Track ${i+1}`)).concat(['Notes']).join(',') + '\n';
  // CSV rows
  for (const file of files) {
    const md = file.metadata;
    const row = [md.filename||'',md.scene||'',md.take||'',md.tcStart||'',md.duration||''];
    const tracks = md.trackNames||[];
    for (let i=0;i<maxTracks;i++) row.push(tracks[i]||'');
    row.push(md.notes||'');
    csv += row.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(',') + '\n';
  }
  // Save dialog
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'SoundReport.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// PDF Export (striped rows, logo, header, table)
async function exportSoundReportPDF() {
  if (!window.jspdf) { alert('jsPDF not loaded'); return; }
  const { jsPDF } = window.jspdf;
  const headerFields = getSoundReportHeaderValues();
  const { files, maxTracks } = getSoundReportTakeListData();
  // Prepare column headers
  const colHeaders = ['Filename','Scene','Take','TC Start','Duration']
    .concat(Array.from({length:maxTracks},(_,i)=>`Track ${i+1}`)).concat(['Notes']);
  // Create a temp doc for measuring
  const tempDoc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  tempDoc.setFontSize(11);
  // Calculate max width for each column
  let colWidths = colHeaders.map(h => tempDoc.getTextWidth(h) + 16); // header + padding
  files.forEach(file => {
    const md = file.metadata;
    let vals = [md.filename||'',md.scene||'',md.take||'',md.tcStart||'',md.duration||''];
    const tracks = md.trackNames||[];
    for (let i=0;i<maxTracks;i++) vals.push(tracks[i]||'');
    vals.push(md.notes||'');
    vals.forEach((v,j) => {
      const w = tempDoc.getTextWidth(String(v)) + 16;
      if (w > colWidths[j]) colWidths[j] = w;
    });
  });
  const totalTableWidth = colWidths.reduce((a,b)=>a+b, 0);
  // Set a minimum width for the page (e.g., a4 landscape width)
  const minPageWidth = 842; // a4 landscape in pt
  const pageWidth = Math.max(totalTableWidth + 80, minPageWidth); // 40pt margin each side
  // Now create the real doc with dynamic width
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [pageWidth, 595] }); // 595pt = a4 height
  // Title/logo
  const company = document.getElementById('report-company')?.value || '';
  let y = 40;
  if (company) { doc.setFontSize(18); doc.text(company, 40, y); y += 30; }
  const logoInput = document.getElementById('report-logo');
  if (logoInput && logoInput.files && logoInput.files[0]) {
    const img = await fileToDataURL(logoInput.files[0]);
    doc.addImage(img, 'PNG', pageWidth - 180, 10, 120, 60, undefined, 'FAST');
  }
  // Header fields
  doc.setFontSize(10);
  let headerY = y;
  let col = 0, row = 0;
  for (let i=0; i<headerFields.length; i++) {
    if (headerFields[i].label !== 'None' && headerFields[i].value) {
      doc.text(`${headerFields[i].label}: ${headerFields[i].value}`, 40 + col*200, headerY + row*16);
      row++;
      if ((col<3 && row>=6) || (col===3 && row>=4)) { col++; row=0; }
    }
  }
  y = headerY + 110;
  // Table header
  doc.setFontSize(11);
  let tableX = 40;
  let tableY = y;
  let x = tableX;
  colHeaders.forEach((h,j)=>{ doc.setFillColor(220,220,220); doc.rect(x,tableY, colWidths[j],20,'F'); doc.text(h, x+4, tableY+14); x+=colWidths[j]; });
  tableY += 20;
  // Table rows
  const notesNewline = document.getElementById('report-notes-newline')?.checked;
  const tracksNewline = document.getElementById('report-tracks-newline')?.checked;
  files.forEach((file, rowIdx) => {
    x = tableX;
    const md = file.metadata;
    // Stripe
    if (rowIdx%2===1) doc.setFillColor(240,240,240); else doc.setFillColor(255,255,255);
    doc.rect(x, tableY, colWidths.reduce((a,b)=>a+b,0), 20, 'F');
    // Data
    let vals = [md.filename||'',md.scene||'',md.take||'',md.tcStart||'',md.duration||''];
    const tracks = md.trackNames||[];
    for (let i=0;i<maxTracks;i++) vals.push(tracks[i]||'');
    vals.push(md.notes||'');
    vals.forEach((v,j)=>{ doc.setTextColor(30,30,30); doc.text(String(v), x+4, tableY+14, {maxWidth:colWidths[j]-8}); x+=colWidths[j]; });
    tableY += 20;
    // New line logic
    if (tracksNewline || notesNewline) {
      let extra = '';
      if (tracksNewline) extra += tracks.filter(Boolean).join(' | ');
      if (tracksNewline && notesNewline) extra += '\n';
      if (notesNewline) extra += md.notes||'';
      if (extra) {
        doc.setFontSize(9);
        doc.setTextColor(120,120,120);
        doc.text(extra, tableX+4, tableY+12, {maxWidth:colWidths.reduce((a,b)=>a+b,0)-8});
        doc.setFontSize(11);
        doc.setTextColor(30,30,30);
        tableY += 16;
      }
    }
  });
  // Save dialog
  doc.save('SoundReport.pdf');
}

// Helper: file to data URL
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Hook up export buttons
function setupSoundReportExport() {
  const createBtn = document.getElementById('create-report-btn');
  if (!createBtn) return;
  createBtn.addEventListener('click', () => {
    const format = document.querySelector('input[name="report-export-format"]:checked')?.value || 'csv';
    if (format === 'pdf') {
      exportSoundReportPDF();
    } else {
      exportSoundReportCSV();
    }
  });
}

document.addEventListener('DOMContentLoaded', setupSoundReportExport);
