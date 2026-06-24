# UNICO Laser App — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the laser app's look (fonts, colours, cut-off money, misleading dashboard) and surface the data already in the cloud (electricity, pick-any-day, week/month/period, month rollup), plus clean up junk sizes — all without depending on the BOCHU API.

**Architecture:** Single Vite + React PWA (`laser-app`) reading the shared `unico-operations` Firestore. Pure-logic helpers go in `src/lib/` and are TDD-tested with Node's built-in runner; React UI is verified by `npm run build` + a real device/browser load. Size cleanup is applied **client-side** from a new owner-editable `laser_size_map` collection so Phase 1 needs no re-sync. A separate independent task improves the `laser-iot/parse.js` parser for future syncs.

**Tech Stack:** Vite 5, React 18, Firebase 11 (Firestore + anonymous auth), gh-pages. Tests: `node --test` (built in, no new dependency). No CSS framework — plain `src/styles.css`.

## Global Constraints

- **No new runtime dependency.** Tests use Node's built-in `node:test` / `node:assert` only.
- **Vite build must pass for every UI task** — it is the only gate that catches the blank-screen class of bug. Run `npm run build` and confirm it exits 0.
- **Keep the dark theme.** `--bg:#0b0f15` etc. stay; this is a correct shop-floor look.
- **Colour carries meaning only:** green `#34d399` = positive margin, red `#f87171` = negative margin, amber `#f59e0b` = "needs attention / unlabelled". No random/hash hues.
- **Sentence case** for all labels/headings — no `text-transform: uppercase`.
- **Numbers use `font-variant-numeric: tabular-nums` in the body sans font** — not monospace. `--mono` stays only for serial/code strings.
- **Electricity ₹ = `kWh × cfg.electricityRate`**, fallback `14` (₹/unit). Charge ₹ uses `cfg.chargePerMin`, fallback `40`.
- **Machine cardId:** `250811133266` (constant `CARD` in `src/firebase.js`).
- **Deploy** is `npm run deploy` (`gh-pages -d dist --dotfiles --nojekyll`) and only works on the **iPhone hotspot** (GitHub blocked on factory network). Base path is `/laser-app/` — do not change.
- **Commit after each task.** Conventional commit messages.

---

## File Structure

**New files**
- `src/lib/format.js` — `rupee`, `fmt`, `prettyYmd`, `whenStr`, `MON` (moved out of `App.jsx`).
- `src/lib/format.test.js` — tests for format helpers.
- `src/lib/period.js` — `lastCompleteDay`, `periodRange`, `filterDaysByRange`, `filterJobsByRange`, `monthRollup`.
- `src/lib/period.test.js` — tests for period logic.
- `src/lib/sizemap.js` — `applySizeMap`, `groupBySize` (folds unlabelled into one bucket).
- `src/lib/sizemap.test.js` — tests for size mapping/grouping.
- `src/lib/energy.js` — `kWhCost`, `energyPer1000`.
- `src/lib/energy.test.js` — tests for energy math.

**Modified files**
- `src/styles.css` — typography, sentence-case, colour discipline, money-column widths, period bar, day-detail, month-rollup styles.
- `src/App.jsx` — remove hash-colour funcs; import lib helpers; add period state + selector; Dashboard headline fix + Today strip; electricity on cards/Reports; new Day Detail + Month tabs; By-Size grouping; assign screen.
- `src/firebase.js` — add `loadSizeMap()` and `saveSizeMapEntry()`.
- `laser-iot/parse.js` — parser improvement (independent task).
- `laser-iot/parse.test.js` — **new** tests for the parser.

> `App.jsx` is 330 lines and will grow. This plan extracts pure logic into `src/lib/` (keeps `App.jsx` focused) but does **not** split every tab into its own file in Phase 1 — that is a larger refactor deferred to avoid risk. Follow the existing single-file component pattern for the UI.

---

## Task 1: Extract & test format helpers (`src/lib/format.js`)

Pure refactor first so later tasks import shared helpers instead of duplicating them.

**Files:**
- Create: `src/lib/format.js`
- Test: `src/lib/format.test.js`
- Modify: `src/App.jsx` (remove local copies of these helpers, import from lib)

**Interfaces:**
- Produces:
  - `rupee(n: number) => string` — `'₹' + Math.round(n||0).toLocaleString('en-IN')`
  - `fmt(n) => string` — `n==null ? '-' : Number(n).toLocaleString('en-IN')`
  - `prettyYmd(s) => string` — `'YYYYMMDD' → 'DD-MM-YYYY'`
  - `whenStr(s) => string` — `'YYYY-MM-DD HH:MM:SS' → 'DD Mon · HH:MM'`
  - `MON: string[]` — `['','Jan',...,'Dec']`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/format.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rupee, fmt, prettyYmd, whenStr } from './format.js';

