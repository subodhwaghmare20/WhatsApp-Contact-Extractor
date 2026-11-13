/**
 * Frontend Application Controller for WhatsApp Contact Extractor
 */

const state = {
  connectionStatus: 'disconnected', // 'authenticated' | 'qr_required' | 'loading' | 'disconnected'
  isExtracting: false,
  participants: [],
  groupTitle: '',
  stats: {
    totalParticipants: 0,
    numbersExtracted: 0,
    numbersUnavailable: 0,
    profileExtracted: 0
  }
};

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const btnToggleBrowser = document.getElementById('btnToggleBrowser');
const btnStartExtract = document.getElementById('btnStartExtract');
const btnExportExcel = document.getElementById('btnExportExcel');
const chkInspectProfiles = document.getElementById('chkInspectProfiles');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressMessage = document.getElementById('progressMessage');
const progressCounter = document.getElementById('progressCounter');
const statusBanner = document.getElementById('statusBanner');

const metricTotal = document.getElementById('metricTotal');
const metricNumbers = document.getElementById('metricNumbers');
const metricUnavailable = document.getElementById('metricUnavailable');
const metricGroupName = document.getElementById('metricGroupName');

const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const tableBody = document.getElementById('tableBody');
const tableRecordCount = document.getElementById('tableRecordCount');

const qrContainer = document.getElementById('qrContainer');
const qrImage = document.getElementById('qrImage');
const qrLoading = document.getElementById('qrLoading');
const groupSelect = document.getElementById('groupSelect');

let statusInterval = null;
let groupsLoaded = false;

// Safe Fetch helper that handles non-JSON / HTML error pages (e.g. 502 Bad Gateway / Render cold start)
async function safeFetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    if (!res.ok) {
      throw new Error(`Cloud server is waking up or restarting (HTTP ${res.status}). Please try again in a few moments.`);
    }
    throw new Error('Server returned an unexpected response. Please refresh.');
  }
  if (!res.ok) {
    throw new Error(data.error || `Server error (${res.status})`);
  }
  return data;
}

async function checkStatus() {
  try {
    const data = await safeFetchJson('/api/status');
    updateConnectionUI(data.status, data.details);
  } catch (err) {
    updateConnectionUI('disconnected', err.message);
  }
}

async function fetchGroups() {
  if (groupsLoaded) return;
  try {
    const data = await safeFetchJson('/api/groups');
    if (data.groups && data.groups.length > 0 && groupSelect) {
      groupSelect.innerHTML = '<option value="">-- Choose group from your account or auto-detect --</option>' +
        data.groups.map(g => `<option value="${escapeHtml(g.subject)}">${escapeHtml(g.subject)}</option>`).join('');
      groupsLoaded = true;
    }
  } catch (err) {}
}

async function fetchQrCode() {
  try {
    const data = await safeFetchJson('/api/qr');
    if (data && data.qr) {
      qrImage.src = data.qr;
      qrImage.style.display = 'block';
      qrLoading.style.display = 'none';
    } else {
      qrImage.style.display = 'none';
      qrLoading.style.display = 'block';
      qrLoading.textContent = 'Generating WhatsApp QR code in cloud...';
    }
  } catch (err) {
    qrLoading.textContent = 'Connecting to WhatsApp Web in cloud...';
  }
}

