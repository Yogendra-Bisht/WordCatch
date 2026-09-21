/**
 * dateKey utilities (SRS FR-4.4).
 *
 * The client computes dateKey from the user's local date and sends it with
 * every save request. The server validates format and proximity to UTC now.
 */

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns true if `value` is a valid YYYY-MM-DD string that is within
 * `toleranceDays` calendar days of today's UTC date (default: 1 day).
 *
 * Rejects values that are syntactically wrong, in the distant past,
 * or suspiciously far in the future.
 */
function isValidDateKey(value, toleranceDays = 1) {
  if (!DATE_KEY_REGEX.test(value)) return false;

  const supplied = new Date(`${value}T00:00:00Z`);
  if (isNaN(supplied.getTime())) return false;

  const nowUtc = new Date();
  // Normalise both to midnight UTC for day-level comparison
  const todayMidnight = new Date(
    Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate())
  );

  const diffMs = Math.abs(supplied.getTime() - todayMidnight.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays <= toleranceDays;
}

module.exports = { isValidDateKey };
