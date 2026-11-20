// AutoApply AI Client Frontend

let ws;
const terminalEl = document.getElementById('terminal-logs');
const historyTbody = document.getElementById('history-tbody');
const modal = document.getElementById('proof-modal');
const modalImg = document.getElementById('modal-img');
const btnCloseModal = document.getElementById('btn-close-modal');

// Log Audit Modal Elements
const logModal = document.getElementById('log-modal');
const logModalTitle = document.getElementById('log-modal-title');
const logModalBody = document.getElementById('log-modal-body');
const btnCloseLogModal = document.getElementById('btn-close-log-modal');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupWebSocket();
  checkNaukriAuthStatus();
  loadStatus();
  loadApplications('today');
  loadAnalytics('today');
  loadProfile();
  loadSettings();
  loadNaukriAppliedStats();
  setupEventListeners();
});

// Setup WebSocket Connection
function setupWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    appendLog('System', 'Connected to AutoApply AI Engine via WebSocket.', 'info');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        appendLog('Agent', data.payload.message, data.payload.level);
      } else if (data.type === 'applied') {
        appendLog('Success', `Applied: ${data.payload.companyName} (${data.payload.jobTitle})`, 'success');
        loadStatus();
        const currentFilterVal = document.getElementById('date-filter-select')?.value || 'today';
        currentPage = 1;
        loadApplications(currentFilterVal, 1);
        loadAnalytics(currentFilterVal);
      } else if (data.type === 'job_apply_progress') {
        handleJobApplyProgress(data.payload);
      } else if (data.type === 'auth_success') {
        appendLog('Auth', 'Naukri account linked successfully!', 'success');
        checkNaukriAuthStatus();
      } else if (data.type === 'verified_count') {
        handleVerifiedCount(data.payload);
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };

  ws.onclose = () => {
    setTimeout(setupWebSocket, 3000);
  };
}

function appendLog(sender, message, level = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `<span class="timestamp">[${time}]</span> <strong>[${sender}]</strong> ${escapeHtml(message)}`;
  terminalEl.appendChild(entry);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Check Naukri Authentication Status
async function checkNaukriAuthStatus() {
  try {
    const res = await fetch('/api/naukri/auth-status');
    const data = await res.json();
    const badge = document.getElementById('naukri-auth-badge');
    const text = document.getElementById('naukri-auth-text');
    const btn = document.getElementById('btn-connect-naukri');

    if (data.isLoggedIn) {
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      badge.style.color = '#34d399';
      text.innerText = 'Naukri: Account Linked ✅';
      btn.innerText = '🔄 Re-link Naukri';
    } else {
      badge.style.background = 'rgba(245, 158, 11, 0.15)';
      badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      badge.style.color = '#fbbf24';
      text.innerText = 'Naukri: Ready to Link';
      btn.innerText = '🔑 Link Naukri Account';
    }
  } catch (e) {
    console.error('Error checking auth:', e);
  }
}

// Load System Status & Counters
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    document.getElementById('stat-total').innerText = data.stats.total;
    document.getElementById('stat-success').innerText = data.stats.success;
    document.getElementById('stat-company').innerText = data.stats.appliedToday || data.stats.success;
    document.getElementById('stat-pending').innerText = data.stats.failed;
  } catch (e) {
    console.error('Error loading stats:', e);
  }
}

// Pagination State (10 items per page, recent applications on top)
let currentPage = 1;
const itemsPerPage = 10;
let currentFilter = 'today';
let totalApplications = 0;
let totalPages = 1;

let loadedApplicationsList = [];

// Load Application History Table with Date Filtering & 10-Item Pagination
async function loadApplications(dateFilter = currentFilter, page = currentPage) {
  currentFilter = dateFilter;
  currentPage = page;

  try {
    const res = await fetch(`/api/applications?date=${encodeURIComponent(dateFilter)}&page=${page}&limit=${itemsPerPage}`);
    const data = await res.json();

    const isPaginated = !Array.isArray(data);
    const apps = isPaginated ? (data.items || []) : data;
    totalApplications = isPaginated ? data.total : apps.length;
    totalPages = isPaginated ? (data.totalPages || 1) : Math.ceil(totalApplications / itemsPerPage) || 1;

    // Guarantee latest applied jobs are strictly on top (descending order)
    apps.sort((a, b) => {
      const timeA = new Date(a.appliedAt || a.appliedDate || 0).getTime();
      const timeB = new Date(b.appliedAt || b.appliedDate || 0).getTime();
      return timeB - timeA;
    });

    loadedApplicationsList = apps;

    const historyCountEl = document.getElementById('history-count');
    if (historyCountEl) {
      historyCountEl.innerText = `${totalApplications} Records`;
    }

    const paginationWrapper = document.getElementById('pagination-wrapper');

    if (totalApplications === 0) {
      historyTbody.innerHTML = `<tr><td colspan="6" class="empty-state">No applications found for selected date (${dateFilter}). Click "START 100 JOBS AUTO-APPLY" above to run!</td></tr>`;
      if (paginationWrapper) paginationWrapper.style.display = 'none';
      return;
    }

    if (paginationWrapper) {
      paginationWrapper.style.display = 'flex';
    }

    historyTbody.innerHTML = apps.map(app => {
      const jobUrl = app.appliedUrl || app.sourceUrl || '';
      return `
      <tr data-app-id="${app.id}">
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(app.jobTitle)}</div>
          <span style="color: var(--text-muted); font-size: 12px;">${escapeHtml(app.companyName)}</span>
        </td>
        <td><span class="badge">${escapeHtml(app.atsType || 'Naukri / External')}</span></td>
        <td><span class="status-tag ${app.status}">${app.status}</span></td>
        <td style="color: var(--text-secondary); font-size: 12.5px;">
          ${escapeHtml(app.appliedDate || '')} <span style="color:var(--text-muted); font-size:11.5px;">${escapeHtml(app.appliedTime || '')}</span>
        </td>
        <td>
          ${jobUrl ? `
            <a href="${escapeHtml(jobUrl)}" target="_blank" rel="noopener noreferrer" style="color: #00d2ff; font-size: 12.5px; text-decoration: underline; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
              <span>🔗 View on Naukri</span>
            </a>
          ` : '<span style="color: var(--text-muted); font-size: 12px;">N/A</span>'}
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${app.proofScreenshot ? `<button class="btn-proof" onclick="viewProof('${app.proofScreenshot}')">View Proof</button>` : '<span style="color:var(--text-muted); font-size:12px;">No Image</span>'}
            <button class="btn-log" onclick="viewAppLog('${app.id}')" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); color: #e2e8f0; padding: 6px 10px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px;">
              📋 Log
            </button>
          </div>
        </td>
      </tr>
      `;
    }).join('');

    renderPagination(totalApplications, currentPage, totalPages);
  } catch (e) {
    console.error('Error loading applications:', e);
  }
}

