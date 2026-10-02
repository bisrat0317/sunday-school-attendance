// Current Application State
let currentLang = localStorage.getItem('app_lang') || 'am';
let token = localStorage.getItem('app_token') || null;
let currentUser = JSON.parse(localStorage.getItem('app_user') || 'null');

let activeSessionId = null;
let activeSessionData = null;
let activeAttendanceRecords = {}; // student_id -> { status: 'present'|'absent'|'permission', remarks: '' }
let searchDebounceTimer = null;

// Translation Helper
function t(key) {
  if (translations[currentLang] && translations[currentLang][key]) {
    return translations[currentLang][key];
  }
  if (translations['en'] && translations['en'][key]) {
    return translations['en'][key];
  }
  return key;
}

// Mobile Telegram Slide Bar Drawer Controller
function toggleMobileDrawer() {
  const drawer = document.getElementById('sidebarDrawer');
  if (drawer && drawer.classList.contains('open')) {
    closeMobileDrawer();
  } else {
    openMobileDrawer();
  }
}

function openMobileDrawer() {
  const drawer = document.getElementById('sidebarDrawer');
  const overlay = document.getElementById('drawerOverlay');
  if (drawer) drawer.classList.add('open');
  if (overlay) overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMobileDrawer() {
  const drawer = document.getElementById('sidebarDrawer');
  const overlay = document.getElementById('drawerOverlay');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// Update UI Language
function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('app_lang', lang);

  // Update Lang buttons active state
  const btnAm = document.getElementById('btnLangAm');
  const btnEn = document.getElementById('btnLangEn');
  if (btnAm) btnAm.classList.toggle('active', lang === 'am');
  if (btnEn) btnEn.classList.toggle('active', lang === 'en');

  const drawerAm = document.getElementById('btnLangAmDrawer');
  const drawerEn = document.getElementById('btnLangEnDrawer');
  if (drawerAm) drawerAm.classList.toggle('active', lang === 'am');
  if (drawerEn) drawerEn.classList.toggle('active', lang === 'en');

  // Translate all text elements with data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang] && translations[lang][key]) {
      el.textContent = translations[lang][key];
    }
  });

  // Translate placeholders with data-i18n-ph
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    if (translations[lang] && translations[lang][key]) {
      el.setAttribute('placeholder', translations[lang][key]);
    }
  });

  // Re-render current active tab contents if logged in
  if (currentUser) {
    updateUserBadge();
    refreshActiveTabData();
  }
}

// API Fetch Helper
async function api(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  try {
    const response = await fetch(endpoint, { ...options, headers });
    if (response.status === 401 || response.status === 403) {
      if (token && response.status === 401) {
        logout();
        return null;
      }
    }

    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      throw new Error(text || `Server error (${response.status})`);
    }

    if (!response.ok) {
      throw new Error(data.message || 'API request failed');
    }
    return data;
  } catch (error) {
    showToast(error.message, 'danger');
    throw error;
  }
}

// Toast Notifications
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = type === 'danger' ? 'var(--danger)' : (type === 'success' ? 'var(--success)' : '#1e293b');
  toast.style.display = 'block';
  toast.style.opacity = '1';

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 3500);
}

// Modal Helpers
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// Authentication
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('btnLoginSubmit');

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('loggingIn')}`;

  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (res && res.token) {
      token = res.token;
      currentUser = res.user;
      localStorage.setItem('app_token', token);
      localStorage.setItem('app_user', JSON.stringify(currentUser));

      showToast(`${t('welcome')}, ${currentUser.full_name}!`, 'success');
      initAppView();
    }
  } catch (err) {
    // Handled in api()
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> ${t('signIn')}`;
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('app_token');
  localStorage.removeItem('app_user');
  closeMobileDrawer();

  document.getElementById('viewApp').style.display = 'none';
  document.getElementById('subNavBar').style.display = 'none';
  document.getElementById('navUserSection').style.display = 'none';

  const drawerUserSec = document.getElementById('drawerUserSection');
  if (drawerUserSec) drawerUserSec.style.display = 'none';

  const mobileBtn = document.getElementById('mobileMenuBtn');
  if (mobileBtn) mobileBtn.style.display = 'none';

  document.getElementById('viewLogin').style.display = 'flex';
  showToast('Logged out successfully', 'info');
}

function updateUserBadge() {
  if (!currentUser) return;
  const fullName = currentUser.full_name || currentUser.username;
  document.getElementById('navUsername').textContent = fullName;
  const drawerUserEl = document.getElementById('drawerUsername');
  if (drawerUserEl) drawerUserEl.textContent = fullName;

  let roleLabel = t('encoderRole');
  if (currentUser.role === 'super_admin') roleLabel = t('superAdminRole');
  else if (currentUser.role === 'admin') roleLabel = t('adminRole');

  document.getElementById('navRole').textContent = roleLabel;
  const drawerRoleEl = document.getElementById('drawerRole');
  if (drawerRoleEl) drawerRoleEl.textContent = roleLabel;
}

// App Initialization
function initAppView() {
  document.getElementById('viewLogin').style.display = 'none';
  document.getElementById('navUserSection').style.display = 'flex';

  const drawerUserSec = document.getElementById('drawerUserSection');
  if (drawerUserSec) drawerUserSec.style.display = 'flex';

  const mobileBtn = document.getElementById('mobileMenuBtn');
  if (mobileBtn) mobileBtn.style.display = 'flex';

  document.getElementById('subNavBar').style.display = 'block';
  document.getElementById('viewApp').style.display = 'block';

  updateUserBadge();

  // Role visibility guards
  const isSuperAdmin = currentUser.role === 'super_admin';
  const isAdmin = ['admin', 'super_admin'].includes(currentUser.role);

  document.querySelectorAll('.super-admin-only').forEach(el => {
    el.style.display = isSuperAdmin ? '' : 'none';
  });

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  // Choose default tab
  if (isAdmin) {
    switchTab('dashboard');
    load3AbsentAlerts(); // background count check
  } else {
    switchTab('sessions');
  }
}

// Tab Switching
function switchTab(tabName) {
  closeMobileDrawer();

  const isSuperAdmin = currentUser.role === 'super_admin';
  const isAdmin = ['admin', 'super_admin'].includes(currentUser.role);

  // Role access guards
  if ((tabName === 'dashboard' || tabName === 'categoryMatrix' || tabName === 'alerts' || tabName === 'inactive') && !isAdmin) {
    tabName = 'sessions';
  }
  if ((tabName === 'users' || tabName === 'auditLogs') && !isSuperAdmin) {
    tabName = 'sessions';
  }

  // Update Tab buttons & Drawer items
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.drawer-nav-item').forEach(b => b.classList.remove('active'));

  const tabTitle = tabName.charAt(0).toUpperCase() + tabName.slice(1);
  const activeBtn = document.getElementById(`tabBtn${tabTitle}`);
  if (activeBtn) activeBtn.classList.add('active');

  const activeDrawerBtn = document.getElementById(`drawerTab${tabTitle}`);
  if (activeDrawerBtn) activeDrawerBtn.classList.add('active');

  // Hide all panes
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

  // Show target pane
  const pane = document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  if (pane) pane.style.display = 'block';

  // Load data for that tab
  if (tabName === 'dashboard' && isAdmin) loadDashboard();
  if (tabName === 'sessions') loadSessions();
  if (tabName === 'students') loadStudents();
  if (tabName === 'families') loadFamilies();
  if (tabName === 'categoryMatrix' && isAdmin) loadCategoryMatrix();
  if (tabName === 'alerts' && isAdmin) load3AbsentAlerts();
  if (tabName === 'inactive' && isAdmin) loadInactiveStudents();
  if (tabName === 'users' && isSuperAdmin) loadUsers();
  if (tabName === 'auditLogs' && isSuperAdmin) loadAuditLogs();
}

function refreshActiveTabData() {
  const activePane = document.querySelector('.tab-pane[style*="display: block"]');
  if (!activePane) return;
  const tabId = activePane.id;
  if (tabId === 'tabDashboard') loadDashboard();
  else if (tabId === 'tabSessions') loadSessions();
  else if (tabId === 'tabStudents') loadStudents();
  else if (tabId === 'tabFamilies') loadFamilies();
  else if (tabId === 'tabCategoryMatrix') loadCategoryMatrix();
  else if (tabId === 'tabAlerts') load3AbsentAlerts();
  else if (tabId === 'tabInactive') loadInactiveStudents();
  else if (tabId === 'tabUsers') loadUsers();
  else if (tabId === 'tabAuditLogs') loadAuditLogs();
}

// ==========================================
// 1. DASHBOARD LOGIC (Admin)
// ==========================================
async function loadDashboard() {
  try {
    const data = await api('/api/reports/dashboard');
    if (!data) return;

    // Numbers
    document.getElementById('dashTotalStudents').textContent = data.students.total_students || 0;
    document.getElementById('dashActiveStudents').textContent = data.students.active_students || 0;
    document.getElementById('dashTotalSessions').textContent = data.total_sessions || 0;

    const totalRecords = data.attendanceTotals.total_records || 0;
    const presentRecords = data.attendanceTotals.total_present || 0;
    const rate = totalRecords > 0 ? Math.round((presentRecords / totalRecords) * 100) : 0;
    document.getElementById('dashAttendanceRate').textContent = `${rate}%`;

    // Category breakdown
    const catList = document.getElementById('dashCategoriesList');
    catList.innerHTML = '';
    if (data.categories.length === 0) {
      catList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">No data yet</p>`;
    } else {
      data.categories.forEach(c => {
        catList.innerHTML += `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: #f8fafc; border-radius: 8px;">
            <span style="font-weight: 600;"><span class="tag tag-category">${c.category}</span></span>
            <span style="font-weight: 700; color: var(--primary);">${c.count} ${t('studentsTitle')}</span>
          </div>
        `;
      });
    }

    // Recent sessions
    const recList = document.getElementById('dashRecentSessionsList');
    recList.innerHTML = '';
    if (data.recentSessions.length === 0) {
      recList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">No sessions yet</p>`;
    } else {
      data.recentSessions.forEach(s => {
        recList.innerHTML += `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.65rem 0.75rem; background: #f8fafc; border-radius: 8px; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <div style="font-weight: 600;">${escapeHtml(s.course_title)}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(s.session_date)} | ${escapeHtml(getDualTimeDisplay(s.session_time, s.start_time, s.end_time))} (${s.category})</div>
            </div>
            <div style="display: flex; gap: 0.35rem;">
              <span class="tag tag-present"><i class="fa-solid fa-check"></i> ${s.present_count}</span>
              <span class="tag tag-absent"><i class="fa-solid fa-xmark"></i> ${s.absent_count}</span>
              <span class="tag tag-permission"><i class="fa-solid fa-clock"></i> ${s.permission_count}</span>
            </div>
          </div>
        `;
      });
    }
  } catch (err) { }
}

// Ethiopian & Standard Dual Time Helper
function formatSingleEthiopianTime(time24) {
  if (!time24) return '';
  const cleanTime = time24.trim();
  const parts = cleanTime.split(':');
  if (parts.length < 2) return time24;
  let h = parseInt(parts[0], 10);
  let m = parts[1].slice(0, 2);
  if (isNaN(h)) return time24;

  let ethHour = h >= 6 ? h - 6 : h + 6;
  if (ethHour > 12) ethHour -= 12;
  if (ethHour === 0) ethHour = 12;

  let period = 'ከጠዋቱ';
  if (h >= 12 && h < 18) period = 'ከቀኑ';
  else if (h >= 18 && h <= 23) period = 'ከምሽቱ';
  else if (h >= 0 && h < 6) period = 'ከሌሊቱ';

  return `${period} ${ethHour}:${m}`;
}

function getDualTimeDisplay(sessionTime, startTime, endTime) {
  let start = startTime;
  let end = endTime;

  // If sessionTime already contains Ethiopian time formatted string, strip any legacy bracketed standard time
  if (sessionTime && (sessionTime.includes('ከጠዋቱ') || sessionTime.includes('ከቀኑ') || sessionTime.includes('ከምሽቱ') || sessionTime.includes('ከሌሊቱ'))) {
    return sessionTime.replace(/\s*\([^)]*\)/g, '').trim();
  }

  if ((!start || !end) && sessionTime) {
    const cleanStr = sessionTime.replace(/\s*\([^)]*\)/g, '').trim();
    const parts = cleanStr.split('-');
    if (parts.length === 2) {
      start = parts[0].trim();
      end = parts[1].trim();
    } else {
      start = cleanStr.trim();
    }
  }

  if (!start) return sessionTime || '';

  const ethStart = formatSingleEthiopianTime(start);
  if (!end) {
    return ethStart;
  }

  const ethEndFormatted = formatSingleEthiopianTime(end);
  const ethEndParts = ethEndFormatted.split(' ');
  const ethEndNum = ethEndParts.length > 1 ? ethEndParts[1] : ethEndFormatted;

  return `${ethStart} - ${ethEndNum} ሰዓት`;
}

function updateDualTimePreview() {
  const startEl = document.getElementById('sessionStartTime');
  const endEl = document.getElementById('sessionEndTime');
  const previewEl = document.getElementById('dualTimePreview');
  if (!startEl || !endEl || !previewEl) return;

  const startVal = startEl.value || '09:00';
  const endVal = endEl.value || '11:00';

  previewEl.textContent = getDualTimeDisplay('', startVal, endVal);
}

