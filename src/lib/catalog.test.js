import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normFile, programFileName, buildCatalogIndex, matchCatalog, tagJobs, sizeCatalog, programOptions } from './catalog.js';

const cat = [
  { id: 'a', name: 'Varun table leg', photo: 'data:img/leg', sizeKey: '54x50 t3.2' }, // size-linked (new)
  { id: 'b', name: 'Chair base', photo: 'data:img/base', fileName: '123.zzx' },        // file-linked (legacy)
  { id: 'c', name: 'No link', photo: 'data:img/x' },                                   // neither -> not linkable
];

test('normFile: basename + lowercase', () => {
  assert.equal(normFile('C:\\jobs\\ABC.ZZX'), 'abc.zzx');
  assert.equal(normFile('/x/y/123.zzx'), '123.zzx');
  assert.equal(normFile(''), '');
});

test('programFileName uses the BOCHU program head without mistaking a Windows path', () => {
  assert.equal(programFileName('table107.zx\\Rectangular Tube 50 X 25_Nest 2'), 'table107.zx');
  assert.equal(programFileName('C:\\jobs\\table107.zx'), 'table107.zx');
  assert.equal(programFileName('/jobs/table107.zx'), 'table107.zx');
})

test('index has separate size and file maps; skips unlinkable entries', () => {
  const idx = buildCatalogIndex(cat);
  assert.ok(idx.bySize.has('54x50 t3.2'));
  assert.ok(idx.byFile.has('123.zzx'));
  assert.ok(![...idx.bySize.values(), ...idx.byFile.values()].some((e) => e.name === 'No link'));
});

test('match by size-only fallback', () => {
  const idx = buildCatalogIndex(cat);
  assert.equal(matchCatalog({ sizeKey: '54x50 t3.2', file: 'anything.zzx' }, idx).name, 'Varun table leg');
  assert.equal(matchCatalog({ sizeKey: 'unknown-size' }, idx), null);
});

test('exact file link matches independent of extension and path formatting', () => {
  const idx = buildCatalogIndex(cat);
  assert.equal(matchCatalog({ file: '123.zzx' }, idx).name, 'Chair base');
  assert.equal(matchCatalog({ file: '123' }, idx).name, 'Chair base');            // no ext
  assert.equal(matchCatalog({ file: 'C:\\n\\123.ZZX' }, idx).name, 'Chair base'); // case+path
  assert.equal(matchCatalog({ file: 'nope.zzx' }, idx), null);
});

test('a different explicit machine extension is not treated as the same product', () => {
  const idx = buildCatalogIndex([{ id: 'a', name: 'TubeST result', fileName: '123.zzx' }]);
  assert.equal(matchCatalog({ file: '123.zx' }, idx), null);
  assert.equal(matchCatalog({ file: '123' }, idx).name, 'TubeST result');
});

test('exact file wins over a size-only fallback when a job has both', () => {
  const idx = buildCatalogIndex([
    { id: 's', name: 'BySize', photo: 'p1', sizeKey: 'S1' },
    { id: 'f', name: 'ByFile', photo: 'p2', fileName: 'x.zzx' },
  ]);
  assert.equal(matchCatalog({ sizeKey: 'S1', file: 'x.zzx' }, idx).name, 'ByFile');
});

test('newest wins on a size clash', () => {
  const idx = buildCatalogIndex([
    { id: 'old', name: 'Old', sizeKey: 'S1', updatedAt: 1 },
    { id: 'new', name: 'New', sizeKey: 'S1', updatedAt: 2 },
  ]);
  assert.equal(matchCatalog({ sizeKey: 'S1' }, idx).name, 'New');
});

test('tagJobs attaches catName/catPhoto only on matches', () => {
  const idx = buildCatalogIndex(cat);
  const out = tagJobs([{ sizeKey: '54x50 t3.2' }, { sizeKey: 'other' }], idx);
  assert.equal(out[0].catName, 'Varun table leg');
  assert.equal(out[0].catPhoto, 'data:img/leg');
  assert.equal(out[1].catName, undefined);
});

test('tagJobs passes jobs through unchanged when index empty', () => {
  const jobs = [{ sizeKey: 'x' }];
  assert.equal(tagJobs(jobs, buildCatalogIndex([])), jobs);
});

