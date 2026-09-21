const express  = require('express');
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');

const router = express.Router();

// ── POST /api/auth/register ────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(res, 400, 'MISSING_FIELDS', 'Email and password are required');
    }
    if (password.length < 8) {
      return sendError(res, 400, 'WEAK_PASSWORD', 'Password must be at least 8 characters');
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return sendError(res, 409, 'EMAIL_TAKEN', 'An account with that email already exists');
    }

    // passwordHash is set to the plain password; the pre-save hook hashes it
    const user = await User.create({ email, passwordHash: password });

    const token = issueToken(user);
    return sendSuccess(res, { token, email: user.email }, 201);
  } catch (err) {
    console.error('register error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Registration failed');
  }
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(res, 400, 'MISSING_FIELDS', 'Email and password are required');
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Generic message — don't reveal whether email exists
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    }

    const token = issueToken(user);
    return sendSuccess(res, { token, email: user.email });
  } catch (err) {
    console.error('login error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Login failed');
  }
});

// ── Helper ─────────────────────────────────────────────────────────────────
function issueToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

module.exports = router;