test('rupee rounds and uses ₹ + en-IN grouping', () => {
  assert.equal(rupee(1234.6), '₹1,235');
  assert.equal(rupee(0), '₹0');
  assert.equal(rupee(null), '₹0');
});
test('fmt handles null and groups', () => {
  assert.equal(fmt(null), '-');
  assert.equal(fmt(13430), '13,430');
});
test('prettyYmd reformats YYYYMMDD', () => {
  assert.equal(prettyYmd('20260624'), '24-06-2026');
});
test('whenStr formats a BOCHU datetime', () => {
  assert.equal(whenStr('2026-06-21 19:58:06'), '21 Jun · 19:58');
  assert.equal(whenStr(''), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/nishel/laser-app && node --test src/lib/format.test.js`
Expected: FAIL — `Cannot find module './format.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/format.js
export const rupee = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('en-IN'));
export const prettyYmd = (s) => { s = String(s); return `${s.slice(6, 8)}-${s.slice(4, 6)}-${s.slice(0, 4)}`; };
export const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const whenStr = (s) => {
  if (!s) return '';
  const [d, t] = String(s).split(' ');
  const p = d.split('-');
  return `${p[2]} ${MON[+p[1]]} · ${(t || '').slice(0, 5)}`;
};
```

> Note: this switches the currency prefix from `'Rs '` to `'₹'`. That is intentional (cleaner). All rupee output flows through this one function.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/format.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire `App.jsx` to import from lib**

In `src/App.jsx`, delete the local `rupee`, `fmt`, `prettyYmd`, `MON`, `whenStr` definitions (lines ~5–7 and ~19–20) and add at the top:

```js
import { rupee, fmt, prettyYmd, whenStr } from './lib/format.js'
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: exit 0, `dist/` rebuilt. (Confirms no broken import.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/format.js src/lib/format.test.js src/App.jsx
git commit -m "refactor: extract format helpers to src/lib + tests"
```

---

## Task 2: Typography + sentence case + colour discipline

Make it readable and stop the confetti. CSS + removal of hash-colour JS.

**Files:**
- Modify: `src/styles.css`
- Modify: `src/App.jsx` (remove `hueFor`/`chipStyle`/`dotStyle`/`needsInfo`/`labelClass` colour logic; simplify chips/dots)

**Interfaces:**
- Produces: no exported API; visual change only. After this task `App.jsx` no longer references `chipStyle`/`dotStyle`/`hueFor`.

- [ ] **Step 1: Typography + colour CSS edits in `src/styles.css`**

Replace the monospace-number rules and uppercase labels. Apply these exact changes:

```css
/* body: numbers use sans + tabular figures, not monospace */
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--txt);
  -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums; }

/* header */
.ttl { font-weight: 500; color: var(--mut); letter-spacing: .5px; font-size: 13px; } /* was uppercase 12px */

/* section eyebrow -> readable sentence-case heading */
h2 { font-size: 14px; color: var(--txt); font-weight: 700; margin: 24px 2px 12px;
  text-transform: none; letter-spacing: 0; display: flex; align-items: center; gap: 8px; }

/* cards: bigger, sans numbers */
.card-t { font-size: 13px; color: var(--mut); text-transform: none; letter-spacing: 0; }
.card-v { font-size: 28px; font-weight: 700; margin-top: 6px; font-family: inherit;
  font-variant-numeric: tabular-nums; letter-spacing: -.5px; }
.card-s { font-size: 12px; color: var(--mut); margin-top: 3px; }

/* bars: sans labels, a touch bigger */
.bar-x { font-size: 10px; color: var(--faint); font-family: inherit; }
.bar-v { font-size: 10px; color: var(--mut); height: 12px; font-family: inherit; }

/* tables: bigger, sans numbers, sentence-case headers */
.tr { font-size: 15px; }
.tr.th { color: var(--faint); font-weight: 700; font-size: 11px; text-transform: none; letter-spacing: .2px; }
.tr > span:not(:first-child) { text-align: right; font-family: inherit; font-variant-numeric: tabular-nums; }

/* jobs cards: bigger numbers, sentence-case unit labels */
.jobcard-stats b { font-size: 19px; font-weight: 700; font-family: inherit; font-variant-numeric: tabular-nums; }
.jobcard-stats span { font-size: 11px; color: var(--mut); text-transform: none; letter-spacing: 0; }
.jobcard-when { font-size: 12px; color: var(--mut); font-family: inherit; }

/* bottom nav: a touch bigger, sentence case */
.tabs button { font-size: 12px; font-weight: 600; letter-spacing: 0; }

/* neutral size marker (replaces hash-coloured dot) */
.dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: var(--faint); }
.dot.warn { background: var(--amber); }
/* neutral chip (replaces hash-coloured chip) */
.chip { font-size: 14px; font-weight: 700; padding: 6px 12px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel2); color: var(--txt);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%; }
.chip.warn { color: var(--amber); border-color: rgba(245,158,11,.5); background: rgba(245,158,11,.12); }
```

- [ ] **Step 2: Remove hash-colour logic from `src/App.jsx`**

Delete these definitions (lines ~8–18): `needsInfo`, `labelClass`, `hueFor`, `chipStyle`, `dotStyle`. Replace their usages:

In `Jobs`, the job card:
```jsx
<div className="jobcard" key={j.workUuid}>
  <div className="jobcard-head">
    <span className={'chip' + (j.hasSize ? '' : ' warn')}>{j.sizeKey}</span>
    <span className="jobcard-when">{whenStr(j.startTime)}</span>
  </div>
```
(Removed `style={{ borderLeftColor: ... }}` and `style={chipStyle(...)}`.)

In `BySize`, the size cell:
```jsx
<span className={'szcell' + (s.hasSize ? '' : ' isname')}>
  <i className={'dot' + (s.hasSize ? '' : ' warn')} />{s.sizeKey}
</span>
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exit 0. Then `npm run dev` and confirm in the browser: no random colours; numbers are sans + aligned; labels are sentence case; sizes bigger.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css src/App.jsx
git commit -m "style: readable sans typography, sentence case, meaning-only colours"
```

---

## Task 3: Fix cut-off money columns (By-Size + Costing)

**Files:**
- Modify: `src/styles.css` (`.tr.wide` grid; allow number cells room)
- Modify: `src/App.jsx` (`BySize` — drop the two low-value columns on phone so ₹ never truncates)

**Interfaces:**
- Produces: By-Size table renders full ₹ values; columns: Size · Pieces · ₹/pc · Margin/pc (Lengths and s/pc move into Day Detail / are dropped from the mobile table).

- [ ] **Step 1: Simplify the By-Size table to 4 columns in `App.jsx`**

Replace the `BySize` table header + rows:
```jsx
<div className="tbl">
  <div className="tr th sz4"><span>Size</span><span>Pieces</span><span>₹/pc</span><span>Margin/pc</span></div>
  {rows.map((s) => {
    const spp = s.pieces ? s.sec / s.pieces : 0
    const chgPc = (spp / 60) * charge
    const costPc = (spp / 60) * mo.costPerBillMin
    return (
      <div className="tr sz4" key={s.sizeKey}>
        <span className={'szcell' + (s.hasSize ? '' : ' isname')}><i className={'dot' + (s.hasSize ? '' : ' warn')} />{s.sizeKey}</span>
        <span>{fmt(s.pieces)}</span>
        <span>{'₹' + chgPc.toFixed(2)}</span>
        <span style={{ color: chgPc - costPc >= 0 ? '#34d399' : '#f87171' }}>{'₹' + (chgPc - costPc).toFixed(2)}</span>
      </div>
    )
  })}
</div>
```

- [ ] **Step 2: Add the `.sz4` grid in `src/styles.css`**

```css
.tr.sz4 { grid-template-columns: 1.7fr .8fr 1fr 1.1fr; }
```

- [ ] **Step 3: Verify build + visual**

Run: `npm run build` (exit 0). In `npm run dev`, open By Size: every ₹ value shows in full (e.g. `₹15.30`), no `..` truncation.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/styles.css
git commit -m "fix: By-Size 4-column layout so ₹ values never truncate"
```

