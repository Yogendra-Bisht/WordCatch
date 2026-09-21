const jwt = require('jsonwebtoken');
const { sendError } = require('../utils/response');

/**
 * Express middleware that verifies the Bearer JWT attached to the request.
 * On success, attaches `req.user = { id, email }` and calls next().
 * On failure, returns a 401 with a structured error response.
 *
 * The service worker (SRS §3.1) attaches the token; this middleware
 * is the corresponding server-side gate for all /api/words/* routes (FR-6.3).
 */
function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return sendError(res, 401, 'NO_TOKEN', 'Authentication token is required');
  }

  const token = header.slice(7); // strip "Bearer "

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendError(res, 401, 'TOKEN_EXPIRED', 'Token has expired, please log in again');
    }
    return sendError(res, 401, 'TOKEN_INVALID', 'Invalid authentication token');
  }
}

module.exports = auth;