// ==========================================
// 2. SESSIONS & ATTENDANCE LOGIC
// ==========================================
async function loadSessions() {
  const category = document.getElementById('filterSessionCategory').value;
  try {
    const sessions = await api(`/api/sessions?category=${category}`);
    const tbody = document.getElementById('sessionsTableBody');
    const mobileContainer = document.getElementById('sessionsCardContainer');
    tbody.innerHTML = '';
    if (mobileContainer) mobileContainer.innerHTML = '';

    if (!sessions || sessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">No sessions found.</td></tr>`;
      if (mobileContainer) {
        mobileContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No sessions found.</div>`;
      }
      return;
    }

    const isSuperAdmin = currentUser.role === 'super_admin';
    const isAdmin = ['admin', 'super_admin'].includes(currentUser.role);
    const todayStr = new Date().toISOString().split('T')[0];

    sessions.forEach(s => {
      const dualTime = getDualTimeDisplay(s.session_time, s.start_time, s.end_time);
      const sessDateStr = s.session_date ? new Date(s.session_date).toISOString().split('T')[0] : '';
      const isFuture = sessDateStr > todayStr;
      const attStatus = s.attendance_status || (s.total_marked > 0 ? 'finalized' : 'unrecorded');
      const hasAttendance = s.total_marked > 0;
      const canDelete = isSuperAdmin || (currentUser.role === 'admin' && !hasAttendance);

      let statusBadgeHtml = '';
      if (isFuture) {
        statusBadgeHtml = `<span class="tag" style="background:#f1f5f9; color:#64748b; font-size:0.72rem; padding:0.15rem 0.45rem;" title="${t('futureSessionAttendanceBlocked')}"><i class="fa-solid fa-calendar"></i> ${t('upcomingBadge')}</span>`;
      } else if (attStatus === 'draft') {
        statusBadgeHtml = `<span class="tag" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-size:0.72rem; padding:0.15rem 0.45rem;" title="${t('statusDraft')}"><i class="fa-solid fa-pen-ruler"></i> ${t('draftBadge')}</span>`;
      } else if (attStatus === 'finalized' || hasAttendance) {
        statusBadgeHtml = `<span class="tag" style="background:#dcfce7; color:#166534; border:1px solid #bbf7d0; font-size:0.72rem; padding:0.15rem 0.45rem;" title="${t('statusFinalized')}"><i class="fa-solid fa-circle-check"></i> ${t('finalizedBadge')}</span>`;
      }

      let encoderBadgeHtml = '';
      if (isAdmin) {
        if (s.assigned_encoders && Array.isArray(s.assigned_encoders) && s.assigned_encoders.length > 0) {
          const names = s.assigned_encoders.map(e => escapeHtml(e.full_name)).join(', ');
          const countBadge = s.assigned_encoders.length > 1 ? ` <span class="tag" style="background:#e0e7ff; color:#3730a3; font-size:0.68rem; padding:0.1rem 0.35rem;">${s.assigned_encoders.length}</span>` : '';
          encoderBadgeHtml = `<div style="font-size: 0.76rem; color: #475569; margin-top: 3px;"><i class="fa-solid fa-user-pen" style="color: var(--primary);"></i> ${t('assignedTo') || 'Assigned to:'} <strong>${names}</strong>${countBadge}</div>`;
        } else if (s.assigned_encoder_name) {
          encoderBadgeHtml = `<div style="font-size: 0.76rem; color: #475569; margin-top: 3px;"><i class="fa-solid fa-user-pen" style="color: var(--primary);"></i> ${t('assignedTo') || 'Assigned to:'} <strong>${escapeHtml(s.assigned_encoder_name)}</strong></div>`;
        } else {
          encoderBadgeHtml = `<div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 3px;"><i class="fa-solid fa-user-slash"></i> <em>${t('unassigned') || 'Unassigned'}</em></div>`;
        }
      } else if (currentUser.role === 'encoder') {
        const isAssigned = (s.assigned_encoders && Array.isArray(s.assigned_encoders) && s.assigned_encoders.some(e => e.id === currentUser.id)) || s.assigned_encoder_id === currentUser.id;
        if (isAssigned) {
          encoderBadgeHtml = `<span class="tag" style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; font-size:0.72rem; padding:0.15rem 0.45rem;"><i class="fa-solid fa-user-check"></i> ${t('assignedToYou') || 'Assigned to You'}</span>`;
        }
      }

      let deleteBtnHtml = '';
      if (canDelete) {
        deleteBtnHtml = `
          <button class="btn btn-outline btn-sm" style="color: var(--danger); border-color: #fca5a5;" onclick="deleteSession(${s.id})" title="${t('delete')}">
            <i class="fa-solid fa-trash"></i>
          </button>
        `;
      } else if (currentUser.role === 'admin' && hasAttendance) {
        deleteBtnHtml = `
          <button class="btn btn-outline btn-sm" style="color: #94a3b8; cursor: not-allowed; opacity: 0.6;" disabled title="${t('superAdminOnlyDeleteAttendance')}">
            <i class="fa-solid fa-lock"></i>
          </button>
        `;
      }

      let continueBtnHtml = '';
      if (isAdmin) {
        continueBtnHtml = `
          <button class="btn btn-outline btn-sm" style="color: var(--primary); border-color: #93c5fd;" onclick="openContinueSessionModal(${s.id})" title="${t('continueSession')}">
            <i class="fa-solid fa-copy"></i>
          </button>
        `;
      }

      // Desktop row
      tbody.innerHTML += `
        <tr>
          <td>
            <strong>${escapeHtml(s.course_title)}</strong>
            ${statusBadgeHtml ? `<span style="margin-left: 0.4rem;">${statusBadgeHtml}</span>` : ''}
            ${currentUser.role === 'encoder' && encoderBadgeHtml ? `<span style="margin-left: 0.4rem;">${encoderBadgeHtml}</span>` : ''}
            ${s.description ? `<br><small style="color: var(--text-muted);">${escapeHtml(s.description)}</small>` : ''}
            ${isAdmin && encoderBadgeHtml ? encoderBadgeHtml : ''}
          </td>
          <td>${formatDate(s.session_date)}</td>
          <td><strong style="color: var(--primary);">${escapeHtml(dualTime)}</strong></td>
          <td><span class="tag tag-category">${escapeHtml(s.category)}</span></td>
          <td>
            <span class="tag tag-present"><i class="fa-solid fa-check"></i> ${s.present_count}</span>
            <span class="tag tag-absent"><i class="fa-solid fa-xmark"></i> ${s.absent_count}</span>
            <span class="tag tag-permission"><i class="fa-solid fa-clock"></i> ${s.permission_count}</span>
          </td>
          <td>
            <div style="display: flex; gap: 0.4rem; align-items: center;">
              <button class="btn ${isFuture ? 'btn-outline' : 'btn-primary'} btn-sm" onclick="openAttendanceModal(${s.id})">
                <i class="fa-solid ${isFuture ? 'fa-calendar-day' : 'fa-clipboard-user'}"></i> ${isFuture ? t('upcomingSession') : t('takeAttendance')}
              </button>
              ${continueBtnHtml}
              ${deleteBtnHtml}
            </div>
          </td>
        </tr>
      `;

      // Mobile Card
      if (mobileContainer) {
        mobileContainer.innerHTML += `
          <div class="card" style="margin-bottom: 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
              <div>
                <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--primary);">${escapeHtml(s.course_title)}</h4>
                <p style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(s.session_date)} | <strong style="color: var(--primary);">${escapeHtml(dualTime)}</strong></p>
                ${isAdmin && encoderBadgeHtml ? encoderBadgeHtml : ''}
              </div>
              <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap; justify-content: flex-end;">
                ${statusBadgeHtml}
                ${currentUser.role === 'encoder' && encoderBadgeHtml ? encoderBadgeHtml : ''}
                <span class="tag tag-category">${escapeHtml(s.category)}</span>
              </div>
            </div>
            ${s.description ? `<p style="font-size: 0.85rem; color: #475569; margin-bottom: 0.6rem;">${escapeHtml(s.description)}</p>` : ''}
            
            <div style="display: flex; gap: 0.35rem; margin-bottom: 0.75rem;">
              <span class="tag tag-present"><i class="fa-solid fa-check"></i> ${s.present_count}</span>
              <span class="tag tag-absent"><i class="fa-solid fa-xmark"></i> ${s.absent_count}</span>
              <span class="tag tag-permission"><i class="fa-solid fa-clock"></i> ${s.permission_count}</span>
            </div>

            <div style="display: flex; gap: 0.5rem; border-top: 1px solid #f1f5f9; padding-top: 0.5rem; align-items: center;">
              <button class="btn ${isFuture ? 'btn-outline' : 'btn-primary'} btn-sm" style="flex: 1; justify-content: center;" onclick="openAttendanceModal(${s.id})">
                <i class="fa-solid ${isFuture ? 'fa-calendar-day' : 'fa-clipboard-user'}"></i> ${isFuture ? t('upcomingSession') : t('takeAttendance')}
              </button>
              ${continueBtnHtml}
              ${deleteBtnHtml}
            </div>
          </div>
        `;
      }
    });
  } catch (err) { }
}

// Encoder checklist & recurrence helpers
let cachedEncodersList = [];

async function fetchEncodersList() {
  try {
    const encoders = await api('/api/users/encoders');
    if (Array.isArray(encoders)) {
      cachedEncodersList = encoders;
    }
  } catch (err) {
    console.error('Failed to fetch encoders:', err);
  }
  return cachedEncodersList;
}

function renderEncoderChecklist(containerId, countElId, preselectedIds = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (!cachedEncodersList || cachedEncodersList.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); font-size: 0.8rem; padding: 0.4rem;">${t('noEncodersFound') || 'No encoders found'}</div>`;
    updateEncoderSelectedCount(containerId, countElId);
    return;
  }

  cachedEncodersList.forEach(enc => {
    const isChecked = preselectedIds.includes(enc.id);
    const item = document.createElement('label');
    item.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; cursor: pointer; padding: 0.2rem 0.3rem; border-radius: 4px;';
    item.innerHTML = `
      <input type="checkbox" value="${enc.id}" ${isChecked ? 'checked' : ''} onchange="updateEncoderSelectedCount('${containerId}', '${countElId}')" style="cursor: pointer;">
      <span><strong>${escapeHtml(enc.full_name)}</strong> <small style="color: var(--text-muted);">(@${escapeHtml(enc.username)})</small></span>
    `;
    container.appendChild(item);
  });

  updateEncoderSelectedCount(containerId, countElId);
}

function updateEncoderSelectedCount(containerId, countElId) {
  const container = document.getElementById(containerId);
  const countEl = document.getElementById(countElId);
  if (!container || !countEl) return;
  const checked = container.querySelectorAll('input[type="checkbox"]:checked').length;
  countEl.textContent = `${checked} ${t('encodersSelected') || 'encoder(s) selected'}`;
}

function selectAllSessionEncoders(selectAll) {
  const container = document.getElementById('sessionEncodersList');
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = selectAll);
  updateEncoderSelectedCount('sessionEncodersList', 'sessionEncodersCount');
}

function selectAllContinueEncoders(selectAll) {
  const container = document.getElementById('continueEncodersList');
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = selectAll);
  updateEncoderSelectedCount('continueEncodersList', 'continueEncodersCount');
}

function getSelectedEncoderIds(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  const checked = Array.from(container.querySelectorAll('input[type="checkbox"]:checked'));
  return checked.map(cb => parseInt(cb.value, 10)).filter(n => !isNaN(n) && n > 0);
}

function toggleSessionRecurrenceOptions() {
  const type = document.getElementById('sessionRecurrenceType').value;
  const countGroup = document.getElementById('sessionRecurrenceCountGroup');
  const customGroup = document.getElementById('sessionCustomDatesGroup');
  const countSelect = document.getElementById('sessionRecurrenceCount');

  if (type === 'weekly' || type === 'monthly') {
    countGroup.style.display = 'block';
    customGroup.style.display = 'none';
    if (type === 'weekly') {
      countSelect.innerHTML = `
        <option value="4">4 ሳምንታት (4 weeks)</option>
        <option value="8">8 ሳምንታት (8 weeks)</option>
        <option value="12">12 ሳምንታት (12 weeks)</option>
        <option value="16">16 ሳምንታት (16 weeks)</option>
        <option value="24">24 ሳምንታት (24 weeks)</option>
      `;
    } else {
      countSelect.innerHTML = `
        <option value="2">2 ወራት (2 months)</option>
        <option value="3" selected>3 ወራት (3 months)</option>
        <option value="6">6 ወራት (6 months)</option>
        <option value="12">12 ወራት (12 months)</option>
      `;
    }
  } else if (type === 'custom') {
    countGroup.style.display = 'none';
    customGroup.style.display = 'block';
    const list = document.getElementById('sessionCustomDatesList');
    if (list && list.children.length === 0) {
      addCustomSessionDateInput();
    }
  } else {
    countGroup.style.display = 'none';
    customGroup.style.display = 'none';
  }

  updateRecurrencePreview();
}

function addCustomSessionDateInput() {
  const list = document.getElementById('sessionCustomDatesList');
  if (!list) return;
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; gap: 0.4rem; align-items: center;';
  row.innerHTML = `
    <input type="date" class="form-control session-custom-date-input" style="flex: 1;" onchange="updateRecurrencePreview()">
    <button type="button" class="btn btn-outline btn-sm" style="color: var(--danger); border-color: #fca5a5; padding: 0.35rem 0.6rem;" onclick="this.parentElement.remove(); updateRecurrencePreview();">
      <i class="fa-solid fa-trash"></i>
    </button>
  `;
  list.appendChild(row);
  updateRecurrencePreview();
}

function calculateDatesClient(startDateStr, type, count, customDatesList = []) {
  if (!startDateStr) return [];
  if (!type || type === 'none') return [startDateStr];

  if (type === 'custom') {
    const set = new Set([startDateStr, ...customDatesList.filter(Boolean)]);
    return Array.from(set).sort();
  }

  const [sYear, sMonth, sDay] = startDateStr.split('-').map(Number);
  const num = Math.max(1, parseInt(count, 10) || 1);
  const res = [];

  for (let i = 0; i < num; i++) {
    if (type === 'weekly') {
      const d = new Date(Date.UTC(sYear, sMonth - 1, sDay + (i * 7)));
      res.push(d.toISOString().split('T')[0]);
    } else if (type === 'monthly') {
      const d = new Date(Date.UTC(sYear, sMonth - 1 + i, sDay));
      res.push(d.toISOString().split('T')[0]);
    }
  }

  return Array.from(new Set(res)).sort();
}

function updateRecurrencePreview() {
  const startEl = document.getElementById('sessionDate');
  const typeEl = document.getElementById('sessionRecurrenceType');
  const countEl = document.getElementById('sessionRecurrenceCount');
  const previewEl = document.getElementById('sessionRecurrencePreview');
  if (!startEl || !typeEl || !previewEl) return;

  const startDate = startEl.value;
  const type = typeEl.value;
  const count = countEl ? countEl.value : 1;

  if (type === 'none' || !startDate) {
    previewEl.style.display = 'none';
    previewEl.innerHTML = '';
    return;
  }

  let customDates = [];
  if (type === 'custom') {
    document.querySelectorAll('.session-custom-date-input').forEach(inp => {
      if (inp.value) customDates.push(inp.value);
    });
  }

  const generated = calculateDatesClient(startDate, type, count, customDates);
  previewEl.style.display = 'block';
  previewEl.innerHTML = `
    <div><i class="fa-solid fa-calendar-days"></i> <strong>${generated.length} ${t('totalSessions') || 'Sessions'} will be created:</strong></div>
    <div style="display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 4px;">
      ${generated.map(d => `<span class="tag" style="background: white; border: 1px solid #bfdbfe; color: #1e3a8a; font-size: 0.75rem;">${formatDate(d)}</span>`).join('')}
    </div>
  `;
}

