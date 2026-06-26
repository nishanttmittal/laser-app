# Laser App — Staff Meter Entry, Date Filters, Once-a-Day Caching & Tab Cleanup

**Date:** 2026-06-26  ·  **Status:** design (awaiting owner review)

## Goal
Let staff record the daily meter in-app, add day-level filtering and per-size/day costing,
read Firestore once a day (with a manual Refresh) to spare quota, and consolidate the tabs.

## 1 · Roles & access
- `apps/laser/users/<email>` gains a **`role`**: `owner` (full app) | `meter` (staff — Meter screen only).
- Bootstrap owner (`nspenterprises24@gmail.com`) = owner. App resolves role at login and routes:
  a `meter` user sees **only** the Meter screen (no dashboard, costing, margins).
- Firestore already allowlist-locked (`laserUser()`); `apps/laser/users` read stays `nonAnon` so the
  app can resolve role; owner writes the user docs (no UI yet → owner adds emails; small Users list in Admin later).

## 2 · In-app meter entry (staff + owner)
- **Meter screen:** date (default today) + **two cumulative readings** — Meter A (machine+UPS+dust),
  Meter B (compressor) — + optional note. Submit.
- Saved to a **new `laser_meter` collection**: `{cardId, date, meterA, meterB, total, enteredBy, at}`.
  Client-writable by `owner`/`meter` role only (new rule); read by `laserUser()`.
- **Daily kWh = total − previous reading's total.** A trusted backend step (`meter-apply.js`, added to
  `daily.sh`) computes deltas from `laser_meter` and writes `laser_days.kWh` as **meter-actual** via Admin
  SDK — so `laser_days` stays admin-written (client never writes production data).
- **Missed day:** the next entry's delta covers the gap; the **monthly total stays exact**, and a gap is
  split across its days by each day's cutting share (approximate per-day, correct per-month).
- Same-day display: the app can read `laser_meter` and show the computed kWh immediately; the persisted
  `laser_days.kWh` updates on the nightly apply.

## 3 · Read once a day + Refresh
- Cache `core` (days/config/meta) **and** jobs in localStorage with a **date stamp**. On open: if the
  stamp is today → serve cache, **zero Firestore reads**; else read once and re-stamp.
- **Refresh button** (header): clears the stamp → forces one live re-read (for current status when the
  machine is online). Extends the existing `jobcache` once/day idea to `core` too.

## 4 · Date filter
- Date picker on **Dashboard, Utilization, Reports** (beside the Today/Week/Month buttons). Picking a date
  shows that single day. This makes the standalone **Day** tab redundant → removed.

## 5 · Per-day, per-size costing
- In **Costing**, an optional **date**. With a date: a size's electricity =
  `(size's cut-min that day ÷ day's total cut-min) × day's kWh × ₹/unit` — **SIMPLE split by cutting time**
  (compressor is variable, so this is accurate). Without a date: monthly `cost/min` as today.

## 6 · Tab restructure (10 → 6 + staff)
| Owner tab | Absorbs |
|---|---|
| **Dashboard** | Dashboard (+ date filter) |
| **Utilization** | Utilization (+ date filter) |
| **Production** | Jobs + By Size |
| **Costing** | Costing + Margin + per-day/size + what-if |
| **Reports** | Reports (+ date filter); **Day** removed |
| **Admin** | Machine + Fix sizes + **Meter entry** + **Users** |
| _staff only_ **Meter** | the one staff screen |

## Build order (deploy + verify each)
1. **Caching once/day + Refresh** (quota relief first).
2. **Date filters** + remove Day tab.
3. **Staff role + Meter entry** (`laser_meter` + rule + `meter-apply.js`).
4. **Per-day-per-size costing** (simple split).
5. **Tab restructure**.

## Out of scope
- Photo OCR of meters (typed entry chosen). Optional photo upload could come later (needs Storage).
- Per-day base-vs-variable electricity split (simple whole-day split chosen).

## Risks
- Auth/role routing is production-critical — keep owner (bootstrap) full access; test staff role with a
  throwaway allowlisted email before relying on it.
- Client writing `laser_meter` is new — rule must restrict to `owner`/`meter` role; `laser_days` stays admin-only.
