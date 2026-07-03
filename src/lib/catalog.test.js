import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normFile, buildCatalogIndex, matchCatalog, tagJobs, sizeCatalog } from './catalog.js';

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

test('index has separate size and file maps; skips unlinkable entries', () => {
  const idx = buildCatalogIndex(cat);
  assert.ok(idx.bySize.has('54x50 t3.2'));
  assert.ok(idx.byFile.has('123.zzx'));
  assert.ok(![...idx.bySize.values(), ...idx.byFile.values()].some((e) => e.name === 'No link'));
});

test('match by SIZE (primary)', () => {
  const idx = buildCatalogIndex(cat);
  assert.equal(matchCatalog({ sizeKey: '54x50 t3.2', file: 'anything.zzx' }, idx).name, 'Varun table leg');
  assert.equal(matchCatalog({ sizeKey: 'unknown-size' }, idx), null);
});

test('legacy FILE link still matches (fallback) when no size hit', () => {
  const idx = buildCatalogIndex(cat);
  assert.equal(matchCatalog({ file: '123.zzx' }, idx).name, 'Chair base');
  assert.equal(matchCatalog({ file: '123' }, idx).name, 'Chair base');            // no ext
  assert.equal(matchCatalog({ file: 'C:\\n\\123.ZZX' }, idx).name, 'Chair base'); // case+path
  assert.equal(matchCatalog({ file: 'nope.zzx' }, idx), null);
});

test('size wins over file when a job has both', () => {
  const idx = buildCatalogIndex([
    { id: 's', name: 'BySize', photo: 'p1', sizeKey: 'S1' },
    { id: 'f', name: 'ByFile', photo: 'p2', fileName: 'x.zzx' },
  ]);
  assert.equal(matchCatalog({ sizeKey: 'S1', file: 'x.zzx' }, idx).name, 'BySize');
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