async function openCreateSessionModal() {
  document.getElementById('formSession').reset();
  document.getElementById('sessionDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('sessionStartTime').value = '09:00';
  document.getElementById('sessionEndTime').value = '11:00';
  document.getElementById('sessionRecurrenceType').value = 'none';
  document.getElementById('sessionRecurrenceCountGroup').style.display = 'none';
  document.getElementById('sessionCustomDatesGroup').style.display = 'none';
  const customList = document.getElementById('sessionCustomDatesList');
  if (customList) customList.innerHTML = '';
  document.getElementById('sessionRecurrencePreview').style.display = 'none';
  updateDualTimePreview();

  await fetchEncodersList();
  renderEncoderChecklist('sessionEncodersList', 'sessionEncodersCount', []);

  openModal('modalSession');
}

async function handleCreateSession(e) {
  e.preventDefault();
  const startTime = document.getElementById('sessionStartTime').value;
  const endTime = document.getElementById('sessionEndTime').value;
  const dualTimeStr = getDualTimeDisplay('', startTime, endTime);
  const assignedEncoderIds = getSelectedEncoderIds('sessionEncodersList');
  const recurrenceType = document.getElementById('sessionRecurrenceType').value;
  const recurrenceCount = document.getElementById('sessionRecurrenceCount')?.value || 1;

  let customDates = [];
  if (recurrenceType === 'custom') {
    document.querySelectorAll('.session-custom-date-input').forEach(inp => {
      if (inp.value) customDates.push(inp.value);
    });
  }

  const body = {
    course_title: document.getElementById('sessionCourseTitle').value,
    session_date: document.getElementById('sessionDate').value,
    start_time: startTime,
    end_time: endTime,
    session_time: dualTimeStr,
    category: document.getElementById('sessionCategory').value,
    description: document.getElementById('sessionDescription').value,
    assigned_encoder_ids: assignedEncoderIds,
    recurrence: {
      type: recurrenceType,
      count: parseInt(recurrenceCount, 10) || 1,
      custom_dates: customDates
    }
  };

  try {
    const res = await api('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
    closeModal('modalSession');
    showToast(res.message || 'Session created successfully!', 'success');
    loadSessions();
  } catch (err) { }
}

// Continue / Copy Session Modal Logic
let currentContinueSessionData = null;

async function openContinueSessionModal(sessionId) {
  try {
    const session = await api(`/api/sessions/${sessionId}`);
    if (!session) return;
    currentContinueSessionData = session;

    document.getElementById('continueOriginalSessionId').value = session.id;
    document.getElementById('continueSessionOriginalTitle').textContent = session.course_title;
    const dualTime = getDualTimeDisplay(session.session_time, session.start_time, session.end_time);
    document.getElementById('continueSessionOriginalDetails').textContent = `${session.category} | ${formatDate(session.session_date)} | ${dualTime}`;

    // Suggested next date: +7 days from original date
    const dateStr = session.session_date ? session.session_date.split('T')[0] : new Date().toISOString().split('T')[0];
    const [sYear, sMonth, sDay] = dateStr.split('-').map(Number);
    const nextWeekDate = new Date(Date.UTC(sYear, sMonth - 1, sDay + 7)).toISOString().split('T')[0];
    document.getElementById('continueStartDate').value = nextWeekDate;

    // Reset recurrence type to 'none'
    document.getElementById('continueRecurrenceType').value = 'none';
    document.getElementById('continueCountGroup').style.display = 'none';
    document.getElementById('continueCustomDatesGroup').style.display = 'none';
    const customList = document.getElementById('continueCustomDatesList');
    if (customList) customList.innerHTML = '';

    // Encoders checklist pre-checked with original encoders
    await fetchEncodersList();
    const origEncIds = (session.assigned_encoders || []).map(e => e.id);
    if (session.assigned_encoder_id && !origEncIds.includes(session.assigned_encoder_id)) {
      origEncIds.push(session.assigned_encoder_id);
    }
    renderEncoderChecklist('continueEncodersList', 'continueEncodersCount', origEncIds);

    updateContinueRecurrencePreview();
    openModal('modalContinueSession');
  } catch (err) {
    console.error('Error opening continue modal:', err);
  }
}

function setContinueOption(option) {
  if (!currentContinueSessionData) return;
  const dateStr = currentContinueSessionData.session_date ? currentContinueSessionData.session_date.split('T')[0] : new Date().toISOString().split('T')[0];
  const [sYear, sMonth, sDay] = dateStr.split('-').map(Number);

  if (option === 'next_week') {
    const d = new Date(Date.UTC(sYear, sMonth - 1, sDay + 7)).toISOString().split('T')[0];
    document.getElementById('continueStartDate').value = d;
    document.getElementById('continueRecurrenceType').value = 'none';
    toggleContinueRecurrenceOptions();
  } else if (option === 'next_month') {
    const d = new Date(Date.UTC(sYear, sMonth, sDay)).toISOString().split('T')[0];
    document.getElementById('continueStartDate').value = d;
    document.getElementById('continueRecurrenceType').value = 'none';
    toggleContinueRecurrenceOptions();
  } else if (option === 'weekly_4') {
    const d = new Date(Date.UTC(sYear, sMonth - 1, sDay + 7)).toISOString().split('T')[0];
    document.getElementById('continueStartDate').value = d;
    document.getElementById('continueRecurrenceType').value = 'weekly';
    document.getElementById('continueRecurrenceCount').value = '4';
    toggleContinueRecurrenceOptions();
  } else if (option === 'monthly_3') {
    const d = new Date(Date.UTC(sYear, sMonth, sDay)).toISOString().split('T')[0];
    document.getElementById('continueStartDate').value = d;
    document.getElementById('continueRecurrenceType').value = 'monthly';
    document.getElementById('continueRecurrenceCount').value = '3';
    toggleContinueRecurrenceOptions();
  }
}

function toggleContinueRecurrenceOptions() {
  const type = document.getElementById('continueRecurrenceType').value;
  const countGroup = document.getElementById('continueCountGroup');
  const customGroup = document.getElementById('continueCustomDatesGroup');

  if (type === 'weekly' || type === 'monthly') {
    countGroup.style.display = 'block';
    customGroup.style.display = 'none';
  } else if (type === 'custom') {
    countGroup.style.display = 'none';
    customGroup.style.display = 'block';
    const list = document.getElementById('continueCustomDatesList');
    if (list && list.children.length === 0) {
      addContinueCustomDateInput();
    }
  } else {
    countGroup.style.display = 'none';
    customGroup.style.display = 'none';
  }

  updateContinueRecurrencePreview();
}

function addContinueCustomDateInput() {
  const list = document.getElementById('continueCustomDatesList');
  if (!list) return;
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; gap: 0.4rem; align-items: center;';
  row.innerHTML = `
    <input type="date" class="form-control continue-custom-date-input" style="flex: 1;" onchange="updateContinueRecurrencePreview()">
    <button type="button" class="btn btn-outline btn-sm" style="color: var(--danger); border-color: #fca5a5; padding: 0.35rem 0.6rem;" onclick="this.parentElement.remove(); updateContinueRecurrencePreview();">
      <i class="fa-solid fa-trash"></i>
    </button>
  `;
  list.appendChild(row);
  updateContinueRecurrencePreview();
}

function updateContinueRecurrencePreview() {
  const startEl = document.getElementById('continueStartDate');
  const typeEl = document.getElementById('continueRecurrenceType');
  const countEl = document.getElementById('continueRecurrenceCount');
  const previewEl = document.getElementById('continueDatesPreview');
  if (!startEl || !typeEl || !previewEl) return;

  const startDate = startEl.value;
  const type = typeEl.value;
  const count = countEl ? countEl.value : 1;

  if (!startDate) {
    previewEl.style.display = 'none';
    previewEl.innerHTML = '';
    return;
  }

  let customDates = [];
  if (type === 'custom') {
    document.querySelectorAll('.continue-custom-date-input').forEach(inp => {
      if (inp.value) customDates.push(inp.value);
    });
  }

  const generated = calculateDatesClient(startDate, type, count, customDates);
  previewEl.style.display = 'block';
  previewEl.innerHTML = `
    <div><i class="fa-solid fa-calendar-days"></i> <strong>${generated.length} ${t('totalSessions') || 'Sessions'} will be created:</strong></div>
    <div style="display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 4px;">
      ${generated.map(d => `<span class="tag" style="background: white; border: 1px solid #bfdbfe; color: #1e3a8a; font-size: 0.75rem;">${formatDate(d)}</span>`).join('')}
    </div>
  `;
}

async function handleContinueSessionSubmit(e) {
  e.preventDefault();
  const sessionId = document.getElementById('continueOriginalSessionId').value;
  const startDate = document.getElementById('continueStartDate').value;
  const recurrenceType = document.getElementById('continueRecurrenceType').value;
  const recurrenceCount = document.getElementById('continueRecurrenceCount').value;
  const assignedEncoderIds = getSelectedEncoderIds('continueEncodersList');

  let customDates = [];
  if (recurrenceType === 'custom') {
    document.querySelectorAll('.continue-custom-date-input').forEach(inp => {
      if (inp.value) customDates.push(inp.value);
    });
  }

  const body = {
    start_date: startDate,
    recurrence: {
      type: recurrenceType,
      count: parseInt(recurrenceCount, 10) || 1,
      custom_dates: customDates
    },
    assigned_encoder_ids: assignedEncoderIds
  };

  try {
    const res = await api(`/api/sessions/${sessionId}/continue`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    closeModal('modalContinueSession');
    showToast(res.message || 'Session continued successfully!', 'success');
    loadSessions();
  } catch (err) { }
}

async function deleteSession(id) {
  if (!confirm(t('confirmDelete'))) return;
  try {
    await api(`/api/sessions/${id}`, { method: 'DELETE' });
    showToast('Session deleted', 'info');
    loadSessions();
  } catch (err) { }
}

// Attendance Modal & Marking
async function openAttendanceModal(sessionId) {
  activeSessionId = sessionId;
  activeAttendanceRecords = {};

  // Reset cross-category search box
  const crossPanel = document.getElementById('crossCategorySearchPanel');
  if (crossPanel) crossPanel.style.display = 'none';
  const crossInput = document.getElementById('crossCategorySearchInput');
  if (crossInput) crossInput.value = '';
  const crossResults = document.getElementById('crossCategorySearchResults');
  if (crossResults) crossResults.innerHTML = '';

  try {
    const data = await api(`/api/attendance/session/${sessionId}`);
    if (!data) return;

    activeSessionData = data;
    const dualTime = getDualTimeDisplay(data.session.session_time, data.session.start_time, data.session.end_time);

    document.getElementById('attModalSessionTitle').textContent = `${data.session.course_title} (${data.session.category})`;
    document.getElementById('attModalSessionSubtitle').textContent = `${formatDate(data.session.session_date)} | ${dualTime}`;
    document.getElementById('attSearchInput').value = '';

    // Handle status notification banners & action buttons visibility
    const banner = document.getElementById('attModalAlertBanner');
    const btnDraft = document.getElementById('btnSaveDraftAttendance');
    const btnSave = document.getElementById('btnSaveAttendance');
    const btnMarkAll = document.getElementById('btnMarkAllPresent');
    const crossContainer = document.getElementById('crossCategoryContainer');

    if (data.is_future) {
      if (banner) {
        banner.style.display = 'block';
        banner.innerHTML = `
          <div style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; border-radius: 8px; padding: 0.6rem 0.9rem; font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem;">
            <i class="fa-solid fa-calendar-xmark" style="font-size: 1.1rem; color: #2563eb;"></i> 
            <span><strong>${t('futureSessionAttendanceBlocked')}</strong></span>
          </div>
        `;
      }
      if (btnDraft) btnDraft.style.display = 'none';
      if (btnSave) btnSave.style.display = 'none';
      if (btnMarkAll) btnMarkAll.style.display = 'none';
      if (crossContainer) crossContainer.style.display = 'none';
    } else if (!data.can_edit) {
      if (banner) {
        banner.style.display = 'block';
        banner.innerHTML = `
          <div style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 8px; padding: 0.6rem 0.9rem; font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem;">
            <i class="fa-solid fa-lock" style="font-size: 1.1rem; color: #d97706;"></i> 
            <span><strong>${t('attendanceLockedNotice')}</strong></span>
          </div>
        `;
      }
      if (btnDraft) btnDraft.style.display = 'none';
      if (btnSave) btnSave.style.display = 'none';
      if (btnMarkAll) btnMarkAll.style.display = 'none';
      if (crossContainer) crossContainer.style.display = 'none';
    } else {
      if (data.attendance_status === 'draft') {
        if (banner) {
          banner.style.display = 'block';
          banner.innerHTML = `
            <div style="background: #fef9c3; color: #854d0e; border: 1px solid #fef08a; border-radius: 8px; padding: 0.55rem 0.85rem; font-size: 0.83rem; display: flex; align-items: center; gap: 0.45rem;">
              <i class="fa-solid fa-pen-ruler" style="color: #ca8a04;"></i> 
              <span><strong>${t('statusDraft')}</strong>: ${currentLang === 'am' ? 'ይህ መገኘት በጊዜያዊነት የተቀመጠ ረቂቅ ነው። መዝግበው ሲጨርሱ "አጽድቀህ መዝግብ" የሚለውን ይጫኑ።' : 'This attendance is a saved draft. Click "Finalize & Save" to finalize.'}</span>
            </div>
          `;
        }
      } else {
        if (banner) banner.style.display = 'none';
      }
      if (btnDraft) {
        btnDraft.style.display = 'inline-flex';
        btnDraft.disabled = false;
      }
      if (btnSave) {
        btnSave.style.display = 'inline-flex';
        btnSave.disabled = false;
      }
      if (btnMarkAll) btnMarkAll.style.display = 'inline-flex';
      if (crossContainer) crossContainer.style.display = 'block';
    }

    // Initialize in-memory attendance record states
    data.students.forEach(s => {
      const hasCrossAttendance = s.other_session_id && (s.other_status === 'present' || s.other_status === 'permission');
      if (hasCrossAttendance) {
        activeAttendanceRecords[s.student_id] = {
          status: s.other_status || 'present',
          remarks: s.remarks || `Attended in ${s.other_category || ''} (${s.other_course_title || ''})`,
          is_locked_cross: true,
          other_session_id: s.other_session_id,
          other_category: s.other_category,
          other_course_title: s.other_course_title,
          other_status: s.other_status
        };
      } else {
        activeAttendanceRecords[s.student_id] = {
          status: s.attendance_status || 'present', // Default to present for convenience
          remarks: s.remarks || ''
        };
      }
      if (data.session.category !== 'All' && s.category && s.category !== data.session.category) {
        s.is_cross_category = true;
      }
    });

    renderAttendanceStudentList();
    openModal('modalAttendance');
  } catch (err) { }
}

function renderAttendanceStudentList() {
  const container = document.getElementById('attStudentsGrid');
  container.innerHTML = '';

  const filterText = (document.getElementById('attSearchInput').value || '').toLowerCase().trim();

  const filtered = activeSessionData.students.filter(s => {
    if (!filterText) return true;
    const name = `${s.first_name} ${s.father_name}`.toLowerCase();
    const phone = (s.phone || '').toLowerCase();
    const cat = (s.category || '').toLowerCase();
    return name.includes(filterText) || phone.includes(filterText) || cat.includes(filterText);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No students found in this sheet.</div>`;
    return;
  }

  const isLockedForEditing = !activeSessionData.can_edit || activeSessionData.is_future;

  filtered.forEach(s => {
    const currentRec = activeAttendanceRecords[s.student_id] || { status: 'present', remarks: '' };
    const hasCrossAttendance = currentRec.is_locked_cross || (s.other_session_id && (s.other_status === 'present' || s.other_status === 'permission'));
    const rowClass = hasCrossAttendance ? `attendance-row marked-present cross-attended-locked` : `attendance-row marked-${currentRec.status}`;
    const isCrossCategory = s.is_cross_category || (activeSessionData.session && activeSessionData.session.category !== 'All' && s.category && s.category !== activeSessionData.session.category);

    let actionsHtml = '';
    if (hasCrossAttendance) {
      const otherCat = s.other_category || currentRec.other_category || '';
      const otherCourse = s.other_course_title || currentRec.other_course_title || '';
      actionsHtml = `
        <div class="attendance-btn-group" style="align-items: center; justify-content: flex-end;">
          <div class="tag" style="background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; font-size: 0.8rem; padding: 0.4rem 0.75rem; border-radius: 8px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.45rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);" title="${t('learnInOtherClassNotice')}">
            <i class="fa-solid fa-graduation-cap" style="color: #059669; font-size: 0.95rem;"></i>
            <span>${t('attendedInOtherClass')}: <strong style="color: #047857;">${escapeHtml(otherCat)}</strong> ${otherCourse ? `<span style="font-weight: 400; opacity: 0.9;">(${escapeHtml(otherCourse)})</span>` : ''}</span>
          </div>
        </div>
      `;
    } else if (isLockedForEditing) {
      const statusLabels = {
        present: `<span class="tag tag-present" style="font-size:0.85rem; padding:0.35rem 0.75rem;"><i class="fa-solid fa-check"></i> ${t('statusPresent')}</span>`,
        absent: `<span class="tag tag-absent" style="font-size:0.85rem; padding:0.35rem 0.75rem;"><i class="fa-solid fa-xmark"></i> ${t('statusAbsent')}</span>`,
        permission: `<span class="tag tag-permission" style="font-size:0.85rem; padding:0.35rem 0.75rem;"><i class="fa-solid fa-clock"></i> ${t('statusPermission')}</span>`
      };
      actionsHtml = `
        <div class="attendance-btn-group" style="align-items: center; justify-content: flex-end;">
          ${statusLabels[currentRec.status] || `<span class="tag tag-secondary">-</span>`}
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="attendance-btn-group">
          <button type="button" class="btn-toggle-att btn-present ${currentRec.status === 'present' ? 'selected' : ''}" 
                  onclick="selectAttendanceStatus(${s.student_id}, 'present')">
            <i class="fa-solid fa-check"></i> ${t('statusPresent')}
          </button>
          <button type="button" class="btn-toggle-att btn-absent ${currentRec.status === 'absent' ? 'selected' : ''}" 
                  onclick="selectAttendanceStatus(${s.student_id}, 'absent')">
            <i class="fa-solid fa-xmark"></i> ${t('statusAbsent')}
          </button>
          <button type="button" class="btn-toggle-att btn-permission ${currentRec.status === 'permission' ? 'selected' : ''}" 
                  onclick="selectAttendanceStatus(${s.student_id}, 'permission')">
            <i class="fa-solid fa-clock"></i> ${t('statusPermission')}
          </button>
        </div>
      `;
    }

    container.innerHTML += `
      <div class="${rowClass}" id="attRow_${s.student_id}">
        <div class="attendance-student-details">
          <h5>
            ${escapeHtml(s.first_name)} ${escapeHtml(s.father_name)}
            ${isCrossCategory ? `
              <span class="tag" style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 0.72rem; padding: 0.12rem 0.4rem; margin-left: 0.35rem;" title="${t('crossCategoryBadge')}: ${escapeHtml(s.category)}">
                <i class="fa-solid fa-arrow-right-arrow-left"></i> ${escapeHtml(s.category)} (${t('crossCategoryBadge')})
              </span>
            ` : ''}
            ${hasCrossAttendance ? `
              <span class="tag" style="background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; font-size: 0.72rem; padding: 0.12rem 0.4rem; margin-left: 0.35rem;">
                <i class="fa-solid fa-link"></i> ${t('attendedInOtherClass')}
              </span>
            ` : ''}
          </h5>
          <p><i class="fa-solid fa-phone"></i> ${escapeHtml(s.phone || '-')} | ${t('motherName')}: ${escapeHtml(s.mother_name || '-')}</p>
        </div>

        ${actionsHtml}
      </div>
    `;
  });
}

// Cross-Category Student Search & Add Controllers
function toggleCrossCategorySearch() {
  const panel = document.getElementById('crossCategorySearchPanel');
  const input = document.getElementById('crossCategorySearchInput');
  const results = document.getElementById('crossCategorySearchResults');
  if (!panel) return;

  if (panel.style.display === 'none' || panel.style.display === '') {
    panel.style.display = 'block';
    if (input) {
      input.value = '';
      input.focus();
    }
    if (results) results.innerHTML = '';
  } else {
    panel.style.display = 'none';
    if (results) results.innerHTML = '';
  }
}

let crossCatDebounceTimer = null;

function debounceSearchCrossCategoryStudents() {
  clearTimeout(crossCatDebounceTimer);
  crossCatDebounceTimer = setTimeout(searchCrossCategoryStudents, 250);
}

let crossCatSearchResultsCache = new Map();

async function searchCrossCategoryStudents() {
  const input = document.getElementById('crossCategorySearchInput');
  const resultsContainer = document.getElementById('crossCategorySearchResults');
  if (!input || !resultsContainer) return;

  const query = input.value.trim();
  if (query.length < 1) {
    resultsContainer.innerHTML = '';
    return;
  }

  resultsContainer.innerHTML = `<div style="font-size:0.8rem; color:var(--text-muted); padding:0.4rem;"><i class="fa-solid fa-spinner fa-spin"></i> ${t('loading')}</div>`;

  try {
    const res = await api(`/api/students?status=active&search=${encodeURIComponent(query)}&limit=20`);
    const studentList = Array.isArray(res) ? res : (res && res.students ? res.students : []);

    if (!studentList || studentList.length === 0) {
      resultsContainer.innerHTML = `<div style="font-size:0.8rem; color:var(--text-muted); padding:0.4rem;">${t('noMatchingStudentsFound')}</div>`;
      return;
    }

    const currentStudentIds = new Set((activeSessionData.students || []).map(s => s.student_id || s.id));

    crossCatSearchResultsCache.clear();
    resultsContainer.innerHTML = '';

    studentList.forEach(st => {
      crossCatSearchResultsCache.set(st.id, st);
      const alreadyInSheet = currentStudentIds.has(st.id);
      resultsContainer.innerHTML += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.45rem 0.65rem; background: #fff; border: 1px solid #dcfce7; border-radius: 6px;">
          <div>
            <strong style="font-size: 0.88rem; color: var(--text-dark);">${escapeHtml(st.first_name)} ${escapeHtml(st.father_name)}</strong>
            ${st.christian_name ? `<small style="color: var(--primary);"> (${escapeHtml(st.christian_name)})</small>` : ''}
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              <span class="tag tag-category" style="font-size: 0.68rem; padding: 0.08rem 0.35rem;">${escapeHtml(st.category || '-')}</span>
              ${st.phone ? ` | <i class="fa-solid fa-phone"></i> ${escapeHtml(st.phone)}` : ''}
            </div>
          </div>
          ${alreadyInSheet ? `
            <span class="tag tag-present" style="font-size: 0.72rem;"><i class="fa-solid fa-check"></i> Already in sheet</span>
          ` : `
            <button type="button" class="btn btn-success btn-sm" style="padding: 0.25rem 0.6rem; font-size: 0.78rem;" onclick="addCrossCategoryStudentToSession(${st.id})">
              <i class="fa-solid fa-plus"></i> ${t('save')}
            </button>
          `}
        </div>
      `;
    });
  } catch (err) {
    console.error('Error searching cross-category students:', err);
    resultsContainer.innerHTML = `<div style="font-size:0.8rem; color:var(--danger); padding:0.4rem;">Error searching students</div>`;
  }
}

function addCrossCategoryStudentToSession(studentId) {
  if (!activeSessionData || !activeSessionData.students) return;

  const student = crossCatSearchResultsCache.get(studentId);
  if (!student) return;

  const currentStudentIds = new Set(activeSessionData.students.map(s => s.student_id || s.id));
  if (currentStudentIds.has(student.id)) {
    showToast(t('studentAlreadyInSheet'), 'info');
    return;
  }

  const newStudentEntry = {
    student_id: student.id,
    id: student.id,
    first_name: student.first_name,
    father_name: student.father_name,
    mother_name: student.mother_name,
    phone: student.phone,
    category: student.category,
    attendance_status: 'present',
    is_cross_category: true
  };

  activeSessionData.students.unshift(newStudentEntry);
  activeAttendanceRecords[student.id] = {
    status: 'present',
    remarks: `Cross-category (${student.category})`
  };

  renderAttendanceStudentList();
  showToast(t('crossCategoryAdded'), 'success');

  // Reset search panel
  const panel = document.getElementById('crossCategorySearchPanel');
  if (panel) panel.style.display = 'none';
  const results = document.getElementById('crossCategorySearchResults');
  if (results) results.innerHTML = '';
  const input = document.getElementById('crossCategorySearchInput');
  if (input) input.value = '';
}

function selectAttendanceStatus(studentId, status) {
  if (activeAttendanceRecords[studentId]?.is_locked_cross) {
    showToast(t('learnInOtherClassNotice'), 'info');
    return;
  }

  if (!activeAttendanceRecords[studentId]) {
    activeAttendanceRecords[studentId] = { status: 'present', remarks: '' };
  }
  activeAttendanceRecords[studentId].status = status;

  const row = document.getElementById(`attRow_${studentId}`);
  if (row) {
    row.className = `attendance-row marked-${status}`;
    const btns = row.querySelectorAll('.btn-toggle-att');
    btns.forEach(b => b.classList.remove('selected'));
    if (status === 'present') row.querySelector('.btn-present')?.classList.add('selected');
    if (status === 'absent') row.querySelector('.btn-absent')?.classList.add('selected');
    if (status === 'permission') row.querySelector('.btn-permission')?.classList.add('selected');
  }
}

function markAllPresent() {
  activeSessionData.students.forEach(s => {
    if (!activeAttendanceRecords[s.student_id]?.is_locked_cross) {
      selectAttendanceStatus(s.student_id, 'present');
    }
  });
  showToast(t('markAllPresent'), 'success');
}

function filterAttendanceList() {
  renderAttendanceStudentList();
}

async function saveAttendance(isDraft = false) {
  const btnDraft = document.getElementById('btnSaveDraftAttendance');
  const btnSave = document.getElementById('btnSaveAttendance');

  if (isDraft) {
    if (btnDraft) {
      btnDraft.disabled = true;
      btnDraft.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('savingDraft')}`;
    }
  } else {
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('finalizingAttendance')}`;
    }
  }

  const records = Object.keys(activeAttendanceRecords).map(studentId => {
    const rec = activeAttendanceRecords[studentId];
    return {
      student_id: parseInt(studentId, 10),
      status: rec.status,
      remarks: rec.remarks || ''
    };
  });

  try {
    await api(`/api/attendance/session/${activeSessionId}`, {
      method: 'POST',
      body: JSON.stringify({ records, is_draft: isDraft })
    });

    closeModal('modalAttendance');
    showToast(isDraft ? t('draftSaved') : (t('attendanceFinalized') + ' ✓'), 'success');
    loadSessions();
    if (['admin', 'super_admin'].includes(currentUser.role)) load3AbsentAlerts();
  } catch (err) {
  } finally {
    if (btnDraft) {
      btnDraft.disabled = false;
      btnDraft.innerHTML = `<i class="fa-solid fa-pen-ruler"></i> ${t('saveDraft')}`;
    }
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${t('finalizeAttendance')}`;
    }
  }
}

// ==========================================
// 3. STUDENTS DIRECTORY & REGISTRATION
// ==========================================
function debounceLoadStudents() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(loadStudents, 300);
}

function handleProfessionFilterChange() {
  const prof = document.getElementById('filterStudentProfession')?.value;
  const eduSelect = document.getElementById('filterStudentEducation');
  if (eduSelect) {
    if (prof !== 'All' && prof !== 'Student') {
      eduSelect.value = 'All';
      eduSelect.disabled = true;
      eduSelect.style.opacity = '0.5';
    } else {
      eduSelect.disabled = false;
      eduSelect.style.opacity = '1';
    }
  }
  loadStudents();
}

function toggleProfessionDetails() {
  const profType = document.getElementById('studentProfessionType').value;
  const eduGroup = document.getElementById('groupStudentEducationLevel');
  const otherGroup = document.getElementById('groupStudentOtherProfession');

  if (profType === 'Student') {
    if (eduGroup) eduGroup.style.display = 'block';
    if (otherGroup) otherGroup.style.display = 'none';
  } else if (profType === 'Other') {
    if (eduGroup) eduGroup.style.display = 'none';
    if (otherGroup) otherGroup.style.display = 'block';
  } else {
    // Employee / Worker
    if (eduGroup) eduGroup.style.display = 'none';
    if (otherGroup) otherGroup.style.display = 'none';
  }
}

async function loadStudents() {
  const category = document.getElementById('filterStudentCategory')?.value || 'All';
  const status = document.getElementById('filterStudentStatus')?.value || 'All';
  const profession = document.getElementById('filterStudentProfession')?.value || 'All';
  const education = document.getElementById('filterStudentEducation')?.value || 'All';
  const search = document.getElementById('searchStudentInput')?.value || '';

  try {
    const students = await api(`/api/students?category=${category}&status=${status}&profession=${profession}&education_level=${education}&search=${encodeURIComponent(search)}`);
    const tbody = document.getElementById('studentsTableBody');
    const mobileContainer = document.getElementById('studentsCardContainer');
    tbody.innerHTML = '';
    if (mobileContainer) mobileContainer.innerHTML = '';

    if (!students || students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">No students found.</td></tr>`;
      if (mobileContainer) {
        mobileContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No students found.</div>`;
      }
      return;
    }

    students.forEach(s => {
      const isInactive = s.status === 'inactive';
      const siblingCount = parseInt(s.sibling_count, 10) || 0;

      // Check missing/empty profile fields
      const missingFields = [];
      if (!s.phone || s.phone.trim() === '') missingFields.push(t('phone'));
      if (!s.category || s.category.trim() === '' || s.category === 'All') missingFields.push(t('category'));
      if (!s.age || s.age === 0 || s.age === null) missingFields.push(t('age'));
      if (!s.profession || s.profession.trim() === '') missingFields.push(t('profession'));
      const isIncomplete = missingFields.length > 0;

      // Desktop Table Row
      tbody.innerHTML += `
        <tr style="${isInactive ? 'opacity: 0.6;' : ''}">
          <td>
            <strong>${escapeHtml(s.first_name)} ${escapeHtml(s.father_name)}</strong>
            ${s.christian_name ? `<br><small style="color: var(--primary); font-weight: 600; font-size: 0.8rem;"><i class="fa-solid fa-cross"></i> ${escapeHtml(s.christian_name)}</small>` : ''}
            ${siblingCount > 0 ? `
              <div style="margin-top: 4px;">
                <span class="tag" style="background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; font-size: 0.72rem; padding: 0.15rem 0.45rem; display: inline-flex; align-items: center; gap: 0.3rem; cursor: pointer;" onclick="viewStudentProfile(${s.id})" title="${siblingCount} ${t('siblings')}">
                  <i class="fa-solid fa-people-roof"></i> ${siblingCount} ${t('siblings')}
                </span>
              </div>
            ` : ''}
            ${isIncomplete ? `
              <div style="margin-top: 4px;">
                <span class="tag" style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a; font-size: 0.72rem; padding: 0.15rem 0.45rem; display: inline-flex; align-items: center; gap: 0.3rem;" title="${t('missingFields')}: ${missingFields.join(', ')}">
                  <i class="fa-solid fa-triangle-exclamation"></i> ${t('incompleteProfile')}: ${missingFields.join(', ')}
                </span>
              </div>
            ` : ''}
          </td>
          <td>${escapeHtml(s.mother_name || '-')}</td>
          <td>
            ${s.category ? `<span class="tag tag-category">${escapeHtml(s.category)}</span>` : `<span style="color: #b45309; font-size: 0.85rem;"><i class="fa-solid fa-circle-exclamation"></i> -</span>`}
          </td>
          <td>${s.age ? s.age : `<span style="color: #b45309; font-size: 0.85rem;">-</span>`}</td>
          <td>
            ${s.phone ? `
              <a href="tel:${escapeHtml(s.phone)}" style="color: var(--primary); text-decoration: none; font-weight: 600;">
                <i class="fa-solid fa-phone"></i> ${escapeHtml(s.phone)}
              </a>
            ` : `<span style="color: #b45309; font-size: 0.8rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${t('missingFields')}</span>`}
          </td>
          <td>
            <span class="tag ${s.status === 'active' ? 'tag-present' : 'tag-absent'}">
              ${s.status === 'active' ? t('active') : t('inactive')}
            </span>
          </td>
          <td>
            <div style="display: flex; gap: 0.35rem;">
              <button class="btn btn-outline btn-sm" onclick="viewStudentProfile(${s.id})" title="${t('viewProfile')}">
                <i class="fa-solid fa-eye"></i>
              </button>
              <button class="btn btn-outline btn-sm" onclick="openEditStudentModal(${s.id})" title="${t('edit')}">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              ${currentUser.role === 'super_admin' ? `
                <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="deleteStudent(${s.id})" title="${t('delete')}">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;

      // Mobile Student Card
      if (mobileContainer) {
        mobileContainer.innerHTML += `
          <div class="card" style="margin-bottom: 0; ${isInactive ? 'opacity: 0.7;' : ''}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
              <div>
                <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-dark);">${escapeHtml(s.first_name)} ${escapeHtml(s.father_name)}</h4>
                ${s.christian_name ? `<p style="font-size: 0.82rem; color: var(--primary); font-weight: 600; margin-top: 2px;"><i class="fa-solid fa-cross"></i> ${escapeHtml(s.christian_name)}</p>` : ''}
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                  ${t('motherName')}: <strong>${escapeHtml(s.mother_name || '-')}</strong> | ${t('age')}: ${s.age || '-'}
                </p>
                ${siblingCount > 0 ? `
                  <div style="margin-top: 4px;">
                    <span class="tag" style="background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; font-size: 0.72rem; padding: 0.15rem 0.45rem; display: inline-flex; align-items: center; gap: 0.3rem; cursor: pointer;" onclick="viewStudentProfile(${s.id})">
                      <i class="fa-solid fa-people-roof"></i> ${siblingCount} ${t('siblings')}
                    </span>
                  </div>
                ` : ''}
                ${isIncomplete ? `
                  <div style="margin-top: 4px;">
                    <span class="tag" style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a; font-size: 0.72rem; padding: 0.15rem 0.45rem; display: inline-flex; align-items: center; gap: 0.3rem;" title="${t('missingFields')}: ${missingFields.join(', ')}">
                      <i class="fa-solid fa-triangle-exclamation"></i> ${t('incompleteProfile')}: ${missingFields.join(', ')}
                    </span>
                  </div>
                ` : ''}
              </div>
              <span class="tag tag-category">${escapeHtml(s.category || '-')}</span>
            </div>

            <div style="margin-bottom: 0.75rem;">
              ${s.phone ? `
                <a href="tel:${escapeHtml(s.phone)}" class="btn btn-outline btn-sm" style="width: 100%; justify-content: center; font-weight: 700; color: var(--primary);">
                  <i class="fa-solid fa-phone"></i> ${escapeHtml(s.phone)}
                </a>
              ` : `
                <div style="background: #fffbeb; border: 1px solid #fde68a; color: #b45309; font-size: 0.8rem; padding: 0.35rem; border-radius: 6px; text-align: center;">
                  <i class="fa-solid fa-triangle-exclamation"></i> ${t('missingFields')} ${t('phone')}
                </div>
              `}
              ${s.emergency_contact ? `
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; text-align: center;">
                  ${t('emergencyContact')}: <a href="tel:${escapeHtml(s.emergency_contact)}" style="color: var(--secondary);">${escapeHtml(s.emergency_contact)}</a>
                </div>
              ` : ''}
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; padding-top: 0.6rem;">
              <span class="tag ${s.status === 'active' ? 'tag-present' : 'tag-absent'}">
                ${s.status === 'active' ? t('active') : t('inactive')}
              </span>
              <div style="display: flex; gap: 0.4rem;">
                <button class="btn btn-outline btn-sm" onclick="viewStudentProfile(${s.id})">
                  <i class="fa-solid fa-eye"></i> ${t('viewProfile')}
                </button>
                <button class="btn btn-outline btn-sm" onclick="openEditStudentModal(${s.id})">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                ${currentUser.role === 'super_admin' ? `
                  <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="deleteStudent(${s.id})">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }
    });
  } catch (err) { }
}

function openRegisterStudentModal() {
  document.getElementById('formStudent').reset();
  document.getElementById('studentEditId').value = '';
  document.getElementById('studentChristianName').value = '';
  document.getElementById('studentProfessionType').value = 'Student';
  document.getElementById('studentEducationLevel').value = 'Grade 1';
  document.getElementById('studentProfessionCustom').value = '';
  toggleProfessionDetails();
  document.getElementById('modalStudentTitle').textContent = t('registerStudent');
  openModal('modalStudent');
}

async function openEditStudentModal(id) {
  try {
    const data = await api(`/api/students/${id}`);
    if (!data) return;

    const s = data.student;
    document.getElementById('studentEditId').value = s.id;
    document.getElementById('studentFirstName').value = s.first_name || '';
    document.getElementById('studentFatherName').value = s.father_name || '';
    document.getElementById('studentMotherName').value = s.mother_name || '';
    document.getElementById('studentChristianName').value = s.christian_name || '';
    document.getElementById('studentAge').value = s.age || '';
    document.getElementById('studentPhone').value = s.phone || '';
    document.getElementById('studentEmergency').value = s.emergency_contact || '';
    document.getElementById('studentCategory').value = s.category || 'Youth';
    document.getElementById('studentPreviousService').value = s.previous_service || '';

    // Handle Profession parsing
    const rawProf = (s.profession || '').trim();
    const profTypeSelect = document.getElementById('studentProfessionType');
    const eduLevelSelect = document.getElementById('studentEducationLevel');
    const customProfInput = document.getElementById('studentProfessionCustom');

    if (rawProf.startsWith('Student - ')) {
      profTypeSelect.value = 'Student';
      const level = rawProf.replace('Student - ', '').trim();
      eduLevelSelect.value = level;
      if (!eduLevelSelect.value) {
        eduLevelSelect.value = 'Grade 1';
      }
      customProfInput.value = '';
    } else if (rawProf === 'Student') {
      profTypeSelect.value = 'Student';
      eduLevelSelect.value = 'Grade 1';
      customProfInput.value = '';
    } else if (rawProf === 'Worker') {
      profTypeSelect.value = 'Worker';
      customProfInput.value = '';
    } else if (rawProf) {
      profTypeSelect.value = 'Other';
      customProfInput.value = rawProf;
    } else {
      profTypeSelect.value = 'Student';
      eduLevelSelect.value = 'Grade 1';
      customProfInput.value = '';
    }

    toggleProfessionDetails();

    document.getElementById('modalStudentTitle').textContent = t('edit') + ': ' + s.first_name;
    openModal('modalStudent');
  } catch (err) { }
}

async function handleSaveStudent(e) {
  e.preventDefault();
  const id = document.getElementById('studentEditId').value;
  
  const profType = document.getElementById('studentProfessionType').value;
  let finalProfession = profType;
  if (profType === 'Student') {
    const edu = document.getElementById('studentEducationLevel').value;
    finalProfession = `Student - ${edu}`;
  } else if (profType === 'Other') {
    finalProfession = document.getElementById('studentProfessionCustom').value.trim() || 'Other';
  } else if (profType === 'Worker') {
    finalProfession = 'Worker';
  }

  const body = {
    first_name: document.getElementById('studentFirstName').value.trim(),
    father_name: document.getElementById('studentFatherName').value.trim(),
    mother_name: document.getElementById('studentMotherName').value.trim(),
    christian_name: document.getElementById('studentChristianName').value.trim(),
    age: document.getElementById('studentAge').value ? parseInt(document.getElementById('studentAge').value, 10) : null,
    phone: document.getElementById('studentPhone').value.trim(),
    emergency_contact: document.getElementById('studentEmergency').value.trim(),
    category: document.getElementById('studentCategory').value,
    profession: finalProfession,
    previous_service: document.getElementById('studentPreviousService').value.trim()
  };

  try {
    if (id) {
      await api(`/api/students/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Student updated successfully!', 'success');
    } else {
      await api('/api/students', { method: 'POST', body: JSON.stringify(body) });
      showToast('Student registered successfully!', 'success');
    }
    closeModal('modalStudent');
    loadStudents();
  } catch (err) { }
}

async function viewStudentProfile(id) {
  try {
    const data = await api(`/api/students/${id}`);
    if (!data) return;

    const s = data.student;

    const missingFields = [];
    if (!s.phone || s.phone.trim() === '') missingFields.push(t('phone'));
    if (!s.category || s.category.trim() === '' || s.category === 'All') missingFields.push(t('category'));
    if (!s.age || s.age === 0 || s.age === null) missingFields.push(t('age'));
    if (!s.profession || s.profession.trim() === '') missingFields.push(t('profession'));
    const isIncomplete = missingFields.length > 0;

    document.getElementById('profileStudentName').innerHTML = `${escapeHtml(s.first_name)} ${escapeHtml(s.father_name)} ${s.christian_name ? `<span style="font-size: 0.9rem; color: var(--primary); font-weight: normal;">(${escapeHtml(s.christian_name)})</span>` : ''}`;

    document.getElementById('profileDetailsCard').innerHTML = `
      ${isIncomplete ? `
        <div style="background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 0.65rem 0.85rem; border-radius: 8px; margin-bottom: 0.85rem; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <i class="fa-solid fa-triangle-exclamation"></i> <strong>${t('incompleteProfile')}:</strong> ${t('missingFields')} (${missingFields.join(', ')})
          </div>
          <button class="btn btn-warning btn-sm" onclick="closeModal('modalStudentProfile'); openEditStudentModal(${s.id});">
            <i class="fa-solid fa-pen"></i> ${t('edit')}
          </button>
        </div>
      ` : ''}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
        <div><strong>${t('christianName')}:</strong> ${escapeHtml(s.christian_name || 'N/A')}</div>
        <div><strong>${t('motherName')}:</strong> ${escapeHtml(s.mother_name || 'N/A')}</div>
        <div><strong>${t('age')}:</strong> ${s.age || '<span style="color:#b45309;">N/A</span>'}</div>
        <div><strong>${t('category')}:</strong> ${s.category ? `<span class="tag tag-category">${escapeHtml(s.category)}</span>` : '<span style="color:#b45309;">N/A</span>'}</div>
        <div><strong>${t('phone')}:</strong> ${s.phone ? `<a href="tel:${escapeHtml(s.phone)}">${escapeHtml(s.phone)}</a>` : '<span style="color:#b45309;">N/A</span>'}</div>
        <div><strong>${t('emergencyContact')}:</strong> <a href="tel:${escapeHtml(s.emergency_contact)}">${escapeHtml(s.emergency_contact || 'N/A')}</a></div>
        <div><strong>${t('profession')}:</strong> ${escapeHtml(s.profession || 'N/A')}</div>
        <div><strong>${t('previousService')}:</strong> ${escapeHtml(s.previous_service || 'N/A')}</div>
        <div>
          <strong>${t('status')}:</strong> 
          <span class="tag ${s.status === 'active' ? 'tag-present' : 'tag-absent'}">${s.status}</span>
          ${['admin', 'super_admin'].includes(currentUser.role) ? `
            <button class="btn btn-outline btn-sm" style="margin-left: 0.5rem;" onclick="toggleStudentStatus(${s.id}, '${s.status}')">
              ${s.status === 'active' ? t('deactivate') : t('activate')}
            </button>
          ` : ''}
        </div>
      </div>
    `;

    // Render Sibling & Family Information
    const sibCard = document.getElementById('profileSiblingsCard');
    const sibContent = document.getElementById('profileSiblingsContent');
    if (sibCard && sibContent) {
      if (data.siblings && data.siblings.length > 0) {
        sibCard.style.display = 'block';
        sibContent.innerHTML = '';
        data.siblings.forEach(sib => {
          sibContent.innerHTML += `
            <div style="background: #fff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 0.6rem 0.85rem; flex: 1; min-width: 200px; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
              <div>
                <strong style="color: #1e1b4b; font-size: 0.9rem;">${escapeHtml(sib.first_name)} ${escapeHtml(sib.father_name)}</strong>
                ${sib.christian_name ? `<div style="font-size: 0.78rem; color: var(--primary);"><i class="fa-solid fa-cross"></i> ${escapeHtml(sib.christian_name)}</div>` : ''}
                <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">
                  <span class="tag tag-category" style="font-size: 0.7rem; padding: 0.1rem 0.35rem;">${escapeHtml(sib.category || '-')}</span>
                  ${sib.age ? ` | ${t('age')}: ${sib.age}` : ''}
                </div>
              </div>
              <button type="button" class="btn btn-outline btn-sm" style="color: #4338ca; border-color: #c7d2fe;" onclick="viewStudentProfile(${sib.id})" title="${t('viewProfile')}">
                <i class="fa-solid fa-arrow-right"></i>
              </button>
            </div>
          `;
        });
      } else {
        sibCard.style.display = 'none';
        sibContent.innerHTML = '';
      }
    }

    const histTbody = document.getElementById('profileHistoryTableBody');
    histTbody.innerHTML = '';
    if (data.history.length === 0) {
      histTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No attendance history yet.</td></tr>`;
    } else {
      data.history.forEach(h => {
        let tagClass = 'tag-present';
        if (h.status === 'absent') tagClass = 'tag-absent';
        if (h.status === 'permission') tagClass = 'tag-permission';

        histTbody.innerHTML += `
          <tr>
            <td>${formatDate(h.session_date)}</td>
            <td>${escapeHtml(h.course_title)}</td>
            <td><span class="tag ${tagClass}">${t('status' + h.status.charAt(0).toUpperCase() + h.status.slice(1))}</span></td>
            <td>${escapeHtml(h.remarks || '-')}</td>
          </tr>
        `;
      });
    }

    openModal('modalStudentProfile');
  } catch (err) { }
}

async function toggleStudentStatus(id, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  try {
    await api(`/api/students/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });
    showToast(`Status updated to ${newStatus}`, 'success');
    closeModal('modalStudentProfile');
    loadStudents();
    if (currentUser.role === 'admin') loadInactiveStudents();
  } catch (err) { }
}

async function deleteStudent(id) {
  if (!confirm(t('confirmDelete'))) return;
  try {
    await api(`/api/students/${id}`, { method: 'DELETE' });
    showToast('Student deleted', 'info');
    loadStudents();
  } catch (err) { }
}

// ==========================================
// 4. 3-CONSECUTIVE ABSENCES ALERT (Admin)
// ==========================================
async function load3AbsentAlerts() {
  try {
    const alerts = await api('/api/reports/three-absents');
    const badge = document.getElementById('badge3AbsentCount');
    const drawerBadge = document.getElementById('drawerBadge3AbsentCount');
    const container = document.getElementById('alertsContainer');

    if (!alerts || alerts.length === 0) {
      if (badge) badge.style.display = 'none';
      if (drawerBadge) drawerBadge.style.display = 'none';
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2.5rem; color: #15803d; background: #f0fdf4; border-radius: 12px; border: 1px solid #bbf7d0;">
            <i class="fa-solid fa-circle-check" style="font-size: 2.5rem; margin-bottom: 0.75rem;"></i>
            <h4 style="font-size: 1.1rem; font-weight: 700;">${t('noAlerts')}</h4>
          </div>
        `;
      }
      return;
    }

    if (badge) {
      badge.style.display = 'inline-block';
      badge.textContent = alerts.length;
    }
    if (drawerBadge) {
      drawerBadge.style.display = 'inline-block';
      drawerBadge.textContent = alerts.length;
    }

    if (!container) return;
    container.innerHTML = '';

    alerts.forEach(a => {
      container.innerHTML += `
        <div class="alert-card">
          <div class="alert-student-info">
            <h4><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(a.first_name)} ${escapeHtml(a.father_name)} (${escapeHtml(a.category)})</h4>
            <p><strong>${t('motherName')}:</strong> ${escapeHtml(a.mother_name)} | <strong>${t('profession')}:</strong> ${escapeHtml(a.profession || 'N/A')}</p>
            <p>
              <strong>${t('consecutiveAbsences')}:</strong> <span style="font-weight: 700; color: var(--danger); font-size: 1rem;">${a.absent_count}</span> | 
              <strong>${t('lastPresentDate')}:</strong> ${a.last_present_date ? formatDate(a.last_present_date) : 'Never'}
            </p>
          </div>

          <div class="alert-actions">
            <a href="tel:${escapeHtml(a.phone)}" class="btn btn-danger">
              <i class="fa-solid fa-phone"></i> ${t('callStudent')} (${escapeHtml(a.phone)})
            </a>
            ${a.emergency_contact ? `
              <a href="tel:${escapeHtml(a.emergency_contact)}" class="btn btn-warning">
                <i class="fa-solid fa-phone-volume"></i> ${t('callEmergency')}
              </a>
            ` : ''}
            <button class="btn btn-outline" onclick="viewStudentProfile(${a.student_id})">
              <i class="fa-solid fa-user"></i> ${t('viewProfile')}
            </button>
          </div>
        </div>
      `;
    });
  } catch (err) { }
}

// ==========================================
// 5. INACTIVE STUDENTS (Admin)
// ==========================================
async function loadInactiveStudents() {
  try {
    const list = await api('/api/reports/inactive-students');
    const container = document.getElementById('inactiveContainer');
    container.innerHTML = '';

    if (!list || list.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
          <i class="fa-solid fa-circle-check" style="font-size: 2.5rem; margin-bottom: 0.75rem; color: var(--success);"></i>
          <h4>${t('noInactive')}</h4>
        </div>
      `;
      return;
    }

    list.forEach(s => {
      container.innerHTML += `
        <div class="card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; border-left: 4px solid var(--text-muted);">
          <div>
            <h4 style="font-weight: 700; color: var(--text-dark);">${escapeHtml(s.first_name)} ${escapeHtml(s.father_name)}</h4>
            <p style="font-size: 0.85rem; color: var(--text-muted);">
              ${escapeHtml(s.category)} | ${t('phone')}: ${escapeHtml(s.phone)} | ${t('lastPresentDate')}: ${s.last_attended_date ? formatDate(s.last_attended_date) : 'None'}
            </p>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-success btn-sm" onclick="toggleStudentStatus(${s.id}, 'inactive')">
              <i class="fa-solid fa-arrow-rotate-left"></i> ${t('activate')}
            </button>
            <button class="btn btn-outline btn-sm" onclick="viewStudentProfile(${s.id})">
              <i class="fa-solid fa-eye"></i> ${t('viewProfile')}
            </button>
          </div>
        </div>
      `;
    });
  } catch (err) { }
}

