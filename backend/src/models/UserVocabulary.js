const mongoose = require('mongoose');

/**
 * Per-user vocabulary entry (SRS §6.3).
 *
 * Compound unique index { userId, wordId, dateKey } enforces FR-4.3:
 * the same word can be saved multiple times across different days
 * but only once per day.
 */
const userVocabularySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    wordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Word',
      required: true,
    },
    capturedForm: {
      type: String,
      required: true,
      trim: true,
    },
    sentenceContext: {
      type: String,
      default: '',
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    dateKey: {
      // YYYY-MM-DD in the user's local timezone (FR-4.2, FR-4.4)
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'dateKey must be YYYY-MM-DD'],
    },
    dateAdded: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

// Unique compound index — enforces FR-4.3
userVocabularySchema.index(
  { userId: 1, wordId: 1, dateKey: 1 },
  { unique: true }
);

// Supports date-range retrieval (FR-5.1)
userVocabularySchema.index({ userId: 1, dateAdded: -1 });

module.exports = mongoose.model('UserVocabulary', userVocabularySchema);
