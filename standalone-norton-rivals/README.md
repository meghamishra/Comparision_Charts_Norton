# Norton vs Other Companies — Standalone Dashboard

A self-hostable local version of the Norton LifeLock comparison dashboard.
It compares Norton (Norton 360 with LifeLock + Privacy Monitor Assistant)
against 26 other companies on two jobs: finding and removing your personal
information from data brokers, and protecting you while you browse. Every
claim is sourced from the company's own official website, with an exact
quote and link to the proof.

- 26 companies (one company was removed by the user on 2026-11-12 and is not included).
- 5 tabs: Only {company} · Privacy Features · Brokers · Tiers & Cost · Proof.
- Optery is selected by default.
- First-page pie has exactly three segments — Offered by {company} — not by
  Norton / Offered by both — differently / Offered by Norton — not by
  {company}. Data brokers count as ONE item ("Data brokers") in that pie;
  per-broker detail lives only on the Brokers tab.
- Norton stack: two bills totalling $209.98/yr (Select Plus $99.99 +
  Privacy Monitor Assistant add-on $109.99).

## Run it locally (Node version — with live refresh)

Requirements: Node.js 20 or later. No dependencies at all.

```bash
cd <this folder>
npm start            # or: node server.js
# open http://localhost:3000
```

Port: `PORT=8080 npm start`. The server serves the dashboard and exposes
a small JSON API (`/api/rivals`, `/api/norton`, `/api/overview`,
`/api/comparison/:id`, `/api/brokers/:company`). The "Refresh data" button
in the page (or `POST /api/refresh`) re-checks the companies' official
pages. Refresh is manual only — there is no automatic or daily re-check.

## Static version (no server needed)

The `static/` folder is the same dashboard with the same data, loaded from
local JSON files instead of the API. It runs on any plain static host:

```bash
# from this folder
python3 -m http.server 8000 -d static
# open http://localhost:8000
```

Cloudflare Pages, Netlify, GitHub Pages and Vercel all host a folder like
this on their free tier — upload the contents of `static/` (not the folder
itself) as the site root. The static copy has no refresh button; re-extract
the data to update it.

## Deploy to Render (free) — the version with refresh

Render deploys from your own GitHub repository. `render.yaml` in this
folder already describes the service (free plan, `npm install` build,
`npm start` start command), so Render picks it up automatically.

1. Sign in at github.com as **meghamishra**.
2. Open your existing repository:
   **github.com/meghamishra/Comparision_Charts_Norton**.
3. Unzip this package, then in the repo choose "Add file" → "Upload files"
   and drag in ALL the contents of the unzipped folder — `server.js`,
   `package.json`, `render.yaml`, `public/`, `data/`, `scripts/` — the
   contents, not the folder itself, so `render.yaml` and `package.json`
   sit at the top level of the repo. Commit changes. (If the repo still
   holds an older copy inside a `standalone-norton-rivals` folder, the
   new files at the top level are the ones Render should use.)
4. Go to render.com → Sign in with GitHub (meghamishra).
5. New + → Web Service → "Build and deploy from a Git repository" →
   pick **meghamishra/Comparision_Charts_Norton**. If you already created
   the service earlier, just connect it to this repo instead.
6. Render reads `render.yaml` automatically (Free plan, build and start
   commands pre-filled) → Create Web Service. In Settings, Root Directory
   must be EMPTY (blank) because the files now sit at the repo's top
   level; Build Command `npm install`, Start Command `npm start`.
7. Wait for "Your service is live".

The free plan costs nothing. Note: a free Render service sleeps after a
period with no traffic, so the first visit after a long idle gap takes
about 30–50 seconds to wake up — that is normal on the free tier.

## Files

- `server.js` — zero-dependency Node server (node:http only).
- `package.json` — engines node >= 20, `npm start` runs `node server.js`.
- `render.yaml` — one free Render web service.
- `public/` — dashboard UI (index.html, app.js, styles.css).
- `data/` — the extracted comparison data. `data/rivals.json` (company
  list), `data/norton.json`, `data/overview.json` (cross-company totals),
  `data/<company>.json` (one file per company, with gaps, partials,
  nortonOnly items and proofs), `data/brokers/*.json` (named broker
  lists), `data/EXTRACTION_STATUS.json` (data currency record).
- `static/` — the static copy (same UI/data, no server).
- `scripts/scrape.js` — the official-sites-only re-checker.

## How the data is checked (scripts/scrape.js)

- Canonical official pages only — one official domain per company. No
  reviews, aggregators or third-party comparisons. Anything a company's
  official site does not state is shown as "Not stated on official site",
  never invented.
- The generic engine may only REPORT a differing figure — it never
  auto-writes a changed value. Only the four tight parsers (Norton, Aura,
  Incogni, Optery) may auto-write a figure, and only when it was read
  cleanly from the canonical page.
- Run a dry run first: `node scripts/scrape.js --dry-run`. It reports
  differences without writing anything.
- Known drift, not errors: some companies' pages vary between reads
  (for example Malwarebytes' broker count and Optery's tier counts). A
  single differing read is reported, never silently overwritten.

## Data currency

See `data/EXTRACTION_STATUS.json`. This package is a snapshot of the
hosted dashboard as of 2026-11-25: 393 products compared — 217 offered by
both, 120 offered differently, 56 offered by the other company and not by
Norton; 479 Norton-only items across the 26 companies; Norton 374 named
brokers; Aura 525+ brokers; Optery Core 375+ / Extended 550+ / Ultimate
615+ automated / 930+ total. It does not receive hosted-dashboard fixes
automatically — run the refresh (Node version) or re-extract to update it.