// Render Pagination Controls (10 per page, dynamic pills, prev/next)
function renderPagination(total, page, pages) {
  const rangeEl = document.getElementById('pagination-range');
  const totalEl = document.getElementById('pagination-total');
  const numbersEl = document.getElementById('pagination-numbers');
  const btnFirst = document.getElementById('btn-page-first');
  const btnPrev = document.getElementById('btn-page-prev');
  const btnNext = document.getElementById('btn-page-next');
  const btnLast = document.getElementById('btn-page-last');

  const start = total === 0 ? 0 : (page - 1) * itemsPerPage + 1;
  const end = Math.min(page * itemsPerPage, total);

  if (rangeEl) rangeEl.innerText = `${start}-${end}`;
  if (totalEl) totalEl.innerText = total;

  if (btnFirst) btnFirst.disabled = page <= 1;
  if (btnPrev) btnPrev.disabled = page <= 1;
  if (btnNext) btnNext.disabled = page >= pages;
  if (btnLast) btnLast.disabled = page >= pages;

  if (numbersEl) {
    numbersEl.innerHTML = '';
    
    // Window of up to 5 page pills
    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(pages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let p = startPage; p <= endPage; p++) {
      const pBtn = document.createElement('button');
      pBtn.className = `btn-page ${p === page ? 'active' : ''}`;
      pBtn.innerText = p;
      pBtn.onclick = () => loadApplications(currentFilter, p);
      numbersEl.appendChild(pBtn);
    }
  }
}

// Load Date Analytics & Summary Breakdown
async function loadAnalytics(dateFilter = 'today') {
  try {
    const res = await fetch(`/api/analytics?date=${encodeURIComponent(dateFilter)}`);
    const data = await res.json();

    const rolesList = Object.entries(data.roleCounts || {})
      .map(([role, cnt]) => `${role} (${cnt})`)
      .slice(0, 3)
      .join(', ');

    const dateLabel = dateFilter === 'today' ? 'Today' : dateFilter === 'yesterday' ? 'Yesterday' : 'All Time';
    const summaryText = `📊 ${dateLabel}: ${data.total} Applied (${data.easyApplyCount} Easy Apply, ${data.companySiteCount} Company Portal) ${rolesList ? `• Top Roles: ${rolesList}` : ''}`;
    
    const summaryEl = document.getElementById('analytics-summary-text');
    if (summaryEl) {
      summaryEl.innerText = summaryText;
    }
  } catch (e) {
    console.error('Error loading analytics:', e);
  }
}

// Load Candidate Profile
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    const profile = await res.json();

    document.getElementById('badge-name').innerText = profile.personal.fullName;
    document.getElementById('prof-name').value = profile.personal.fullName;
    document.getElementById('prof-email').value = profile.personal.email;
    document.getElementById('prof-phone').value = profile.personal.phone;
    document.getElementById('prof-exp').value = profile.professional.totalExperienceYears;
    document.getElementById('prof-notice').value = profile.professional.noticePeriodText;
    document.getElementById('prof-cctc').value = profile.professional.currentCtcLpa;
    document.getElementById('prof-ectc').value = profile.professional.expectedCtcLpa;
    document.getElementById('prof-location').value = profile.personal.currentLocation;
    document.getElementById('prof-linkedin').value = profile.links.linkedin;
    document.getElementById('prof-resume').value = profile.resume.filePath;
  } catch (e) {
    console.error('Error loading profile:', e);
  }
}

// Load Settings
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    document.getElementById('set-keyword').value = settings.search.keyword;
    document.getElementById('set-location').value = settings.search.location;
    document.getElementById('set-headless').checked = settings.browser.headless;
    document.getElementById('set-autosubmit').checked = settings.automation.autoSubmit;
  } catch (e) {}
}

