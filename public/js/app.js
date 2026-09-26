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

// Update UI Language
function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('app_lang', lang);

  // Update Lang buttons active state
  document.getElementById('btnLangAm').classList.toggle('active', lang === 'am');
  document.getElementById('btnLangEn').classList.toggle('active', lang === 'en');

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
  document.getElementById('viewApp').style.display = 'none';
  document.getElementById('subNavBar').style.display = 'none';
  document.getElementById('navUserSection').style.display = 'none';
  document.getElementById('viewLogin').style.display = 'flex';
  showToast('Logged out successfully', 'info');
}

function updateUserBadge() {
  if (!currentUser) return;
  document.getElementById('navUsername').textContent = currentUser.full_name || currentUser.username;
  document.getElementById('navRole').textContent = currentUser.role === 'admin' ? t('adminRole') : t('encoderRole');
}

// App Initialization
function initAppView() {
  document.getElementById('viewLogin').style.display = 'none';
  document.getElementById('navUserSection').style.display = 'flex';
  document.getElementById('subNavBar').style.display = 'block';
  document.getElementById('viewApp').style.display = 'block';

  updateUserBadge();

  // Role visibility guards
  const isAdmin = currentUser.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  // Choose default tab
  if (isAdmin) {
    switchTab('dashboard');
    load3AbsentAlerts(); // background count check
  } else {
    // Encoder starts directly on Sessions or Students
    switchTab('sessions');
  }
}

// Tab Switching
function switchTab(tabName) {
  // Update Tab buttons
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`tabBtn${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  if (activeBtn) activeBtn.classList.add('active');

  // Hide all panes
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

  // Show target pane
  const pane = document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  if (pane) pane.style.display = 'block';

  // Load data for that tab
  if (tabName === 'dashboard' && currentUser.role === 'admin') loadDashboard();
  if (tabName === 'sessions') loadSessions();
  if (tabName === 'students') loadStudents();
  if (tabName === 'categoryMatrix') loadCategoryMatrix();
  if (tabName === 'alerts' && currentUser.role === 'admin') load3AbsentAlerts();
  if (tabName === 'inactive' && currentUser.role === 'admin') loadInactiveStudents();
  if (tabName === 'users' && currentUser.role === 'admin') loadUsers();
}

function refreshActiveTabData() {
  const activePane = document.querySelector('.tab-pane[style*="display: block"]');
  if (!activePane) return;
  const tabId = activePane.id;
  if (tabId === 'tabDashboard') loadDashboard();
  else if (tabId === 'tabSessions') loadSessions();
  else if (tabId === 'tabStudents') loadStudents();
  else if (tabId === 'tabCategoryMatrix') loadCategoryMatrix();
  else if (tabId === 'tabAlerts') load3AbsentAlerts();
  else if (tabId === 'tabInactive') loadInactiveStudents();
  else if (tabId === 'tabUsers') loadUsers();
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
              <div style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(s.session_date)} | ${escapeHtml(s.session_time)} (${s.category})</div>
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

    sessions.forEach(s => {
      // Desktop row
      tbody.innerHTML += `
        <tr>
          <td>
            <strong>${escapeHtml(s.course_title)}</strong>
            ${s.description ? `<br><small style="color: var(--text-muted);">${escapeHtml(s.description)}</small>` : ''}
          </td>
          <td>${formatDate(s.session_date)}</td>
          <td>${escapeHtml(s.session_time)}</td>
          <td><span class="tag tag-category">${escapeHtml(s.category)}</span></td>
          <td>
            <span class="tag tag-present"><i class="fa-solid fa-check"></i> ${s.present_count}</span>
            <span class="tag tag-absent"><i class="fa-solid fa-xmark"></i> ${s.absent_count}</span>
            <span class="tag tag-permission"><i class="fa-solid fa-clock"></i> ${s.permission_count}</span>
          </td>
          <td>
            <div style="display: flex; gap: 0.4rem;">
              <button class="btn btn-primary btn-sm" onclick="openAttendanceModal(${s.id})">
                <i class="fa-solid fa-clipboard-user"></i> ${t('takeAttendance')}
              </button>
              ${currentUser.role === 'admin' ? `
                <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="deleteSession(${s.id})">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
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
                <p style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(s.session_date)} | ${escapeHtml(s.session_time)}</p>
              </div>
              <span class="tag tag-category">${escapeHtml(s.category)}</span>
            </div>
            ${s.description ? `<p style="font-size: 0.85rem; color: #475569; margin-bottom: 0.6rem;">${escapeHtml(s.description)}</p>` : ''}
            
            <div style="display: flex; gap: 0.35rem; margin-bottom: 0.75rem;">
              <span class="tag tag-present"><i class="fa-solid fa-check"></i> ${s.present_count}</span>
              <span class="tag tag-absent"><i class="fa-solid fa-xmark"></i> ${s.absent_count}</span>
              <span class="tag tag-permission"><i class="fa-solid fa-clock"></i> ${s.permission_count}</span>
            </div>

            <div style="display: flex; gap: 0.5rem; border-top: 1px solid #f1f5f9; pt-2;">
              <button class="btn btn-primary btn-sm" style="flex: 1; justify-content: center;" onclick="openAttendanceModal(${s.id})">
                <i class="fa-solid fa-clipboard-user"></i> ${t('takeAttendance')}
              </button>
              ${currentUser.role === 'admin' ? `
                <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="deleteSession(${s.id})">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }
    });
  } catch (err) { }
}