// ==========================================
// 6. USER MANAGEMENT (Admin)
// ==========================================
async function loadUsers() {
  try {
    const users = await api('/api/users');
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    if (!users || users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No users found.</td></tr>`;
      return;
    }

    users.forEach(u => {
      let roleTagClass = 'tag-permission';
      let roleText = t('encoderRole');
      if (u.role === 'super_admin') {
        roleTagClass = 'tag-present';
        roleText = t('superAdminRole');
      } else if (u.role === 'admin') {
        roleTagClass = 'tag-category';
        roleText = t('adminRole');
      }

      tbody.innerHTML += `
        <tr>
          <td><strong>${escapeHtml(u.full_name)}</strong></td>
          <td>${escapeHtml(u.username)}</td>
          <td><span class="tag ${roleTagClass}">${roleText}</span></td>
          <td>${formatDate(u.created_at)}</td>
          <td>
            <div style="display: flex; gap: 0.4rem;">
              <button class="btn btn-outline btn-sm" title="${t('resetUserPassword')}" onclick="openResetUserPasswordModal(${u.id}, '${escapeHtml(u.username)}', '${escapeHtml(u.full_name)}')">
                <i class="fa-solid fa-key"></i>
              </button>
              ${u.id !== currentUser.id ? `
                <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="deleteUser(${u.id})">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : `<small style="color: var(--text-muted); padding: 0.2rem 0.4rem;">(You)</small>`}
            </div>
          </td>
        </tr>
      `;
    });
  } catch (err) { }
}

