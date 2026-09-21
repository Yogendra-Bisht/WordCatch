/**
 * Word normalisation service (SRS FR-2.1, FR-2.2).
 *
 * Step 1 — normalise:   lowercase + strip non-alphabetic characters
 * Step 2 — fallbacks:   morphological suffix-stripping ladder
 *
 * This is intentionally rule-based (not a full lemmatiser) as noted in SRS §9.
 * Irregular forms (mice → mouse, went → go) are out of v1 scope.
 */

/**
 * Normalise a captured form to a lemma key candidate.
 * "Running" → "running", "café" → "caf", "word," → "word"
 */
function normalise(raw) {
  return raw.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Generate the ordered fallback sequence for a lemma key.
 * The first element is always the normalised form itself.
 * Subsequent elements are morphological variants, most→least specific.
 *
 * @param {string} lemma — already normalised (lowercase, alpha only)
 * @returns {string[]} ordered list of candidates to try
 */
function fallbacks(lemma) {
  const candidates = [lemma];
  const l = lemma;

  // -ies → -y  (studies → study)
  if (l.endsWith('ies') && l.length > 4) {
    candidates.push(l.slice(0, -3) + 'y');
  }

  // -es → strip es (boxes → box, watches → watch)
  if (l.endsWith('es') && l.length > 3) {
    candidates.push(l.slice(0, -2));
  }

  // -s → strip s  (cats → cat)
  if (l.endsWith('s') && l.length > 2 && !l.endsWith('ss')) {
    candidates.push(l.slice(0, -1));
  }

  // -ed → strip ed, or -ed doubled consonant (planned → plan)
  if (l.endsWith('ed') && l.length > 4) {
    const stripped = l.slice(0, -2);
    candidates.push(stripped);
    // doubled consonant: e.g. planned → plann → plan
    if (stripped.length > 2) {
      const last = stripped[stripped.length - 1];
      if (last === stripped[stripped.length - 2]) {
        candidates.push(stripped.slice(0, -1));
      }
    }
  }

  // -ing → strip ing, or -ing doubled consonant (running → runn → run)
  if (l.endsWith('ing') && l.length > 5) {
    const stripped = l.slice(0, -3);
    candidates.push(stripped);
    // doubled consonant: e.g. running → runn → run
    if (stripped.length > 2) {
      const last = stripped[stripped.length - 1];
      if (last === stripped[stripped.length - 2]) {
        candidates.push(stripped.slice(0, -1));
      }
    }
    // -ing with silent e restored: hoping → hop → hope
    candidates.push(stripped + 'e');
  }

  // Deduplicate while preserving order
  return [...new Set(candidates)];
}

module.exports = { normalise, fallbacks };
