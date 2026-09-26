/**
 * Dictionary service (SRS FR-3.1 – FR-3.5).
 *
 * Responsibilities:
 *   1. Check the `words` cache collection (cache hit → return immediately)
 *   2. On cache miss, walk the fallback ladder from normalisationService
 *   3. For each candidate, query the Free Dictionary API
 *   4. On success, write a positive cache entry and return it
 *   5. On total failure, write a negative cache entry (found: false) and return it
 *
 * The external API is consumed server-side only (SRS §7).
 */

const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

const Word   = require('../models/Word');
const { normalise, fallbacks } = require('./normalisationService');

const DICT_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

/**
 * Fetch a single candidate from the Free Dictionary API.
 * Returns the parsed meanings array on success, null on 404 / error.
 *
 * @param {string} candidate — already normalised word
 * @returns {Promise<Array|null>}
 */
async function fetchFromDictAPI(candidate) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${DICT_API_BASE}/${encodeURIComponent(candidate)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null; // 404 or other HTTP error

    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;

    // Map the API's shape to our schema shape
    const meanings = json
      .flatMap((entry) => entry.meanings ?? [])
      .map((m) => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions ?? []).slice(0, 5).map((d) => ({
          definition: d.definition ?? '',
          example:    d.example   ?? '',
        })),
      }));

    return meanings.length > 0 ? meanings : null;
  } catch {
    return null; // network error or timeout — treat as miss
  }
}

/**
 * Main lookup function.
 *
 * @param {string} capturedForm — raw text the user double-clicked
 * @returns {Promise<{ wordDoc, resolvedLemma }>}
 *   wordDoc     — the Word mongoose document (found: true or false)
 *   resolvedLemma — the lemma key that was eventually stored/found
 */
async function lookupWord(capturedForm) {
  const lemma     = normalise(capturedForm);
  const candidates = fallbacks(lemma);

  // ── 1. Check cache for any candidate ──────────────────────────────────
  for (const candidate of candidates) {
    const cached = await Word.findOne({ word: candidate });
    if (cached) {
      return { wordDoc: cached, resolvedLemma: candidate };
    }
  }

  // ── 2. Cache miss — query external API for each candidate ──────────────
  for (const candidate of candidates) {
    const meanings = await fetchFromDictAPI(candidate);

    if (meanings) {
      // Positive result — persist and return
      const wordDoc = await Word.findOneAndUpdate(
        { word: candidate },
        {
          word:      candidate,
          found:     true,
          meanings,
          source:    'free-dictionary-api',
          fetchedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return { wordDoc, resolvedLemma: candidate };
    }
  }

  // ── 3. All candidates failed — write negative cache entry (FR-3.4) ──────
  const negativeLemma = lemma; // cache under the base normalised form
  const wordDoc = await Word.findOneAndUpdate(
    { word: negativeLemma },
    {
      word:      negativeLemma,
      found:     false,
      meanings:  [],
      source:    'free-dictionary-api',
      fetchedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { wordDoc, resolvedLemma: negativeLemma };
}

module.exports = { lookupWord };