---

## Task 4: Period logic helpers (`src/lib/period.js`)

Pure, fully TDD'd. Drives the period selector, Day Detail, and Month rollup.

**Files:**
- Create: `src/lib/period.js`
- Test: `src/lib/period.test.js`

**Interfaces:**
- Produces:
  - `ymd(date: Date) => number` — local date → `YYYYMMDD` number.
  - `lastCompleteDay(days: Day[], todayYmd: number) => Day|null` — newest day with `statDate < todayYmd` and `pieces>0`; else newest with `pieces>0`; else null.
  - `periodRange(kind, todayYmd, custom?) => {from: number, to: number}` — `kind ∈ 'today'|'week'|'month'|'lastMonth'|'all'|'custom'`. Inclusive `YYYYMMDD` bounds.
  - `filterDaysByRange(days, {from,to}) => Day[]`
  - `monthRollup(days) => MonthRow[]` — `[{ym:'2026-06', pieces, runs, cutH, laserOnH, kWh}]` sorted ascending.
  - `Day` shape: `{statDate:number, pieces:number, runs:number, cutTimeH:number, laserOnH:number, cutLengthM:number, kWh:number}`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/period.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ymd, lastCompleteDay, periodRange, filterDaysByRange, monthRollup } from './period.js';

const days = [
  { statDate: 20260621, pieces: 1971, runs: 31, cutTimeH: 4.19, laserOnH: 2.45, cutLengthM: 1194, kWh: 100 },
  { statDate: 20260622, pieces: 13430, runs: 87, cutTimeH: 6.79, laserOnH: 4.16, cutLengthM: 1966, kWh: 128 },
  { statDate: 20260624, pieces: 7, runs: 2, cutTimeH: 0.03, laserOnH: 0.01, cutLengthM: 4.7, kWh: 1 },
  { statDate: 20260501, pieces: 500, runs: 5, cutTimeH: 1, laserOnH: 0.5, cutLengthM: 100, kWh: 20 },
];

