/**
 * WordCatch Content Script
 *
 * Responsibilities (SRS §3.1):
 *   ✓ Listen for dblclick on body text
 *   ✓ Extract single-word selection + sentence context
 *   ✓ Render tooltip in a closed Shadow DOM root
 *   ✗ MUST NOT call the backend
 *   ✗ MUST NOT hold or receive the JWT
 *   ✗ MUST NOT write to chrome.storage
 *
 * All network work is delegated to the service worker via
 * chrome.runtime.sendMessage (FR-1.6).
 */

// ── Shadow DOM host ──────────────────────────────────────────────────────────
const HOST_ID = '__wordcatch_host__';

function getOrCreateHost() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    // Position off-screen until we place the tooltip
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(host);
  }
  return host;
}

// Closed shadow root so host-page JS cannot reach in (FR-7.1)
let _shadow = null;
function getShadow() {
  if (_shadow) return _shadow;
  const host = getOrCreateHost();
  _shadow = host.attachShadow({ mode: 'closed' });
  _shadow.innerHTML = `
    <style>
      :host { all: initial; }
      #wc-tooltip {
        --bg: #1e1e2e;
        --border: #6c63ff;
        --text: #cdd6f4;
        --muted: #a6adc8;
        --accent: #6c63ff;
        --save-bg: #6c63ff;
        --save-hover: #7c73ff;
        --del: #f38ba8;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: 12px;
        padding: 14px 16px 12px;
        max-width: 340px;
        min-width: 220px;
        color: var(--text);
        box-shadow: 0 8px 32px rgba(0,0,0,0.45);
        pointer-events: all;
        animation: wc-pop 0.18s cubic-bezier(.175,.885,.32,1.275) both;
      }
      @keyframes wc-pop {
        from { opacity:0; transform:scale(0.88) translateY(6px); }
        to   { opacity:1; transform:scale(1)    translateY(0);   }
      }
      #wc-tooltip.wc-hiding {
        animation: wc-pop 0.12s cubic-bezier(.6,0,.8,1) reverse both;
      }
      .wc-word {
        font-size: 17px;
        font-weight: 700;
        color: #fff;
        margin-bottom: 2px;
        letter-spacing: -0.01em;
      }
      .wc-pos {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--accent);
        margin-bottom: 8px;
        font-weight: 600;
      }
      .wc-def {
        color: var(--text);
        margin-bottom: 4px;
      }
      .wc-example {
        color: var(--muted);
        font-style: italic;
        font-size: 12.5px;
        margin-bottom: 10px;
        padding-left: 8px;
        border-left: 2px solid var(--border);
      }
      .wc-not-found {
        color: var(--del);
        font-style: italic;
        margin-bottom: 10px;
      }
      .wc-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }
      .wc-btn {
        flex: 1;
        border: none;
        border-radius: 7px;
        padding: 6px 10px;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s, transform 0.1s;
      }
      .wc-btn:active { transform: scale(0.96); }
      .wc-btn-save {
        background: var(--save-bg);
        color: #fff;
      }
      .wc-btn-save:hover { background: var(--save-hover); }
      .wc-btn-save:disabled {
        background: #44475a;
        color: #6272a4;
        cursor: default;
      }
      .wc-btn-close {
        background: #313244;
        color: var(--muted);
      }
      .wc-btn-close:hover { background: #45475a; }
      .wc-spinner {
        display: inline-block;
        width: 16px; height: 16px;
        border: 2px solid #44475a;
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: wc-spin 0.7s linear infinite;
        vertical-align: middle;
        margin-right: 6px;
      }
      @keyframes wc-spin { to { transform: rotate(360deg); } }
      .wc-status {
        font-size: 12px;
        color: var(--muted);
        margin-top: 4px;
        min-height: 16px;
      }
      .wc-status.wc-ok  { color: #a6e3a1; }
      .wc-status.wc-err { color: var(--del); }
    </style>
    <div id="wc-tooltip" role="dialog" aria-modal="false" aria-label="WordCatch definition"></div>
  `;
  return _shadow;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractSentence(node) {
  // Walk up to a block element and grab its innerText, capped at 200 chars
  let el = node;
  const blocks = new Set(['P','LI','TD','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','DIV','SPAN','ARTICLE','SECTION']);
  while (el && el.nodeType === Node.ELEMENT_NODE && !blocks.has(el.tagName)) {
    el = el.parentElement;
  }
  const text = (el?.innerText || document.body.innerText || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 200);
}

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  let node = el;
  while (node) {
    if (node.contentEditable === 'true') return true;
    node = node.parentElement;
  }
  return false;
}