function openCreateSessionModal() {
  document.getElementById('formSession').reset();
  // Default date to today
  document.getElementById('sessionDate').value = new Date().toISOString().split('T')[0];
  openModal('modalSession');
}

async function handleCreateSession(e) {
  e.preventDefault();
  const body = {
    course_title: document.getElementById('sessionCourseTitle').value,
    session_date: document.getElementById('sessionDate').value,
    session_time: document.getElementById('sessionTime').value,
    category: document.getElementById('sessionCategory').value,
    description: document.getElementById('sessionDescription').value
  };

  try {
    await api('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
    closeModal('modalSession');
    showToast('Session created successfully!', 'success');
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

  try {
    const data = await api(`/api/attendance/session/${sessionId}`);
    if (!data) return;

    activeSessionData = data;
    document.getElementById('attModalSessionTitle').textContent = `${data.session.course_title} (${data.session.category})`;
    document.getElementById('attModalSessionSubtitle').textContent = `${formatDate(data.session.session_date)} | ${data.session.session_time}`;
    document.getElementById('attSearchInput').value = '';

    // Initialize in-memory attendance record states
    data.students.forEach(s => {
      activeAttendanceRecords[s.student_id] = {
        status: s.attendance_status || 'present', // Default to present for convenience
        remarks: s.remarks || ''
      };
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
    return name.includes(filterText) || phone.includes(filterText);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No students found for this category.</div>`;
    return;
  }

  filtered.forEach(s => {
    const currentRec = activeAttendanceRecords[s.student_id] || { status: 'present', remarks: '' };
    const rowClass = `attendance-row marked-${currentRec.status}`;

    container.innerHTML += `
      <div class="${rowClass}" id="attRow_${s.student_id}">
        <div class="attendance-student-details">
          <h5>${escapeHtml(s.first_name)} ${escapeHtml(s.father_name)}</h5>
          <p><i class="fa-solid fa-phone"></i> ${escapeHtml(s.phone)} | ${t('motherName')}: ${escapeHtml(s.mother_name)}</p>
        </div>

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
      </div>
    `;
  });
}

function selectAttendanceStatus(studentId, status) {
  if (!activeAttendanceRecords[studentId]) {
    activeAttendanceRecords[studentId] = { status: 'present', remarks: '' };
  }
  activeAttendanceRecords[studentId].status = status;

  const row = document.getElementById(`attRow_${studentId}`);
  if (row) {
    row.className = `attendance-row marked-${status}`;
    const btns = row.querySelectorAll('.btn-toggle-att');
    btns.forEach(b => b.classList.remove('selected'));
    if (status === 'present') row.querySelector('.btn-present').classList.add('selected');
    if (status === 'absent') row.querySelector('.btn-absent').classList.add('selected');
    if (status === 'permission') row.querySelector('.btn-permission').classList.add('selected');
  }
}

function markAllPresent() {
  activeSessionData.students.forEach(s => {
    selectAttendanceStatus(s.student_id, 'present');
  });
  showToast(t('markAllPresent'), 'success');
}

function filterAttendanceList() {
  renderAttendanceStudentList();
}

async function saveAttendance() {
  const btn = document.getElementById('btnSaveAttendance');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('savingAttendance')}`;

  const records = Object.keys(activeAttendanceRecords).map(studentId => ({
    student_id: parseInt(studentId, 10),
    status: activeAttendanceRecords[studentId].status,
    remarks: activeAttendanceRecords[studentId].remarks || ''
  }));

  try {
    await api(`/api/attendance/session/${activeSessionId}`, {
      method: 'POST',
      body: JSON.stringify({ records })
    });

    closeModal('modalAttendance');
    showToast(t('saveAttendance') + ' ✓', 'success');
    loadSessions();
    if (currentUser.role === 'admin') load3AbsentAlerts();
  } catch (err) {
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> ${t('saveAttendance')}`;
  }
}

// ==========================================
// 3. STUDENTS DIRECTORY & REGISTRATION
// ==========================================
function debounceLoadStudents() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(loadStudents, 300);
}

async function loadStudents() {
  const category = document.getElementById('filterStudentCategory').value;
  const status = document.getElementById('filterStudentStatus').value;
  const search = document.getElementById('searchStudentInput').value;

  try {
    const students = await api(`/api/students?category=${category}&status=${status}&search=${encodeURIComponent(search)}`);
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

      // Desktop Table Row
      tbody.innerHTML += `
        <tr style="${isInactive ? 'opacity: 0.6;' : ''}">
          <td>
            <strong>${escapeHtml(s.first_name)} ${escapeHtml(s.father_name)}</strong>
          </td>
          <td>${escapeHtml(s.mother_name)}</td>
          <td><span class="tag tag-category">${escapeHtml(s.category)}</span></td>
          <td>${s.age}</td>
          <td>
            <a href="tel:${escapeHtml(s.phone)}" style="color: var(--primary); text-decoration: none; font-weight: 600;">
              <i class="fa-solid fa-phone"></i> ${escapeHtml(s.phone)}
            </a>
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
              ${currentUser.role === 'admin' ? `
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
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                  ${t('motherName')}: <strong>${escapeHtml(s.mother_name)}</strong> | ${t('age')}: ${s.age}
                </p>
              </div>
              <span class="tag tag-category">${escapeHtml(s.category)}</span>
            </div>

            <div style="margin-bottom: 0.75rem;">
              <a href="tel:${escapeHtml(s.phone)}" class="btn btn-outline btn-sm" style="width: 100%; justify-content: center; font-weight: 700; color: var(--primary);">
                <i class="fa-solid fa-phone"></i> ${escapeHtml(s.phone)}
              </a>
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
                ${currentUser.role === 'admin' ? `
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
  document.getElementById('modalStudentTitle').textContent = t('registerStudent');
  openModal('modalStudent');
}

async function openEditStudentModal(id) {
  try {
    const data = await api(`/api/students/${id}`);
    if (!data) return;

    const s = data.student;
    document.getElementById('studentEditId').value = s.id;
    document.getElementById('studentFirstName').value = s.first_name;
    document.getElementById('studentFatherName').value = s.father_name;
    document.getElementById('studentMotherName').value = s.mother_name;
    document.getElementById('studentAge').value = s.age;
    document.getElementById('studentPhone').value = s.phone;
    document.getElementById('studentEmergency').value = s.emergency_contact || '';
    document.getElementById('studentCategory').value = s.category;
    document.getElementById('studentProfession').value = s.profession || '';
    document.getElementById('studentPreviousService').value = s.previous_service || '';

    document.getElementById('modalStudentTitle').textContent = t('edit') + ': ' + s.first_name;
    openModal('modalStudent');
  } catch (err) { }
}

async function handleSaveStudent(e) {
  e.preventDefault();
  const id = document.getElementById('studentEditId').value;
  const body = {
    first_name: document.getElementById('studentFirstName').value,
    father_name: document.getElementById('studentFatherName').value,
    mother_name: document.getElementById('studentMotherName').value,
    age: document.getElementById('studentAge').value,
    phone: document.getElementById('studentPhone').value,
    emergency_contact: document.getElementById('studentEmergency').value,
    category: document.getElementById('studentCategory').value,
    profession: document.getElementById('studentProfession').value,
    previous_service: document.getElementById('studentPreviousService').value
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
    document.getElementById('profileStudentName').textContent = `${s.first_name} ${s.father_name}`;

    document.getElementById('profileDetailsCard').innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
        <div><strong>${t('motherName')}:</strong> ${escapeHtml(s.mother_name)}</div>
        <div><strong>${t('age')}:</strong> ${s.age}</div>
        <div><strong>${t('category')}:</strong> <span class="tag tag-category">${escapeHtml(s.category)}</span></div>
        <div><strong>${t('phone')}:</strong> <a href="tel:${escapeHtml(s.phone)}">${escapeHtml(s.phone)}</a></div>
        <div><strong>${t('emergencyContact')}:</strong> <a href="tel:${escapeHtml(s.emergency_contact)}">${escapeHtml(s.emergency_contact || 'N/A')}</a></div>
        <div><strong>${t('profession')}:</strong> ${escapeHtml(s.profession || 'N/A')}</div>
        <div><strong>${t('previousService')}:</strong> ${escapeHtml(s.previous_service || 'N/A')}</div>
        <div>
          <strong>${t('status')}:</strong> 
          <span class="tag ${s.status === 'active' ? 'tag-present' : 'tag-absent'}">${s.status}</span>
          ${currentUser.role === 'admin' ? `
            <button class="btn btn-outline btn-sm" style="margin-left: 0.5rem;" onclick="toggleStudentStatus(${s.id}, '${s.status}')">
              ${s.status === 'active' ? t('deactivate') : t('activate')}
            </button>
          ` : ''}
        </div>
      </div>
    `;

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
    const container = document.getElementById('alertsContainer');

    if (!alerts || alerts.length === 0) {
      badge.style.display = 'none';
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

    badge.style.display = 'inline-block';
    badge.textContent = alerts.length;

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
      tbody.innerHTML += `
        <tr>
          <td><strong>${escapeHtml(u.full_name)}</strong></td>
          <td>${escapeHtml(u.username)}</td>
          <td><span class="tag ${u.role === 'admin' ? 'tag-category' : 'tag-permission'}">${u.role === 'admin' ? t('adminRole') : t('encoderRole')}</span></td>
          <td>${formatDate(u.created_at)}</td>
          <td>
            ${u.id !== currentUser.id ? `
              <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="deleteUser(${u.id})">
                <i class="fa-solid fa-trash"></i>
              </button>
            ` : `<small style="color: var(--text-muted);">(You)</small>`}
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

  const category = document.getElementById('filterStudentCategory').value;
  const status = document.getElementById('filterStudentStatus').value;
  const search = document.getElementById('searchStudentInput').value;
  const isAmharic = currentLang === 'am';

  try {
    const students = await api(`/api/students?category=${category}&status=${status}&search=${encodeURIComponent(search)}`);
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



// Category Matrix & Excel Export Logic
function isSessionBeforeRegistration(sessionDateStr, studentCreatedAtStr) {
  if (!sessionDateStr || !studentCreatedAtStr) return false;
  try {
    const sessDay = new Date(sessionDateStr).toISOString().split('T')[0];
    const regDay = new Date(studentCreatedAtStr).toISOString().split('T')[0];
    return sessDay < regDay;
  } catch (e) {
    return false;
  }
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
    if (attendance) {
      attendance.forEach(a => {
        attMap[`${a.session_id}_${a.student_id}`] = a;
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
        let val = '-';
        let color = '#94a3b8';

        if (att) {
          if (att.status === 'present') {
            val = '✓';
            color = 'var(--success)';
          } else if (att.status === 'absent') {
            val = '✗';
            color = 'var(--danger)';
          } else if (att.status === 'permission') {
            val = isAmharic ? 'ፈ' : 'P';
            color = 'var(--warning)';
          }
        } else if (!isSessionBeforeRegistration(sess.session_date, s.created_at)) {
          val = '✗';
          color = 'var(--danger)';
        }

        html += `<td style="text-align: center; font-weight: bold; color: ${color}; font-size: 1.1rem;">${val}</td>`;
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
    if (attendance) {
      attendance.forEach(a => {
        attMap[`${a.session_id}_${a.student_id}`] = a;
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

        if (att) {
          if (att.status === 'present') {
            row[colHeader] = '✓';
            presentCount++;
          } else if (att.status === 'absent') {
            row[colHeader] = '✗';
            absentCount++;
          } else if (att.status === 'permission') {
            row[colHeader] = isAmharic ? 'ፈ' : 'P';
            permissionCount++;
          }
        } else if (isSessionBeforeRegistration(sess.session_date, s.created_at)) {
          row[colHeader] = '-';
        } else {
          row[colHeader] = '✗';
          absentCount++;
        }
      });

      row[isAmharic ? 'የተገኘበት ብዛት' : 'Total Present'] = presentCount;
      row[isAmharic ? 'የቀረበት ብዛት' : 'Total Absent'] = absentCount;
      row[isAmharic ? 'በፈቃድ የቀረ' : 'Total Permission'] = permissionCount;

      const totalApplicableSessions = sessions.filter(sess => !isSessionBeforeRegistration(sess.session_date, s.created_at)).length;
      const rate = totalApplicableSessions > 0 ? Math.round((presentCount / totalApplicableSessions) * 100) : 0;
      row[isAmharic ? 'የመገኘት %' : 'Attendance %'] = `${rate}%`;

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

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
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