function openCreateUserModal() {
  document.getElementById('formUser').reset();
  openModal('modalUser');
}

async function handleCreateUser(e) {
  e.preventDefault();
  const body = {
    full_name: document.getElementById('userFullName').value,
    username: document.getElementById('userUsername').value,
    password: document.getElementById('userPassword').value,
    role: document.getElementById('userRole').value
  };

  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
    closeModal('modalUser');
    showToast('User created successfully!', 'success');
    loadUsers();
  } catch (err) { }
}

async function deleteUser(id) {
  if (!confirm(t('confirmDelete'))) return;
  try {
    await api(`/api/users/${id}`, { method: 'DELETE' });
    showToast('User deleted', 'info');
    loadUsers();
  } catch (err) { }
}

// Password Management Handlers
function openChangePasswordModal() {
  const form = document.getElementById('formChangePassword');
  if (form) form.reset();
  openModal('modalChangePassword');
}

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('changeCurrentPassword').value;
  const newPassword = document.getElementById('changeNewPassword').value;
  const confirmPassword = document.getElementById('changeConfirmPassword').value;
  const btn = document.getElementById('btnSubmitChangePassword');

  if (newPassword !== confirmPassword) {
    showToast(t('passwordsDoNotMatch'), 'danger');
    return;
  }

  if (newPassword.length < 6) {
    showToast(t('passwordLengthMin'), 'danger');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('loading')}`;

  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    closeModal('modalChangePassword');
    showToast(t('passwordChangedSuccess'), 'success');
  } catch (err) {
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-key"></i> ${t('save')}`;
  }
}

