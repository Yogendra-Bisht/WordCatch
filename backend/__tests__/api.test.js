const request = require('supertest');
const mongoose = require('mongoose');
const { connect, clearDB, closeDB } = require('./setup');

// Import the app AFTER env vars are set by setup
let app;

beforeAll(async () => {
  await connect();
  app = require('../src/index');
});

afterEach(async () => {
  await clearDB();
});

afterAll(async () => {
  await closeDB();
});

// ── Helper ──────────────────────────────────────────────────────────────────
function todayDateKey() {
  const d = new Date();
  const yr  = d.getFullYear();
  const mo  = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${day}`;
}

async function registerAndGetToken(email = 'test@example.com', password = 'password123') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password });
  return res.body.data.token;
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /health', () => {
  test('returns 200 with database connected', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.database).toBe('connected');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/register', () => {
  test('registers a new user and returns JWT', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.email).toBe('new@example.com');
  });

  test('rejects duplicate email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'no-pass@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELDS');
  });

  test('rejects password shorter than 8 chars', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'weak@example.com', password: '1234567' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'login@example.com', password: 'password123' });
  });

  test('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.token).toBeDefined();
  });

  test('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('rejects non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WORDS — LOOKUP
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/words/lookup', () => {
  test('rejects request without token', async () => {
    const res = await request(app)
      .post('/api/words/lookup')
      .send({ word: 'hello' });

    expect(res.status).toBe(401);
  });

  test('rejects empty word', async () => {
    const token = await registerAndGetToken();
    const res = await request(app)
      .post('/api/words/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_WORD');
  });

  test('looks up a word and returns a well-formed response', async () => {
    const token = await registerAndGetToken();
    const res = await request(app)
      .post('/api/words/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // The external API may be unreachable in CI, so accept both outcomes
    expect(typeof res.body.data.found).toBe('boolean');
    expect(Array.isArray(res.body.data.meanings)).toBe(true);
    expect(res.body.data.wordId).toBeDefined();
    expect(res.body.data.capturedForm).toBe('hello');
    expect(res.body.data.resolvedLemma).toBeDefined();
  }, 10000); // allow time for external API call

  test('returns found:true when word exists in cache', async () => {
    // Pre-seed the words cache so no external API call is needed
    const Word = require('../src/models/Word');
    await Word.create({
      word: 'serendipity',
      found: true,
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A happy accident', example: '' }] }],
      source: 'test-seed',
      fetchedAt: new Date(),
    });

    const token = await registerAndGetToken();
    const res = await request(app)
      .post('/api/words/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'serendipity' });

    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(true);
    expect(res.body.data.meanings[0].partOfSpeech).toBe('noun');
    expect(res.body.data.meanings[0].definitions[0].definition).toBe('A happy accident');
  });

  test('second lookup for same word hits cache (faster)', async () => {
    const token = await registerAndGetToken();

    // First call — cache miss, hits external API
    await request(app)
      .post('/api/words/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'hello' });

    // Second call — should be a cache hit
    const start = Date.now();
    const res = await request(app)
      .post('/api/words/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'hello' });
    const elapsed = Date.now() - start;

    expect(res.body.ok).toBe(true);
    expect(elapsed).toBeLessThan(500); // cache hit should be fast
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// WORDS — SAVE
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/words/save', () => {
  test('saves a word to the user vocabulary', async () => {
    const token = await registerAndGetToken();

    // Lookup first to get wordId
    const lookup = await request(app)
      .post('/api/words/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'hello' });

    const { wordId } = lookup.body.data;

    const res = await request(app)
      .post('/api/words/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        word: 'hello',
        wordId,
        capturedForm: 'Hello',
        sentenceContext: 'He said Hello to her.',
        sourceUrl: 'https://example.com',
        dateKey: todayDateKey(),
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.entry).toBeDefined();
  }, 10000);

  test('duplicate save on same day returns success, not error (FR-4.5)', async () => {
    const token = await registerAndGetToken();

    const lookup = await request(app)
      .post('/api/words/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'hello' });

    const { wordId } = lookup.body.data;
    const dateKey = todayDateKey();

    // First save
    await request(app)
      .post('/api/words/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'hello', wordId, capturedForm: 'Hello', dateKey });

    // Second save — same word, same day
    const res = await request(app)
      .post('/api/words/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'hello', wordId, capturedForm: 'Hello', dateKey });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    // Should not create a duplicate
  }, 15000);

  test('rejects invalid dateKey', async () => {
    const token = await registerAndGetToken();
    const res = await request(app)
      .post('/api/words/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'test', dateKey: '2020-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE_KEY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WORDS — GET VOCAB
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/words', () => {
  test('returns empty vocab for new user', async () => {
    const token = await registerAndGetToken();
    const res = await request(app)
      .get('/api/words')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });

  test('returns saved words grouped by dateKey', async () => {
    const token = await registerAndGetToken();
    const dateKey = todayDateKey();

    // Lookup + save a word
    const lookup = await request(app)
      .post('/api/words/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'world' });

    await request(app)
      .post('/api/words/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        word: 'world',
        wordId: lookup.body.data.wordId,
        capturedForm: 'world',
        dateKey,
      });

    const res = await request(app)
      .get('/api/words')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.grouped[dateKey]).toBeDefined();
    expect(res.body.data.grouped[dateKey].length).toBe(1);
  }, 10000);
});

// ═══════════════════════════════════════════════════════════════════════════
// WORDS — DELETE
// ═══════════════════════════════════════════════════════════════════════════
describe('DELETE /api/words/:id', () => {
  test('deletes a saved entry', async () => {
    const token = await registerAndGetToken();
    const dateKey = todayDateKey();

    const lookup = await request(app)
      .post('/api/words/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ word: 'test' });

    const save = await request(app)
      .post('/api/words/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        word: 'test',
        wordId: lookup.body.data.wordId,
        capturedForm: 'Test',
        dateKey,
      });

    const entryId = save.body.data.entry._id;

    const res = await request(app)
      .delete(`/api/words/${entryId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    // Confirm it's gone
    const vocab = await request(app)
      .get('/api/words')
      .set('Authorization', `Bearer ${token}`);
    expect(vocab.body.data.total).toBe(0);
  }, 10000);

  test('rejects invalid ObjectId', async () => {
    const token = await registerAndGetToken();
    const res = await request(app)
      .delete('/api/words/not-an-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });

  test('returns 404 for non-existent entry', async () => {
    const token = await registerAndGetToken();
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .delete(`/api/words/${fakeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