test('ymd builds YYYYMMDD from a Date', () => {
  assert.equal(ymd(new Date(2026, 5, 24)), 20260624); // month is 0-based
});
test('lastCompleteDay skips today and zero-piece days', () => {
  assert.equal(lastCompleteDay(days, 20260624).statDate, 20260622);
});
test('periodRange month covers the calendar month of today', () => {
  assert.deepEqual(periodRange('month', 20260624), { from: 20260601, to: 20260630 });
});
test('periodRange lastMonth covers previous calendar month', () => {
  assert.deepEqual(periodRange('lastMonth', 20260624), { from: 20260501, to: 20260531 });
});
test('periodRange custom passes bounds through', () => {
  assert.deepEqual(periodRange('custom', 20260624, { from: 20260610, to: 20260620 }), { from: 20260610, to: 20260620 });
});
test('filterDaysByRange is inclusive', () => {
  const r = filterDaysByRange(days, { from: 20260601, to: 20260630 });
  assert.deepEqual(r.map(d => d.statDate).sort(), [20260621, 20260622, 20260624]);
});
test('monthRollup groups by year-month and sums', () => {
  const r = monthRollup(days);
  const jun = r.find(m => m.ym === '2026-06');
  assert.equal(jun.pieces, 1971 + 13430 + 7);
  assert.equal(jun.runs, 31 + 87 + 2);
  assert.equal(r[0].ym, '2026-05'); // ascending
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/period.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/period.js
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const parseYmd = (n) => { const s = String(n); return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); };

export function lastCompleteDay(days, todayYmd) {
  const withPcs = days.filter((d) => (d.pieces || 0) > 0).sort((a, b) => a.statDate - b.statDate);
  const before = withPcs.filter((d) => d.statDate < todayYmd);
  return (before.length ? before[before.length - 1] : (withPcs[withPcs.length - 1] || null));
}

export function periodRange(kind, todayYmd, custom) {
  const t = parseYmd(todayYmd);
  const y = t.getFullYear(), m = t.getMonth();
  const mk = (d) => ymd(d);
  if (kind === 'today') return { from: todayYmd, to: todayYmd };
  if (kind === 'week') { const s = new Date(t); s.setDate(t.getDate() - 6); return { from: mk(s), to: todayYmd }; }
  if (kind === 'month') return { from: y * 10000 + (m + 1) * 100 + 1, to: mk(new Date(y, m + 1, 0)) };
  if (kind === 'lastMonth') return { from: mk(new Date(y, m - 1, 1)), to: mk(new Date(y, m, 0)) };
  if (kind === 'custom') return { from: custom.from, to: custom.to };
  return { from: 0, to: 99999999 }; // 'all'
}

export const filterDaysByRange = (days, { from, to }) =>
  days.filter((d) => d.statDate >= from && d.statDate <= to);

export function monthRollup(days) {
  const m = {};
  for (const d of days) {
    const ym = `${String(d.statDate).slice(0, 4)}-${String(d.statDate).slice(4, 6)}`;
    const r = (m[ym] = m[ym] || { ym, pieces: 0, runs: 0, cutH: 0, laserOnH: 0, kWh: 0 });
    r.pieces += d.pieces || 0; r.runs += d.runs || 0; r.cutH += d.cutTimeH || 0;
    r.laserOnH += d.laserOnH || 0; r.kWh += d.kWh || 0;
  }
  return Object.values(m).sort((a, b) => a.ym.localeCompare(b.ym));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/period.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/period.js src/lib/period.test.js
git commit -m "feat: period filtering + lastCompleteDay + monthRollup helpers (tested)"
```

---

## Task 5: Energy helpers (`src/lib/energy.js`)

**Files:**
- Create: `src/lib/energy.js`
- Test: `src/lib/energy.test.js`

**Interfaces:**
- Produces:
  - `kWhCost(kWh: number, rate=14) => number` — ₹ for the energy.
  - `energyPer1000(kWh: number, pieces: number) => number|null` — kWh per 1,000 pieces, null if pieces=0.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/energy.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kWhCost, energyPer1000 } from './energy.js';

test('kWhCost multiplies by rate (default 14)', () => {
  assert.equal(kWhCost(127.94), +(127.94 * 14).toFixed(2));
  assert.equal(kWhCost(100, 12), 1200);
  assert.equal(kWhCost(0), 0);
});
test('energyPer1000 normalises per 1000 pieces, null on zero', () => {
  assert.equal(energyPer1000(128, 6172), +(128 / 6172 * 1000).toFixed(2));
  assert.equal(energyPer1000(10, 0), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/lib/energy.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// src/lib/energy.js
export const kWhCost = (kWh, rate = 14) => +(((kWh || 0) * rate)).toFixed(2);
export const energyPer1000 = (kWh, pieces) =>
  pieces > 0 ? +(((kWh || 0) / pieces) * 1000).toFixed(2) : null;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test src/lib/energy.test.js` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/energy.js src/lib/energy.test.js
git commit -m "feat: energy cost helpers (tested)"
```

---

## Task 6: Dashboard headline → last complete day + Today strip + electricity card

**Files:**
- Modify: `src/App.jsx` (`Dashboard`)
- Modify: `src/styles.css` (Today strip styles)

**Interfaces:**
- Consumes: `lastCompleteDay` (Task 4), `kWhCost` (Task 5), `rupee`/`fmt`/`prettyYmd` (Task 1).
- Produces: Dashboard shows the last complete day as the headline; a small "Today (in progress)" strip; an Electricity card (units + ₹).

- [ ] **Step 1: Add imports at top of `App.jsx`**

```js
import { lastCompleteDay, ymd } from './lib/period.js'
import { kWhCost } from './lib/energy.js'
```

- [ ] **Step 2: Rework the `Dashboard` head in `App.jsx`**

Replace the `const latest = days[days.length - 1]` line and the `<h2>Latest day …</h2>` + grid with:

```jsx
const todayY = ymd(new Date())
const headline = lastCompleteDay(days, todayY) || days[days.length - 1]
const today = days.find((d) => d.statDate === todayY)
const charge = cfg.chargePerMin || 40
const rate = cfg.electricityRate || 14
const cutMin = (headline?.cutTime || 0) / 60
// ...
<h2>Last full day — {prettyYmd(headline.statDate)}</h2>
{today && today.statDate !== headline.statDate && (
  <div className="todaystrip">Today ({prettyYmd(today.statDate)}, in progress): <b>{fmt(today.pieces || 0)}</b> pcs · {(today.cutTimeH || 0).toFixed(2)} h cutting</div>
)}
<div className="grid">
  <Card title="Pieces produced" value={fmt(headline.pieces || 0)} accent="#34d399" />
  <Card title="Lengths (runs)" value={fmt(headline.runs || 0)} />
  <Card title="Cutting" value={`${(headline.cutTimeH || 0).toFixed(2)} h`} />
  <Card title="Laser-on" value={`${(headline.laserOnH || 0).toFixed(2)} h`} />
  <Card title="Electricity" value={`${fmt(Math.round(headline.kWh || 0))} kWh`} sub={rupee(kWhCost(headline.kWh, rate))} />
  <Card title="Charge (cutting)" value={rupee(cutMin * charge)} accent="#34d399" />
</div>
```

(Remove the old `Cut length` card or keep it — six cards max for a clean 2-col grid; this set replaces Cut length with Electricity.)

- [ ] **Step 3: Add Today-strip CSS in `styles.css`**

```css
.todaystrip { background: var(--panel2); border: 1px dashed var(--line); border-radius: 10px;
  padding: 9px 12px; font-size: 13px; color: var(--mut); margin: 0 0 12px; }
.todaystrip b { color: var(--txt); }
```

- [ ] **Step 4: Verify build + visual**

Run: `npm run build` (exit 0). In dev, Dashboard headline shows 22-06 (last full day, 13,430 pcs), today shown only as the small strip, Electricity card shows kWh + ₹.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/styles.css
git commit -m "feat: dashboard headline = last full day + today strip + electricity card"
```

---

## Task 7: Period selector + wire Dashboard charts/Reports to it

**Files:**
- Modify: `src/App.jsx` (top-level period state; pass filtered days down)
- Modify: `src/styles.css` (period bar)

**Interfaces:**
- Consumes: `periodRange`, `filterDaysByRange`, `ymd` (Task 4).
- Produces: a header period bar (Today · Week · Month · Last month · All); selected range filters the days used by Dashboard charts, By-Size, and Reports. `App` holds `period` state and passes `vdays` (filtered) to tabs.

- [ ] **Step 1: Add period state in `App()` (`App.jsx`)**

```js
const [period, setPeriod] = useState('month')
const todayY = ymd(new Date())
const range = periodRange(period, todayY)
const vdays = filterDaysByRange(days, range)
const vjobs = (jobs || []).filter((j) => { const d = +j.day; return d >= range.from && d <= range.to })
```
Add imports: `import { periodRange, filterDaysByRange } from './lib/period.js'` (merge with existing period import).

- [ ] **Step 2: Render the period bar above `<main>`**

```jsx
<div className="periodbar">
  {[['today','Today'],['week','Week'],['month','Month'],['lastMonth','Last month'],['all','All']].map(([k,l]) => (
    <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>
  ))}
</div>
```

Pass filtered data: `Dashboard` gets `days={vdays}`, By-Size gets `jobs={vjobs}`, Reports gets `days={vdays}`. (Costing/Jobs keep full `jobs` for history-based averages; By-Size reflects the period.)

- [ ] **Step 3: Period-bar CSS**

```css
.periodbar { display: flex; gap: 6px; padding: 8px 16px 0; flex-wrap: wrap; }
.periodbar button { flex: 1; min-width: 64px; padding: 8px 6px; border: 1px solid var(--line);
  background: var(--panel2); color: var(--mut); border-radius: 9px; font-size: 12px; font-weight: 600; }
.periodbar button.on { color: var(--accent); border-color: var(--accent); background: rgba(56,189,248,.10); }
```

- [ ] **Step 4: Guard empty ranges**

In `Dashboard`, the bars use `days.slice(-14)`; with a filtered set that is fine. Confirm `Dashboard` still renders `<Empty/>` when `vdays` is empty (it already returns `<Empty/>` on `!days.length`).

- [ ] **Step 5: Verify build + manual**

Run: `npm run build` (exit 0). In dev: switching Today/Week/Month/Last month changes the dashboard cards/charts and By-Size totals. "All" shows everything.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/styles.css
git commit -m "feat: period selector filtering dashboard, by-size, reports"
```

---

## Task 8: Day Detail tab (pick any day)

**Files:**
- Modify: `src/App.jsx` (new `DayDetail` component + add to `TABS`)
- Modify: `src/styles.css` (date input reuse — uses existing `.search`/`.tbl`)

**Interfaces:**
- Consumes: `prettyYmd`, `fmt`, `rupee` (Task 1), `kWhCost` (Task 5).
- Produces: a "Day" tab with an HTML date input; selecting a date shows that day's card grid (pieces, runs, cutting h, laser-on h, electricity kWh+₹, pierces) and the runs cut that day.

- [ ] **Step 1: Add `DayDetail` to `App.jsx`**

```jsx
function DayDetail({ days, jobs, cfg }) {
  const ymds = days.map((d) => String(d.statDate)).sort()
  const [iso, setIso] = useState(() => { const s = ymds[ymds.length - 1] || ''; return s ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : '' })
  const pick = iso.replace(/-/g, '')
  const d = days.find((x) => String(x.statDate) === pick)
  const dayJobs = (jobs || []).filter((j) => j.day === pick)
  const rate = cfg.electricityRate || 14
  const charge = cfg.chargePerMin || 40
  return (
    <div>
      <h2>Pick a day</h2>
      <input className="search" type="date" value={iso} onChange={(e) => setIso(e.target.value)} />
      {!d ? <div className="note">No production recorded on {iso || 'that day'}.</div> : (
        <>
          <h2>{prettyYmd(d.statDate)}</h2>
          <div className="grid">
            <Card title="Pieces produced" value={fmt(d.pieces || 0)} accent="#34d399" />
            <Card title="Lengths (runs)" value={fmt(d.runs || 0)} />
            <Card title="Cutting" value={`${(d.cutTimeH || 0).toFixed(2)} h`} />
            <Card title="Laser-on" value={`${(d.laserOnH || 0).toFixed(2)} h`} />
            <Card title="Electricity" value={`${fmt(Math.round(d.kWh || 0))} kWh`} sub={rupee(kWhCost(d.kWh, rate))} />
            <Card title="Charge (cutting)" value={rupee(((d.cutTime || 0) / 60) * charge)} accent="#34d399" />
          </div>
          <h2>Runs that day ({dayJobs.length})</h2>
          <div className="tbl">
            <div className="tr th sz4"><span>Size</span><span>Pieces</span><span>Min</span><span>When</span></div>
            {dayJobs.map((j) => (
              <div className="tr sz4" key={j.workUuid}>
                <span className={'szcell' + (j.hasSize ? '' : ' isname')}>{j.sizeKey}</span>
                <span>{fmt(j.partAmount)}</span><span>{((j.timeTaken || 0) / 60).toFixed(1)}</span>
                <span>{(j.startTime || '').slice(11, 16)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register the tab**

In `App()`: `const TABS = ['Dashboard', 'Day', 'Jobs', 'By Size', 'Costing', 'Reports', 'Machine']` and add:
```jsx
{tab === 'Day' && (ready ? <DayDetail days={days} jobs={jobs} cfg={cfg} /> : <Loading />)}
```
(Use full `days`/`jobs`, not period-filtered — Day Detail picks its own day.)

- [ ] **Step 3: Verify build + manual**

Run: `npm run build` (exit 0). In dev: Day tab → date input defaults to latest day; pick 22-06 → shows 13,430 pcs + electricity + that day's runs list; pick a blank day → "No production recorded".

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: Day Detail tab — pick any day, full breakdown + runs"
```

---

## Task 9: Month rollup in Reports

**Files:**
- Modify: `src/App.jsx` (`Reports` — add month table above the day table)

**Interfaces:**
- Consumes: `monthRollup` (Task 4), `kWhCost` (Task 5), `fmt`, `rupee`.
- Produces: a month-wise summary table in Reports.

- [ ] **Step 1: Add the month table in `Reports`**

At the top of the `Reports` return, before the existing day table:
```jsx
import { monthRollup } from './lib/period.js' // add to top imports, not here
// inside Reports():
const months = monthRollup(days)
// ...JSX, above the day-wise table:
<h2>Month-wise summary</h2>
<div className="tbl">
  <div className="tr th sz4"><span>Month</span><span>Pieces</span><span>Cut h</span><span>kWh ₹</span></div>
  {months.map((m) => (
    <div className="tr sz4" key={m.ym}>
      <span>{m.ym}</span><span>{fmt(m.pieces)}</span><span>{m.cutH.toFixed(1)}</span>
      <span>{rupee(kWhCost(m.kWh, cfg.electricityRate || 14))}</span>
    </div>
  ))}
</div>
```
Move the `monthRollup` import to the top-of-file import block with the other period imports.

- [ ] **Step 2: Verify build + manual**

Run: `npm run build` (exit 0). Reports shows a `2026-06` month row with summed pieces/cut-h/electricity ₹, above the day list.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: month-wise summary in Reports"
```

---

## Task 10: Size extractor + map override + group unlabelled (`src/lib/sizemap.js`)

**OWNER RULE (2026-06-24):** the "junk" file names mostly **contain the size inside them** — extract it aggressively. The current parser is too strict (rejects dimensions > 600mm, needs the word "tube" for round). Pull the size out of the filename; only files with **no numbers at all** (`bhawani`, `tbi`, `ss`, `all`, `last`) stay Unlabelled. The manual assign screen (Task 12) is the override for any the extractor gets wrong.

**Extraction heuristic** (tube sections are small, lengths are large):
- Take all numbers from the filename base.
- If an `A x B (x C…)` pattern exists: classify each dimension number — **length** if `≥ 500`, else **section**. Section numbers form the size: 2 → `AxB`, 1 → `R{a}` (round), 0 (all ≥500, e.g. a sheet `1200x500`) → use the first two raw → `AxB`.
- If no `x` pattern but exactly one number `< 500` → `R{n}` (round bar/tube).
- Append ` t{thickness}` when thickness is known.
- No numbers → Unlabelled.

**Files:**
- Create: `src/lib/sizemap.js`
- Test: `src/lib/sizemap.test.js`

**Interfaces:**
- Produces:
  - `deriveSize(job) => { sizeKey: string, hasSize: boolean }` — extracts a size from `job.fileName`/`job.file` + `job.thickness` per the heuristic above. If `job.hasSize` is already true (clean parse upstream), returns the existing `job.sizeKey`.
  - `enrichJobs(jobs, map) => jobs'` — for each job: if `map[job.file]` exists, force `sizeKey=map[job.file].sizeKey, hasSize=true` (manual override wins); else apply `deriveSize`.
  - `groupBySize(jobs) => rows` — aggregate by `sizeKey`; **all `hasSize===false` runs collapse into one** `{sizeKey:'Unlabelled', hasSize:false, unlabelled:true, runs, pieces, sec}`; labelled sizes individual; sorted by pieces desc, Unlabelled forced last.
  - `unlabelledFiles(jobs) => [{file, runs, pieces}]` — distinct still-unlabelled files (after enrich), for the assign screen.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/sizemap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSize, enrichJobs, groupBySize, unlabelledFiles } from './sizemap.js';

test('deriveSize keeps a clean upstream size', () => {
  assert.deepEqual(deriveSize({ file: 'x.zzx', sizeKey: '30x20 t1.2', hasSize: true }),
    { sizeKey: '30x20 t1.2', hasSize: true });
});
test('deriveSize: AxBxLength -> section AxB + thickness', () => {
  assert.deepEqual(deriveSize({ file: '31.75x35x6000.zzx', thickness: 3 }),
    { sizeKey: '31.75x35 t3', hasSize: true });
});
test('deriveSize: Qty x Length x section -> round R{section}', () => {
  assert.deepEqual(deriveSize({ file: '858x6010x31.75.zzx', thickness: 1.2 }),
    { sizeKey: 'R31.75 t1.2', hasSize: true });
});
test('deriveSize: sheet AxB (both >=500) keeps AxB', () => {
  assert.deepEqual(deriveSize({ file: '1200x500step.zzx' }),
    { sizeKey: '1200x500', hasSize: true });
});
test('deriveSize: single number -> round', () => {
  assert.deepEqual(deriveSize({ file: '30.59.zzx', thickness: 1.2 }),
    { sizeKey: 'R30.59 t1.2', hasSize: true });
});
test('deriveSize: pure name -> unlabelled', () => {
  assert.deepEqual(deriveSize({ file: 'bhawani.zzx' }), { sizeKey: 'bhawani', hasSize: false });
  assert.deepEqual(deriveSize({ file: 'ss.zzx' }), { sizeKey: 'ss', hasSize: false });
});

const jobs = [
  { file: 'a.zzx', sizeKey: '30x20 t1.2', hasSize: true, partAmount: 100, timeTaken: 60 },
  { file: 'bhawani.zzx', hasSize: false, partAmount: 50, timeTaken: 120 },
  { file: 'bhawani.zzx', hasSize: false, partAmount: 30, timeTaken: 60 },
  { file: '858x6010x31.75.zzx', thickness: 1.2, hasSize: false, partAmount: 90, timeTaken: 90 },
];

test('enrichJobs derives sizes; map override wins', () => {
  const out = enrichJobs(jobs, { 'bhawani.zzx': { sizeKey: '40x40 t2' } });
  assert.ok(out.filter(j => j.file === 'bhawani.zzx').every(j => j.sizeKey === '40x40 t2' && j.hasSize));
  assert.equal(out.find(j => j.file === '858x6010x31.75.zzx').sizeKey, 'R31.75 t1.2'); // derived
});
test('groupBySize collapses only truly unlabelled, forced last', () => {
  const rows = groupBySize(enrichJobs(jobs, {})); // no map: bhawani stays unlabelled
  const unl = rows.find(r => r.unlabelled);
  assert.equal(unl.pieces, 80); // both bhawani runs
  assert.equal(rows[rows.length - 1].unlabelled, true);
  assert.ok(rows.some(r => r.sizeKey === 'R31.75 t1.2')); // derived size present, not in Unlabelled
});
test('unlabelledFiles lists only still-nameless files', () => {
  const f = unlabelledFiles(enrichJobs(jobs, {}));
  assert.equal(f.length, 1);
  assert.equal(f[0].file, 'bhawani.zzx');
  assert.equal(f[0].pieces, 80);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/lib/sizemap.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// src/lib/sizemap.js
const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
const noExt = (p) => baseName(p).replace(/\.(zx|zzx|dxf|nc|tube)$/i, '');
const trimNum = (s) => { const n = Number(s); return Number.isFinite(n) ? String(n) : String(s); };

export function deriveSize(job) {
  if (job.hasSize) return { sizeKey: job.sizeKey, hasSize: true };
  const base = noExt(job.fileName || job.file || '');
  const thk = job.thickness;
  const tsuf = (thk != null && thk !== '') ? ` t${thk}` : '';
  // dimensions joined by x/×/*
  const dim = base.match(/(\d+(?:\.\d+)?)\s*(?:[xX×*]\s*(\d+(?:\.\d+)?)\s*)+/);
  if (dim) {
    const nums = (dim[0].match(/\d+(?:\.\d+)?/g) || []).map(Number);
    const section = nums.filter((n) => n > 0 && n < 500);
    let key;
    if (section.length >= 2) key = `${trimNum(section[0])}x${trimNum(section[1])}`;
    else if (section.length === 1) key = `R${trimNum(section[0])}`;
    else key = `${trimNum(nums[0])}x${trimNum(nums[1])}`; // all >=500: sheet, keep AxB
    return { sizeKey: key + tsuf, hasSize: true };
  }
  // no x-pattern: a lone number = round bar/tube
  const one = base.match(/\d+(?:\.\d+)?/g);
  if (one && one.length === 1 && Number(one[0]) < 500) {
    return { sizeKey: `R${trimNum(one[0])}${tsuf}`, hasSize: true };
  }
  // truly nameless
  return { sizeKey: base || '★ unknown', hasSize: false };
}

export function enrichJobs(jobs, map) {
  return (jobs || []).map((j) => {
    const hit = map && map[j.file];
    if (hit) return { ...j, sizeKey: hit.sizeKey, hasSize: true };
    const d = deriveSize(j);
    return { ...j, sizeKey: d.sizeKey, hasSize: d.hasSize };
  });
}

export function groupBySize(jobs) {
  const m = {};
  const UNL = { sizeKey: 'Unlabelled', hasSize: false, unlabelled: true, runs: 0, pieces: 0, sec: 0 };
  for (const j of jobs || []) {
    if (!j.hasSize) { UNL.runs++; UNL.pieces += j.partAmount || 0; UNL.sec += j.timeTaken || 0; continue; }
    const s = (m[j.sizeKey] = m[j.sizeKey] || { sizeKey: j.sizeKey, hasSize: true, runs: 0, pieces: 0, sec: 0 });
    s.runs++; s.pieces += j.partAmount || 0; s.sec += j.timeTaken || 0;
  }
  const rows = Object.values(m).sort((a, b) => b.pieces - a.pieces);
  if (UNL.runs) rows.push(UNL);
  return rows;
}

export function unlabelledFiles(jobs) {
  const m = {};
  for (const j of jobs || []) {
    if (j.hasSize) continue;
    const r = (m[j.file] = m[j.file] || { file: j.file, runs: 0, pieces: 0 });
    r.runs++; r.pieces += j.partAmount || 0;
  }
  return Object.values(m).sort((a, b) => b.pieces - a.pieces);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test src/lib/sizemap.test.js` → PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sizemap.js src/lib/sizemap.test.js
git commit -m "feat: aggressive size extractor + map override + unlabelled grouping (tested)"
```

---

## Task 11: Load size-map + use grouping in By-Size

**Files:**
- Modify: `src/firebase.js` (add `loadSizeMap`)
- Modify: `src/App.jsx` (load map, apply to jobs, swap `bySizeAgg` → `groupBySize`)

**Interfaces:**
- Consumes: `enrichJobs`, `groupBySize` (Task 10).
- Produces: `loadSizeMap() => {[file]: {sizeKey, ...}}`. By-Size shows clean labelled sizes (most former "junk" now resolved by the extractor) + a single amber "Unlabelled (n runs)" row for the truly nameless.

- [ ] **Step 1: Add `loadSizeMap` to `src/firebase.js`**

```js
export async function loadSizeMap() {
  await ensureAuth()
  const snap = await getDocs(query(collection(db, 'laser_size_map'), where('cardId', '==', CARD)))
  const m = {}
  snap.docs.forEach((d) => { const x = d.data(); if (x.file) m[x.file] = x })
  return m
}
```

- [ ] **Step 2: Load + apply in `App.jsx`**

Add state + effect:
```js
import { loadCore, loadJobs, loadSizeMap } from './firebase'
import { enrichJobs, groupBySize } from './lib/sizemap.js'
// in App():
const [sizeMap, setSizeMap] = useState({})
useEffect(() => { loadSizeMap().then(setSizeMap).catch(() => {}) }, [])
const mappedJobs = useMemo(() => enrichJobs(jobs || [], sizeMap), [jobs, sizeMap])
```
Pass `mappedJobs` where `jobs` previously went into By-Size and Costing (so extraction + overrides apply everywhere): `vjobs` should derive from `mappedJobs` not raw `jobs`. Update the `vjobs` filter to use `mappedJobs`. Jobs tab also uses `mappedJobs` so the search shows extracted sizes.

- [ ] **Step 3: Use `groupBySize` in `BySize` and `Costing`**

Replace `const rows = bySizeAgg(jobs)` with `const rows = groupBySize(jobs)` in `BySize`. In `Costing`, replace `const sizes = bySizeAgg(jobs)` with `const sizes = groupBySize(jobs).filter((s) => !s.unlabelled)` (don't offer "Unlabelled" as a quotable size). Delete the now-unused local `bySizeAgg`.

- [ ] **Step 4: Verify build + manual**

Run: `npm run build` (exit 0). By-Size now shows clean sizes — former junk like `858x6010x31.75` resolves to `R31.75 t1.2`; only truly nameless files (`bhawani`, `ss`) collapse into one amber "Unlabelled" row at the bottom. With an empty `laser_size_map`, the extractor still does the work.

- [ ] **Step 5: Commit**

```bash
git add src/firebase.js src/App.jsx
git commit -m "feat: load laser_size_map, group unlabelled sizes in By-Size + Costing"
```

---

## Task 12: Assign screen (label an unlabelled file) + Firestore rule

**Files:**
- Modify: `src/firebase.js` (add `saveSizeMapEntry`)
- Modify: `src/App.jsx` (new `Assign` component under Machine tab, or a small section in By-Size)
- Modify: Firestore rules via `attendance-app/jobs` (read+write for `laser_size_map`)

**Interfaces:**
- Consumes: `unlabelledFiles` (Task 10), `loadSizeMap`.
- Produces: `saveSizeMapEntry({file, sizeKey}) => Promise` writing `laser_size_map/{CARD__file}`; a screen listing unlabelled files where the owner types the real size and saves.

- [ ] **Step 1: Add `saveSizeMapEntry` to `src/firebase.js`**

```js
import { setDoc } from 'firebase/firestore' // add to the firestore import line
export async function saveSizeMapEntry({ file, sizeKey }) {
  await ensureAuth()
  const id = `${CARD}__${file}`.replace(/[\/#?]/g, '_')
  await setDoc(doc(db, 'laser_size_map', id), { cardId: CARD, file, sizeKey, updatedAt: Date.now() }, { merge: true })
}
```

- [ ] **Step 2: Add an `Assign` section in `App.jsx`**

Add a new tab `'Fix sizes'` (or place inside Machine). Component:
```jsx
function Assign({ jobs, onSaved }) {
  const files = useMemo(() => unlabelledFiles(jobs), [jobs])
  const [draft, setDraft] = useState({})
  const save = async (file) => { const v = (draft[file] || '').trim(); if (!v) return; await saveSizeMapEntry({ file, sizeKey: v }); onSaved && onSaved() }
  return (
    <div>
      <h2>Fix unlabelled sizes ({files.length})</h2>
      <div className="note">These runs came from machine file names with no readable size. Type the real size once — it sticks for all past and future runs of that file.</div>
      <div className="joblist">
        {files.map((f) => (
          <div className="jobcard" key={f.file}>
            <div className="jobcard-head"><span className="chip warn">{f.file}</span><span className="jobcard-when">{f.runs} runs · {f.pieces} pcs</span></div>
            <div className="quote">
              <input className="search" placeholder="Real size e.g. 40x40 t2" value={draft[f.file] || ''} onChange={(e) => setDraft({ ...draft, [f.file]: e.target.value })} />
              <button className="btn" onClick={() => save(f.file)}>Save size</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```
Imports: `import { unlabelledFiles } from './lib/sizemap.js'`, `import { saveSizeMapEntry } from './firebase'`.
Register tab; on save, re-run `loadSizeMap().then(setSizeMap)` (pass `onSaved={() => loadSizeMap().then(setSizeMap)}`).

- [ ] **Step 3: Add Firestore rule for `laser_size_map`**

Pull live rules, add the block, deploy, audit (run from `attendance-app/jobs`):
```bash
cd /home/nishel/attendance-app/jobs
node getRules.js   # backs up live rules
```
In the pulled rules file, inside `match /databases/{database}/documents {`, add (mirroring the other `laser_*` collections' read rule, plus write so the app can save):
```
match /laser_size_map/{id} {
  allow read: if true;
  allow write: if true;
}
```
> Matches the existing anonymous-access pattern for the laser collections. (Security tightening for all laser collections is tracked separately in `security-audit-2026-06-14`; do not change other collections here.)
```bash
node deployRules.js
node auditAllRules.js   # confirm laser_size_map present
```

- [ ] **Step 4: Verify build + manual**

Run: `npm run build` (exit 0). In dev: Fix-sizes tab lists `bhawani.zzx` etc.; type `40x40 t2`, Save; By-Size "Unlabelled" count drops by that file's runs and `40x40 t2` appears as a real size (after the `loadSizeMap` refresh).

- [ ] **Step 5: Commit**

```bash
git add src/firebase.js src/App.jsx
git commit -m "feat: assign-size screen + laser_size_map write + rule"
```

---

## Task 13: Parser improvement (`laser-iot/parse.js`) — independent, for future syncs

Improves how future syncs derive sizes; reduces how many runs land as Unlabelled. Independent of the app (takes effect on next online sync).

**Files:**
- Modify: `laser-iot/parse.js`
- Test: `laser-iot/parse.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `parseJob` (a) treats an `AxBxC` filename where A,B look like qty/length and C ≤ 600 as a round section `R{C}` candidate; (b) marks `aborted = (endState !== 0) || partAmount === 0` so callers can exclude dead runs from size stats. (`endState` semantics confirmed: completed runs have `endState: 0`.)

- [ ] **Step 1: Write the failing test**

```js
// laser-iot/parse.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseJob } = require('./parse');

test('AxBxC filename uses trailing small number as round section', () => {
  const j = parseJob({ workUuid: 'w1', fileName: 'D:\\\\858x6010x31.75.zzx', thickness: 1.2, partAmount: 10, timeTaken: 10, startTime: '2026-06-21 10:00:00' }, 'C');
  assert.equal(j.hasSize, true);
  assert.equal(j.sizeKey, 'R31.75 t1.2');
});
test('aborted flag set on zero-piece or non-zero endState', () => {
  const a = parseJob({ workUuid: 'w2', fileName: 'x.zzx', partAmount: 0, endState: 0, startTime: '2026-06-21 10:00:00' }, 'C');
  const b = parseJob({ workUuid: 'w3', fileName: 'x.zzx', partAmount: 5, endState: 2, startTime: '2026-06-21 10:00:00' }, 'C');
  assert.equal(a.aborted, true);
  assert.equal(b.aborted, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/nishel/laser-iot && node --test parse.test.js`
Expected: FAIL (`sizeKey` is the filename, `aborted` undefined).

- [ ] **Step 3: Implement in `parse.js`**

In `parseSection`, after the existing `AxB` match, add an `AxBxC` rule: when three numbers are present and the third is ≤ 600 while the first two are large (qty/length), return `{ section: 'R'+trimNum(C), ok: true }`. Concretely, before the `return { section:'', ok:false }`, add:
```js
// AxBxC: trailing small number is the round/section size (e.g. 858x6010x31.75)
for (const src of [fileName, portionName, partName]) {
  if (!src) continue;
  const m3 = String(src).match(/(\d+(?:\.\d+)?)[xX×*](\d+(?:\.\d+)?)[xX×*](\d+(?:\.\d+)?)/);
  if (m3) { const c = +m3[3]; if (c > 0 && c <= 600) return { section: `R${trimNum(m3[3])}`, ok: true }; }
}
```
> Place this loop **before** the existing 2-number `AxB` loop so `858x6010x31.75` matches the 3-number rule first (otherwise `858x6010` matches and fails the ≤600 test).

In `parseJob`, add to the returned object:
```js
aborted: (j.endState != null && j.endState !== 0) || partAmount === 0,
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test parse.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/nishel/laser-iot
git add parse.js parse.test.js 2>/dev/null || git add parse.js parse.test.js
git commit -m "feat: parser handles AxBxC round sections + aborted-run flag (tested)" || echo "commit if laser-iot is a repo; else note for manual"
```
> If `laser-iot` is not a git repo, skip the commit; the file change stands. It applies on the next online sync (`node sync.js --commit`), which re-derives `sizeKey`/`hasSize` idempotently.

---

## Task 14: Final verification + deploy

**Files:** none (verification + release).

- [ ] **Step 1: Run all unit tests**

Run: `cd /home/nishel/laser-app && node --test src/lib/*.test.js`
Expected: all PASS (format, period, energy, sizemap).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: exit 0; note the new `dist/assets/index-*.js` hash.

- [ ] **Step 3: Local preview smoke test**

Run: `npm run preview` and load the printed URL. Click every tab (Dashboard, Day, Jobs, By Size, Costing, Reports, Fix sizes, Machine). Confirm: no blank screen, no console errors, period bar works, electricity shows, By-Size has the single Unlabelled row, ₹ never truncates, fonts are sans + sentence case.

- [ ] **Step 4: Deploy (on iPhone hotspot only)**

> GitHub is blocked on the factory network. Switch the PC to the iPhone hotspot first.
Run: `npm run deploy`
Expected: `Published`. Then hard-reload `https://nishanttmittal.github.io/laser-app/` and confirm the live bundle hash matches Step 2 and the app loads on the actual iPhone.

- [ ] **Step 5: Commit any final docs**

```bash
git add -A
git commit -m "chore: phase 1 verification" || echo "nothing to commit"
```

---

## Self-Review (done)

- **Spec coverage:** fonts (T2) ✓, colours (T2) ✓, money truncation (T3) ✓, dashboard headline + Today (T6) ✓, electricity (T6/T8/T9) ✓, period filter (T7) ✓, pick-any-day (T8) ✓, month rollup (T9) ✓, size cleanup + map + assign (T10–T12) ✓, parser improvement (T13) ✓, build+deploy gate (T14) ✓. Phase 2 (alarms/utilization/live/sync-retry) intentionally **not** in this plan — separate plan once the machine is online to probe field names.
- **Placeholder scan:** no TBD/TODO; every code step has real code.
- **Type consistency:** `groupBySize`/`applySizeMap`/`unlabelledFiles` names match across T10–T12; `lastCompleteDay`/`periodRange`/`filterDaysByRange`/`monthRollup` match across T4/T6–T9; `kWhCost` signature consistent T5/T6/T8/T9.
- **Known external dependency:** Firestore free-tier read quota was exhausted on 2026-06-24 — local dev reads may hit `RESOURCE_EXHAUSTED` until it resets (~midnight PT). Does not affect build/tests; only live data load.