// Event Listeners
function setupEventListeners() {
  // Date Filter Change
  document.getElementById('date-filter-select')?.addEventListener('change', (e) => {
    const val = e.target.value;
    currentPage = 1;
    loadApplications(val, 1);
    loadAnalytics(val);
  });

  // Pagination Navigation Buttons
  document.getElementById('btn-page-first')?.addEventListener('click', () => {
    if (currentPage > 1) loadApplications(currentFilter, 1);
  });
  document.getElementById('btn-page-prev')?.addEventListener('click', () => {
    if (currentPage > 1) loadApplications(currentFilter, currentPage - 1);
  });
  document.getElementById('btn-page-next')?.addEventListener('click', () => {
    if (currentPage < totalPages) loadApplications(currentFilter, currentPage + 1);
  });
  document.getElementById('btn-page-last')?.addEventListener('click', () => {
    if (currentPage < totalPages) loadApplications(currentFilter, totalPages);
  });

  // Verify Live Naukri Applies Count Button
  document.getElementById('btn-refresh-naukri-count')?.addEventListener('click', async () => {
    appendLog('User', 'Checking live profile applies count on Naukri...', 'info');
    const btn = document.getElementById('btn-refresh-naukri-count');
    btn.innerText = 'Checking...';
    try {
      const res = await fetch('/api/naukri/current-count');
      const data = await res.json();
      if (data.count !== null && data.count !== undefined) {
        appendLog('Verifier', `Current Naukri Profile Applies Count: ${data.count} ✅`, 'success');
        btn.innerText = `Naukri Count: ${data.count} ✅`;
      } else {
        appendLog('Verifier', 'Could not read count. Please ensure session is active.', 'warn');
        btn.innerText = 'Retry Count Check';
      }
    } catch (e) {
      appendLog('Verifier', `Error checking count: ${e.message}`, 'error');
      btn.innerText = 'Verify Naukri Applies Count';
    }
  });

  // Tabs switcher
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Clear logs
  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    terminalEl.innerHTML = '';
  });

  // Link Naukri Account Button
  document.getElementById('btn-connect-naukri').addEventListener('click', async () => {
    appendLog('User', 'Opening Naukri Login window in Chrome...', 'info');
    try {
      const res = await fetch('/api/naukri/login', { method: 'POST' });
      const data = await res.json();
      appendLog('Server', data.message, 'info');
    } catch (e) {
      appendLog('Client', `Error: ${e.message}`, 'error');
    }
  });

  // Discovered Jobs Segmented Tabs (Ready / Already Applied / All)
  document.querySelectorAll('.discovered-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.discovered-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-secondary)';
        b.style.boxShadow = 'none';
      });
      btn.classList.add('active');
      btn.style.background = 'linear-gradient(135deg, #00d2ff, #3a7bd5)';
      btn.style.color = '#fff';
      btn.style.boxShadow = '0 0 12px rgba(0,210,255,0.35)';

      currentDiscoveredTab = btn.getAttribute('data-tab') || 'ready';
      discoveredCurrentPage = 1;
      renderDiscoveredJobs(window.discoveredJobs || discoveredJobs);
    });
  });

  // Discovered Jobs Pagination Navigation
  document.getElementById('btn-discovered-page-first')?.addEventListener('click', () => {
    discoveredCurrentPage = 1;
    renderDiscoveredJobs(window.discoveredJobs || discoveredJobs);
    document.getElementById('discovered-section')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('btn-discovered-page-prev')?.addEventListener('click', () => {
    if (discoveredCurrentPage > 1) {
      discoveredCurrentPage--;
      renderDiscoveredJobs(window.discoveredJobs || discoveredJobs);
      document.getElementById('discovered-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  document.getElementById('btn-discovered-page-next')?.addEventListener('click', () => {
    const totalPages = Math.ceil(getFilteredJobsForCurrentTab().length / discoveredItemsPerPage) || 1;
    if (discoveredCurrentPage < totalPages) {
      discoveredCurrentPage++;
      renderDiscoveredJobs(window.discoveredJobs || discoveredJobs);
      document.getElementById('discovered-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  document.getElementById('btn-discovered-page-last')?.addEventListener('click', () => {
    const totalPages = Math.ceil(getFilteredJobsForCurrentTab().length / discoveredItemsPerPage) || 1;
    discoveredCurrentPage = totalPages;
    renderDiscoveredJobs(window.discoveredJobs || discoveredJobs);
    document.getElementById('discovered-section')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Filter & Search Jobs Button
  document.getElementById('btn-filter-jobs')?.addEventListener('click', () => {
    executeFilterSearch();
  });

  // Sync Naukri Applied History Button
  document.getElementById('btn-sync-applied')?.addEventListener('click', (e) => {
    e.preventDefault();
    syncNaukriAppliedHistory();
  });

  // Apply All Selected Jobs Button
  document.getElementById('btn-apply-all-selected')?.addEventListener('click', () => {
    executeApplyAllSelected();
  });

  // Toggle All Checkboxes on Current Page
  document.getElementById('btn-toggle-select-all')?.addEventListener('click', () => {
    const currentSlice = getCurrentDiscoveredPageSlice().filter(j => !j.alreadyApplied);
    const anyUnchecked = currentSlice.some(j => !discoveredSelectedIds.has(j.id));
    currentSlice.forEach(j => {
      if (anyUnchecked) discoveredSelectedIds.add(j.id);
      else discoveredSelectedIds.delete(j.id);
    });
    renderDiscoveredJobs(window.discoveredJobs || discoveredJobs);
  });

  document.getElementById('th-select-all')?.addEventListener('change', (e) => {
    const currentSlice = getCurrentDiscoveredPageSlice().filter(j => !j.alreadyApplied);
    currentSlice.forEach(j => {
      if (e.target.checked) discoveredSelectedIds.add(j.id);
      else discoveredSelectedIds.delete(j.id);
    });
    renderDiscoveredJobs(window.discoveredJobs || discoveredJobs);
  });

  // Save Profile Form
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentRes = await fetch('/api/profile');
    const profile = await currentRes.json();

    profile.personal.fullName = document.getElementById('prof-name').value;
    profile.personal.email = document.getElementById('prof-email').value;
    profile.personal.phone = document.getElementById('prof-phone').value;
    profile.professional.totalExperienceYears = parseFloat(document.getElementById('prof-exp').value);
    profile.professional.noticePeriodText = document.getElementById('prof-notice').value;
    profile.professional.currentCtcLpa = parseFloat(document.getElementById('prof-cctc').value);
    profile.professional.expectedCtcLpa = parseFloat(document.getElementById('prof-ectc').value);
    profile.personal.currentLocation = document.getElementById('prof-location').value;
    profile.links.linkedin = document.getElementById('prof-linkedin').value;

    const saveRes = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile)
    });
    if (saveRes.ok) {
      alert('Profile details saved successfully!');
      loadProfile();
    }
  });

  // Close Modals
  btnCloseModal?.addEventListener('click', () => {
    modal?.classList.remove('open');
  });

  btnCloseLogModal?.addEventListener('click', () => {
    logModal?.classList.remove('open');
  });

  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open');
    }
    if (e.target === logModal) {
      logModal.classList.remove('open');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modal?.classList.remove('open');
      logModal?.classList.remove('open');
    }
  });
}