function updateConnectionUI(status, details) {
  state.connectionStatus = status;

  connectionBadge.className = 'status-badge';
  if (status === 'authenticated') {
    connectionBadge.classList.add('badge-connected');
    connectionText.textContent = 'WhatsApp Connected';
    btnToggleBrowser.textContent = 'Close Browser';
    btnStartExtract.disabled = state.isExtracting;
    if (qrContainer) qrContainer.classList.add('hidden');
    showBanner('WhatsApp connected successfully! Select your group below and click "Start Extraction".', 'success');
    fetchGroups();
  } else if (status === 'qr_required') {
    connectionBadge.classList.add('badge-qr');
    connectionText.textContent = 'Scan QR Code Below';
    btnToggleBrowser.textContent = 'Close Browser';
    btnStartExtract.disabled = true;
    groupsLoaded = false;
    if (qrContainer) {
      qrContainer.classList.remove('hidden');
      fetchQrCode();
    }
  } else if (status === 'loading') {
    connectionBadge.classList.add('badge-qr');
    connectionText.textContent = 'Syncing WhatsApp...';
    btnToggleBrowser.textContent = 'Close Browser';
    btnStartExtract.disabled = true;
    if (qrContainer) {
      qrContainer.classList.remove('hidden');
      qrImage.style.display = 'none';
      qrLoading.style.display = 'block';
      qrLoading.textContent = details || 'Pairing with phone and syncing WhatsApp... Please wait a moment.';
    }
  } else {
    connectionBadge.classList.add('badge-disconnected');
    connectionText.textContent = 'Disconnected';
    btnToggleBrowser.textContent = 'Launch Browser';
    btnStartExtract.disabled = true;
    groupsLoaded = false;
    if (qrContainer) qrContainer.classList.add('hidden');
  }
}

function showBanner(message, type = 'info') {
  statusBanner.className = `status-banner banner-${type}`;
  statusBanner.textContent = message;
  statusBanner.classList.remove('hidden');
}

function hideBanner() {
  statusBanner.classList.add('hidden');
}

// Toggle Browser
btnToggleBrowser.addEventListener('click', async () => {
  btnToggleBrowser.disabled = true;
  try {
    if (state.connectionStatus === 'disconnected') {
      showBanner('Opening cloud WhatsApp browser... QR code will appear below in 10-15s.', 'info');
      if (qrContainer) {
        qrContainer.classList.remove('hidden');
        qrImage.style.display = 'none';
        qrLoading.style.display = 'block';
        qrLoading.textContent = 'Launching cloud browser... Fetching QR code...';
      }
      const data = await safeFetchJson('/api/browser/start', { method: 'POST' });
      showBanner('Cloud browser ready. Please scan the QR code below with WhatsApp on your phone!', 'info');
      await checkStatus();
      if (data.status === 'qr_required' || data.status === 'loading') {
        fetchQrCode();
      }
    } else {
      showBanner('Closing cloud browser session...', 'info');
      await safeFetchJson('/api/browser/close', { method: 'POST' });
      showBanner('Browser closed.', 'info');
      await checkStatus();
    }
  } catch (err) {
    showBanner(err.message, 'error');
  } finally {
    btnToggleBrowser.disabled = false;
  }
});

// Start Extraction
btnStartExtract.addEventListener('click', async () => {
  if (state.isExtracting) return;

  const selectedGroup = groupSelect ? groupSelect.value.trim() : '';
  if (!selectedGroup) {
    showBanner('Please select a WhatsApp group from the "Select WhatsApp Group" dropdown first.', 'error');
    if (groupSelect) groupSelect.focus();
    return;
  }

  state.isExtracting = true;
  btnStartExtract.disabled = true;
  btnExportExcel.disabled = true;
  progressContainer.classList.remove('hidden');
  progressBar.style.width = '10%';
  progressMessage.textContent = `Connecting to "${selectedGroup}" in WhatsApp Web...`;
  progressCounter.textContent = '0 found';
  hideBanner();

  const inspectProfiles = chkInspectProfiles ? chkInspectProfiles.checked : true;

  // Listen to SSE progress stream
  const eventSource = new EventSource('/api/extract/events');

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'progress') {
        if (data.phase === 'profile_inspection') {
          const percent = 50 + Math.round((data.current / data.total) * 45);
          progressBar.style.width = `${percent}%`;
          progressMessage.textContent = data.message;
          progressCounter.textContent = `${data.current} of ${data.total} inspected`;
        } else {
          progressBar.style.width = `${Math.min(50, 10 + data.iteration * 4)}%`;
          progressMessage.textContent = data.message;
          progressCounter.textContent = `${data.totalRawFound} found`;
        }
      }
    } catch (err) {}
  };

  try {
    const result = await safeFetchJson('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectSavedProfiles: inspectProfiles,
        groupTitle: selectedGroup
      })
    });

    eventSource.close();
    progressBar.style.width = '100%';
    progressMessage.textContent = 'Extraction complete!';
    
    state.participants = result.participants || [];
    state.groupTitle = result.groupTitle || 'WhatsApp Group';
    state.stats = result.stats || {};

    updateMetrics();
    renderTable();

    btnExportExcel.disabled = state.participants.length === 0;
    const profileCountMsg = state.stats.profileExtracted ? ` (${state.stats.profileExtracted} via profile inspection)` : '';
    showBanner(`Successfully extracted ${state.participants.length} participants from "${state.groupTitle}"${profileCountMsg}!`, 'success');
  } catch (err) {
    eventSource.close();
    progressBar.style.width = '0%';
    showBanner(`Extraction error: ${err.message}`, 'error');
  } finally {
    state.isExtracting = false;
    btnStartExtract.disabled = state.connectionStatus !== 'authenticated';
  }
});

