# WordCatch — Publishing Guide

> **Last updated:** 2026-09-28
> **Status:** Deployment complete ✅ — Publishing to Edge Add-ons Store remaining

---

## What's Already Done ✅

| Task | Details |
|---|---|
| MongoDB Atlas | Connected — `wordcatch` database on free M0 cluster |
| Backend on Render | Live at `https://wordcatch.onrender.com` |
| Extension updated | `API_BASE` and `host_permissions` point to Render URL |
| Committed & pushed | Branch `main` is up to date |

---

## Tonight's Plan — Publish to Microsoft Edge Add-ons Store

Edge Add-ons Store is **free to publish** (unlike Chrome Web Store which charges $5).
Your MV3 extension works on Edge with **zero code changes**.

---

## Step 1 — Take Screenshots (You do this manually)

Microsoft requires at least **1 screenshot**, up to 5.

**What to capture:**
- **Screenshot 1:** A webpage (e.g. Wikipedia) with the WordCatch tooltip appearing after double-clicking a word — showing the word definition
- **Screenshot 2:** The extension popup open, showing the vocabulary list with saved words

**Requirements:**
- Size: **1280×800px** or **640×400px**
- Format: PNG or JPEG
- Take them in **Microsoft Edge** browser (looks more native for Edge store)

**How to take exactly 1280×800:**
1. Open Edge → press `F12` (DevTools)
2. Click the device toolbar icon (📱) → set dimensions to 1280×800
3. Use Windows Snipping Tool (`Win + Shift + S`) to capture

Save screenshots to: `d:\WordCatch\store-assets\`

---

## Step 2 — Create Privacy Policy (Host on GitHub Pages)

Microsoft **requires** a public Privacy Policy URL before submission.

### 2.1 Create the privacy policy file

Create file: `d:\WordCatch\docs\privacy.md` with this content:

```markdown
# Privacy Policy for WordCatch

**Last updated:** September 2026

## What data we collect
- **Email address** — used for account creation and login only
- **Words you save** — stored in your personal account to build your vocabulary list
- **Source page URL** — saved alongside each word so you can revisit the context

## What we do NOT collect
- We do not collect browsing history
- We do not track which pages you visit
- We do not sell your data to any third party
- We do not use analytics or tracking pixels

## Where data is stored
Your data is stored securely in MongoDB Atlas (cloud database) and is accessible only via your authenticated account.

## Authentication
Passwords are hashed using bcrypt before storage. We never store plain-text passwords.

## Contact
For privacy concerns, contact: [your-email@gmail.com]
```

### 2.2 Enable GitHub Pages

1. Go to your GitHub repo → **Settings** → **Pages**
2. Source: **Deploy from a branch** → branch: `main` → folder: `/docs`
3. Save → your privacy policy will be live at:
   `https://yogendra-bisht.github.io/WordCatch/privacy`

> This URL is what you paste into the Edge Partner Center form.

---

## Step 3 — Store Listing Text

Copy-paste these when filling in the Edge Partner Center form.

### Short Description (max 150 chars)
```
Double-click any word on any webpage to instantly look it up and save it to your personal vocabulary list.
```

### Detailed Description
```
WordCatch is a productivity extension for readers and learners.

HOW IT WORKS:
1. Double-click any word on any webpage
2. A tooltip instantly shows the definition, phonetic, and part of speech
3. Click "Save" to add it to your personal vocabulary list
4. Open the WordCatch popup to review all your saved words, filtered by date

FEATURES:
✓ Instant word lookup — no need to open a new tab
✓ Definitions powered by the Free Dictionary API
✓ Personal vocabulary list grouped by the day you saved each word
✓ Source URL saved with each word so you can revisit the context
✓ Secure account system — your vocabulary follows you across devices
✓ Works on all websites
✓ Lightweight — no impact on page performance

PRIVACY:
WordCatch only collects your email and the words you choose to save. We never track your browsing history. See our full privacy policy for details.

Perfect for students, readers, language learners, and anyone who wants to grow their vocabulary naturally while browsing.
```

### Category
`Productivity`

---

## Step 4 — Package the Extension as ZIP

Run this in PowerShell:

```powershell
Compress-Archive -Path d:\WordCatch\extension\* -DestinationPath d:\WordCatch\wordcatch-v1.0.0.zip
```

This creates `wordcatch-v1.0.0.zip` — this is the file you upload to Edge Partner Center.

> ⚠️ Make sure the ZIP contains the `extension/` contents directly (not a nested folder).
> Check: open the ZIP — you should see `manifest.json` at the root, not `extension/manifest.json`.

---

## Step 5 — Submit on Edge Partner Center

1. Go to [partner.microsoft.com/en-us/dashboard/microsoftedge](https://partner.microsoft.com/en-us/dashboard/microsoftedge)
2. Sign in with your **Microsoft account**
3. Click **"Create new extension"**
4. Upload `wordcatch-v1.0.0.zip`
5. Fill in the listing:

| Field | Value |
|---|---|
| Name | `WordCatch` |
| Short description | *(from Step 3)* |
| Detailed description | *(from Step 3)* |
| Category | `Productivity` |
| Privacy policy URL | `https://yogendra-bisht.github.io/WordCatch/privacy` |
| Language | `English` |
| Screenshots | Upload 1–2 from Step 1 |
| Store icon | Use `extension/icons/128.png` |

6. Click **"Submit for review"**

**Review time:** 1–7 business days. Microsoft will email you when approved or if changes are needed.

---

## After Publishing — Lock Down CORS (Optional but Recommended)

Once your extension is approved, Edge assigns it a **permanent Extension ID** (looks like `abcdefghijklmnopqrstuvwxyzabcdef`).

You can then lock your backend API to only accept requests from your extension:

1. Copy your extension ID from Edge Add-ons dashboard
2. On **Render dashboard** → your service → **Environment** → add:
   ```
   EXTENSION_ORIGIN=chrome-extension://YOUR_EXTENSION_ID_HERE
   ```
3. Render auto-redeploys — your API now rejects requests from anywhere other than your extension

---

## Future Roadmap (After Edge Store)

| Task | Notes |
|---|---|
| Publish to Chrome Web Store | $5 one-time fee, same ZIP, larger audience |
| Add Namecheap custom domain | Use Student Pack free domain (e.g. `wordcatch.me`) |
| Upgrade to Azure App Service B1 | Use $100 Student Pack Azure credit for always-on, custom domain |
| Add monetization | Freemium model, Stripe payments, or "Buy Me a Coffee" |
| GitHub Actions CI/CD | Auto-deploy to Render on every push to `main` |

---

## Quick Reference

| Service | URL / Detail |
|---|---|
| **Live API** | `https://wordcatch.onrender.com` |
| **Health check** | `https://wordcatch.onrender.com/health` |
| **MongoDB Atlas** | `cloud.mongodb.com` → wordcatch cluster |
| **Render dashboard** | `render.com` → wordcatch-api service |
| **GitHub repo** | `github.com/Yogendra-Bisht/WordCatch` |
| **Edge Partner Center** | `partner.microsoft.com/en-us/dashboard/microsoftedge` |

---

*WordCatch PUBLISHING.md — v1.0.0 — September 2026*
