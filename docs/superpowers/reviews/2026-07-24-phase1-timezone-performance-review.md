# Phase 1 Timezone + Performance Hardening — Claude Review

**Date:** 2026-07-24  
**Repository:** `/home/nishel/laser-app`  
**Scope:** owner-requested timezone and performance hardening only  
**Production migration:** none  
**Firestore/rules/deploy:** untouched

## Summary

This change makes all app-owned calendar decisions explicit:

- Business dates, cache-day gates, meter defaults/limits, report defaults, quote dates,
  rate effective dates, PDF generation times, and freshness calculations use
  `Asia/Kolkata`.
- Naive BOCHU/TubePro timestamps are interpreted as `Asia/Shanghai` and exposed as additive
  `startTimeIst`, `endTimeIst`, and `businessDay` fields in the browser.
- Original `day`, `startTime`, and `endTime` fields are preserved. Existing BOCHU machine-day
  grouping therefore continues to reconcile with `laser_days` without rewriting production data.

The large `laser_jobs` browser cache now prefers IndexedDB. The existing localStorage cache remains
the fallback for private/unsupported browser modes. Period job/day filtering is memoized, and Vite
now emits stable React/Firebase vendor chunks so app-only releases do not invalidate those bundles.

## Files

- `src/lib/time.js` — explicit IST/China calendar helpers and additive job-time normalization.
- `src/lib/time.test.js` — midnight, offset, idempotence, and host-independent day tests.
- `src/lib/largeCache.js` — IndexedDB value cache with localStorage callback fallback.
- `src/lib/largeCache.test.js` — fallback behavior in a non-browser test runtime.
- `src/lib/jobcache.js` / `jobcache.test.js` — calendar-safe YYYYMMDD window arithmetic.
- `src/firebase.js` — IST cache/rate dates, China-date query cutoff, normalized job display fields,
  and IndexedDB job cache.
- `src/App.jsx` — IST UI defaults/display, memoized period filters, and removal of the prior lint
  warning.
- `src/lib/pdf.js` — generated timestamp fixed to IST.
- `vite.config.js` — stable React and Firebase chunks.

## Compatibility Boundary

`laser_days.statDate` is an aggregate produced on the machine/cloud calendar. Moving a whole daily
aggregate back by 2.5 hours would be mathematically wrong because the boundary-crossing events cannot
be split without raw data. This phase therefore:

1. preserves source-day fields for current totals, filtering, and reconciliation;
2. displays individual job timestamps in IST;
3. exposes `businessDay` for the later normalized ingestion model.

A future sync/collector can persist UTC instants and generate authoritative IST rollups additively.
That later work requires an approved data-model/backfill plan and is intentionally not hidden inside
this no-migration phase.

## Verification

- Baseline before edits: 10 test suites passed; lint had one unused-function warning; build passed
  with a 675.78 kB app chunk and a Firebase mixed static/dynamic import warning.
- `npm test`: 12/12 suites passed.
- `TZ=UTC npm test`: 12/12 suites passed.
- `npm run lint`: clean, zero warnings.
- `npm run build`: passed.
- Final bundles:
  - app `76.16 kB` (`24.59 kB` gzip)
  - React `140.97 kB` (`45.29 kB` gzip)
  - Firebase `460.51 kB` (`109.83 kB` gzip)
- The prior Firebase import warning and oversized-main-chunk warning are gone.
- Headless Chrome loaded the mobile app shell from the local Vite server without a blank-screen or
  asset-resolution failure. Authenticated Firestore screens were not exercised because this review
  did not use an owner Google session.

## Review Focus

1. Confirm the deliberate decision to preserve source-day grouping while exposing IST display fields.
2. Confirm IndexedDB fallback semantics are acceptable for the supported iPhone/Chrome environments.
3. Confirm manual vendor chunking is preferred over Rollup's default single app bundle.
4. No commit or deployment was performed.
