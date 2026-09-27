/**
 * Dictionary service (SRS FR-3.1 – FR-3.5).
 *
 * Responsibilities:
 *   1. Check the `words` cache collection (cache hit → return immediately)
 *   2. On cache miss, walk the fallback ladder from normalisationService
 *   3. Try Primary API (Free Dictionary API), then Fallback API (Datamuse)
 *   4. On success, write a positive cache entry and return it
 *   5. Only write a negative cache entry (found: false) when a word is
 *      genuinely not found (404), NOT on 5xx/network errors (transient outage)
 *
 * The external API is consumed server-side only (SRS §7).
 * Uses Node.js built-in fetch (stable since Node 18 — no external dependency needed).
 */

// Node v18+ has fetch built-in globally — no import needed.

const Word   = require('../models/Word');
const { normalise, fallbacks } = require('./normalisationService');

// ── API endpoints ─────────────────────────────────────────────────────────────
const FREE_DICT_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const DATAMUSE_BASE  = 'https://api.datamuse.com/words';

// Negative cache TTL: re-try genuinely-not-found words after 7 days
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Primary: Free Dictionary API ──────────────────────────────────────────────

/**
 * Fetch from the Free Dictionary API.
 * Returns { meanings, definitive } where:
 *   meanings   — array of meaning objects on success, null otherwise
 *   definitive — true if the API gave a clear 404 (word genuinely not found)
 *                false if it was a network/5xx error (transient — don't cache)
 */
async function fetchFromFreeDictAPI(candidate) {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      `${FREE_DICT_BASE}/${encodeURIComponent(candidate)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (res.status === 404) {
      return { meanings: null, definitive: true };   // word not in this dictionary
    }
    if (!res.ok) {
      return { meanings: null, definitive: false };  // 5xx / outage — don't cache
    }

    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) {
      return { meanings: null, definitive: true };
    }

    const meanings = json
      .flatMap((entry) => entry.meanings ?? [])
      .map((m) => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions ?? []).slice(0, 5).map((d) => ({
          definition: d.definition ?? '',
          example:    d.example   ?? '',
        })),
      }));

    return { meanings: meanings.length > 0 ? meanings : null, definitive: true };
  } catch {
    return { meanings: null, definitive: false }; // network error / timeout
  }
}

// ── Fallback: Datamuse API ────────────────────────────────────────────────────

/**
 * Fetch from Datamuse as a fallback.
 * Datamuse /words?sp=<word>&md=dp&max=1 returns definitions and parts of speech.
 * Returns meanings array on success, null on miss or error.
 */
async function fetchFromDatamuse(candidate) {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 5000);

    const url = `${DATAMUSE_BASE}?sp=${encodeURIComponent(candidate)}&md=dp&max=1`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;

    // Datamuse returns the closest spelling match — ensure it actually matches
    const entry = json[0];
    if (!entry || entry.word !== candidate) return null;

    const defs = entry.defs ?? [];
    if (defs.length === 0) return null;

    // defs format: ["n\tA greeting.", "v\tTo greet."]  (pos\tdefinition)
    const POS_MAP = {
      n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb',
      u: 'unknown', r: 'adverb', prep: 'preposition', conj: 'conjunction',
    };

    // Group by part of speech
    const byPos = {};
    for (const def of defs) {
      const tabIdx = def.indexOf('\t');
      if (tabIdx === -1) continue;
      const posCode   = def.slice(0, tabIdx).trim();
      const defText   = def.slice(tabIdx + 1).trim();
      const pos       = POS_MAP[posCode] ?? posCode;
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push({ definition: defText, example: '' });
    }

    const meanings = Object.entries(byPos).map(([partOfSpeech, definitions]) => ({
      partOfSpeech,
      definitions: definitions.slice(0, 5),
    }));

    return meanings.length > 0 ? meanings : null;
  } catch {
    return null;
  }
}

// ── Main lookup ───────────────────────────────────────────────────────────────

/**
 * Main lookup function.
 *
 * @param {string} capturedForm — raw text the user double-clicked
 * @returns {Promise<{ wordDoc, resolvedLemma }>}
 */
async function lookupWord(capturedForm) {
  const lemma      = normalise(capturedForm);
  const candidates = fallbacks(lemma);

  // ── 1. Check cache ─────────────────────────────────────────────────────────
  for (const candidate of candidates) {
    const cached = await Word.findOne({ word: candidate });
    if (cached) {
      // Skip stale negative entries so genuinely-not-found words get re-checked
      if (!cached.found) {
        const age = Date.now() - new Date(cached.fetchedAt).getTime();
        if (age > NEGATIVE_TTL_MS) continue; // treat as cache miss
      }
      return { wordDoc: cached, resolvedLemma: candidate };
    }
  }

  // ── 2. Cache miss — query APIs ─────────────────────────────────────────────
  let anyTransientFailure = false;

  for (const candidate of candidates) {
    // Try primary API first
    const primary = await fetchFromFreeDictAPI(candidate);
    if (primary.meanings) {
      return await savePositive(candidate, primary.meanings, 'free-dictionary-api');
    }
    if (!primary.definitive) {
      anyTransientFailure = true;
      // Primary had a transient failure — try Datamuse as fallback
      const fallbackMeanings = await fetchFromDatamuse(candidate);
      if (fallbackMeanings) {
        return await savePositive(candidate, fallbackMeanings, 'datamuse');
      }
    }
  }

  // ── 3. All candidates failed ────────────────────────────────────────────────
  // Only cache as "not found" if we got definitive 404s (not transient errors)
  if (anyTransientFailure) {
    // Return a temporary not-found without caching — user can retry
    const tempDoc = { found: false, meanings: [], _id: null, word: lemma };
    return { wordDoc: tempDoc, resolvedLemma: lemma };
  }

  // Genuine not-found — write negative cache entry
  const wordDoc = await Word.findOneAndUpdate(
    { word: lemma },
    { word: lemma, found: false, meanings: [], source: 'free-dictionary-api', fetchedAt: new Date() },
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
