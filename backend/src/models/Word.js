const mongoose = require('mongoose');

/**
 * Global word cache (shared across all users).
 *
 * Schema (SRS §6.2):
 *   word      — lemma key; lowercase, unique
 *   found     — false marks a negative cache entry (FR-3.4)
 *   meanings  — [ { partOfSpeech, definitions: [ { definition, example } ] } ]
 *   source    — which dictionary provider supplied the data
 *   fetchedAt — when the entry was written
 */
const definitionSchema = new mongoose.Schema(
  {
    definition: { type: String, required: true },
    example:    { type: String, default: '' },
  },
  { _id: false }
);

const meaningSchema = new mongoose.Schema(
  {
    partOfSpeech: { type: String, required: true },
    definitions:  { type: [definitionSchema], default: [] },
  },
  { _id: false }
);

const wordSchema = new mongoose.Schema(
  {
    word: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    found:     { type: Boolean, required: true, default: true },
    meanings:  { type: [meaningSchema], default: [] },
    source:    { type: String, default: 'free-dictionary-api' },
    fetchedAt: { type: Date,   default: Date.now },
  },
  { timestamps: false }
);

module.exports = mongoose.model('Word', wordSchema);
