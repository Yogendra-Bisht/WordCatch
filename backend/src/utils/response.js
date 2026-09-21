/**
 * Shared response helpers so all routes return a consistent envelope:
 *   { ok: true, data }  or  { ok: false, error: { code, message } }
 * as specified in SRS §3.3.
 */

function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json({ ok: true, data });
}

function sendError(res, statusCode, code, message) {
  return res.status(statusCode).json({ ok: false, error: { code, message } });
}

module.exports = { sendSuccess, sendError };
