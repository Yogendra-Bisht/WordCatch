/**
 * WordCatch Popup JS
 *
 * Responsibilities (SRS §3.1):
 *   ✓ Render auth forms and vocab cheat sheet
 *   ✓ Communicate with service worker via chrome.runtime.sendMessage
 *   ✗ MUST NOT call the backend directly
 */

// ── Element refs ──────────────────────────────────────────────────────────────
const authPanel   = document.getElementById('auth-panel');
const vocabPanel  = document.getElementById('vocab-panel');
const authBadge   = document.getElementById('auth-status');

const authForm    = document.getElementById('auth-form');
const emailInput  = document.getElementById('input-email');
const passInput   = document.getElementById('input-password');
const authSubmit  = document.getElementById('auth-submit');
const authError   = document.getElementById('auth-error');

const tabLogin    = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');

const vocabList   = document.getElementById('vocab-list');
const filterFrom  = document.getElementById('filter-from');
const filterTo    = document.getElementById('filter-to');
const filterApply = document.getElementById('filter-apply');
const filterClear = document.getElementById('filter-clear');
const btnLogout   = document.getElementById('btn-logout');

// ── State ─────────────────────────────────────────────────────────────────────
let currentMode = 'login'; // 'login' | 'register'

// ── SW message wrapper ────────────────────────────────────────────────────────
function sw(message) {
  return chrome.runtime.sendMessage(message);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const res = await sw({ type: 'GET_AUTH_STATUS' });
  if (res?.ok && res.data.isLoggedIn) {
    showVocabPanel();
  } else {
    showAuthPanel();
  }
}

// ── Panel visibility ──────────────────────────────────────────────────────────
function showAuthPanel() {
  authPanel.classList.remove('hidden');
  vocabPanel.classList.add('hidden');
  authBadge.textContent = 'Not signed in';
  authBadge.className   = 'auth-badge';
}

function showVocabPanel() {
  authPanel.classList.add('hidden');
  vocabPanel.classList.remove('hidden');
  authBadge.textContent = '✓ Signed in';
  authBadge.className   = 'auth-badge logged-in';
  loadVocab();
}

// ── Auth tab switching ────────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  authSubmit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
  passInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  tabLogin.classList.toggle('active',    mode === 'login');
  tabRegister.classList.toggle('active', mode === 'register');
  clearAuthError();
}

tabLogin.addEventListener('click',    () => setMode('login'));
tabRegister.addEventListener('click', () => setMode('register'));

// ── Auth form submit ──────────────────────────────────────────────────────────
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthError();

  const email    = emailInput.value.trim();
  const password = passInput.value;

  if (!email || !password) {
    showAuthError('Please fill in all fields.');
    return;
  }

  authSubmit.disabled    = true;
  authSubmit.textContent = currentMode === 'login' ? 'Signing in…' : 'Creating account…';

  const msgType = currentMode === 'login' ? 'LOGIN' : 'REGISTER';
  const res = await sw({ type: msgType, email, password });

  authSubmit.disabled    = false;
  authSubmit.textContent = currentMode === 'login' ? 'Sign in' : 'Create account';

  if (res?.ok) {
    showVocabPanel();
  } else {
    showAuthError(res?.error?.message ?? 'Authentication failed. Please try again.');
  }
});

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

function clearAuthError() {
  authError.textContent = '';
  authError.classList.add('hidden');
}

// ── Logout ────────────────────────────────────────────────────────────────────
btnLogout.addEventListener('click', async () => {
  await sw({ type: 'LOGOUT' });
  showAuthPanel();
});

// ── Vocab loading ─────────────────────────────────────────────────────────────
async function loadVocab(from, to) {
  vocabList.innerHTML = `
    <div class="loading-state"><span class="spinner"></span> Loading…</div>
  `;

  const res = await sw({ type: 'GET_VOCAB', from, to });

  if (!res?.ok) {
    if (res?.error?.code === 'NO_TOKEN') {
      showAuthPanel();
      return;
    }
    vocabList.innerHTML = `
      <div class="empty-state">Failed to load vocabulary.<br>
        <small>${escHtml(res?.error?.message ?? '')}</small>
      </div>`;
    return;
  }

  const { grouped, total } = res.data;

  if (total === 0) {
    vocabList.innerHTML = `
      <div class="empty-state">
        No words saved yet.<br>
        <small>Double-click any word on a webpage to capture it.</small>
      </div>`;
    return;
  }

  // Sort dateKeys newest first
  const sortedKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  vocabList.innerHTML = sortedKeys.map((dateKey) => {
    const entries = grouped[dateKey];
    const label   = formatDateKey(dateKey);
    const cards   = entries.map(renderCard).join('');
    return `
      <div class="day-group">
        <div class="day-header">${escHtml(label)} <span style="color:var(--border);font-weight:400">(${entries.length})</span></div>
        ${cards}
      </div>`;
  }).join('');

  // Attach delete handlers
  vocabList.querySelectorAll('.vocab-del-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });

  // Attach source URL handlers — open in new tab (FR-5.3)
  vocabList.querySelectorAll('.vocab-source').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: link.dataset.url });
    });
  });
}

function renderCard(entry) {
  const word    = entry.wordId?.word ?? entry.capturedForm ?? '—';
  const wordDoc = entry.wordId;
  const pos     = wordDoc?.meanings?.[0]?.partOfSpeech ?? '';
  const def     = wordDoc?.meanings?.[0]?.definitions?.[0]?.definition ?? '';
  const ctx     = entry.sentenceContext ? `"${entry.sentenceContext.slice(0, 80)}…"` : '';
  const url     = entry.sourceUrl || '';

  // Display a truncated hostname when a source URL is available (FR-5.3)
  let sourceHtml = '';
  if (url) {
    let displayUrl;
    try { displayUrl = new URL(url).hostname; } catch { displayUrl = url.slice(0, 30); }
    sourceHtml = `<a class="vocab-source" href="${escHtml(url)}" data-url="${escHtml(url)}" title="${escHtml(url)}">↗ ${escHtml(displayUrl)}</a>`;
  }

  return `
    <div class="vocab-card">
      <div class="vocab-card-body">
        <div class="vocab-word">${escHtml(entry.capturedForm || word)}</div>
        ${pos ? `<div class="vocab-pos">${escHtml(pos)}</div>` : ''}
        ${def ? `<div class="vocab-def">${escHtml(def)}</div>` : '<div class="vocab-def" style="color:var(--border);font-style:italic">No definition</div>'}
        ${ctx ? `<div class="vocab-context">${escHtml(ctx)}</div>` : ''}
        ${sourceHtml}
      </div>
      <button class="vocab-del-btn" data-id="${entry._id}" title="Remove" aria-label="Remove ${escHtml(word)}">✕</button>
    </div>`;
}

async function handleDelete(id) {
  const res = await sw({ type: 'DELETE_ENTRY', id });
  if (res?.ok) {
    // Re-render current filter
    const from = filterFrom.value || undefined;
    const to   = filterTo.value   || undefined;
    loadVocab(from, to);
  }
}

// ── Filters ───────────────────────────────────────────────────────────────────
filterApply.addEventListener('click', () => {
  loadVocab(filterFrom.value || undefined, filterTo.value || undefined);
});

filterClear.addEventListener('click', () => {
  filterFrom.value = '';
  filterTo.value   = '';
  loadVocab();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDateKey(dateKey) {
  // dateKey is YYYY-MM-DD; display as "Mon, 21 Sep 2026" or "Today"
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  if (dateKey === todayKey) return 'Today';

  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
