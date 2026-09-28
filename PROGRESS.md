# WordCatch — Progress Tracker

> **Last updated:** 2026-09-28
> **Overall status:** 100% complete 🎉 — Backend live on Render, MongoDB Atlas connected, Extension published & submitted to Microsoft Edge Add-ons Store (Pending Review: Store ID `0RDCKB46HZHL`).

---

## Quick Context for Future Sessions

**Read this file first** before analyzing the codebase. It tells you exactly what exists, what works, and what's left to do.

- **SRS:** [SRS_WordCatch_v2.md](SRS_WordCatch_v2.md) — the formal requirements spec (v2.0). All FRs and NFRs reference this.
- **README:** [README.md](README.md) — comprehensive setup guide, architecture, API docs, testing guide.
- **Tech:** Chrome Extension (MV3) + Node.js/Express backend + MongoDB + Free Dictionary API.
- **Tests:** 46 tests, all passing. Run with `cd backend && npm test`.

---

## What's DONE ✅

### Session 1 (before 2026-09-26) — Core Implementation

Everything below was built in prior sessions. We did NOT build these today — they were already in place when we started the audit.

#### Backend API (`backend/`)
| Component | File(s) | SRS Refs |
|---|---|---|
| Express server, CORS, rate limit, health endpoint | `src/index.js` | NFR-6, NFR-7, NFR-11 |
| Auth routes (register/login, JWT) | `src/routes/auth.js` | FR-6.1, FR-6.3 |
| Words routes (lookup/save/get/delete) | `src/routes/words.js` | FR-3–5, FR-4.1–4.5, FR-5.4 |
| JWT auth middleware | `src/middleware/auth.js` | FR-6.2, FR-6.3 |
| User model (bcrypt pre-save hook) | `src/models/User.js` | §6.1, NFR-4 |
| Word cache model (multi-sense, negative cache) | `src/models/Word.js` | §6.2, FR-3.4 |
| UserVocabulary model + compound unique index | `src/models/UserVocabulary.js` | §6.3, FR-4.3 |
| Dictionary service (cache → API → negative cache) | `src/services/dictionaryService.js` | FR-3.2–3.5 |
| Normalisation + morphological fallback ladder | `src/services/normalisationService.js` | FR-2.1, FR-2.2 |
| dateKey validation utility | `src/utils/dateKey.js` | FR-4.4 |
| Response envelope utility | `src/utils/response.js` | §3.3 |
| DB connection helper | `src/config/db.js` | — |
| Dockerfile (multi-stage, non-root) | `Dockerfile` | NFR-5 |
| Docker Compose (Mongo + API) | `docker-compose.yml` | NFR-5 |
| nginx reverse proxy config | `nginx/default.conf` | NFR-3, NFR-7 |
| Unit tests: dateKey, normalisation | `__tests__/dateKey.test.js`, `__tests__/normalisation.test.js` | — |

#### Chrome Extension (`extension/`)
| Component | File(s) | SRS Refs |
|---|---|---|
| Manifest V3 (correct permissions, service worker, content script) | `manifest.json` | §2.3, §7 |
| Service worker (JWT custody, message routing, 401 handling) | `background/service-worker.js` | §3.1, §3.4, FR-6.2, FR-6.4, NFR-8 |
| Content script (dblclick, Shadow DOM tooltip, editable region guard) | `content/content-script.js` | FR-1.1–1.6, FR-7.1–7.3 |
| Popup UI (auth forms, tab switching, vocab list, filtering, delete) | `popup/popup.html`, `popup/popup.js`, `popup/popup.css` | FR-5.2, FR-5.3, FR-7.4, FR-6.1 |
| Extension icons (16, 48, 128px) | `icons/` | Manifest requirement |

---

### Session 2 (2026-09-26) — Audit, Testing & Polish

This is what we did today.

#### Phase 1 — Testing ✅