// Update Metrics Display
function updateMetrics() {
  metricTotal.textContent = state.stats.totalParticipants || 0;
  metricNumbers.textContent = state.stats.numbersExtracted || 0;
  metricUnavailable.textContent = state.stats.numbersUnavailable || 0;
  metricGroupName.textContent = state.groupTitle || 'None';
}

// Render Participants Table
function renderTable() {
  const searchTerm = searchInput.value.toLowerCase().trim();
  const filterVal = statusFilter.value;

  const filtered = state.participants.filter(p => {
    const matchesSearch = !searchTerm ||
      p.name.toLowerCase().includes(searchTerm) ||
      p.mobileNumber.toLowerCase().includes(searchTerm);

    let matchesStatus = true;
    if (filterVal === 'Extracted (Profile)') {
      matchesStatus = (p.extractionStatus || '').includes('Profile');
    } else if (filterVal !== 'all') {
      matchesStatus = p.contactStatus === filterVal;
    }

    return matchesSearch && matchesStatus;
  });

  tableRecordCount.textContent = `${filtered.length} of ${state.participants.length} records`;

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">No matching participants found.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(p => {
    let statusClass = 'tag-unknown';
    if (p.contactStatus === 'Saved') statusClass = 'tag-saved';
    else if (p.contactStatus === 'Unsaved') statusClass = 'tag-unsaved';

    const phoneDisplay = p.mobileNumber === 'Not Available'
      ? `<span class="text-muted"><em>Not Available</em></span>`
      : `<strong>${p.mobileNumber}</strong>`;

    let extClass = 'tag-hidden';
    const extText = p.extractionStatus || (p.mobileNumber !== 'Not Available' ? 'Extracted' : 'Unavailable');
    if (extText.includes('Profile')) extClass = 'tag-profile';
    else if (extText.includes('Direct') || extText === 'Extracted') extClass = 'tag-direct';

    const adminBadge = p.isAdmin ? `<span class="tag-admin">Admin</span>` : `<span class="text-muted">Member</span>`;

    return `
      <tr>
        <td style="text-align: center;">${p.srNo}</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${phoneDisplay}</td>
        <td><span class="tag-status ${statusClass}">${p.contactStatus}</span></td>
        <td><span class="tag-status ${extClass}">${escapeHtml(extText)}</span></td>
        <td>${adminBadge}</td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Search and Filter Listeners
searchInput.addEventListener('input', renderTable);
statusFilter.addEventListener('change', renderTable);

// Export to Excel
btnExportExcel.addEventListener('click', async () => {
  if (state.participants.length === 0) return;

  btnExportExcel.disabled = true;
  showBanner('Generating formatted Excel file...', 'info');

  try {
    const data = await safeFetchJson('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupName: state.groupTitle,
        participants: state.participants
      })
    });

    window.location.href = `/api/download/${encodeURIComponent(data.fileName)}`;
    showBanner(`Excel file "${data.fileName}" generated and downloaded!`, 'success');
  } catch (err) {
    showBanner(`Export error: ${err.message}`, 'error');
  } finally {
    btnExportExcel.disabled = false;
  }
});

// Initialize Polling
checkStatus();
statusInterval = setInterval(checkStatus, 3000);