// Global function to view proof screenshot full size
window.viewProof = function(filename) {
  modalImg.src = `/proofs/${filename}`;
  modal.classList.add('open');
};

// Global function to view rich application log, failure/skip reasons, and live verification link
window.viewAppLog = async function(appId) {
  let app = (loadedApplicationsList || []).find(a => a.id === appId);
  if (!app) {
    try {
      const res = await fetch('/api/applications?date=all');
      const all = await res.json();
      const list = Array.isArray(all) ? all : (all.items || []);
      app = list.find(a => a.id === appId);
    } catch (e) {}
  }

  if (!app) {
    alert('Application details not found.');
    return;
  }

  const jobUrl = app.appliedUrl || app.sourceUrl || '';
  const statusColor = app.status === 'SUCCESS' ? '#34d399' : (app.status === 'QUOTA_EXCEEDED' ? '#f87171' : (app.status === 'SKIPPED' ? '#fbbf24' : (app.status === 'DUPLICATE' ? '#c084fc' : '#ef4444')));
  const statusBg = app.status === 'SUCCESS' ? 'rgba(16, 185, 129, 0.15)' : (app.status === 'QUOTA_EXCEEDED' ? 'rgba(239, 68, 68, 0.2)' : (app.status === 'SKIPPED' ? 'rgba(245, 158, 11, 0.15)' : (app.status === 'DUPLICATE' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(239, 68, 68, 0.15)')));

  let statusExplanation = '';
  if (app.status === 'SUCCESS') {
    statusExplanation = `
      <div style="background: rgba(16, 185, 129, 0.08); border-left: 3px solid #34d399; padding: 12px 14px; border-radius: 4px; margin-bottom: 14px;">
        <div style="font-weight: 700; color: #34d399; font-size: 13.5px; margin-bottom: 4px;">✅ Application Successfully Submitted & Confirmed</div>
        <div style="font-size: 12.5px; color: #e2e8f0; line-height: 1.5;">${escapeHtml(app.notes || '1-Click application completed on Naukri. Form questionnaire auto-filled (3 Years experience on Node.js/Fullstack skills, Immediate notice period, 3.6 Current CTC, 6.0 Expected CTC).')}</div>
      </div>
    `;
  } else if (app.status === 'QUOTA_EXCEEDED') {
    statusExplanation = `
      <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #f87171; padding: 12px 14px; border-radius: 4px; margin-bottom: 14px;">
        <div style="font-weight: 700; color: #f87171; font-size: 13.5px; margin-bottom: 4px;">🛑 Daily Application Quota Limit Reached (40-50 Jobs/Day)</div>
        <div style="font-size: 12.5px; color: #e2e8f0; line-height: 1.5;">Naukri enforces a strict daily limit of 40-50 applications per account to protect against spam. Quota automatically resets at <strong>12:00 AM midnight IST</strong>.</div>
      </div>
    `;
  } else if (app.status === 'DUPLICATE') {
    statusExplanation = `
      <div style="background: rgba(168, 85, 247, 0.1); border-left: 3px solid #c084fc; padding: 12px 14px; border-radius: 4px; margin-bottom: 14px;">
        <div style="font-weight: 700; color: #c084fc; font-size: 13.5px; margin-bottom: 4px;">⏩ Duplicate Application Prevented</div>
        <div style="font-size: 12.5px; color: #e2e8f0; line-height: 1.5;">This position at <strong>${escapeHtml(app.companyName)}</strong> was already applied to on ${escapeHtml(app.appliedDate || 'earlier run')}. Re-applying is blocked to protect candidate profile rating and recruiter response rate.</div>
      </div>
    `;
  } else if (app.status === 'SKIPPED') {
    statusExplanation = `
      <div style="background: rgba(245, 158, 11, 0.1); border-left: 3px solid #fbbf24; padding: 12px 14px; border-radius: 4px; margin-bottom: 14px;">
        <div style="font-weight: 700; color: #fbbf24; font-size: 13.5px; margin-bottom: 4px;">⛔ Filter Skipped: Non-Matching Skill Detected</div>
        <div style="font-size: 12.5px; color: #e2e8f0; line-height: 1.5;">${escapeHtml(app.notes || 'The job description explicitly required non-resume skills (e.g., Python, Java, Django, .NET). Skipped in accordance with strict candidate matching rules.')}</div>
      </div>
    `;
  } else {
    statusExplanation = `
      <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 12px 14px; border-radius: 4px; margin-bottom: 14px;">
        <div style="font-weight: 700; color: #ef4444; font-size: 13.5px; margin-bottom: 4px;">⚠️ Application Execution Issue</div>
        <div style="font-size: 12.5px; color: #e2e8f0; line-height: 1.5;">${escapeHtml(app.notes || 'The application could not be automatically submitted. You can click the direct link below to verify or complete manually.')}</div>
      </div>
    `;
  }

  logModalTitle.innerText = `${app.jobTitle} • ${app.companyName}`;
  logModalBody.innerHTML = `
    <!-- Top Status Summary Pill & Date -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="background: ${statusBg}; color: ${statusColor}; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 4px; border: 1px solid ${statusColor}40;">
          ${app.status}
        </span>
        <span style="font-size: 12px; color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px;">
          ${escapeHtml(app.atsType || 'Naukri 1-Click')}
        </span>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary);">
        📅 ${escapeHtml(app.appliedDate || '')} <span style="color: var(--text-muted);">${escapeHtml(app.appliedTime || '')}</span>
      </div>
    </div>

    <!-- Status Explanation Card -->
    ${statusExplanation}

    <!-- Direct Naukri Link for User Live Verification -->
    <div style="margin-bottom: 16px;">
      <div style="font-size: 12px; color: var(--text-secondary); font-weight: 600; margin-bottom: 6px;">🔗 Direct Live Verification Link:</div>
      ${jobUrl ? `
        <a href="${escapeHtml(jobUrl)}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: space-between; background: rgba(0, 210, 255, 0.08); border: 1px solid rgba(0, 210, 255, 0.3); padding: 10px 14px; border-radius: 6px; text-decoration: none; color: #00d2ff; font-size: 13px; font-weight: 600; transition: all 0.2s;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 440px;">${escapeHtml(jobUrl)}</span>
          <span style="font-size: 11.5px; background: rgba(0, 210, 255, 0.2); padding: 3px 8px; border-radius: 4px; white-space: nowrap; margin-left: 8px;">Open on Naukri ↗</span>
        </a>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Clicking this link opens the live Naukri job posting where you can verify the green "Applied" button.</div>
      ` : '<div style="color: var(--text-muted); font-size: 12px;">No direct URL available</div>'}
    </div>

    <!-- Audit Details Table -->
    <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 6px; padding: 12px; margin-bottom: 16px;">
      <div style="font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 8px;">📊 Application Execution Audit</div>
      <div style="display: grid; grid-template-columns: 140px 1fr; gap: 6px; font-size: 12px;">
        <div style="color: var(--text-secondary);">Company:</div>
        <div style="color: #fff; font-weight: 600;">${escapeHtml(app.companyName)}</div>

        <div style="color: var(--text-secondary);">Role Title:</div>
        <div style="color: #fff;">${escapeHtml(app.jobTitle)}</div>

        <div style="color: var(--text-secondary);">Application ID:</div>
        <div style="color: var(--text-muted); font-family: monospace;">${escapeHtml(app.id)}</div>

        <div style="color: var(--text-secondary);">Job ID (Naukri):</div>
        <div style="color: #00d2ff; font-family: monospace;">${escapeHtml(app.jobId || 'N/A')}</div>

        <div style="color: var(--text-secondary);">Questionnaire Rules:</div>
        <div style="color: #34d399;">3 Yrs Exp (Node/React/Express), 0-Day Notice, 3.6 / 6.0 CTC</div>

        <div style="color: var(--text-secondary);">Execution Notes:</div>
        <div style="color: #e2e8f0;">${escapeHtml(app.notes || 'None')}</div>
      </div>
    </div>

    <!-- Proof Screenshot Thumbnail with Green "Applied" Badge -->
    ${app.proofScreenshot ? `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 12px; color: var(--text-secondary); font-weight: 600;">📸 Submission Proof (Shows Green "Applied" Badge):</span>
          <button onclick="viewProof('${app.proofScreenshot}')" class="btn-text" style="font-size: 11.5px; color: #00d2ff;">Expand Fullscreen ↗</button>
        </div>
        <div style="border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; overflow: hidden; background: #000; cursor: pointer;" onclick="viewProof('${app.proofScreenshot}')">
          <img src="/proofs/${app.proofScreenshot}" alt="Submission Proof" style="width: 100%; max-height: 200px; object-fit: cover; object-position: top; display: block;" onerror="this.parentElement.style.display='none';">
        </div>
      </div>
    ` : ''}
  `;

  logModal.classList.add('open');
};

// -------------------------------------------------------------
// Discovered Jobs Filter & Autonomous Batch Apply Workflow
// -------------------------------------------------------------
window.discoveredJobs = [];
let discoveredJobs = window.discoveredJobs;
let currentDiscoveredTab = 'ready'; // 'ready' | 'applied' | 'all'
let discoveredCurrentPage = 1;
const discoveredItemsPerPage = 20;
window.discoveredSelectedIds = new Set();
let discoveredSelectedIds = window.discoveredSelectedIds;

function getFilteredJobsForCurrentTab() {
  const allJobs = window.discoveredJobs || discoveredJobs || [];
  if (currentDiscoveredTab === 'ready') {
    return allJobs.filter(j => !j.alreadyApplied);
  } else if (currentDiscoveredTab === 'applied') {
    return allJobs.filter(j => j.alreadyApplied);
  }
  return allJobs;
}

function getCurrentDiscoveredPageSlice() {
  const list = getFilteredJobsForCurrentTab();
  const start = (discoveredCurrentPage - 1) * discoveredItemsPerPage;
  return list.slice(start, start + discoveredItemsPerPage);
}

window.toggleDiscoveredJobSelection = function(jobId, isChecked) {
  if (isChecked) {
    discoveredSelectedIds.add(jobId);
  } else {
    discoveredSelectedIds.delete(jobId);
  }
  updateSelectedCount();
};

function renderDiscoveredPagination(total, page, pages) {
  const rangeEl = document.getElementById('discovered-pagination-range');
  const totalEl = document.getElementById('discovered-pagination-total');
  const numbersEl = document.getElementById('discovered-pagination-numbers');
  const btnFirst = document.getElementById('btn-discovered-page-first');
  const btnPrev = document.getElementById('btn-discovered-page-prev');
  const btnNext = document.getElementById('btn-discovered-page-next');
  const btnLast = document.getElementById('btn-discovered-page-last');

  const start = total === 0 ? 0 : (page - 1) * discoveredItemsPerPage + 1;
  const end = Math.min(page * discoveredItemsPerPage, total);

  if (rangeEl) rangeEl.innerText = `${start}-${end}`;
  if (totalEl) totalEl.innerText = total;

  if (btnFirst) btnFirst.disabled = page <= 1;
  if (btnPrev) btnPrev.disabled = page <= 1;
  if (btnNext) btnNext.disabled = page >= pages;
  if (btnLast) btnLast.disabled = page >= pages;

  if (numbersEl) {
    numbersEl.innerHTML = '';
    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(pages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let p = startPage; p <= endPage; p++) {
      const pBtn = document.createElement('button');
      pBtn.className = `btn-page ${p === page ? 'active' : ''}`;
      pBtn.innerText = p;
      pBtn.onclick = () => {
        discoveredCurrentPage = p;
        renderDiscoveredJobs(window.discoveredJobs || discoveredJobs);
        document.getElementById('discovered-section')?.scrollIntoView({ behavior: 'smooth' });
      };
      numbersEl.appendChild(pBtn);
    }
  }
}

async function executeFilterSearch() {
  const keyword = document.getElementById('batch-keyword')?.value.trim() || 'Node.js Developer';
  const location = document.getElementById('batch-location')?.value.trim() || 'Chennai, Bangalore, Thiruvananthapuram, Hyderabad';
  const applyType = document.getElementById('filter-apply-type')?.value || 'easy_apply';
  const targetCount = parseInt(document.getElementById('batch-target-count')?.value, 10) || 20;

  const minSalaryVal = document.getElementById('filter-min-salary')?.value.trim();
  const minSalary = minSalaryVal ? parseFloat(minSalaryVal) : 0;
  const includeUnspecifiedSal = document.getElementById('filter-include-unspecified-sal')?.checked !== false;
  const freshness = document.getElementById('filter-freshness')?.value || 'all';

  const expVal = document.getElementById('filter-experience')?.value.trim();
  const experience = (expVal !== '' && !isNaN(parseFloat(expVal))) ? parseFloat(expVal) : 5;

  const btn = document.getElementById('btn-filter-jobs');
  const origBtnHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <span class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid #00d2ff; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px;"></span>
      <span>FILTERING NAUKRI...</span>
    `;
  }

  const salNote = minSalary > 0 ? ` [Min Salary: ${minSalary} LPA+]` : '';
  const expNote = experience !== null ? ` [Exp: <= ${experience} Yrs]` : '';
  const freshNote = freshness !== 'all' ? ` [Freshness: Last ${freshness} Days]` : '';
  appendLog('User', `Triggered Filter Search: "${keyword}" in ${location} [Filter: ${applyType.toUpperCase()}${salNote}${expNote}${freshNote}, Max: ${targetCount}]`, 'info');

  const tbody = document.getElementById('discovered-tbody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state" style="padding: 36px 16px; text-align: center; color: #00d2ff;">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
            <div style="width: 26px; height: 26px; border: 3px solid #00d2ff; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            <span>Scanning Naukri & matching position titles (excluding Lead/.NET/Java/Python)...</span>
          </div>
        </td>
      </tr>
    `;
  }

  try {
    const res = await fetch('/api/jobs/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword,
        location,
        applyType,
        targetCount,
        minSalary,
        includeUnspecifiedSal,
        freshness,
        experience
      })
    });
    const data = await res.json();

    if (data.success) {
      discoveredJobs = data.jobs || [];
      window.discoveredJobs = discoveredJobs;
      window.renderDiscoveredJobs = renderDiscoveredJobs;

      // Reset to page 1 and ready tab as active default
      discoveredCurrentPage = 1;
      currentDiscoveredTab = 'ready';
      discoveredSelectedIds = new Set(discoveredJobs.filter(j => !j.alreadyApplied).map(j => j.id));

      document.querySelectorAll('.discovered-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-secondary)';
        b.style.boxShadow = 'none';
      });
      const readyBtn = document.getElementById('tab-btn-ready');
      if (readyBtn) {
        readyBtn.classList.add('active');
        readyBtn.style.background = 'linear-gradient(135deg, #00d2ff, #3a7bd5)';
        readyBtn.style.color = '#fff';
        readyBtn.style.boxShadow = '0 0 12px rgba(0,210,255,0.35)';
      }

      renderDiscoveredJobs(discoveredJobs);

      const filterLabel = applyType === 'easy_apply' ? 'Easy Apply' : (applyType === 'company_site' ? 'Company Site' : 'All');
      const badge = document.getElementById('discovered-count-badge');
      if (badge) {
        badge.innerText = `${discoveredJobs.length} Jobs Discovered (${filterLabel})`;
      }
      appendLog('Server', `Filter complete: Discovered ${discoveredJobs.length} total jobs.`, 'success');

      // Scroll smoothly to discovered table
      document.getElementById('discovered-section')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      appendLog('Server', data.error || 'Failed to search jobs', 'error');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color: #f87171;">Error searching jobs: ${escapeHtml(data.error)}</td></tr>`;
      }
    }
  } catch (err) {
    appendLog('Client', `Network error during search: ${err.message}`, 'error');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color: #f87171;">Network error: ${escapeHtml(err.message)}</td></tr>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnHtml;
    }
  }
}