function openResetUserPasswordModal(userId, username, fullName) {
  document.getElementById('formResetUserPassword').reset();
  document.getElementById('resetTargetUserId').value = userId;
  document.getElementById('resetTargetUserText').textContent = `${fullName} (@${username})`;
  openModal('modalResetUserPassword');
}

async function handleResetUserPassword(e) {
  e.preventDefault();
  const userId = document.getElementById('resetTargetUserId').value;
  const newPassword = document.getElementById('resetUserNewPassword').value;
  const btn = document.getElementById('btnSubmitResetUserPassword');

  if (!newPassword || newPassword.length < 6) {
    showToast(t('passwordLengthMin'), 'danger');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('loading')}`;

  try {
    await api(`/api/users/${userId}/reset-password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword })
    });
    closeModal('modalResetUserPassword');
    showToast('User password reset successfully!', 'success');
  } catch (err) {
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-key"></i> ${t('save')}`;
  }
}

// ==========================================
// EXCEL EXPORT FUNCTIONS (SheetJS)
// ==========================================
function exportSessionAttendanceToExcel() {
  if (!activeSessionData || !activeSessionData.students) {
    showToast('No session data available to export', 'danger');
    return;
  }

  if (typeof XLSX === 'undefined') {
    showToast('Excel library loading, please try again in a moment', 'info');
    return;
  }

  const session = activeSessionData.session;
  const isAmharic = currentLang === 'am';

  const exportData = activeSessionData.students.map((s, index) => {
    const rec = activeAttendanceRecords[s.student_id] || { status: s.attendance_status || 'present', remarks: '' };

    let statusLabel = rec.status;
    if (rec.status === 'present') statusLabel = isAmharic ? 'ተገኝቷል' : 'Present';
    if (rec.status === 'absent') statusLabel = isAmharic ? 'ቀረ' : 'Absent';
    if (rec.status === 'permission') statusLabel = isAmharic ? 'ፈቃድ' : 'Permission';

    if (isAmharic) {
      return {
        'ተራ ቁጥር': index + 1,
        'የተማሪው ሙሉ ስም': `${s.first_name} ${s.father_name}`,
        'የእናት ስም': s.mother_name,
        'ምድብ': s.category,
        'ስልክ ቁጥር': s.phone,
        'የአደጋ ጊዜ ስልክ': s.emergency_contact || '',
        'የመገኘት ሁኔታ': statusLabel,
        'አስተያየት': rec.remarks || ''
      };
    } else {
      return {
        'No.': index + 1,
        'Student Name': `${s.first_name} ${s.father_name}`,
        'Mother Name': s.mother_name,
        'Category': s.category,
        'Phone': s.phone,
        'Emergency Contact': s.emergency_contact || '',
        'Attendance Status': statusLabel,
        'Remarks': rec.remarks || ''
      };
    }
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Sheet');

  const fileName = `Attendance_${session.course_title.replace(/[^a-zA-Z0-9]/g, '_')}_${formatDate(session.session_date)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  showToast('Excel file downloaded successfully!', 'success');
}

async function exportStudentsToExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Excel library loading, please try again in a moment', 'info');
    return;
  }

  const category = document.getElementById('filterStudentCategory')?.value || 'All';
  const status = document.getElementById('filterStudentStatus')?.value || 'All';
  const profession = document.getElementById('filterStudentProfession')?.value || 'All';
  const education = document.getElementById('filterStudentEducation')?.value || 'All';
  const search = document.getElementById('searchStudentInput')?.value || '';
  const isAmharic = currentLang === 'am';

  try {
    const students = await api(`/api/students?category=${category}&status=${status}&profession=${profession}&education_level=${education}&search=${encodeURIComponent(search)}`);
    if (!students || students.length === 0) {
      showToast('No student records found to export', 'warning');
      return;
    }

    const exportData = students.map((s, index) => {
      const statusLabel = s.status === 'active'
        ? (isAmharic ? 'ንቁ' : 'Active')
        : (isAmharic ? 'እንቅስቃሴ ያቆመ' : 'Inactive');

      if (isAmharic) {
        return {
          'ተራ ቁጥር': index + 1,
          'የተማሪው ስም': s.first_name,
          'የአባት ስም': s.father_name,
          'የእናት ስም': s.mother_name,
          'የክርስትና ስም': s.christian_name || '',
          'ዕድሜ': s.age,
          'ምድብ': s.category,
          'ስልክ ቁጥር': s.phone,
          'የአደጋ ጊዜ ስልክ': s.emergency_contact || '',
          'ሙያ/ትምህርት': s.profession || '',
          'ቀደም ሲል ያገለገሉበት': s.previous_service || '',
          'ሁኔታ': statusLabel,
          'የተገኘበት ብዛት': s.present_count || 0,
          'የቀረበት ብዛት': s.absent_count || 0,
          'በፈቃድ የቀረ': s.permission_count || 0
        };
      } else {
        return {
          'No.': index + 1,
          'First Name': s.first_name,
          'Father Name': s.father_name,
          'Mother Name': s.mother_name,
          'Christian Name': s.christian_name || '',
          'Age': s.age,
          'Category': s.category,
          'Phone': s.phone,
          'Emergency Contact': s.emergency_contact || '',
          'Profession': s.profession || '',
          'Previous Service': s.previous_service || '',
          'Status': statusLabel,
          'Total Present': s.present_count || 0,
          'Total Absent': s.absent_count || 0,
          'Total Permission': s.permission_count || 0
        };
      }
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sunday School Students');

    const fileName = `Sunday_School_Students_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    showToast('Students list exported to Excel!', 'success');
  } catch (err) { }
}

// ==========================================
// BULK IMPORT STUDENTS (Excel / CSV - Super Admin Only)
// ==========================================
let parsedImportStudents = [];

function openImportModal() {
  if (!currentUser || currentUser.role !== 'super_admin') {
    showToast(t('superAdminOnly') || 'Administrator access required for bulk import', 'danger');
    return;
  }

  const fileInput = document.getElementById('importStudentsFileInput');
  if (fileInput) fileInput.value = '';
  const statusDiv = document.getElementById('importFileStatus');
  if (statusDiv) {
    statusDiv.style.display = 'none';
    statusDiv.innerHTML = '';
  }
  const previewContainer = document.getElementById('importPreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';
  const submitBtn = document.getElementById('btnSubmitImport');
  if (submitBtn) submitBtn.style.display = 'none';
  const tbody = document.getElementById('importPreviewTbody');
  if (tbody) tbody.innerHTML = '';
  parsedImportStudents = [];
  openModal('modalImportStudents');
}

function downloadStudentImportTemplate() {
  if (typeof XLSX === 'undefined') {
    showToast('Excel library not loaded yet', 'warning');
    return;
  }

  const sampleRows = [
    {
      'First Name (የተማሪ ስም)': 'Test',
      'Father Name (የአባት ስም)': 'Test',
      'Grandfather / Mother Name (የአያት/እናት ስም)': 'Test',
      'Christian Name (የክርስትና ስም)': 'Test',
      'Age (ዕድሜ)': 15,
      'Category (ምድብ)': 'Grade 8',
      'Phone (ስልክ)': '0911000000',
      'Emergency Contact (አማራጭ ስልክ)': '0911000001',
      'Profession / Grade (ሙያ / ክፍል)': 'Student - Grade 8',
      'Previous Service (ቀደምት አገልግሎት)': 'የዝማሬ ክፍል'
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Student Template');
  XLSX.writeFile(wb, 'Sunday_School_Students_Template.xlsx');
  showToast('Import template downloaded!', 'success');
}

function normalizeHeaderKey(key) {
  const k = String(key || '').toLowerCase().trim();
  if (k.includes('first') || k.includes('የተማሪ') || k === 'name' || k === 'ስም') return 'first_name';
  if (k.includes('father') || k.includes('አባት')) return 'father_name';
  if (k.includes('mother') || k.includes('እናት') || k.includes('grandfather') || k.includes('አያት')) return 'mother_name';
  if (k.includes('christian') || k.includes('ክርስትና') || k.includes('baptismal')) return 'christian_name';
  if (k.includes('age') || k.includes('ዕድሜ') || k.includes('እድሜ')) return 'age';
  if (k.includes('category') || k.includes('ምድብ') || k.includes('ክፍል/ምድብ')) return 'category';
  if (k.includes('phone') || k.includes('ስልክ') || k.includes('tel') || k.includes('mobile')) {
    if (k.includes('emergency') || k.includes('አማራጭ') || k.includes('አደጋ')) return 'emergency_contact';
    return 'phone';
  }
  if (k.includes('emergency') || k.includes('secondary') || k.includes('አማራጭ') || k.includes('አደጋ')) return 'emergency_contact';
  if (k.includes('profession') || k.includes('ሙያ') || k.includes('job') || k.includes('occupation') || k.includes('ትምህርት')) return 'profession';
  if (k.includes('service') || k.includes('አገልግሎት')) return 'previous_service';
  return null;
}

function normalizeCategoryValue(raw) {
  if (!raw) return '';
  const r = String(raw).trim();
  const lower = r.toLowerCase();
  
  // Check Grade 1 to 12
  for (let i = 1; i <= 12; i++) {
    if (lower === `grade ${i}` || lower === `grade${i}` || lower === `${i}ኛ ክፍል` || lower === `${i}ኛ` || lower === `${i}`) {
      return `Grade ${i}`;
    }
  }

  if (lower.includes('child') || lower.includes('ህፃናት')) return 'Child';
  if (lower.includes('teen') || lower.includes('አዳጊ')) return 'Teens';
  if (lower.includes('adult') || lower.includes('አዋቂ')) return 'Adult';
  if (lower.includes('all') || lower.includes('ሁሉም')) return 'All';
  if (lower.includes('youth') || lower.includes('ወጣት')) return 'Youth';

  return r;
}

async function handleImportFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (typeof XLSX === 'undefined') {
    showToast('Excel library not loaded yet', 'warning');
    return;
  }

  const statusDiv = document.getElementById('importFileStatus');
  const previewContainer = document.getElementById('importPreviewContainer');
  const submitBtn = document.getElementById('btnSubmitImport');
  const tbody = document.getElementById('importPreviewTbody');

  statusDiv.style.display = 'block';
  statusDiv.style.background = '#f8fafc';
  statusDiv.style.color = 'var(--text-dark)';
  statusDiv.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Reading file: <strong>${escapeHtml(file.name)}</strong>...`;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = evt.target.result;
      const workbook = XLSX.read(data, { type: 'binary' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!rawRows || rawRows.length === 0) {
        statusDiv.style.background = '#fef2f2';
        statusDiv.style.color = '#991b1b';
        statusDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> No data rows found in the selected file.`;
        previewContainer.style.display = 'none';
        submitBtn.style.display = 'none';
        return;
      }

      parsedImportStudents = [];
      tbody.innerHTML = '';
      let skippedTestRows = 0;

      rawRows.forEach((row) => {
        const studentObj = {
          first_name: '',
          father_name: '',
          mother_name: '',
          christian_name: '',
          age: '',
          category: '',
          phone: '',
          emergency_contact: '',
          profession: '',
          previous_service: '',
          status: 'active'
        };

        Object.keys(row).forEach(header => {
          const normKey = normalizeHeaderKey(header);
          if (normKey) {
            studentObj[normKey] = String(row[header]).trim();
          }
        });

        // Skip test / sample rows (so template cannot be imported)
        const lowerFirst = studentObj.first_name.toLowerCase();
        const lowerFather = studentObj.father_name.toLowerCase();
        const isTestRow = ['test', 'sample', 'የሙከራ', 'ሙከራ'].includes(lowerFirst) ||
                          ['test', 'sample', 'የሙከራ', 'ሙከራ'].includes(lowerFather) ||
                          (lowerFirst.includes('test') && lowerFather.includes('test'));

        if (isTestRow) {
          skippedTestRows++;
          return;
        }

        if (studentObj.category) {
          studentObj.category = normalizeCategoryValue(studentObj.category);
        }

        if (studentObj.age) {
          const parsedAge = parseInt(studentObj.age, 10);
          studentObj.age = !isNaN(parsedAge) && parsedAge > 0 ? parsedAge : '';
        }

        // Only require First Name and Father Name to import
        if (studentObj.first_name && studentObj.father_name) {
          parsedImportStudents.push(studentObj);

          const missingInRow = [];
          if (!studentObj.phone) missingInRow.push(t('phone'));
          if (!studentObj.category) missingInRow.push(t('category'));
          if (!studentObj.age) missingInRow.push(t('age'));
          if (!studentObj.profession) missingInRow.push(t('profession'));

          tbody.innerHTML += `
            <tr>
              <td>${parsedImportStudents.length}</td>
              <td>
                <strong>${escapeHtml(studentObj.first_name)}</strong>
                ${missingInRow.length > 0 ? `<br><small style="color: #b45309;"><i class="fa-solid fa-triangle-exclamation"></i> ${t('missingFields')}: ${missingInRow.join(', ')}</small>` : ''}
              </td>
              <td>${escapeHtml(studentObj.father_name)}</td>
              <td>${escapeHtml(studentObj.mother_name || '-')}</td>
              <td>${escapeHtml(studentObj.christian_name || '-')}</td>
              <td>${studentObj.category ? `<span class="tag tag-category">${escapeHtml(studentObj.category)}</span>` : '<span style="color: #b45309;">-</span>'}</td>
              <td>${studentObj.age || '<span style="color: #b45309;">-</span>'}</td>
              <td>${studentObj.phone ? escapeHtml(studentObj.phone) : '<span style="color: #b45309;">-</span>'}</td>
              <td><small>${escapeHtml(studentObj.profession || '-')}</small></td>
            </tr>
          `;
        }
      });

      if (parsedImportStudents.length === 0) {
        statusDiv.style.background = '#fef2f2';
        statusDiv.style.color = '#991b1b';
        statusDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> No valid student rows to import.${skippedTestRows > 0 ? ` (Skipped ${skippedTestRows} test/sample rows)` : ''}`;
        previewContainer.style.display = 'none';
        submitBtn.style.display = 'none';
      } else {
        statusDiv.style.background = '#f0fdf4';
        statusDiv.style.color = '#166534';
        statusDiv.innerHTML = `<i class="fa-solid fa-circle-check"></i> Found <strong>${parsedImportStudents.length}</strong> student record(s) ready to import.${skippedTestRows > 0 ? ` <span style="color: var(--text-muted); font-size: 0.8rem;">(${skippedTestRows} test row(s) skipped)</span>` : ''}`;
        previewContainer.style.display = 'block';
        submitBtn.style.display = 'inline-flex';
      }
    } catch (err) {
      statusDiv.style.background = '#fef2f2';
      statusDiv.style.color = '#991b1b';
      statusDiv.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Error parsing file: ${escapeHtml(err.message)}`;
      previewContainer.style.display = 'none';
      submitBtn.style.display = 'none';
    }
  };

  reader.readAsBinaryString(file);
}

async function submitBulkImport() {
  if (!parsedImportStudents || parsedImportStudents.length === 0) {
    showToast('No students to import', 'warning');
    return;
  }

  const submitBtn = document.getElementById('btnSubmitImport');
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const result = await api('/api/students/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ students: parsedImportStudents })
    });

    showToast(result.message || `${result.importedCount} students imported successfully!`, 'success');
    closeModal('modalImportStudents');
    loadStudents();
  } catch (err) {
    // api helper already displays toast
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}



