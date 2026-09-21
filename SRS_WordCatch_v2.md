# Software Requirements Specification

**Project:** WordCatch — Contextual Vocabulary Builder (Chrome Extension)
**Prepared for:** Yogendra Bisht
**Version:** 2.0
**Date:** September 21, 2026
**Supersedes:** v1.0 (September 11, 2026)

---

## 0. Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0 | 2026-09-11 | Initial specification |
| 2.0 | 2026-09-21 | Reworked extension messaging architecture; JWT moved out of the content script; word normalization and negative caching added; duplicate-prevention mechanism specified; `words` schema restructured for multi-sense definitions; guest mode deferred; domain/TLS prerequisite made explicit; lookup endpoint now authenticated and rate-limited |

Rationale for each v2.0 change is recorded in **Appendix A**. Decisions that were made on a default and can reasonably be reversed are listed in **Appendix B**.

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional and non-functional requirements for **WordCatch**, a Chrome extension that lets students capture unfamiliar words from any webpage by double-clicking them, automatically fetches the meaning, and builds a personal, date-stamped vocabulary list — removing the manual "write it down, then search it up" workflow.

### 1.2 Intended Audience
Developer (self), and any future collaborator or reviewer evaluating the project as a portfolio piece.

### 1.3 Scope
The system consists of:

- A Chrome extension (Manifest V3), composed of three isolated contexts:
  - **Content script** — DOM interaction and tooltip rendering only
  - **Service worker** (background) — all network I/O, credential custody, caching
  - **Popup UI** — vocabulary review and authentication forms
- A backend REST API (Node.js / Express)
- A database (MongoDB Atlas) for the shared word cache and per-user vocabulary
- Infrastructure: Dockerised API deployed on AWS EC2 behind nginx, served from a registered domain over TLS

Out of scope for v1: mobile browsers, multi-word phrase/idiom capture, spaced-repetition scheduling, unauthenticated/guest usage, and browsers other than Chrome (Edge/Firefox parity is a future consideration since both support Manifest V3, but is not built or tested in v1).

### 1.4 Definitions

| Term | Meaning |
|---|---|
| Capture | The act of double-clicking a word to select it for lookup |
| Captured form | The exact surface form the user clicked, e.g. `running` |
| Lemma key | The normalised base form under which a word is cached, e.g. `run` |
| Cheat sheet | The date-grouped list of a user's saved words |
| Cache hit | A `words` document already exists for the lemma key |
| Cache miss | No `words` document exists; the external dictionary API is queried |
| Negative cache entry | A `words` document with `found: false`, recording that no definition exists, so the external API is not re-queried |
| `dateKey` | The capture date as a `YYYY-MM-DD` string in the user's local timezone, used as the day-granularity uniqueness key |
| Service worker | The extension's MV3 background context; ephemeral and terminated when idle |

---

## 2. Overall Description

### 2.1 Product Perspective
A standalone browser extension with a lightweight backend. Not dependent on any existing product. Vocabulary data is user-owned and persists across sessions and devices (tied to account, not browser).

### 2.2 User Classes

| User class | Description |
|---|---|
| Registered user | Authenticated via JWT; all captures saved to their personal cloud vocabulary |
| Unauthenticated visitor | Can install the extension but sees a login prompt on first capture; no lookup or save capability until signed in |

> **Changed in v2.0.** The v1 "Guest" class (local-only captures, no sync) has been deferred. It required a second storage path and an unspecified merge-on-login migration, and it forced the lookup endpoint to remain public. See Appendix A.1 and Future Scope §9.

### 2.3 Operating Environment

- **Client:** Google Chrome, latest stable, Manifest V3, desktop only for v1
- **Server:** Node.js / Express, containerised with Docker
- **Hosting:** AWS EC2 instance; nginx as reverse proxy, TLS terminator, and rate limiter
- **Domain:** A registered domain name resolving to the EC2 instance, required before TLS can be provisioned
- **Database:** MongoDB Atlas (cloud-hosted)

### 2.4 Assumptions and Dependencies

- The user has an active internet connection for lookups (no offline dictionary in v1).
- A registered domain name is available and pointed at the EC2 instance. **Certificates cannot be issued for a bare EC2 public IP**, so NFR-3 is unsatisfiable without this.
- The extension is published (or loaded with a fixed `key` in the manifest) so that its extension ID — and therefore its origin — is stable and can be allowlisted by the API's CORS policy.
- Reliance on a third-party dictionary API (e.g. Free Dictionary API) for definitions not already cached. This API carries no SLA and no documented rate limit; the cache is the primary mitigation.
- Chrome Web Store review is not covered by this SRS.

---

## 3. Extension Architecture

This section is new in v2.0 and is normative. It constrains how the requirements in §4 are implemented.

