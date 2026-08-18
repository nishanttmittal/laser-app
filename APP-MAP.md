# UNICO Laser — app map (review context)

Written for an outside reviewer. This is the factory-floor app for a **single BOCHU/FSCUT
fiber tube-laser** at UNICO Metal Products (metal furniture components, Delhi NCR). It is
used by the **owner** (full access) and by **shop staff** (a meter-reading screen only).
It is production software — real quotes go to real customers from it.

## What it is

A Vite + React 18 PWA, deployed to **GitHub Pages** (`npm run deploy`, gh-pages,
`--dotfiles --nojekyll` is load-bearing). No server of our own. Data lives in a **shared
Firestore project `unico-operations`** used by ~10 UNICO apps, with **one shared ruleset**.

There is **no test runner beyond `node --test`** (`npm test`, 167 tests) and `eslint`
(`npm run lint`). A Vite build is the only other gate. There is no CI.

## How data gets in

The app does **not** talk to the laser machine. A separate Node project (`~/laser-iot`,
not in this repo) pulls from the BOCHU cloud API nightly at 21:00 via Windows Task
Scheduler and writes Firestore:

- `laser_days/{card}_{YYYYMMDD}` — one doc per machine-day (pieces, runs, laser-on hours,
  utilization, kWh, plus additive `mcp*` fields from BOCHU's metrics API).
- `laser_jobs/{workUuid}` — one doc per cutting run (~6,800 docs). `startTime` is stored in
  the **machine's China clock**; `src/lib/time.js` converts to IST for display. Do not
  "fix" the stored value.
- `laser_config/settings`, `laser_size_map`, `costing_cut_rates`, `apps/laser/{users,
  products,customers,quotes}`.

Key consequence: **the app is always as-of last night.** The freshness banner ("Data as of
…") exists so a dead sync can't masquerade as live data.

## Money-critical logic — review this hardest

`src/lib/costing.js` and `src/lib/quoteMath.js` decide what customers are charged.

- `costing.js` → `monthly()` spreads rent, salary, maintenance, consumables, depreciation
  and electricity over **billable minutes** (cut + setup + loading + QC) to produce
  `costPerBillMin` (currently ≈ ₹29.62/min). `quoteJob()` is the per-job model used by the
  Costing tab.
- `quoteMath.js` → `computeLine()` / `computeQuote()` power the customer-facing Quote tab.
  Price per piece = material + cutting + one-time setup ÷ qty. Four things were added on
  **2026-08-19** and deserve the most scrutiny:
  1. **Job-work basis** — `materialByCustomer`. When the customer supplies the tube,
     material leaves the price *and the cost* (leaving it in cost made job work report a
     loss it wasn't making). Quote-level switch with a per-line override; resolved in
     `computeQuote`, not `computeLine`, so a stale flag on a reopened line can't outrank
     the screen. `materialBasisNote()` must print on the screen, the PDF and the WhatsApp
     text — a cutting-only price read as all-in is a commercial dispute.
  2. **Setup & loading uplift** (`setupLoadPct`, default 50) — BOCHU's sec/pc is machine-ON
     only, so raw seconds under-bill. Applies to price and cost. A hand-typed
     `cutPricePerPiece` is never uplifted.
  3. **One-time setup per part** (`setupType` dimension/length/none + `newPart`) — minutes
     come from the owner's Admin rates (40 min size change, 25 min programming), charged
     once and divided by line qty. Absent `setupType` means `none` so quotes saved before
     the feature reprice exactly as quoted.
  4. Both features fall back to the pre-change behaviour on reopen, deliberately.

**Known weakness we already suspect** (please confirm or refute): material is costed at the
same ₹/kg it is priced at, so `estimatedMargin` ignores the real buy/sell spread on steel
(buy ≈ ₹72/kg, quote ₹80/kg) and understates margin on full-supply quotes.

## Access

Google sign-in only. `BOOTSTRAP` email in `src/firebase.js` is always owner; everyone else
is looked up in `apps/laser/users/{email}` and defaults to the **least** privilege. Role
`meter` sees only the staff meter screen — costing and margins must never leak to it.

## Read-cost constraint (shapes the code)

The shared Firestore project is on the **Spark free tier: 50,000 reads/day across all ~10
UNICO apps**. Exhaustion has taken worker apps down before. Hence `jobcache.js` /
`largeCache.js`: `laser_jobs` is cached on the device, refetched in a 35-day window, with a
full reconcile every 10 days, and read at most once per calendar day. On 2026-08-18 the
full reconcile was made **progressive** (recent window paints first, history merges in
behind) because a blocking ~6,800-doc read never completed on the owner's iPhone and the
app appeared dead.

## Layout

- `src/App.jsx` — shell, auth, period bar (Today/Week/Month/Last month/All + From–To date
  range), and the Dashboard / Utilization / Production / Costing / Reports / Admin tabs.
  It is large; splitting it is a fair criticism but not a priority.
- `src/tabs/Quote.jsx` — the customer quote workspace.
- `src/lib/*.js` — pure modules, each with a `.test.js` beside it. Business rules belong
  here, not in components.
- `scripts/` — machine-manifest build + the outbound-only sync agent for the shop-floor PC.

## What a review is most useful on

1. **Correctness of pricing maths** in `quoteMath.js` and `costing.js` — double-counting,
   unit errors (a real one shipped and was caught by a test: setup minutes divided by 60
   against a per-minute rate), division by zero, rounding, GST.
2. **Anything that could quote a customer too low**, or leak owner-only cost/margin data to
   a `meter` user.
3. **Firestore read-count regressions** — an unbounded query here can take down other apps.
4. Data-integrity risks around the nightly sync, timezone handling, and cached data being
   mistaken for live data.
5. Honest assessment of test coverage: the pure libs are well covered, **UI components have
   no tests at all**.
