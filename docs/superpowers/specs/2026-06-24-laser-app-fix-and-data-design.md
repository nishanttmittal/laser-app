# UNICO Laser App — Fix + Full Data Utilization

**Date:** 2026-06-24
**Owner:** Nishant Mittal (UNICO / NSP)
**Apps touched:** `laser-app` (React PWA, GitHub Pages) and `laser-iot` (Node sync, BOCHU IoT → Firestore `unico-operations`)
**Machine:** TubePro / Friendess, cardId `250811133266`, MaxSZ 3000 W tube laser.

---

## 1. Problem (what's wrong today)

Verified against the live app (`nishanttmittal.github.io/laser-app`) and real Firestore data (2,273 runs / 44 days).

**Looks "off":**
1. **Fonts** — numbers are monospace (typewriter), labels are tiny ALL-CAPS. Too small, too "computery," caps too harsh. (Owner confirmed all three.)
2. **Colours** — every size gets a random hash-generated hue → ~87 clashing dots (confetti). No meaning, looks cheap.
3. **Money truncated** — By-Size `₹/PC` and `MARGIN/PC` columns are too narrow; values render as `Rs 15..`, `Rs 43..`. Unreadable.
4. **Dashboard headline shows today** — "Latest day" shows the in-progress day (e.g. 7 pieces), making the app look empty/broken on open.

**Data "not okay":**
5. Sizes are derived from machine **file names**. Clean ones parse (`31.75x35 t3`); worker-typed junk cannot (`bhawani`, `tbi`, `all`, `last`, `ss`, `1-2`). `858x6010x31.75` is a sheet dimension mis-read as a size. **273 runs (12%) have no real size.** A smarter parser alone won't fix names like `bhawani`.