function getDateKey() {
  // YYYY-MM-DD in the user's local timezone (FR-4.4)
  const d = new Date();
  const yr  = d.getFullYear();
  const mo  = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${day}`;
}

// ── Tooltip rendering ─────────────────────────────────────────────────────────

let dismissTimer = null;
let currentTooltip = null;

function dismissTooltip() {
  clearTimeout(dismissTimer);
  const shadow = getShadow();
  const tip = shadow.getElementById('wc-tooltip');
  if (!tip) return;
  tip.classList.add('wc-hiding');
  setTimeout(() => {
    tip.innerHTML = '';
    tip.classList.remove('wc-hiding');
    getOrCreateHost().style.cssText = 'all:initial;position:fixed;z-index:2147483647;pointer-events:none;';
  }, 130);
  currentTooltip = null;
}

function positionHost(anchorRect) {
  const host = getOrCreateHost();
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;pointer-events:none;';

  const MARGIN = 8;
  let top = anchorRect.bottom + MARGIN;
  let left = anchorRect.left;

  // Clamp to viewport
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const TIP_W = 340;
  const TIP_H = 200; // estimate

  if (left + TIP_W > vpW - MARGIN) left = vpW - TIP_W - MARGIN;
  if (left < MARGIN) left = MARGIN;
  if (top + TIP_H > vpH - MARGIN) top = anchorRect.top - TIP_H - MARGIN;

  host.style.cssText = `all:initial;position:fixed;z-index:2147483647;pointer-events:none;top:${top}px;left:${left}px;`;
}

function showLoadingTooltip(word, anchorRect) {
  positionHost(anchorRect);
  const shadow = getShadow();
  const tip = shadow.getElementById('wc-tooltip');
  tip.innerHTML = `
    <div class="wc-word">${escHtml(word)}</div>
    <div class="wc-def"><span class="wc-spinner"></span>Looking up…</div>
    <div class="wc-actions">
      <button class="wc-btn wc-btn-close" id="wc-close">Dismiss</button>
    </div>
  `;
  tip.querySelector('#wc-close').addEventListener('click', dismissTooltip);
}

function showDefinitionTooltip(data, capturedForm, sentence, anchorRect) {
  positionHost(anchorRect);
  const shadow = getShadow();
  const tip = shadow.getElementById('wc-tooltip');

  const { found, meanings } = data;
  const displayWord = capturedForm;

  let bodyHtml = '';
  if (!found || !meanings || meanings.length === 0) {
    bodyHtml = `<div class="wc-not-found">No definition found for "<em>${escHtml(displayWord)}</em>".</div>`;
  } else {
    const m = meanings[0];
    const d = m.definitions?.[0];
    bodyHtml = `
      <div class="wc-pos">${escHtml(m.partOfSpeech)}</div>
      <div class="wc-def">${escHtml(d?.definition ?? '')}</div>
      ${d?.example ? `<div class="wc-example">"${escHtml(d.example)}"</div>` : ''}
    `;
  }

  tip.innerHTML = `
    <div class="wc-word">${escHtml(displayWord)}</div>
    ${bodyHtml}
    <div class="wc-status" id="wc-status"></div>
    <div class="wc-actions">
      <button class="wc-btn wc-btn-save" id="wc-save">Save to vocab</button>
      <button class="wc-btn wc-btn-close" id="wc-close">Dismiss</button>
    </div>
  `;

  tip.querySelector('#wc-close').addEventListener('click', dismissTooltip);
  tip.querySelector('#wc-save').addEventListener('click', () => {
    handleSave(data, capturedForm, sentence, anchorRect);
  });

  // Auto-dismiss after 12 seconds (FR-7.3)
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(dismissTooltip, 12000);
}

function showErrorTooltip(message) {
  const shadow = getShadow();
  const tip = shadow.getElementById('wc-tooltip');
  tip.innerHTML = `
    <div class="wc-not-found">${escHtml(message)}</div>
    <div class="wc-actions">
      <button class="wc-btn wc-btn-close" id="wc-close">Dismiss</button>
    </div>
  `;
  tip.querySelector('#wc-close').addEventListener('click', dismissTooltip);
}

async function handleSave(data, capturedForm, sentence, anchorRect) {
  const shadow = getShadow();
  const saveBtn = shadow.getElementById('wc-save');
  const status  = shadow.getElementById('wc-status');

  if (!saveBtn || !status) return;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const dateKey = getDateKey();

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type:            'SAVE',
      word:            capturedForm,
      wordId:          data.wordId,
      capturedForm,
      sentence,
      url:             window.location.href,
      dateKey,
    });
  } catch (e) {
    status.textContent = 'Extension context disconnected. Please refresh the web page.';
    status.className   = 'wc-status wc-err';
    saveBtn.disabled   = false;
    saveBtn.textContent = 'Retry save';
    return;
  }

  if (response?.ok) {
    saveBtn.textContent = '✓ Saved';
    status.textContent  = 'Added to today\'s vocab!';
    status.className    = 'wc-status wc-ok';
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(dismissTooltip, 2500);
  } else {
    const msg = response?.error?.code === 'NO_TOKEN'
      ? 'Please log in via the WordCatch popup first.'
      : (response?.error?.message ?? 'Save failed, please try again.');
    status.textContent = msg;
    status.className   = 'wc-status wc-err';
    saveBtn.disabled   = false;
    saveBtn.textContent = 'Retry save';
  }
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Double-click handler ──────────────────────────────────────────────────────

document.addEventListener('dblclick', async (e) => {
  try {
    // FR-1.5 — ignore editable regions
    if (isEditableTarget(e.target)) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const raw = selection.toString().trim();

    // FR-1.3 — single word only (no spaces, not empty)
    if (!raw || /\s/.test(raw)) return;

    // Strip leading/trailing punctuation (FR-1.2)
    const word = raw.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
    if (!word) return;

    const range    = selection.getRangeAt(0);
    const anchorRect = range.getBoundingClientRect();
    const sentence = extractSentence(e.target);

    currentTooltip = word;
    showLoadingTooltip(word, anchorRect);

    // FR-1.6 — delegate to service worker, no direct fetch here
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type:     'LOOKUP',
        word,
        sentence,
        url:      window.location.href,
      });
    } catch (err) {
      if (currentTooltip !== word) return;
      showErrorTooltip('Extension context disconnected. Please refresh this page (F5).');
      return;
    }

    // Guard against stale response if user double-clicked again
    if (currentTooltip !== word) return;

    if (response?.ok) {
      showDefinitionTooltip(response.data, word, sentence, anchorRect);
    } else {
      const msg = response?.error?.code === 'NO_TOKEN'
        ? 'Sign in to WordCatch via extension popup to look up words.'
        : (response?.error?.message ?? 'Lookup failed.');
      showErrorTooltip(msg);
    }
  } catch (globalErr) {
    console.warn('[WordCatch] Ignored selection error:', globalErr);
  }
});

// FR-7.3 — dismiss on outside click or Escape
document.addEventListener('click', (e) => {
  if (!currentTooltip) return;
  const host = document.getElementById(HOST_ID);
  if (host && !host.contains(e.target)) dismissTooltip();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentTooltip) dismissTooltip();
});
