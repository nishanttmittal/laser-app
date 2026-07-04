# Laser App — "Parts" view (BOCHU-style, plus ₹ & speed)

**Date:** 2026-07-04 · **App:** `/home/nishel/laser-app` (React+Vite+Firebase+gh-pages)
**Owner goal (verbatim):** "keep [BOCHU parts screen] as it is plus whats missing from bochu app" — one app for everything.

## Problem
Owner likes BOCHU/TubePro's cloud "零件 (Parts)" screen: per-day list, each part = picture + name + length/thickness + piece count. Our app already syncs the cut data but shows it grouped by **size** (Production→Jobs / By-size), which (a) doesn't read like BOCHU's per-part list and (b) lumps different parts that share a cross-section. We build a dedicated **Parts** tab that reads like BOCHU **and** adds what BOCHU can't show: ₹ cost/price and cutting speed.

## Non-goals / constraints
- **No new BOCHU permissions.** Richer task/part endpoints (names, machine-rendered pictures) are permission-locked (`status 1007`) for our API key; unlock is requested but not granted. Build entirely from data we already sync (`work_logs/v2` → `laser_jobs`). If BOCHU unlocks later, better names/pics drop in on top — out of scope here.
- **Additive only.** New tab + one new pure lib module + tests. Do NOT change existing tabs, sync, costing math, or Firestore rules/data.
- **Known caveat (not fixed here):** for some days `work_logs/v2` appears to under-report (e.g. 40×40 pipes seen in BOCHU's 07/02 screen are absent from our synced 20260702). That is a SYNC-completeness issue tracked separately, not this view's job. The Parts tab faithfully shows whatever is in `laser_jobs`.

## Data & decisions (from data-analyst scan → `laser-iot/data/parts-scan-findings.md`)
- **Source:** existing `laser_jobs` (already loaded in App via `loadJobs`, enriched by `enrichJobs` for sizeKey and `tagJobs` for catalog name/photo).
- **Aggregation key = `` `${job.file}|${job.sizeKey}` ``** (one card per part). Chosen because grouping by `sizeKey` alone collides different parts (`30x20 t1.2` = 12 files / ~9,980 pcs). `file+sizeKey` keeps different parts separate and combines a part's repeat runs. (t0/missing-thickness runs land on a separate card — acceptable; do not merge across thickness.)
- **Label fallback chain** (81% of runs have blank names): `portionName` → `parts[0].name` → `file` (basename) → `sizeKey`.
- **Costing hooks** (`src/lib/costing.js`): `monthlyCost(days, cfg, jobs)` → `costPerBillMin`; then per card `quoteJob({ secPerPiece, qty: pieces, setupType:'none', cfg, costPerBillMin, chargePerMin: cfg.chargePerMin })` → `quoteCost` (₹ cost) and `quoteCharge` (₹ price) and `margin`. Per-piece = divide by pieces.
- **Role gating:** ₹ cost/price/margin render only for `role==='owner'`. (Staff `meter` role never reaches this tab — they get `StaffMeter` only — but gate defensively anyway.)

## Card shape (per part, one day)
```
[picture]  <label>                         x<totalPieces>
           <length>mm · <thickness>mm      (<runs> runs)
           <totalMin> min · <pcsPerMin>/min · <secPerPiece> s/pc
           [owner only] cost ₹<c>/pc · price ₹<p>/pc · margin ₹<m>
```
- **Picture:** staff catalog photo if the part is tagged (`catPhoto`, reuse existing `tagJobs`); else an **auto tube icon** — a small inline SVG chosen by shape: round (`section` matches `R…`) vs rectangle/square (`AxB`), sized-agnostic (a simple representative glyph, not to scale). New component `TubeIcon({ section })`.
- **Counts:** `totalPieces = Σ partAmount`; `runs = count`; `totalSec = Σ timeTaken`; `secPerPiece` from **good runs only** (`partAmount>0 && !aborted`), matching existing By-size logic; `pcsPerMin = totalPieces / (goodSec/60)`.
- Cards sorted by `totalPieces` desc (biggest job first), like the By-size view.

## Screen
- New top tab **`Parts`** added to `TABS` (`src/App.jsx`), placed **first** so it's the default landing (it's the owner's most-wanted view). Uses the same period/day model as other tabs.
- **Day picker** at top: dropdown of days that have jobs (from the loaded jobs), default = latest day with data. Mirrors BOCHU's `07/02` picker. (Reuse existing month/period helpers; add a per-day filter.)
- Search box (reuse pattern from `Jobs`) to filter by label/size/file.
- Empty state when a day has no parts.

## Components / files
- **New pure module** `src/lib/partsView.js` — `buildParts(jobs, { day })` → sorted array of card objects `{ key, label, section, length, thickness, sizeKey, catPhoto, pieces, runs, totalMin, secPerPiece, pcsPerMin, aborted, hasSize }`. No React, no ₹ (₹ computed in the component so cost stays owner-gated and out of any shared/testable data). Pure + deterministic.
- **New tests** `src/lib/partsView.test.js` (Vitest — repo already runs `*.test.js`): aggregation key correctness (30x20 t1.2 stays multiple cards; same file+size combines), label fallback, good-run sec/pc, day filter, empty input.
- **New component** in `src/App.jsx`: `Parts({ jobs, days, cfg, mo, role, rateHistory })` rendering the day picker + card list; `TubeIcon`. Wire into the tab switch and `TABS`. Compute ₹ via `monthlyCost` + `quoteJob` only when `role==='owner'`.
- **Styles** in `src/styles.css`: reuse `jobcard`/`joblist`/`jobthumb` classes; add `.particon` for the SVG.

## Testing / acceptance
1. `npm run build` passes (only gate in this repo; no test runner in CI but Vitest runs locally — run `npx vitest run src/lib/partsView.test.js`).
2. Unit tests green, incl. the collision guard (`30x20 t1.2` → many cards, not one).
3. Manual: owner sees ₹; a non-owner render path shows no ₹ (unit-check the gate by rendering with role!=='owner').
4. Real device load after deploy (per repo gotcha — a blank-screen crash won't show in build).
5. Deploy: `npm run deploy` (gh-pages `--dotfiles --nojekyll` — load-bearing).

## Rollback
Pure-additive: revert = remove `Parts` from `TABS` + the new files. No data/rules/costing touched.