// Category Matrix & Excel Export Logic
function getMatrixAttendanceCell(sess, s, att, sessionHasAttendanceMap, isAmharic, attByDateAndStudent = {}) {
  const todayStr = new Date().toISOString().split('T')[0];
  const sessDay = sess.session_date ? new Date(sess.session_date).toISOString().split('T')[0] : '';
  const regDay = s.created_at ? new Date(s.created_at).toISOString().split('T')[0] : '';

  // 1. If student was registered AFTER this session date -> '-' (Not enrolled yet)
  if (sessDay && regDay && sessDay < regDay) {
    return { val: '-', color: '#94a3b8', isCountable: false, status: 'before_reg' };
  }

  // 2. If student has an explicit direct attendance record for this session
  if (att) {
    if (att.status === 'present') {
      return { val: '✓', color: 'var(--success)', isCountable: true, status: 'present' };
    } else if (att.status === 'permission') {
      return { val: isAmharic ? 'ፈ' : 'P', color: 'var(--warning)', isCountable: true, status: 'permission' };
    }
    // If direct record was absent, check cross-category attendance before deciding
  }

  // 3. If student attended or had permission in another cross-category session on this date
  if (sessDay && attByDateAndStudent[`${s.id}_${sessDay}`]) {
    const crossAtt = attByDateAndStudent[`${s.id}_${sessDay}`];
    if (crossAtt.status === 'present') {
      return { 
        val: '✓', 
        color: '#059669', 
        isCountable: true, 
        status: 'present',
        isCross: true,
        crossCategory: crossAtt.session_category,
        crossCourse: crossAtt.course_title,
        tooltip: `${isAmharic ? 'በሌላ ክፍል ተምሯል' : 'Attended in other class'}: ${crossAtt.session_category || ''} (${crossAtt.course_title || ''})`
      };
    } else if (crossAtt.status === 'permission') {
      return { 
        val: isAmharic ? 'ፈ' : 'P', 
        color: 'var(--warning)', 
        isCountable: true, 
        status: 'permission',
        isCross: true,
        crossCategory: crossAtt.session_category,
        crossCourse: crossAtt.course_title,
        tooltip: `${isAmharic ? 'ፈቃድ በሌላ ክፍል' : 'Permission in other class'}: ${crossAtt.session_category || ''}`
      };
    }
  }

  // If student was directly marked absent in this session and no cross attendance on this date
  if (att && att.status === 'absent') {
    return { val: '✗', color: 'var(--danger)', isCountable: true, status: 'absent' };
  }

  // 4. If session date is in the future (after today) -> '-' (Upcoming session, not yet held)
  if (sessDay && sessDay > todayStr) {
    return { val: '-', color: '#94a3b8', isCountable: false, status: 'future' };
  }

  // 5. If session is past/today, but NO ONE has recorded attendance yet -> '-' (Unrecorded session)
  if (!sessionHasAttendanceMap[sess.id]) {
    return { val: '-', color: '#94a3b8', isCountable: false, status: 'unrecorded' };
  }

  // 6. If attendance was taken for this past session, but this active student was absent/not recorded -> Absent '✗'
  return { val: '✗', color: 'var(--danger)', isCountable: true, status: 'absent' };
}