### 3.1 Context Responsibilities

| Context | May do | Must not do |
|---|---|---|
| Content script | Listen for `dblclick`, read selection and sentence context, render the tooltip inside a Shadow DOM root | Call the backend; read, hold, or receive the JWT; write to `chrome.storage` |
| Service worker | All `fetch` calls to the backend, JWT custody, token attachment, message routing | Assume any in-memory state survives between invocations |
| Popup | Render vocabulary and auth forms, message the service worker | Call the backend directly |

### 3.2 Rationale
A content script executes in the host page's origin. Any request it issues is a cross-origin request subject to CORS, and any credential within its reach shares a context with arbitrary third-party page code. Routing all network access through the service worker gives a single trusted network boundary, a single place to attach the token, and a single place to handle 401s.

### 3.3 Messaging Contract

Content script → service worker:

```
{ type: "LOOKUP",  word, sentence, url }
{ type: "SAVE",    word, sentence, url, dateKey }
```

Popup → service worker:

```
{ type: "GET_VOCAB", from, to }
{ type: "LOGIN",     email, password }
{ type: "LOGOUT" }
```

Every response takes the form `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. The content script renders `error.message` and never inspects transport details.

### 3.4 State Persistence
The MV3 service worker is terminated after a short idle period and restarted cold on the next event. Therefore:

- The JWT, the current user record, and any session state **shall** be persisted in `chrome.storage` and re-read on each invocation.
- No requirement shall depend on a module-scope variable retaining its value between messages.

---

## 4. Functional Requirements

### FR-1 — Word Capture
- **FR-1.1** The content script shall detect a `dblclick` event on body text within the host page.
- **FR-1.2** The system shall extract the selected text using `window.getSelection()`, trimmed of surrounding whitespace and punctuation.
- **FR-1.3** The system shall ignore selections that do not resolve to a single word (e.g. an accidental double-click-drag across multiple words) for v1 scope.
- **FR-1.4** The system shall capture the sentence containing the selected word for context storage.
- **FR-1.5** *(new)* The system shall not trigger capture when the selection originates inside an editable region — `<input>`, `<textarea>`, or any element under a `contenteditable` ancestor — so as not to interfere with editors such as Google Docs, Notion, or in-browser IDEs.
- **FR-1.6** *(new)* The content script shall forward the capture to the service worker via `chrome.runtime.sendMessage` and shall not issue any network request itself.

### FR-2 — Word Normalisation
*(new section in v2.0)*

- **FR-2.1** Before lookup, the service worker shall normalise the captured form to a lemma key by lowercasing it and stripping non-alphabetic characters.
- **FR-2.2** If the normalised form yields no definition, the backend shall attempt a bounded sequence of morphological fallbacks before declaring failure, at minimum: plural `-s` / `-es`, past tense `-ed`, progressive `-ing`, and `-ies → -y`, including the doubled-consonant case (`running → run`).
- **FR-2.3** The system shall store the **captured form** alongside the resolved lemma key, so the cheat sheet can display the word as the user actually encountered it.
- **FR-2.4** If all fallbacks fail, the word shall be treated as having no definition (see FR-3.5).

### FR-3 — Meaning Lookup
- **FR-3.1** On capture, the service worker shall call `POST /api/words/lookup` with the lemma key, attaching the user's JWT.
- **FR-3.2** The backend shall check the local `words` cache collection before calling any external API.
- **FR-3.3** On a cache miss, the backend shall query the external dictionary API and store the result in the cache for future lookups.
- **FR-3.4** *(new)* On a confirmed "no definition" result, the backend shall write a **negative cache entry** (`found: false`) so that repeated lookups of the same non-word do not repeatedly hit the external API.
- **FR-3.5** If no definition is found, the system shall display a clear "no definition found" state rather than failing silently, and shall offer to save the word anyway with its sentence context.
- **FR-3.6** The meaning shall be displayed in a non-intrusive tooltip near the selected word within 2 seconds under normal network conditions.

### FR-4 — Personal Vocabulary Storage
- **FR-4.1** A logged-in user shall be able to save a captured word — with meaning, captured form, sentence context, source URL, and date — to their personal vocabulary via `POST /api/words/save`.
- **FR-4.2** The system shall date-stamp every saved word with both a precise `dateAdded` timestamp and a `dateKey` day string.
- **FR-4.3** *(revised)* The system shall prevent duplicate entries for the same word by the same user on the same day by enforcing a **compound unique index on `{ userId, wordId, dateKey }`**. The same word captured on a different day creates a new entry.
- **FR-4.4** *(new)* The `dateKey` shall be computed client-side from the user's local date and sent with the save request. The backend shall validate its format and reject values more than one calendar day from the server's current UTC date.
- **FR-4.5** A save request violating FR-4.3 shall return a success-equivalent response with the existing entry, not an error — re-capturing a word already saved today is expected behaviour, not a fault.

### FR-5 — Vocabulary Retrieval ("Cheat Sheet")
- **FR-5.1** The system shall provide `GET /api/words` returning the authenticated user's saved words, filterable by date range.
- **FR-5.2** The extension popup shall display the user's vocabulary grouped by `dateKey`, most recent first.
- **FR-5.3** The system shall allow the user to view the original sentence context and source URL for any saved word.
- **FR-5.4** *(new)* The system shall allow the user to delete a saved entry.

### FR-6 — Authentication
- **FR-6.1** The system shall support registration and login via email and password, issuing a JWT on success.
- **FR-6.2** *(revised)* The JWT shall be held by the service worker in `chrome.storage` and attached to outbound requests there. It shall never be transmitted to, or readable by, the content script.
- **FR-6.3** The system shall reject requests to any `/api/words/*` endpoint without a valid token, including lookup.
- **FR-6.4** *(new)* On a `401` response, the service worker shall clear the stored token and instruct the active context to prompt for re-authentication.

### FR-7 — Extension UI
- **FR-7.1** *(revised)* The tooltip shall be rendered inside a **closed Shadow DOM root** attached to a single injected host element, so that host-page CSS cannot inherit into it and its own styles cannot leak out.
- **FR-7.2** The tooltip shall be positioned near the double-clicked word without obscuring it, and shall reposition to stay within the viewport.
- **FR-7.3** The tooltip shall auto-dismiss on outside click, on `Escape`, or after a timeout.
- **FR-7.4** The toolbar popup shall show today's captured words and a link to the full vocabulary view.

---

## 5. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | Lookup response time shall be under 2 seconds for a cache hit, under 4 seconds for a cache miss (external API round-trip). |
| NFR-2 | The content script shall not noticeably degrade host page performance: no layout thrashing, and at most one injected DOM node at rest. |
| NFR-3 | All API traffic shall be served over HTTPS, terminated at nginx, using a certificate issued for the registered domain (see §2.4). |
| NFR-4 | Passwords shall be hashed (bcrypt or equivalent) before storage. JWT secrets and database credentials shall be supplied as environment variables and shall not appear in source control or in the container image. |
| NFR-5 | The backend API shall be containerised and independently deployable without manual server reconfiguration. |
| NFR-6 | *(new)* The API's CORS policy shall allow only the extension's own origin (`chrome-extension://<id>`); the extension ID shall be pinned via a fixed `key` in the manifest. |
| NFR-7 | *(new)* `/api/words/lookup` shall be rate-limited per authenticated user at the application layer and per IP at the nginx layer, to bound exposure of the upstream dictionary API. |
| NFR-8 | *(new)* No requirement's implementation shall rely on service-worker in-memory state persisting between events (see §3.4). |
| NFR-9 | The system shall handle at least 50 concurrent lookup requests without failure, verified by a scripted load test rather than by assertion. |
| NFR-10 | The extension shall function correctly on the latest stable Chrome release at time of testing. |
| NFR-11 | *(new)* The API shall expose an unauthenticated `GET /health` endpoint returning process and database connectivity status, for use by the reverse proxy and uptime monitoring. |

---

## 6. Data Requirements

### 6.1 `users`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `email` | String | unique index |
| `passwordHash` | String | |
| `createdAt` | Date | |

### 6.2 `words` (global cache)

*Restructured in v2.0 to hold multiple senses and negative results.*

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `word` | String | lemma key; lowercase; **unique index** |
| `found` | Boolean | `false` marks a negative cache entry |
| `meanings` | Array | `[ { partOfSpeech, definitions: [ { definition, example } ] } ]`; empty when `found: false` |
| `source` | String | which dictionary provider supplied the entry |
| `fetchedAt` | Date | |

> Definitions are treated as immutable once cached; no TTL is applied in v1.

### 6.3 `user_vocabulary`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId | ref → `users` |
| `wordId` | ObjectId | ref → `words` |
| `capturedForm` | String | the exact form the user clicked |
| `sentenceContext` | String | |
| `sourceUrl` | String | |
| `dateKey` | String | `YYYY-MM-DD`, user-local |
| `dateAdded` | Date | precise timestamp |

**Indexes**
- `{ userId: 1, wordId: 1, dateKey: 1 }` — unique; enforces FR-4.3
- `{ userId: 1, dateAdded: -1 }` — supports date-range retrieval (FR-5.1)

---

## 7. External Interface Requirements

- **Dictionary API:** Free Dictionary API (or equivalent), consumed **server-side only**. The extension never calls it directly, preserving a single point of caching, rate-limit control, and provider substitution.
- **Browser APIs:** `chrome.storage` (token and session state), `chrome.runtime` (messaging between content script, service worker, and popup).
- **Manifest permissions:** `storage`, `activeTab`, plus `host_permissions` for the backend domain so the service worker may fetch it.

---

## 8. Use Case Summary

| Use case | Actor | Trigger | Outcome |
|---|---|---|---|
| Capture word | Registered student | Double-clicks a word on any page | Meaning shown in tooltip |
| Capture unknown word | Registered student | Double-clicks a word with no definition | "No definition found" state, with the option to save anyway |
| Save word | Registered student | Confirms save from the tooltip | Word added to personal vocabulary, date-stamped |
| Re-capture same word | Registered student | Double-clicks a word already saved today | Existing entry returned; no duplicate created |
| Review vocabulary | Registered student | Opens extension popup | Date-grouped word list displayed |
| Register / Login | Student | Opens auth form in popup | JWT issued, session established |

---

## 9. Constraints

- v1 targets Chrome only (Manifest V3).
- Single-word capture only; no phrase or idiom support.
- Dependent on third-party dictionary API uptime and rate limits.
- Morphological fallback (FR-2.2) is rule-based, not a true lemmatiser, and will not resolve irregular forms such as *mice → mouse* or *went → go*.
- A registered domain is a hard prerequisite for the TLS requirement.

---

## 10. Future Scope (explicitly out of v1)

- Guest / local-only mode, **including a specified merge-on-login migration for locally captured words**
- Spaced-repetition review mode
- Multi-browser support (Firefox, Edge)
- Offline / local dictionary fallback
- Proper lemmatisation covering irregular inflections
- Export vocabulary as PDF / CSV
- Idiom and phrase capture via drag-select

---

## Appendix A — Rationale for v2.0 Changes

**A.1 Guest mode deferred.** Supporting unauthenticated capture required a parallel local storage path, and v1.0 left unspecified what happens to locally held words when a guest later registers. It also forced `/words/lookup` to remain public, which turns the backend into a free proxy to the upstream dictionary API on the operator's rate limit. Deferring guest mode removes all three problems at once and makes FR-6.3 straightforward.

**A.2 Network access moved to the service worker.** v1.0 implied the content script would call the API. A content script shares an origin with the host page: the call becomes a CORS request, and any token within its reach is exposed to arbitrary page scripts. §3 makes the service worker the sole network boundary.

**A.3 Service-worker ephemerality made explicit.** MV3 background contexts are terminated when idle. Requirements written against in-memory session state would have failed intermittently and unreproducibly. NFR-8 and §3.4 forbid that dependency.

**A.4 Duplicate prevention given a mechanism.** FR-3.3 in v1.0 stated the rule but the schema could not enforce it: `dateAdded` is a timestamp, so two same-day captures differ. The `dateKey` field plus a compound unique index makes the rule enforceable in the database rather than in application logic.

**A.5 `words` schema widened.** `meaning: String` collapsed what dictionary APIs actually return — multiple senses across multiple parts of speech. The `meanings` array preserves the structure; the UI may still render only the first sense.

**A.6 Normalisation and negative caching added.** Inflected forms (`running`, `studies`, `walked`) are the most common real capture and the most common upstream 404. Without a fallback ladder the extension appears broken on ordinary prose. Without negative caching, every repeated miss pays the full external round-trip.

**A.7 Shadow DOM mandated.** The tooltip is injected into pages whose CSS is unknown and hostile. Style inheritance would break its rendering on a significant fraction of sites.

**A.8 Domain prerequisite surfaced.** v1.0's NFR-3 (HTTPS) was unachievable as specified, since no certificate authority issues certificates for bare IP addresses. Recording this as an assumption prevents discovering it at deployment time.

---

## Appendix B — Open Decisions

These were resolved on a stated default. Each can be reversed without restructuring the specification.

| # | Decision | Default taken | Reversal cost |
|---|---|---|---|
| B-1 | Guest mode in v1 | Deferred | Moderate: reintroduces the second storage path and reopens the public-lookup question |
| B-2 | `dateKey` timezone authority | Client-local, server-validated | Low: switch to server UTC and drop FR-4.4 |
| B-3 | Sense rendering in the tooltip | First sense only; full set stored | Low: presentation-layer change only |
| B-4 | Morphological fallback depth | Rule-based ladder (FR-2.2) | Low now, higher later: a real lemmatiser adds a dependency |
| B-5 | Cache expiry on `words` | None; entries immutable | Low: add `fetchedAt`-based TTL |
| B-6 | Negative cache expiry | None in v1 | Low: risks permanently caching a miss caused by a transient upstream outage — worth revisiting |

---

*End of document.*