function renderDiscoveredJobs(jobs) {
  const tbody = document.getElementById('discovered-tbody');
  if (!tbody) return;

  const allJobs = jobs || [];
  const readyJobs = allJobs.filter(j => !j.alreadyApplied);
  const appliedJobs = allJobs.filter(j => j.alreadyApplied);
  const totalJobs = allJobs.length;

  // Update badge pill counters in segmented tabs
  const countReadyEl = document.getElementById('count-ready');
  const countAppliedEl = document.getElementById('count-applied');
  const countTotalEl = document.getElementById('count-total');
  if (countReadyEl) countReadyEl.innerText = readyJobs.length;
  if (countAppliedEl) countAppliedEl.innerText = appliedJobs.length;
  if (countTotalEl) countTotalEl.innerText = totalJobs;

  // Default to selecting all ready jobs if selection set is empty
  if (discoveredSelectedIds.size === 0 && readyJobs.length > 0) {
    readyJobs.forEach(j => discoveredSelectedIds.add(j.id));
  }

  // Filter jobs list to display based on active tab
  let displayJobs = allJobs;
  if (currentDiscoveredTab === 'ready') {
    displayJobs = readyJobs;
  } else if (currentDiscoveredTab === 'applied') {
    displayJobs = appliedJobs;
  }

  const paginationWrapper = document.getElementById('discovered-pagination-wrapper');

  if (displayJobs.length === 0) {
    let emptyMsg = '🔍 No jobs matched your filter criteria. Try expanding the location or adjusting the keyword.';
    if (currentDiscoveredTab === 'ready' && appliedJobs.length > 0) {
      emptyMsg = `🎉 All ${appliedJobs.length} discovered jobs have already been applied to! Switch to the "Already Applied" tab above to review them.`;
    } else if (currentDiscoveredTab === 'applied') {
      emptyMsg = '📁 No previously applied jobs in this search batch. All discovered jobs are open and ready to apply!';
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state" style="padding: 40px 16px; text-align: center; color: var(--text-secondary); line-height: 1.6;">
          ${emptyMsg}
        </td>
      </tr>
    `;
    if (paginationWrapper) paginationWrapper.style.display = 'none';
    updateSelectedCount();
    return;
  }

  // 20 items per page pagination
  const totalDiscovered = displayJobs.length;
  const totalDiscoveredPages = Math.ceil(totalDiscovered / discoveredItemsPerPage) || 1;
  if (discoveredCurrentPage > totalDiscoveredPages) discoveredCurrentPage = totalDiscoveredPages;
  if (discoveredCurrentPage < 1) discoveredCurrentPage = 1;

  if (paginationWrapper) {
    paginationWrapper.style.display = 'flex';
  }

  const startIndex = (discoveredCurrentPage - 1) * discoveredItemsPerPage;
  const endIndex = Math.min(startIndex + discoveredItemsPerPage, totalDiscovered);
  const pageSlice = displayJobs.slice(startIndex, endIndex);

  tbody.innerHTML = pageSlice.map((job) => {
    const isEasy = job.applyType === 'easy_apply';
    const typeBadge = isEasy
      ? `<span class="badge" style="background: rgba(0, 210, 255, 0.15); color: #00d2ff; border-color: rgba(0, 210, 255, 0.3);">⚡ Easy Apply</span>`
      : `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border-color: rgba(168, 85, 247, 0.3);">🏢 Company Site</span>`;

    const statusBadge = job.alreadyApplied
      ? `<span class="badge" style="background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);">Already Applied</span>`
      : `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.3);">Ready</span>`;

    const isChecked = discoveredSelectedIds.has(job.id);

    return `
      <tr data-job-id="${job.id}" style="${job.alreadyApplied ? 'opacity: 0.75;' : ''}">
        <td style="text-align: center;">
          ${job.alreadyApplied ? `
            <input type="checkbox" class="job-select-chk" data-job-id="${job.id}" disabled title="Already applied - cannot re-apply">
          ` : `
            <input type="checkbox" class="job-select-chk" data-job-id="${job.id}" ${isChecked ? 'checked' : ''} onchange="toggleDiscoveredJobSelection('${job.id}', this.checked)">
          `}
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 28px; height: 28px; border-radius: 6px; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; color: #00d2ff;">
              ${escapeHtml(job.company.slice(0, 2).toUpperCase())}
            </div>
            <strong>${escapeHtml(job.company)}</strong>
          </div>
        </td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(job.title)}</div>
        </td>
        <td>
          <span style="color: var(--text-secondary); font-size: 13px;">${escapeHtml(job.experience)} • ${escapeHtml(job.location)}</span>
          ${job.postedText ? `<div style="font-size: 11.5px; color: #60a5fa; margin-top: 3px; font-weight: 500;">🕒 ${escapeHtml(job.postedText)}</div>` : ''}
        </td>
        <td>
          <span style="color: #34d399; font-weight: 600; font-size: 13px;">${escapeHtml(job.salary || 'Not disclosed')}</span>
        </td>
        <td>${typeBadge}</td>
        <td>
          <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer" style="color: #00d2ff; font-size: 12.5px; text-decoration: underline; font-weight: 500;">
            🔗 View on Naukri
          </a>
        </td>
        <td class="col-status">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${statusBadge}
            ${!job.alreadyApplied ? `
              <button class="btn-single-apply" onclick="executeApplySingleJob('${job.id}')" style="background: rgba(0, 210, 255, 0.12); border: 1px solid rgba(0, 210, 255, 0.35); color: #00d2ff; padding: 4px 9px; border-radius: 4px; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all 0.2s; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;">
                ⚡ Apply
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  renderDiscoveredPagination(totalDiscovered, discoveredCurrentPage, totalDiscoveredPages);
  updateSelectedCount();
}

window.executeApplySingleJob = async function(jobId) {
  const job = discoveredJobs.find(j => j.id === jobId);
  if (!job) return;

  const row = document.querySelector(`tr[data-job-id="${jobId}"]`);
  const statusCell = row ? row.querySelector('.col-status') : null;
  if (statusCell) {
    statusCell.innerHTML = '<span class="badge" style="background: rgba(0, 210, 255, 0.2); color: #00d2ff;">⏳ Applying...</span>';
  }

  appendLog('User', `Triggered Single Apply for "${job.title}" at ${job.company}...`, 'info');

  try {
    const res = await fetch('/api/jobs/apply-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: [job] })
    });
    const data = await res.json();
    if (data.success) {
      appendLog('Server', `Single application session started for ${job.company}`, 'info');
    } else {
      appendLog('Server', data.error || 'Failed to start apply', 'error');
      if (statusCell) {
        statusCell.innerHTML = `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">Failed</span>`;
      }
    }
  } catch (err) {
    appendLog('Client', `Error: ${err.message}`, 'error');
    if (statusCell) {
      statusCell.innerHTML = `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">Error</span>`;
    }
  }
};

function updateSelectedCount() {
  const allReadyJobs = (window.discoveredJobs || discoveredJobs || []).filter(j => !j.alreadyApplied);
  const activeSelected = allReadyJobs.filter(j => discoveredSelectedIds.has(j.id));

  const countSpan = document.getElementById('selected-jobs-count');
  if (countSpan) countSpan.innerText = activeSelected.length;

  const btnApply = document.getElementById('btn-apply-all-selected');
  if (btnApply) {
    btnApply.disabled = activeSelected.length === 0;
  }

  // Update header checkbox to reflect current page slice
  const thAll = document.getElementById('th-select-all');
  if (thAll) {
    const pageReadyJobs = getCurrentDiscoveredPageSlice().filter(j => !j.alreadyApplied);
    thAll.checked = pageReadyJobs.length > 0 && pageReadyJobs.every(j => discoveredSelectedIds.has(j.id));
  }
}

async function executeApplyAllSelected() {
  const allJobs = window.discoveredJobs || discoveredJobs || [];
  const selectedJobs = allJobs.filter(j => discoveredSelectedIds.has(j.id) && !j.alreadyApplied);

  if (selectedJobs.length === 0) {
    alert('Please select at least one open job to apply.');
    return;
  }

  const btn = document.getElementById('btn-apply-all-selected');
  if (btn) btn.disabled = true;

  appendLog('User', `Triggered "Apply All" for ${selectedJobs.length} open jobs across all pages. Starting autonomous solver...`, 'info');

  try {
    const res = await fetch('/api/jobs/apply-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: selectedJobs })
    });
    const data = await res.json();
    if (data.success) {
      appendLog('Server', data.message, 'success');
    } else {
      appendLog('Server', data.error || 'Failed to start apply session', 'error');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    appendLog('Client', `Network error: ${err.message}`, 'error');
    if (btn) btn.disabled = false;
  }
}

function handleJobApplyProgress(p) {
  appendLog('Agent', `[${p.index}/${p.total}] ${p.message}`, p.status === 'SUCCESS' ? 'success' : (p.status === 'QUOTA_EXCEEDED' ? 'error' : 'info'));

  const row = document.querySelector(`tr[data-job-id="${p.jobId}"]`);
  if (row) {
    const statusCell = row.querySelector('.col-status');
    if (statusCell) {
      if (p.status === 'APPLYING') {
        statusCell.innerHTML = '<span class="badge" style="background: rgba(0, 210, 255, 0.2); color: #00d2ff;">⏳ Applying...</span>';
      } else if (p.status === 'SUCCESS') {
        statusCell.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399;">✅ Applied</span>
            ${p.proofScreenshot ? `<button class="btn-text" style="font-size: 11px; color: #00d2ff; padding: 2px 4px;" onclick="viewProof('${p.proofScreenshot}')">Proof</button>` : ''}
          </div>
        `;
        const chk = row.querySelector('.job-select-chk');
        if (chk) {
          chk.checked = false;
          chk.disabled = true;
        }
      } else if (p.status === 'QUOTA_EXCEEDED') {
        statusCell.innerHTML = '<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">🛑 Quota Reached</span>';
      } else {
        statusCell.innerHTML = `<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24;">${p.status || 'Skipped'}</span>`;
      }
    }
  }

  if (p.status === 'SUCCESS') {
    loadStatus();
    loadApplications('today');
    loadAnalytics('today');
  }

  updateSelectedCount();
}

function handleVerifiedCount(report) {
  if (!report) return;
  const msg = report.verified
    ? `🎯 NAUKRI VERIFIED: Profile count increased from ${report.beforeCount} to ${report.afterCount} (+${report.diff})!`
    : `📊 Naukri verification complete: Current applies count is ${report.afterCount || report.beforeCount}.`;

  appendLog('Naukri Verifier', msg, report.verified ? 'success' : 'info');

  const banner = document.getElementById('analytics-summary-bar');
  if (banner) {
    banner.style.background = 'rgba(16, 185, 129, 0.12)';
    banner.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    const text = document.getElementById('analytics-summary-text');
    if (text) {
      text.innerHTML = `<strong>${msg}</strong>`;
    }
  }
}

// Load live Naukri Account Applied History Stats
async function loadNaukriAppliedStats() {
  try {
    const res = await fetch('/api/naukri/applied-stats');
    const data = await res.json();
    if (data.success && data.stats) {
      const el = document.getElementById('applied-history-stat-text');
      if (el) {
        el.innerText = `${data.stats.totalApplied} Jobs (${data.stats.uniqueCompanies} Companies) Excluded`;
      }
    }
  } catch (e) {
    console.warn('Error loading applied stats:', e);
  }
}

// Force sync applied history directly from user's live Naukri account
async function syncNaukriAppliedHistory() {
  const btn = document.getElementById('btn-sync-applied');
  const origText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '🔄 Syncing...';
  }
  appendLog('User', 'Verifying & syncing full applied jobs history from Naukri account...', 'info');

  try {
    const res = await fetch('/api/naukri/sync-applied', { method: 'POST' });
    const data = await res.json();
    if (data.success && data.stats) {
      appendLog('Server', `Successfully verified & synced ${data.stats.totalApplied} applied jobs across ${data.stats.uniqueCompanies} companies!`, 'success');
      loadNaukriAppliedStats();
    } else {
      appendLog('Server', data.error || 'Failed to sync applied history', 'error');
    }
  } catch (err) {
    appendLog('Client', `Sync error: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
}

