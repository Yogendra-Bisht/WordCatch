[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Edge Add-on](https://img.shields.io/badge/Microsoft_Edge-Live-brightgreen.svg)](https://microsoftedge.microsoft.com/addons/detail/phgiaghmefmfigmhahigfdlgacifeglb)
[![Backend Status](https://img.shields.io/badge/Backend-Render_Live-brightgreen.svg)](https://wordcatch.onrender.com/health)

> **Double-click any word. Get the meaning. Build your vocabulary.**

WordCatch is a browser extension (Manifest V3) that turns passive reading into active vocabulary building. Double-click any word on any webpage to instantly look up its definition, then save it to [...]

- **Live API Endpoint:** [`https://wordcatch.onrender.com`](https://wordcatch.onrender.com/health)
- **Privacy Policy:** [https://yogendra-bisht.github.io/WordCatch/privacy.html](https://yogendra-bisht.github.io/WordCatch/privacy.html)
- **Microsoft Edge Store:** [https://microsoftedge.microsoft.com/addons/detail/phgiaghmefmfigmhahigfdlgacifeglb](https://microsoftedge.microsoft.com/addons/detail/phgiaghmefmfigmhahigfdlgacifeglb)

---

## ✨ Features

- **Instant Lookup** — Double-click a word anywhere on the web to see its definition in a sleek tooltip
- **One-Click Save** — Save words with their meaning, sentence context, and source URL to your personal vocabulary
- **Date-Stamped Cheat Sheet** — Review saved words grouped by day in the popup, with date-range filtering
- **Smart Caching** — Definitions are cached server-side, so repeated lookups are instant
- **Morphological Fallbacks** — Handles inflected forms (`running → run`, `studies → study`, `planned → plan`) automatically
- **Negative Caching** — Non-words are cached too, preventing repeated external API hits
- **Shadow DOM Tooltip** — Tooltip is isolated from host page CSS — works on any website without style conflicts
- **Secure by Design** — JWT auth flows through the service worker only; the content script never touches credentials or the network

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
│                                                          │
│  ┌─────────────┐    messages     ┌──────────────────┐   │
│  │Content Script│ ─────────────→ │  Service Worker   │   │
│  │             │ ←───────────── │  (Background)     │   │
│  │• dblclick   │   responses    │• JWT custody      │   │
│  │• tooltip    │                │• All fetch() calls│   │
│  │• Shadow DOM │                │• Token attachment  │   │
│  └─────────────┘                │• 401 handling     │   │
│                                  └────────┬─────────┘   │
│  ┌─────────────┐    messages        │          │        │
│  │  Popup UI   │ ──────────────────→│          │        │
│  │• Auth forms │ ←─────────────────            │        │
│  │• Vocab list │                               │        │
│  └─────────────┘                               │        │
└────────────────────────────────────────────────┼────────┘
                                                 │ HTTPS
                                                 ▼
                                    ┌────────────────────┐
                                    │   nginx (TLS/Rate) │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │  Express REST API   │
                                    │  /api/auth/*        │
                                    │  /api/words/*       │
                                    │  /health            │
                                    └─────────┬──────────┘
                                              │
                                ┌───────────────┼───────────────┐
                                ▼                               ▼
                      ┌──────────────┐              ┌────────────────┐
                      │ MongoDB Atlas│              │ Free Dictionary │
                      │  • users     │              │      API        │
                      │  • words     │              │  (fallback for  │
                      │  • user_vocab│              │   cache misses) │
                      └──────────────┘              └────────────────┘
```

### Context Separation (Manifest V3)

| Context | Responsibilities | Must NOT do |
|---|---|---|
| **Content Script** | `dblclick` detection, word extraction, tooltip rendering (Shadow DOM) | Call the backend, hold the JWT, write to `chrome.storage` |
| **Service Worker** | All `fetch()` calls, JWT custody, token attachment, 401 handling | Assume in-memory state survives between events |
| **Popup** | Auth forms, vocabulary cheat sheet, date filtering | Call the backend directly |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+
- **Docker** (for local MongoDB, or use your own Mongo instance)
- **Google Chrome** (latest stable)

### 1. Clone the repo

```bash
git clone https://github.com/Yogendra-Bisht/WordCatch.git
cd WordCatch
```

### 2. Set up the backend

```bash
cd backend

# Install dependencies
npm install

# Create your environment file
cp .env.example .env
# Edit .env and set a real JWT_SECRET (see .env.example for instructions)
```

### 3. Start the database & API

**Option A — Docker Compose (recommended):**
```bash
docker compose up -d
```
This starts both MongoDB and the API server. The API will be available at `http://localhost:3000`.

**Option B — Local Node.js (requires a running MongoDB):**
```bash
# Make sure MONGO_URI in .env points to your Mongo instance
npm run dev
```

### 4. Verify the API is running

```bash
curl http://localhost:3000/health
# Should return: {"ok":true,"process":"up","database":"connected",...}
```

### 5. Load the Chrome extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo
5. The WordCatch icon should appear in your toolbar

### 6. Use it!

1. Click the WordCatch icon → **Register** an account
2. Navigate to any webpage with text
3. **Double-click** any word → see the definition tooltip
4. Click **Save to vocab** → word saved to your cheat sheet
5. Click the WordCatch icon again → see your saved words

---

## ⚙️ Environment Variables

All environment config lives in `backend/.env`. See [.env.example](backend/.env.example) for full documentation.

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | ✅ | — | MongoDB connection string |
| `JWT_SECRET` | ✅ | — | Secret key for signing JWTs |
| `JWT_EXPIRES_IN` | ❌ | `7d` | Token lifetime (e.g. `1h`, `7d`, `30d`) |
| `PORT` | ❌ | `3000` | Express server port |
| `EXTENSION_ORIGIN` | ❌ | `*` | CORS origin (set to `chrome-extension://<id>` in production) |

---

## 🧪 Testing

```bash
cd backend

# Run all tests (unit + integration)
npm test

# Run a specific test file
npx cross-env NODE_ENV=test npx jest __tests__/api.test.js --runInBand --forceExit

# Run with verbose output
npx cross-env NODE_ENV=test npx jest --runInBand --forceExit --verbose
```

### Test Suites

| Suite | File | What it tests |
|---|---|---|
| **API Integration** | `__tests__/api.test.js` | All 6 endpoints end-to-end (health, auth, lookup, save, vocab, delete) using in-memory MongoDB |
| **Normalisation** | `__tests__/normalisation.test.js` | `normalise()` and `fallbacks()` — suffix stripping, deduplication |
| **Date Key** | `__tests__/dateKey.test.js` | `isValidDateKey()` — format validation, ±1 day tolerance |
| **Load Test** | `__tests__/loadtest.js` | 50 concurrent lookups (run separately: `node __tests__/loadtest.js`) |

Integration tests use [`mongodb-memory-server`](https://github.com/nodkz/mongodb-memory-server) — no external database needed.

---

## 📁 Project Structure

```
WordCatch/
├── extension/                  # Chrome Extension (Manifest V3)
│   ├── manifest.json           # Extension manifest
│   ├── background/
│   │   └── service-worker.js   # JWT custody, API calls, message routing
│   ├── content/
│   │   └── content-script.js   # dblclick handler, Shadow DOM tooltip
│   ├── popup/
│   │   ├── popup.html          # Popup structure
│   │   ├── popup.js            # Auth forms, vocab list, filtering
│   │   └── popup.css           # Popup styling (dark theme)
│   └── icons/                  # Extension icons (16, 48, 128)
│
├── backend/                    # Node.js REST API
│   ├── src/
│   │   ├── index.js            # Express app setup, middleware, startup
│   │   ├── config/
│   │   │   └── db.js           # MongoDB connection
│   │   ├── middleware/
│   │   │   └── auth.js         # JWT verification middleware
│   │   ├── models/
│   │   │   ├── User.js         # User schema (bcrypt hashing)
│   │   │   ├── Word.js         # Global word cache schema
│   │   │   └── UserVocabulary.js # Per-user vocabulary entries
│   │   ├── routes/
│   │   │   ├── auth.js         # POST /api/auth/register, /login
│   │   │   └── words.js        # POST /lookup, /save, GET /, DELETE /:id
│   │   ├── services/
│   │   │   ├── dictionaryService.js    # Cache → API → negative cache
│   │   │   └── normalisationService.js # Lemma key + morphological fallbacks
│   │   └── utils/
│   │       ├── dateKey.js      # YYYY-MM-DD validation
│   │       └── response.js     # Consistent JSON envelope
│   ├── __tests__/              # Jest test suites
│   ├── nginx/
│   │   └── default.conf        # nginx reverse proxy config
│   ├── Dockerfile              # Multi-stage production build
│   ├── docker-compose.yml      # MongoDB + API (local dev)
│   └── package.json
│
└── SRS_WordCatch_v2.md         # Software Requirements Specification
```

---

## 🔌 API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | ❌ | Process + database status |
| `POST` | `/api/auth/register` | ❌ | Create account, returns JWT |
| `POST` | `/api/auth/login` | ❌ | Authenticate, returns JWT |
| `POST` | `/api/words/lookup` | ✅ | Look up a word (cache → external API → negative cache) |
| `POST` | `/api/words/save` | ✅ | Save word to personal vocabulary |
| `GET` | `/api/words` | ✅ | Get vocabulary (optional `?from=&to=` date filter) |
| `DELETE` | `/api/words/:id` | ✅ | Delete a saved vocabulary entry |

All authenticated endpoints expect `Authorization: Bearer <token>`.

Response envelope: `{ ok: true, data: {...} }` or `{ ok: false, error: { code, message } }`.

---

## 🛡️ Security

- Passwords hashed with **bcrypt** (12 rounds) before storage
- JWT secrets and database credentials supplied as **environment variables** — never in source control
- Content script has **zero access** to the JWT or network — all auth flows through the service worker
- CORS locked to the extension origin in production
- Rate limiting at both the **application layer** (per-user, 30 lookups/min) and **nginx layer** (per-IP, 20 req/s)
- Tooltip rendered in a **closed Shadow DOM** — host page scripts cannot access it

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome Manifest V3, vanilla JS, Shadow DOM |
| Backend | Node.js, Express, Mongoose |
| Database | MongoDB (Atlas for production, Docker for dev) |
| Auth | JWT (jsonwebtoken), bcrypt |
| Dictionary | [Free Dictionary API](https://dictionaryapi.dev/) |
| Infrastructure | Docker, nginx, AWS EC2 (production) |
| Testing | Jest, Supertest, mongodb-memory-server |

---

## 📋 SRS Compliance

This project is built against a formal [Software Requirements Specification (v2.0)](SRS_WordCatch_v2.md). All functional requirements (FR-1 through FR-7) and non-functional requirements (NFR-1 th[...]

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — created by [Yogendra Bisht](https://github.com/Yogendra-Bisht). Feel free to use, modify, and build upon it!