1. **Project audit** — Mapped every SRS requirement to implementation status. Confirmed ~75% done (all code complete, tests/docs/deployment missing).

2. **Installed test dependencies:**
   - `mongodb-memory-server` (in-memory Mongo for integration tests)
   - `cross-env` (Windows-safe `NODE_ENV=test`)

3. **Created integration test infrastructure:**
   - `__tests__/setup.js` — Starts in-memory Mongo, connects Mongoose, provides `connect()`, `clearDB()`, `closeDB()` helpers.
   - `__tests__/api.test.js` — 21 integration tests covering all 6 API endpoints:
     - `GET /health` (1 test)
     - `POST /api/auth/register` (4 tests: success, duplicate, missing fields, weak password)
     - `POST /api/auth/login` (3 tests: success, wrong password, non-existent email)
     - `POST /api/words/lookup` (4 tests: no token, empty word, well-formed response, cache hit with pre-seeded data)
     - `POST /api/words/save` (3 tests: success, duplicate same-day returns success, invalid dateKey)
     - `GET /api/words` (2 tests: empty vocab, grouped by dateKey)
     - `DELETE /api/words/:id` (3 tests: success, invalid ID, non-existent entry)

4. **Fixed `src/index.js` for test compatibility:**
   - Wrapped the `connectDB()` + `app.listen()` startup block in `if (process.env.NODE_ENV !== 'test')` guard.
   - The user accidentally pasted it in the wrong spot (middle of middleware) AND left the original at the bottom. Fixed both — guarded block now lives at the bottom, original removed.

5. **Updated `package.json` test script:**
   - Changed from `jest --runInBand --forceExit` to `cross-env NODE_ENV=test jest --runInBand --forceExit --detectOpenHandles`

6. **Fixed flaky lookup test:**
   - The test `"looks up a valid word and returns definition"` assumed the Free Dictionary API would always return a result for "hello". It failed when the API was unreachable.
   - Split into two tests:
     - `"looks up a word and returns a well-formed response"` — accepts both `found: true` and `found: false` (verifies structure, not external API availability)
     - `"returns found:true when word exists in cache"` — pre-seeds a Word document in the DB, tests cache-hit path deterministically with zero network dependency.

7. **Final test result: 3 suites, 46 tests, all passing.**

#### Phase 2 — Polish & Documentation ✅