async function loadCategoryMatrix() {
  const categorySelect = document.getElementById('filterCategoryMatrixCategory');
  const selectedCategory = categorySelect ? categorySelect.value : 'Youth';
  const container = document.getElementById('categoryMatrixTableContainer');
  if (!container) return;

  container.innerHTML = `<div style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:0.5rem;">${t('loading')}</p></div>`;

  try {
    const data = await api(`/api/reports/category-matrix?category=${selectedCategory}`);
    if (!data || !data.students || data.students.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No active students found in this category.</div>`;
      return;
    }

    const { students, sessions, attendance } = data;
    const isAmharic = currentLang === 'am';

    const attMap = {};
    const attByDateAndStudent = {};
    const sessionHasAttendanceMap = {};
    if (attendance) {
      attendance.forEach(a => {
        attMap[`${a.session_id}_${a.student_id}`] = a;
        sessionHasAttendanceMap[a.session_id] = true;

        const dateKey = a.session_date ? new Date(a.session_date).toISOString().split('T')[0] : '';
        if (dateKey && (a.status === 'present' || a.status === 'permission')) {
          if (!attByDateAndStudent[`${a.student_id}_${dateKey}`] || a.status === 'present') {
            attByDateAndStudent[`${a.student_id}_${dateKey}`] = a;
          }
        }
      });
    }

    let html = `<table><thead><tr>`;
    html += `<th>#</th>`;
    html += `<th>${isAmharic ? 'የተማሪው ሙሉ ስም' : 'Student Name'}</th>`;
    html += `<th>${isAmharic ? 'ስልክ' : 'Phone'}</th>`;
    html += `<th>${isAmharic ? 'የተመዘገበበት ቀን' : 'Reg Date'}</th>`;

    sessions.forEach(sess => {
      html += `<th style="text-align: center; white-space: nowrap;">
        <div>${formatDate(sess.session_date)}</div>
        <small style="font-weight: normal; font-size: 0.75rem;">${escapeHtml(sess.course_title)}</small>
      </th>`;
    });

    html += `</tr></thead><tbody>`;

    students.forEach((s, idx) => {
      html += `<tr>`;
      html += `<td>${idx + 1}</td>`;
      html += `<td><strong>${escapeHtml(s.first_name)} ${escapeHtml(s.father_name)}</strong></td>`;
      html += `<td>${escapeHtml(s.phone || '-')}</td>`;
      html += `<td><small style="color: var(--text-muted);">${formatDate(s.created_at)}</small></td>`;

      sessions.forEach(sess => {
        const att = attMap[`${sess.id}_${s.id}`];
        const cell = getMatrixAttendanceCell(sess, s, att, sessionHasAttendanceMap, isAmharic, attByDateAndStudent);
        html += `<td style="text-align: center; font-weight: bold; color: ${cell.color}; font-size: 1.1rem;" title="${escapeHtml(cell.tooltip || '')}">
          ${cell.val}${cell.isCross ? `<span style="font-size: 0.65rem; color: #0284c7; vertical-align: super; margin-left: 2px;" title="${escapeHtml(cell.tooltip || '')}">★</span>` : ''}
        </td>`;
      });

      html += `</tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="text-align: center; color: var(--danger); padding: 2rem;">Error loading category matrix.</div>`;
  }
}

async function exportCategoryMatrixToExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Excel library loading, please try again in a moment', 'info');
    return;
  }

  const categorySelect = document.getElementById('filterCategoryMatrixCategory');
  const selectedCategory = categorySelect ? categorySelect.value : 'Youth';
  const isAmharic = currentLang === 'am';

  showToast('Generating Category Matrix Excel...', 'info');

  try {
    const data = await api(`/api/reports/category-matrix?category=${selectedCategory}`);
    if (!data || !data.students || data.students.length === 0) {
      showToast('No student records found to export', 'warning');
      return;
    }

    const { students, sessions, attendance } = data;
    const attMap = {};
    const attByDateAndStudent = {};
    const sessionHasAttendanceMap = {};
    if (attendance) {
      attendance.forEach(a => {
        attMap[`${a.session_id}_${a.student_id}`] = a;
        sessionHasAttendanceMap[a.session_id] = true;

        const dateKey = a.session_date ? new Date(a.session_date).toISOString().split('T')[0] : '';
        if (dateKey && (a.status === 'present' || a.status === 'permission')) {
          if (!attByDateAndStudent[`${a.student_id}_${dateKey}`] || a.status === 'present') {
            attByDateAndStudent[`${a.student_id}_${dateKey}`] = a;
          }
        }
      });
    }

    const rows = students.map((s, idx) => {
      const row = {
        [isAmharic ? 'ተራ ቁጥር' : 'No.']: idx + 1,
        [isAmharic ? 'የተማሪው ሙሉ ስም' : 'Student Name']: `${s.first_name} ${s.father_name}`,
        [isAmharic ? 'የእናት ስም' : 'Mother Name']: s.mother_name || '',
        [isAmharic ? 'ምድብ' : 'Category']: s.category,
        [isAmharic ? 'ስልክ ቁጥር' : 'Phone']: s.phone || '',
        [isAmharic ? 'የተመዘገበበት ቀን' : 'Reg Date']: formatDate(s.created_at)
      };

      let presentCount = 0;
      let absentCount = 0;
      let permissionCount = 0;

      sessions.forEach(sess => {
        const colHeader = `${formatDate(sess.session_date)} (${sess.course_title})`;
        const att = attMap[`${sess.id}_${s.id}`];
        const cell = getMatrixAttendanceCell(sess, s, att, sessionHasAttendanceMap, isAmharic, attByDateAndStudent);

        row[colHeader] = cell.val;

        if (cell.isCountable) {
          if (cell.status === 'present') presentCount++;
          else if (cell.status === 'absent') absentCount++;
          else if (cell.status === 'permission') permissionCount++;
        }
      });

      row[isAmharic ? 'የተገኘበት ብዛት' : 'Total Present'] = presentCount;
      row[isAmharic ? 'የቀረበት ብዛት' : 'Total Absent'] = absentCount;
      row[isAmharic ? 'በፈቃድ የቀረ' : 'Total Permission'] = permissionCount;

      const totalCountable = presentCount + absentCount + permissionCount;
      const rate = totalCountable > 0 ? `${Math.round((presentCount / totalCountable) * 100)}%` : '-';
      row[isAmharic ? 'የመገኘት %' : 'Attendance %'] = rate;

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    const sheetTitle = selectedCategory === 'All'
      ? (isAmharic ? 'ሁሉም ምድቦች' : 'All Categories')
      : selectedCategory;

    XLSX.utils.book_append_sheet(workbook, worksheet, sheetTitle);

    const fileName = `Category_Attendance_${selectedCategory}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    showToast('Category attendance matrix exported to Excel!', 'success');
  } catch (err) {
    console.error(err);
  }
}

// ==========================================
// 8. FAMILY & SIBLINGS DIRECTORY LOGIC
// ==========================================
let cachedFamiliesList = [];

async function loadFamilies() {
  try {
    const data = await api('/api/students/families/overview');
    if (!data) return;

    document.getElementById('familyTotalCount').textContent = data.total_families || 0;
    document.getElementById('familyMultiCount').textContent = data.multi_child_families || 0;

    cachedFamiliesList = data.families || [];
    filterFamiliesList();
  } catch (err) {
    console.error('Error loading families:', err);
  }
}

function filterFamiliesList() {
  const search = (document.getElementById('familySearchInput')?.value || '').toLowerCase().trim();
  const filterType = document.getElementById('familyFilterType')?.value || 'All';
  const container = document.getElementById('familiesContainer');
  if (!container) return;

  let list = cachedFamiliesList;

  if (filterType === 'Multi') {
    list = list.filter(f => f.students_count > 1);
  } else if (filterType === 'Single') {
    list = list.filter(f => f.students_count === 1);
  }

  if (search) {
    list = list.filter(f => {
      const fatherMatch = (f.father_name || '').toLowerCase().includes(search);
      const motherMatch = (f.mother_name || '').toLowerCase().includes(search);
      const phoneMatch = (f.phone || '').includes(search) || (f.emergency_contact || '').includes(search);
      const studentMatch = f.students.some(s => 
        (s.first_name || '').toLowerCase().includes(search) || 
        (s.christian_name || '').toLowerCase().includes(search)
      );
      return fatherMatch || motherMatch || phoneMatch || studentMatch;
    });
  }

  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 2.5rem 1rem;">
      <i class="fa-solid fa-people-roof" style="font-size: 2.5rem; color: #cbd5e1; margin-bottom: 0.75rem; display: block;"></i>
      ${t('noInactive')}
    </div>`;
    return;
  }

  list.forEach(fam => {
    const isMulti = fam.students_count > 1;
    const fatherDisplay = fam.father_name || '-';
    const motherDisplay = fam.mother_name || '-';
    const primaryPhone = fam.phone || fam.emergency_contact;

    let studentsHtml = '';
    fam.students.forEach(st => {
      const isInactive = st.status === 'inactive';
      studentsHtml += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.45rem 0.6rem; background: #fff; border: 1px solid #f1f5f9; border-radius: 6px; margin-bottom: 0.4rem; ${isInactive ? 'opacity: 0.6;' : ''}">
          <div>
            <span style="font-weight: 600; font-size: 0.9rem; color: var(--text-dark); cursor: pointer;" onclick="viewStudentProfile(${st.id})">
              ${escapeHtml(st.first_name)}
            </span>
            ${st.christian_name ? `<small style="color: var(--primary); margin-left: 4px;">(${escapeHtml(st.christian_name)})</small>` : ''}
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              <span class="tag tag-category" style="font-size: 0.68rem; padding: 0.08rem 0.35rem;">${escapeHtml(st.category || '-')}</span>
              ${st.age ? ` | ${t('age')}: ${st.age}` : ''}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="viewStudentProfile(${st.id})" title="${t('viewProfile')}">
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
      `;
    });

    container.innerHTML += `
      <div class="card" style="margin-bottom: 0; border: 1px solid ${isMulti ? '#c7d2fe' : 'var(--border)'}; background: ${isMulti ? '#fafbff' : '#fff'}; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
            <div>
              <h4 style="font-size: 1.05rem; font-weight: 700; color: #1e293b;">
                <i class="fa-solid fa-house-user" style="color: var(--primary); margin-right: 4px;"></i>
                ${escapeHtml(fatherDisplay)}
              </h4>
              <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;">
                ${t('motherName')}: <strong>${escapeHtml(motherDisplay)}</strong>
              </p>
            </div>
            <span class="tag" style="background: ${isMulti ? '#e0e7ff' : '#f1f5f9'}; color: ${isMulti ? '#3730a3' : '#475569'}; font-weight: 700; font-size: 0.8rem;">
              <i class="fa-solid fa-children"></i> ${fam.students_count} ${t('children')}
            </span>
          </div>

          ${primaryPhone ? `
            <div style="margin-bottom: 0.75rem;">
              <a href="tel:${escapeHtml(primaryPhone)}" class="btn btn-outline btn-sm" style="width: 100%; justify-content: center; font-weight: 600; color: var(--primary); font-size: 0.82rem;">
                <i class="fa-solid fa-phone"></i> ${escapeHtml(primaryPhone)}
              </a>
            </div>
          ` : ''}

          <div style="border-top: 1px solid #f1f5f9; padding-top: 0.6rem;">
            <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.4rem;">
              <i class="fa-solid fa-users"></i> ${t('children')} (${fam.students_count}):
            </div>
            ${studentsHtml}
          </div>
        </div>
      </div>
    `;
  });
}

// ==========================================
// 9. AUDIT LOGS & ACTIVITY TRAIL LOGIC
// ==========================================
let auditDebounceTimer = null;

function debounceLoadAuditLogs() {
  clearTimeout(auditDebounceTimer);
  auditDebounceTimer = setTimeout(loadAuditLogs, 300);
}

function getActionBadge(action) {
  const map = {
    'LOGIN': { label: t('actionLogin'), color: '#0284c7', bg: '#e0f2fe' },
    'LOGIN_FAILED': { label: t('actionLoginFailed'), color: '#dc2626', bg: '#fee2e2' },
    'STUDENT_CREATE': { label: t('actionStudentCreate'), color: '#16a34a', bg: '#dcfce7' },
    'STUDENT_UPDATE': { label: t('actionStudentUpdate'), color: '#ca8a04', bg: '#fef9c3' },
    'STUDENT_DELETE': { label: t('actionStudentDelete'), color: '#dc2626', bg: '#fee2e2' },
    'STUDENT_STATUS': { label: t('actionStudentStatus'), color: '#9333ea', bg: '#f3e8ff' },
    'BULK_IMPORT': { label: t('actionBulkImport'), color: '#0d9488', bg: '#ccfbf1' },
    'ATTENDANCE_SAVE': { label: t('actionAttendanceSave'), color: '#2563eb', bg: '#dbeafe' },
    'SESSION_CREATE': { label: t('actionSessionCreate'), color: '#16a34a', bg: '#dcfce7' },
    'SESSION_DELETE': { label: t('actionSessionDelete'), color: '#dc2626', bg: '#fee2e2' },
    'USER_CREATE': { label: t('actionUserCreate'), color: '#4f46e5', bg: '#e0e7ff' },
    'USER_DELETE': { label: t('actionUserDelete'), color: '#dc2626', bg: '#fee2e2' },
    'USER_RESET_PASSWORD': { label: t('actionUserResetPassword'), color: '#ea580c', bg: '#ffedd5' },
    'CHANGE_PASSWORD': { label: t('actionChangePassword'), color: '#ea580c', bg: '#ffedd5' }
  };

  const item = map[action] || { label: action, color: '#475569', bg: '#f1f5f9' };
  return `<span class="tag" style="background: ${item.bg}; color: ${item.color}; font-weight: 700; font-size: 0.75rem; border: 1px solid ${item.color}33;">${item.label}</span>`;
}

function formatAuditTimestamp(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;

  const datePart = formatDate(isoString);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const time24 = `${hours}:${minutes}`;
  const ethTime = formatSingleEthiopianTime(time24);

  return `${datePart} - ${ethTime}`;
}

async function loadAuditLogs() {
  const action = document.getElementById('filterAuditAction')?.value || 'All';
  const search = document.getElementById('searchAuditInput')?.value || '';

  try {
    const data = await api(`/api/audit-logs?action=${action}&search=${encodeURIComponent(search)}&limit=100`);
    const tbody = document.getElementById('auditLogsTableBody');
    const mobileContainer = document.getElementById('auditLogsCardContainer');
    const countEl = document.getElementById('auditLogsCount');

    if (tbody) tbody.innerHTML = '';
    if (mobileContainer) mobileContainer.innerHTML = '';

    if (!data || !data.logs || data.logs.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">${t('noAuditLogs')}</td></tr>`;
      if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">${t('noAuditLogs')}</div>`;
      if (countEl) countEl.textContent = '';
      return;
    }

    if (countEl) {
      countEl.textContent = `${t('totalStudents')}: ${data.total} ${t('actions')}`;
    }

    data.logs.forEach(log => {
      const timeDisplay = formatAuditTimestamp(log.created_at);
      const badgeHtml = getActionBadge(log.action);
      const userDisplay = escapeHtml(log.username || 'System');
      const ipDisplay = escapeHtml(log.ip_address || '-');
      const detailsDisplay = escapeHtml(log.details || '-');

      // Table row
      if (tbody) {
        tbody.innerHTML += `
          <tr>
            <td style="white-space: nowrap; font-size: 0.85rem; color: #475569;">
              <i class="fa-solid fa-clock" style="color: #94a3b8; margin-right: 4px;"></i> ${timeDisplay}
            </td>
            <td>
              <strong>${userDisplay}</strong>
            </td>
            <td>${badgeHtml}</td>
            <td style="font-size: 0.88rem; color: var(--text-dark);">${detailsDisplay}</td>
            <td style="font-family: monospace; font-size: 0.8rem; color: #64748b;">${ipDisplay}</td>
          </tr>
        `;
      }

      // Mobile card
      if (mobileContainer) {
        mobileContainer.innerHTML += `
          <div class="card" style="margin-bottom: 0.6rem; padding: 0.85rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
              <span style="font-weight: 700; font-size: 0.9rem; color: #1e293b;">
                <i class="fa-solid fa-user-circle" style="color: var(--primary);"></i> ${userDisplay}
              </span>
              ${badgeHtml}
            </div>
            <div style="font-size: 0.85rem; color: #334155; margin-bottom: 0.4rem;">
              ${detailsDisplay}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 0.4rem;">
              <span><i class="fa-solid fa-clock"></i> ${timeDisplay}</span>
              <span><i class="fa-solid fa-network-wired"></i> ${ipDisplay}</span>
            </div>
          </div>
        `;
      }
    });
  } catch (err) {
    console.error('Error loading audit logs:', err);
  }
}

// Utilities
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Ethiopian Calendar Conversion Helper (Beyene-Kudlek Algorithm)
const ETHIOPIAN_MONTHS_AM = [
  "መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት",
  "መጋቢት", "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ"
];

function gregorianToEthiopian(gregDate) {
  if (!gregDate) return null;
  let dateObj = typeof gregDate === 'string' ? new Date(gregDate) : gregDate;
  if (isNaN(dateObj.getTime())) return null;

  let gy = dateObj.getFullYear();
  let gm = dateObj.getMonth() + 1;
  let gd = dateObj.getDate();

  let a = Math.floor((14 - gm) / 12);
  let y = gy + 4800 - a;
  let m = gm + 12 * a - 3;
  let jdn = gd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;

  let r = (jdn - 1723856) % 1461;
  let n = (r % 365) + 365 * Math.floor(r / 1460);

  let ey = 4 * Math.floor((jdn - 1723856) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460);
  let em = Math.floor(n / 30) + 1;
  let ed = (n % 30) + 1;

  return { year: ey, month: em, day: ed };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;

  if (currentLang === 'am') {
    const eth = gregorianToEthiopian(d);
    if (eth && eth.month) {
      const monthName = ETHIOPIAN_MONTHS_AM[eth.month - 1] || '';
      return `${monthName} ${eth.day} ቀን ${eth.year} ዓ.ም`;
    }
  }

  return d.toISOString().split('T')[0];
}

// Initial Bootstrap on Page Load
window.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLang);

  if (token && currentUser) {
    initAppView();
  } else {
    document.getElementById('viewLogin').style.display = 'flex';
  }
});