**Under-utilized data (owner's main ask):**
6. **Electricity (kWh) is already stored per day and never shown.** Pierces, work-time, material are stored, unused.
7. No way to pick a specific day, a week/month, or a custom period.
8. No day-wise / month-wise history beyond the raw Reports list.
9. BOCHU also exposes **alarms, live state, idle/offline breakdown, productivity** that we never pull.

**Reliability:**
10. The BOCHU API is **intermittent** — today's 09:20 sync worked, a later grab logged `fetch failed`, and live probes return HTTP 500. A missed sync is currently **silent**; data can go stale with no warning.

---

## 2. Scope (owner-approved)

**Phase 1 now → Phase 2 next.** Owner's priority data: electricity, pick-any-day detail, alarms, utilization (OEE), plus "anything else the cloud has."

**Honest data boundary:** live process parameters (gas pressure, laser power %, cutting speed, focus, nozzle) are **NOT** available via the BOCHU IoT statistics API — they live in TubePro on the machine PC. Out of scope. Everything else the owner listed is feasible.

---

## 3. Design

### 3.1 Visual fixes (Phase 1)

**Typography** (`src/styles.css`):
- Drop monospace for numbers. Use the system sans everywhere with `font-variant-numeric: tabular-nums` so figures still align in columns. Keep the `--mono` variable only for code/serial strings.
- Increase sizes: card value `23 → 28px`; card/section labels `11 → 13px`; table rows `14 → 15px`; bottom-nav `11 → 12px`.
- Remove `text-transform: uppercase` and heavy `letter-spacing` from labels, headings (`h2`), card titles, table headers. Use sentence case ("Pieces produced", not "PIECES PRODUCED").
- Keep the dark theme — it reads as premium and is correct for a shop-floor screen.

**Colour discipline** (replace confetti):
- Remove `hueFor` / `chipStyle` / `dotStyle` hash-colour logic.
- One accent (cyan `--accent`). Colour carries meaning **only**:
  - green = positive margin, red = negative margin (already used; keep),
  - amber = "Unlabelled / needs attention",
  - everything else = neutral text.
- Replace the per-size coloured dot with a neutral marker (or a small round-vs-rectangular tube glyph by `type`). No random hues.

**Money columns** (By-Size, Costing): restructure so ₹ values never truncate — reduce column count on narrow screens (e.g. show Size · Pieces · ₹/pc · Margin/pc; move Lengths/s-per-pc into the per-day drill-down), allow the number cells full width, and round sensibly (`₹1.09`, `₹15.30`).

**Dashboard headline** (`Dashboard`): headline = **last complete day**. Show the in-progress day as a small separate "Today (in progress)" strip so it's never mistaken for the main number.

### 3.2 Surface data we already store (Phase 1)

- **Electricity:** `laser_days.kWh` already exists. Show per day and per period: units (kWh) and ₹ (`kWh × electricityRate`, ₹14/unit from config). Add an "energy per 1,000 pieces" derived figure.
- **Pierces / work-time / material** per day surfaced in the day drill-down.

### 3.3 Period + day controls (Phase 1)

- A **period selector** in the header: Today · This week · This month · Last month · Custom range. Drives Dashboard, By-Size, Reports totals.
- A **single-day picker** → a **Day Detail** view: that day's pieces, runs, cut/laser-on/work hours, utilization, kWh + ₹, pierces, top sizes, and the runs list for that day. This is the owner's "find detail for a particular day."
- **Month-wise rollup** table (pieces, hours, kWh, ₹ charge, utilization per month).

### 3.4 Size cleanup (Phase 1)

- Group all `hasSize=false` runs under a single **"Unlabelled (n runs)"** bucket instead of dozens of junk rows. Keep the real sizes clean and on top.
- New owner-editable mapping `laser_size_map` (per cardId): `fileBase → { sizeKey, label, section, thickness }`. Sync (or the app) applies the map so a name like `bhawani` can be assigned its real size **once** and it sticks for all past+future runs.
- Phase 1 ships the grouping + map application + a minimal assign screen (pick an unlabelled file → type/confirm its size). A richer bulk-assign UI can follow.

### 3.5 Parser improvement (Phase 1, `laser-iot/parse.js`)

- Better-handle `AxBxC` filenames where the last number is the section (e.g. `858x6010x31.75` → treat trailing `31.75` as a round/section candidate, the large numbers as qty/length) — only when confident; otherwise leave it for the map.
- Detect aborted/0-piece runs (`endState`, `partAmount=0`) and exclude them from size stats so they don't pollute averages.
- No destructive re-write of historical docs beyond re-deriving `sizeKey`/`hasSize` on next sync (additive, idempotent — `repository` merge semantics).

### 3.5b What BOCHU actually exposes — confirmed from the WeChat app ("我的机床" / BondU)

The owner's WeChat mini-program **Report** screen (tabs: Stats · Tasks · Parts · Cons · Analysis), per machine + per period, already computes the **full scorecard** below with trend arrows (↑↓% vs previous period). This is the source of truth for "what the cloud has," and the model to mirror (but in our dark premium UI, with ₹ added, WhatsApp-shareable, integrated with UNICO):

**Stats scorecard (period totals):**
- Running Days, **Running Time (h)**, **Processing Time (h)**, **Laser-On Time (h)**, **Idle Time (h)**, **Offline Time (h)**
- **Power-On Rate %**, **Laser-On Rate %**, **Processing Rate %**  ← utilization / OEE, already calculated
- **Electricity (kWh)**, **Material Consumption (t)**, **Moving Length (m)**, **Cutting Length (m)**, **Pierces**
- **Alarm Count**, **Alarm Time (h)**
- **Tasks** (= runs), **Parts** (= pieces)

**Tasks tab:** per-run list with Completed/Pending split, file name, thickness, start time, time taken.
**Parts tab:** count + total length + weight (t), grouped by part name with length/thickness.
**Cons / Analysis tabs:** consumables + AI analysis (BOCHU's own AI: "Data Analysis," "Tech Params" recommendations — informational, not pulled).

**Headline business insight (06/23 actuals):** Offline 16.31h, Idle 4.62h, Laser-On 1.9h → **Laser-On Rate 24.7%**. The machine is idle/offline most of the day. Utilization is the #1 metric and ties directly to the laser job-work lead-gen effort (fill idle capacity). The app must put this front and centre.

**Implication:** alarms + utilization + idle/offline + material are **not a mystery** — they come from the BOCHU statistics summary (the same family as `/api/statistics/sum` / `productivity`). We simply don't pull those fields yet. Exact endpoint + field names must be confirmed by probing **when the machine is online** (the API returns 500 while it's offline).

### 3.6 New machine data (Phase 2 — pull the full scorecard)

Extend `laser-iot/sync.js` to also call the stats-summary endpoint and store the full scorecard per day. Confirm exact shapes by probing when the machine is online; design around these endpoints:
- **Full daily scorecard** (`/api/statistics/sum` / `/api/statistics/productivity`) → store running/processing/laser-on/idle/offline time, the three rates, electricity, material, moving+cutting length, pierces, alarm count + time, tasks, parts. Feeds a **Utilization** view that mirrors the WeChat Stats screen.
- **Alarms** (`/api/user_devices/current_alarms`, historical if available) → `laser_alarms`; count + history + simple pareto.
- **Idle / offline / cutting breakdown** (`/api/user_devices/time_periods`) → utilization detail.
- **Live status** (`/api/user_devices/current_state` / `current_work`) → a "right now" strip (running / idle / alarm / offline).

### 3.7 Sync reliability (Phase 2, `laser-iot`)

- Wrap BOCHU calls in **retry with backoff**; on final failure, send a **Telegram alert** (reuse `sendTelegram.js`) instead of failing silently.
- App shows **"Data as of <last good sync>"** in the header; warns if stale (> ~12h).
- `laser_sync_state` already tracks last run — surface it.

### 3.8 AI insight (Phase 3 — optional, flagged)

Daily plain-language summary to Telegram using data we already have: utilization, idle hours, energy cost, and anomaly flags (e.g. "size 30×20 cut 12% slower than its 30-day average — check nozzle/lens"). No new hardware. Decide later.

---

## 4. Data model changes

| Collection | Change | Phase |
|---|---|---|
| `laser_days` | no schema change; **display** existing `kWh`, `workTime`, `pierceCount` | 1 |
| `laser_size_map` | **new**: `{cardId, fileBase, sizeKey, label, section, thickness}` owner-editable | 1 |
| `laser_jobs` | re-derive `sizeKey`/`hasSize` via map on sync (additive, idempotent) | 1 |
| `laser_stats` | **new**: full daily scorecard (running/idle/offline time, 3 rates, kWh, material t, alarm count+time, tasks, parts) per day | 2 |
| `laser_alarms` | **new**: alarm events | 2 |
| `laser_periods` | **new**: idle/offline/cutting segments | 2 |
| `laser_state` | **new**: latest live state snapshot | 2 |

Firestore rules: add read for the new collections (allowlist as per existing laser collections); deploy via `attendance-app/jobs/deployRules.js` and audit after (a missing rule = silent default-deny — known gotcha).

---

## 5. Architecture note

`App.jsx` is one 330-line file. As Phase 1 adds Day Detail, period selector, electricity, and month rollup, split into `src/components/` (Card, Bars, Table, PeriodPicker), `src/tabs/` (one file per tab), and `src/lib/` (data load, period filtering, derived metrics). Keeps each unit small and testable. No rewrite of working logic — move and extend.

---

## 6. Out of scope
- Live process parameters (gas/power/speed/nozzle) — not in the API.
- Multi-machine aggregation (the 2nd Raybox machine) — separate later task.
- Rebuilding the costing model — reuse `laser-iot/config.js` as-is.

---

## 7. Build order (Phase 1)
1. Typography + colour + money-column fixes (visible win first).
2. Dashboard headline → last complete day + Today strip.
3. Surface electricity (kWh + ₹) on day cards and Reports.
4. Period selector + Day Detail view + month rollup.
5. Size grouping ("Unlabelled") + `laser_size_map` + minimal assign screen + parser tweak.
6. Verify: `npm run build` + real device load (no test runner — build + device are the gate). Deploy via `npm run deploy` (`--dotfiles --nojekyll`) on the **iPhone hotspot** (GitHub is blocked on the factory network).

Phase 2 (alarms, utilization, live status, sync retry/alert) starts once the BOCHU API is reachable enough to probe the exact response shapes.
