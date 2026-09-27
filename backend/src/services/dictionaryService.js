/**
 * Dictionary service (SRS FR-3.1 – FR-3.5).
 *
 * Performance design:
 *   - Cache check: single $in query across all candidates (1 DB round-trip)
 *   - API lookup: Free Dictionary API and Datamuse are raced in parallel —
 *     whichever responds first wins, cutting worst-case wait from 10 s → 2 s
 *   - Timeouts: 2 s per API call (primary + fallback run concurrently)
 *   - Negative cache: only written on definitive 404s, never on 5xx/timeouts
 *
 * Uses Node.js built-in fetch (Node 18+).
 */

const Word   = require('../models/Word');
const { normalise, fallbacks } = require('./normalisationService');

const FREE_DICT_BASE  = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const DATAMUSE_BASE   = 'https://api.datamuse.com/words';
const API_TIMEOUT_MS  = 2000; // per-request timeout
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-try not-found after 7 days

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeController() {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
}

// ── Primary: Free Dictionary API ──────────────────────────────────────────────

/**
 * Returns { meanings, definitive }
 *   meanings    — array on success, null otherwise
 *   definitive  — true=404 (word absent), false=transient error (don't cache)
 */
async function fetchFromFreeDictAPI(candidate) {
  const { signal, clear } = makeController();
  try {
    const res = await fetch(
      `${FREE_DICT_BASE}/${encodeURIComponent(candidate)}`,
      { signal }
    );
    clear();

    if (res.status === 404) return { meanings: null, definitive: true };
    if (!res.ok)            return { meanings: null, definitive: false };

    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) {
      return { meanings: null, definitive: true };
    }

    const meanings = json
      .flatMap((e) => e.meanings ?? [])
      .map((m) => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions ?? []).slice(0, 5).map((d) => ({
          definition: d.definition ?? '',
          example:    d.example   ?? '',
        })),
      }));

    return { meanings: meanings.length > 0 ? meanings : null, definitive: true };
  } catch {
    clear();
    return { meanings: null, definitive: false }; // timeout / network error
  }
}

// ── Fallback: Datamuse API ────────────────────────────────────────────────────

const DATAMUSE_POS = {
  n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb',
  u: 'unknown', r: 'adverb', prep: 'preposition', conj: 'conjunction',
};

async function fetchFromDatamuse(candidate) {
  const { signal, clear } = makeController();
  try {
    const res = await fetch(
      `${DATAMUSE_BASE}?sp=${encodeURIComponent(candidate)}&md=dp&max=1`,
      { signal }
    );
    clear();

    if (!res.ok) return null;

    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;

    const entry = json[0];
    // Datamuse spell-matches — confirm exact word match
    if (!entry || entry.word !== candidate) return null;

    const defs = entry.defs ?? [];
    if (defs.length === 0) return null;

    const byPos = {};
    for (const def of defs) {
      const tab = def.indexOf('\t');
      if (tab === -1) continue;
      const pos    = DATAMUSE_POS[def.slice(0, tab).trim()] ?? def.slice(0, tab).trim();
      const text   = def.slice(tab + 1).trim();
      (byPos[pos] ??= []).push({ definition: text, example: '' });
    }

    const meanings = Object.entries(byPos).map(([partOfSpeech, definitions]) => ({
      partOfSpeech,
      definitions: definitions.slice(0, 5),
    }));

    return meanings.length > 0 ? meanings : null;
  } catch {
    clear();
    return null;
  }
}

// ── Race both APIs simultaneously ─────────────────────────────────────────────

/**
 * Races Free Dictionary API and Datamuse in parallel.
 * Returns { meanings, definitive } — meanings=null if both fail.
 * definitive=false if neither gave a clear 404 (transient failures).
 */
async function fetchFromAnyAPI(candidate) {
  // Start both requests at the same time
  const freeDictPromise = fetchFromFreeDictAPI(candidate);
  const datamusePromise = fetchFromDatamuse(candidate);

  // Take the first successful result
  return new Promise((resolve) => {
    let settled     = false;
    let pending      = 2;
    let anyDefinite404 = false;

    function tryResolve(result) {
      if (settled) return;

      // If this source returned meanings, we're done
      if (result.meanings) {
        settled = true;
        resolve({ meanings: result.meanings, definitive: true });
        return;
      }

      if (result.definitive) anyDefinite404 = true;
      pending--;

      // Both finished with no result
      if (pending === 0) {
        settled = true;
        resolve({ meanings: null, definitive: anyDefinite404 });
      }
    }

    // Wrap Datamuse to match the { meanings, definitive } shape
    freeDictPromise.then(tryResolve);
    datamusePromise.then((m) => tryResolve({ meanings: m, definitive: false }));
  });
}

// ── Main lookup ───────────────────────────────────────────────────────────────

async function lookupWord(capturedForm) {
  const lemma      = normalise(capturedForm);
  const candidates = fallbacks(lemma);

  // ── 1. Batch cache check (single DB query) ─────────────────────────────────
  const cached = await Word.find({ word: { $in: candidates } }).lean();

  // Build a map for O(1) lookup and respect the candidate priority order
  const cacheMap = Object.fromEntries(cached.map((w) => [w.word, w]));

  for (const candidate of candidates) {
    const doc = cacheMap[candidate];
    if (!doc) continue;

    // Skip stale negative entries so they get re-tried
    if (!doc.found) {
      const age = Date.now() - new Date(doc.fetchedAt).getTime();
      if (age > NEGATIVE_TTL_MS) continue;
    }
    return { wordDoc: doc, resolvedLemma: candidate };
  }

  // ── 2. Cache miss — race both APIs for each candidate ─────────────────────
  // Try candidates in priority order; most words resolve on the first candidate
  let anyTransientFailure = false;

  for (const candidate of candidates) {
    const { meanings, definitive } = await fetchFromAnyAPI(candidate);

    if (meanings) {
      return await savePositive(candidate, meanings,
        // tag which source won (already resolved inside fetchFromAnyAPI)
        'dictionary-api');
    }

    if (!definitive) anyTransientFailure = true;
  }

  // ── 3. All candidates failed ───────────────────────────────────────────────
  if (anyTransientFailure) {
    // Transient outage — return not-found without caching so next attempt retries
    return { wordDoc: { found: false, meanings: [], _id: null, word: lemma }, resolvedLemma: lemma };
  }

  // Definitive not-found — write negative cache entry
  const wordDoc = await Word.findOneAndUpdate(
    { word: lemma },
    { word: lemma, found: false, meanings: [], source: 'dictionary-api', fetchedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { wordDoc, resolvedLemma: lemma };
}

async function savePositive(candidate, meanings, source) {
  const wordDoc = await Word.findOneAndUpdate(
    { word: candidate },
    { word: candidate, found: true, meanings, source, fetchedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { wordDoc, resolvedLemma: candidate };
}

module.exports = { lookupWord };