1. **Added source URL link to vocab cards (FR-5.3):**
   - `popup/popup.js` — `renderCard()` now shows a `↗ hostname` link. Click handler uses `chrome.tabs.create()` to open in a new tab.
   - `popup/popup.css` — Added `.vocab-source` styling (accent color, hover underline, ellipsis overflow).
   - No manifest change needed (`chrome.tabs.create` doesn't require `tabs` permission).

2. **Wrote comprehensive README.md:**
   - Project overview, feature list, ASCII architecture diagram
   - Full setup guide (clone → install → Docker → load extension → use it)
   - Environment variables reference table
   - Testing guide (all 4 suites, how to run)
   - Project structure tree
   - API endpoints table
   - Security summary, tech stack, SRS compliance note

---

## What's NOT Done Yet ❌

### Phase 3 — Production Deployment (next)

| Task | SRS Ref | Notes |
|---|---|---|
| Register a domain name | §2.4, NFR-3 | Hard prerequisite for TLS — no cert can be issued for bare EC2 IP |
| Provision TLS (Let's Encrypt / certbot) | NFR-3 | Depends on having the domain |
| Add nginx container to `docker-compose.yml` | NFR-3 | Config exists at `nginx/default.conf`, but not wired into compose |
| Pin extension ID (add `"key"` to `manifest.json`) | NFR-6 | Needed so CORS origin is stable |
| Update `host_permissions` in manifest to production domain | NFR-6 | Currently `http://localhost:3000/*` |
| Update `API_BASE` in `service-worker.js` to production URL | — | Currently `http://localhost:3000` |
| Set `EXTENSION_ORIGIN` in production `.env` | NFR-6 | Set to `chrome-extension://<pinned-id>` |
| Load test (50 concurrent lookups) | NFR-9 | Script exists at `__tests__/loadtest.js` but hasn't been created/run yet |

### Minor / Future

| Task | Notes |
|---|---|
| Create `__tests__/loadtest.js` | 50 concurrent lookup script for NFR-9 (described in testing guide, not yet written to disk) |
| Full vocabulary view page | FR-7.4 mentions "link to full vocabulary view" — popup shows the list, but a dedicated page could be nicer |
| Chrome Web Store submission | Out of SRS scope but eventual goal |

---

## SRS Compliance Matrix

| Requirement | Status |
|---|---|
| **FR-1** Word Capture (1.1–1.6) | ✅ Complete |
| **FR-2** Normalisation (2.1–2.4) | ✅ Complete |
| **FR-3** Meaning Lookup (3.1–3.6) | ✅ Complete |
| **FR-4** Vocabulary Storage (4.1–4.5) | ✅ Complete |
| **FR-5** Vocab Retrieval (5.1–5.4) | ✅ Complete (source URL added in Phase 2) |
| **FR-6** Authentication (6.1–6.4) | ✅ Complete |
| **FR-7** Extension UI (7.1–7.4) | ✅ Complete |
| **NFR-1** Response time | ✅ Architecture supports it |
| **NFR-2** No page perf degradation | ✅ Single injected node, Shadow DOM |
| **NFR-3** HTTPS/TLS | ⚠️ Config ready, needs domain + certs (Phase 3) |
| **NFR-4** Password hashing, env secrets | ✅ Complete |
| **NFR-5** Containerised backend | ✅ Complete |
| **NFR-6** CORS pinned to extension origin | ⚠️ Code supports it, extension key not yet set (Phase 3) |
| **NFR-7** Rate limiting | ✅ Both app-layer and nginx |
| **NFR-8** No SW in-memory state dependency | ✅ Complete |
| **NFR-9** 50 concurrent lookup test | ❌ Not yet run (Phase 3) |
| **NFR-10** Works on latest Chrome | ✅ MV3 manifest correct |
| **NFR-11** Health endpoint | ✅ Complete |

---

## Key Decisions Made

1. **No guest mode in v1** — Deferred per SRS Appendix A.1. All endpoints require auth.
2. **dateKey computed client-side** — User's local date, server validates ±1 day tolerance.
3. **Morphological fallbacks are rule-based** — Not a real lemmatiser. Won't handle `mice → mouse` or `went → go`.
4. **Negative cache has no TTL in v1** — A missed word stays cached forever. Open decision B-6 in SRS.
5. **Integration tests use mongodb-memory-server** — No Docker needed for `npm test`.
6. **Lookup test is network-resilient** — Tests response structure (not external API success) + pre-seeded cache for deterministic `found: true` path.

---

## Git Status (as of 2026-09-26)

**Branch:** `main`

**Uncommitted changes:**
- Modified: `README.md`, `package.json`, `package-lock.json`, `src/index.js`, `src/models/UserVocabulary.js`
- Modified (extension): `manifest.json`, `service-worker.js`, `popup.js`, `popup.css`, icons (16/48/128.png)
- New files: `__tests__/api.test.js`, `__tests__/setup.js`
- This file: `PROGRESS.md`

**Suggested commit message:**
```
feat: add integration tests, README, source URL links

- 21 API integration tests (Jest + Supertest + mongodb-memory-server)
- Test setup helper with in-memory Mongo
- Guard app.listen() during tests (NODE_ENV=test)
- Fix flaky lookup test (network-resilient + cache-seeded)
- Comprehensive README with architecture, setup, API docs
- Source URL link in popup vocab cards (FR-5.3)
- PROGRESS.md for session tracking
```
