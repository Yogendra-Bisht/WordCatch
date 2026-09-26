/**
 * WordCatch Service Worker (MV3 background context)
 *
 * Responsibilities (SRS §3.1):
 *   ✓ All fetch() calls to the backend
 *   ✓ JWT custody — stored in chrome.storage.local, never sent to content script
 *   ✓ Token attachment on outbound requests
 *   ✓ Handle 401s — clear token, signal re-auth
 *   ✓ Message routing from content script and popup
 *   ✗ MUST NOT assume module-scope variables survive between events (NFR-8)
 *
 * Every invocation reads auth state fresh from chrome.storage (§3.4).
 */

const API_BASE = 'http://localhost:3000'; // DEV: swap to https://your-domain.com for production

// ── Storage helpers ───────────────────────────────────────────────────────────

async function getToken() {
  const { wc_token } = await chrome.storage.local.get('wc_token');
  return wc_token ?? null;
}

async function setToken(token) {
  await chrome.storage.local.set({ wc_token: token });
}

async function clearToken() {
  await chrome.storage.local.remove('wc_token');
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function ok(data) {
  return { ok: true, data };
}

function err(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Authenticated fetch wrapper.
 * Attaches Bearer token, parses JSON response envelope,
 * handles 401 by clearing token and returning NO_TOKEN error.
 */
async function apiFetch(path, options = {}) {
  const token = await getToken();

  if (!token) {
    return err('NO_TOKEN', 'You are not logged in. Please sign in via the WordCatch popup.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers ?? {}),
  };

  let response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
  } catch (e) {
    return err('NETWORK_ERROR', 'Could not reach the WordCatch server. Ensure npm run dev is running.');
  }

  // Handle 401 — clear token, signal re-auth (FR-6.4)
  if (response.status === 401) {
    await clearToken();
    return err('NO_TOKEN', 'Session expired. Please sign in again.');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return err('PARSE_ERROR', 'Unexpected response from server.');
  }

  return body; // already in { ok, data/error } envelope shape
}

/**
 * Unauthenticated fetch — used only for login / register.
 */
async function publicFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  let response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
  } catch {
    return err('NETWORK_ERROR', 'Could not reach the WordCatch server. Ensure npm run dev is running.');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return err('PARSE_ERROR', 'Unexpected response from server.');
  }
  return body;
}

// ── Message handlers ──────────────────────────────────────────────────────────

async function handleLookup({ word, sentence, url }) {
  if (!word) return err('MISSING_WORD', 'No word provided.');
  return apiFetch('/api/words/lookup', {
    method: 'POST',
    body: JSON.stringify({ word, sentence, url }),
  });
}

async function handleSave({ word, wordId, capturedForm, sentence, url, dateKey }) {
  return apiFetch('/api/words/save', {
    method: 'POST',
    body: JSON.stringify({ word, wordId, capturedForm, sentenceContext: sentence, sourceUrl: url, dateKey }),
  });
}

async function handleGetVocab({ from, to } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to)   params.set('to',   to);
  const qs = params.toString();
  return apiFetch(`/api/words${qs ? `?${qs}` : ''}`);
}

async function handleDeleteEntry({ id }) {
  if (!id) return err('MISSING_ID', 'No entry ID provided.');
  return apiFetch(`/api/words/${id}`, { method: 'DELETE' });
}

async function handleLogin({ email, password }) {
  if (!email || !password) return err('MISSING_FIELDS', 'Email and password are required.');
  const result = await publicFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (result.ok && result.data?.token) {
    await setToken(result.data.token);
  }
  return result;
}

async function handleRegister({ email, password }) {
  if (!email || !password) return err('MISSING_FIELDS', 'Email and password are required.');
  const result = await publicFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (result.ok && result.data?.token) {
    await setToken(result.data.token);
  }
  return result;
}

async function handleLogout() {
  await clearToken();
  return ok({ loggedOut: true });
}

async function handleGetAuthStatus() {
  const token = await getToken();
  return ok({ isLoggedIn: !!token });
}

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const dispatch = async () => {
    try {
      switch (message.type) {
        case 'LOOKUP':          return await handleLookup(message);
        case 'SAVE':            return await handleSave(message);
        case 'GET_VOCAB':       return await handleGetVocab(message);
        case 'DELETE_ENTRY':    return await handleDeleteEntry(message);
        case 'LOGIN':           return await handleLogin(message);
        case 'REGISTER':        return await handleRegister(message);
        case 'LOGOUT':          return await handleLogout();
        case 'GET_AUTH_STATUS': return await handleGetAuthStatus();
        default:
          return err('UNKNOWN_TYPE', `Unknown message type: ${message.type}`);
      }
    } catch (e) {
      console.error('[WordCatch SW] Unhandled error:', e);
      return err('SERVER_ERROR', 'An unexpected error occurred in the extension.');
    }
  };

  // Return true to keep the message channel open for the async response
  dispatch().then(sendResponse);
  return true;
});
