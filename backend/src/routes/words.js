const express       = require('express');
const rateLimit     = require('express-rate-limit');
const mongoose      = require('mongoose');
const auth          = require('../middleware/auth');
const Word          = require('../models/Word');
const UserVocabulary = require('../models/UserVocabulary');
const { lookupWord } = require('../services/dictionaryService');
const { normalise }  = require('../services/normalisationService');
const { isValidDateKey } = require('../utils/dateKey');
const { sendSuccess, sendError } = require('../utils/response');

const router = express.Router();

// All words routes require authentication (FR-6.3)
router.use(auth);

// Per-user rate limit on the lookup endpoint (NFR-7)
const lookupRateLimit = rateLimit({
  windowMs: 60 * 1000,              // 1-minute window
  max: 30,                          // 30 lookups per user per minute
  keyGenerator: (req) => req.user.id,
  handler: (_req, res) =>
    sendError(res, 429, 'RATE_LIMITED', 'Too many lookups — please slow down'),
  standardHeaders: true,
  legacyHeaders: false,
});

// ── POST /api/words/lookup ─────────────────────────────────────────────────
router.post('/lookup', lookupRateLimit, async (req, res) => {
  try {
    const { word } = req.body;

    if (!word || typeof word !== 'string' || word.trim().length === 0) {
      return sendError(res, 400, 'MISSING_WORD', 'A non-empty "word" field is required');
    }

    const capturedForm = word.trim();
    const lemma = normalise(capturedForm);

    if (lemma.length === 0) {
      return sendError(res, 400, 'INVALID_WORD', 'Word contains no alphabetic characters');
    }

    const { wordDoc, resolvedLemma } = await lookupWord(capturedForm);

    return sendSuccess(res, {
      capturedForm,
      resolvedLemma,
      found:    wordDoc.found,
      meanings: wordDoc.meanings,
      wordId:   wordDoc._id,
    });
  } catch (err) {
    console.error('lookup error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Lookup failed');
  }
});

// ── POST /api/words/save ───────────────────────────────────────────────────
router.post('/save', async (req, res) => {
  try {
    const { word, wordId, capturedForm, sentenceContext, sourceUrl, dateKey } = req.body;

    // Validate dateKey (FR-4.4)
    if (!dateKey || !isValidDateKey(dateKey)) {
      return sendError(
        res, 400, 'INVALID_DATE_KEY',
        'dateKey must be YYYY-MM-DD and within one calendar day of today'
      );
    }

    // Resolve the Word document — prefer explicit wordId, fall back to lookup
    let wordDoc;
    if (wordId && mongoose.isValidObjectId(wordId)) {
      wordDoc = await Word.findById(wordId);
    }

    if (!wordDoc) {
      const raw = (word || capturedForm || '').trim();
      if (!raw) return sendError(res, 400, 'MISSING_WORD', '"word" or "wordId" is required');
      const result = await lookupWord(raw);
      wordDoc = result.wordDoc;
    }

    // Upsert — conflict on { userId, wordId, dateKey } returns existing entry (FR-4.5)
    let entry;
    try {
      entry = await UserVocabulary.findOneAndUpdate(
        { userId: req.user.id, wordId: wordDoc._id, dateKey },
        {
          $setOnInsert: {
            capturedForm:    capturedForm || word || '',
            sentenceContext: sentenceContext || '',
            sourceUrl:       sourceUrl || '',
            dateAdded:       new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      if (err.code === 11000) {
        // Duplicate key — return existing entry as success (FR-4.5)
        entry = await UserVocabulary.findOne({
          userId: req.user.id,
          wordId: wordDoc._id,
          dateKey,
        });
      } else {
        throw err;
      }
    }

    return sendSuccess(res, { entry }, 201);
  } catch (err) {
    console.error('save error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Save failed');
  }
});

// ── GET /api/words ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;

    const filter = { userId: req.user.id };

    // Optional date-range filter on dateKey (FR-5.1)
    if (from || to) {
      filter.dateKey = {};
      if (from) filter.dateKey.$gte = from;
      if (to)   filter.dateKey.$lte = to;
    }

    const entries = await UserVocabulary
      .find(filter)
      .populate('wordId', 'word found meanings')
      .sort({ dateAdded: -1 })
      .lean();

    // Group by dateKey (FR-5.2)
    const grouped = entries.reduce((acc, entry) => {
      const key = entry.dateKey;
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
    }, {});

    return sendSuccess(res, { grouped, total: entries.length });
  } catch (err) {
    console.error('get vocab error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to retrieve vocabulary');
  }
});

// ── DELETE /api/words/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid entry ID');
    }

    // Ensure the entry belongs to the requesting user (FR-5.4)
    const deleted = await UserVocabulary.findOneAndDelete({
      _id: id,
      userId: req.user.id,
    });

    if (!deleted) {
      return sendError(res, 404, 'NOT_FOUND', 'Entry not found or already deleted');
    }

    return sendSuccess(res, { deleted: true, id });
  } catch (err) {
    console.error('delete error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Delete failed');
  }
});

module.exports = router;
