require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose  = require('mongoose');

const connectDB   = require('./config/db');
const authRoutes  = require('./routes/auth');
const wordsRoutes = require('./routes/words');
const { sendSuccess, sendError } = require('./utils/response');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Trust proxy (nginx sits in front) ─────────────────────────────────────
app.set('trust proxy', 1);

// ── CORS (NFR-6) ───────────────────────────────────────────────────────────
// In production, EXTENSION_ORIGIN should be chrome-extension://<id>
// In development, we allow all origins so curl / Postman work without friction.
const allowedOrigin = process.env.EXTENSION_ORIGIN || '*';

app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

// ── Global IP-level rate limit (defence-in-depth; nginx also rate-limits) ─
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ── Health endpoint (NFR-11) ───────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const dbState = mongoose.connection.readyState;
  // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const dbStatus = ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] ?? 'unknown';
  const healthy  = dbState === 1;

  return res.status(healthy ? 200 : 503).json({
    ok:        healthy,
    process:   'up',
    database:  dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// ── API routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',  authRoutes);
app.use('/api/words', wordsRoutes);

// ── 404 catch-all ─────────────────────────────────────────────────────────
app.use((_req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'Route not found');
});

// ── Global process exception safety ─────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  sendError(res, 500, 'SERVER_ERROR', 'An unexpected error occurred');
});

// ── Start ──────────────────────────────────────────────────────────────────
// Only start listening when not in test mode (supertest manages its own port)
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      await connectDB();
      app.listen(PORT, () => {
        console.log(`WordCatch API running on port ${PORT}`);
      });
    } catch (err) {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = app; // exported for supertest in tests