test('sizeCatalog: single name, mixed, or none', () => {
  assert.equal(sizeCatalog([{ catName: 'A' }, { catName: 'A' }, {}]).name, 'A');
  assert.equal(sizeCatalog([{ catName: 'A' }, { catName: 'B' }]), null); // mixed
  assert.equal(sizeCatalog([{}, {}]), null);                            // none
});

test('file-linked cards carrying size metadata do not become size fallbacks', () => {
  const idx = buildCatalogIndex([
    { id: 'p', name: 'Exact product', fileName: 'rail.zx', sizeKey: '40x20 t1.2', matchMode: 'file' },
  ]);
  assert.equal(matchCatalog({ file: 'rail.zx', sizeKey: '40x20 t1.2' }, idx).name, 'Exact product');
  assert.equal(matchCatalog({ file: 'other.zx', sizeKey: '40x20 t1.2' }, idx), null);
});

test('programOptions groups real runs by exact program and marks linked programs', () => {
  const jobs = [
    { file: 'C:\\jobs\\Rail.ZX', sizeKey: '40x20 t1.2', section: '40x20', thickness: 1.2, length: 6000, day: '20260720', startTime: '2026-07-20 10:00:00', partAmount: 20, timeTaken: 200, pierceCount: 40, curveLength: 1000 },
    { file: 'Rail.ZX', sizeKey: '40x20 t1.2', section: '40x20', thickness: 1.2, length: 6000, day: '20260721', startTime: '2026-07-21 11:00:00', partAmount: 30, timeTaken: 360, pierceCount: 60, curveLength: 1500 },
    { file: 'leg.zx', sizeKey: '40x20 t1.2', day: '20260719', startTime: '2026-07-19 09:00:00', partAmount: 10 },
  ];
  const options = programOptions(jobs, [{ id: 'c1', name: 'Side rail', fileName: 'rail.zx', photo: 'p' }]);
  assert.equal(options.length, 2);
  assert.equal(options[0].fileName, 'Rail.ZX');
  assert.equal(options[0].runs, 2);
  assert.equal(options[0].pieces, 50);
  assert.equal(options[0].lastDay, '20260721');
  assert.equal(options[0].linkedName, 'Side rail');
  assert.equal(options[0].secPerPiece, 11.2);
  assert.equal(options[0].pierces, 100);
  assert.equal(options[0].tubeLength, 6000);
  assert.equal(options[1].linkedName, '');
});

test('programOptions groups BOCHU nested names under their source program', () => {
  const options = programOptions([
    { file: 'table107.zx\\Rectangular Tube 50 X 25_Nest 1', day: '20260720', partAmount: 10, timeTaken: 100 },
    { file: 'table107.zx\\Rectangular Tube 50 X 25_Nest 2', day: '20260721', partAmount: 20, timeTaken: 300 },
  ])
  assert.equal(options.length, 1)
  assert.equal(options[0].fileName, 'table107.zx')
  assert.equal(options[0].pieces, 30)
  assert.equal(options[0].secPerPiece, 400 / 30)
})

test('extension-free catalog matching is disabled when two exact files share a stem', () => {
  const idx = buildCatalogIndex([
    { id: 'zx', name: 'ZX product', fileName: 'rail.zx' },
    { id: 'zzx', name: 'ZZX product', fileName: 'rail.zzx' },
  ]);
  assert.equal(matchCatalog({ file: 'rail.zx' }, idx).name, 'ZX product');
  assert.equal(matchCatalog({ file: 'rail.zzx' }, idx).name, 'ZZX product');
  assert.equal(matchCatalog({ file: 'rail' }, idx), null);
});

test('programOptions excludes aborted runs from observed sec/pc', () => {
  const options = programOptions([
    { file: 'x.zx', day: '20260720', partAmount: 10, timeTaken: 100, aborted: false },
    { file: 'x.zx', day: '20260721', partAmount: 10, timeTaken: 900, aborted: true },
  ]);
  assert.equal(options[0].pieces, 20);
  assert.equal(options[0].totalSec, 1000);
  assert.equal(options[0].secPerPiece, 10);
});
