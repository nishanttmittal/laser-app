import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normFile, buildCatalogIndex, matchCatalog, tagJobs, sizeCatalog } from './catalog.js';

const cat = [
  { id: 'a', name: 'Varun table leg', photo: 'data:img/leg', fileName: '858x6010x31.75.zzx' },
  { id: 'b', name: 'Chair base', photo: 'data:img/base', fileName: '123.zzx' },
  { id: 'c', name: 'No file entry', photo: 'data:img/x', fileName: '' }, // not linkable
];

test('normFile: basename + lowercase', () => {
  assert.equal(normFile('C:\\jobs\\ABC.ZZX'), 'abc.zzx');
  assert.equal(normFile('/x/y/123.zzx'), '123.zzx');
  assert.equal(normFile(''), '');
});

test('index skips entries without a fileName', () => {
  const idx = buildCatalogIndex(cat);
  assert.ok(idx.has('123.zzx'));
  assert.ok(![...idx.values()].some((e) => e.name === 'No file entry'));
});

test('match by full name and by extension-stripped name', () => {
  const idx = buildCatalogIndex(cat);
  assert.equal(matchCatalog({ file: '123.zzx' }, idx).name, 'Chair base');
  assert.equal(matchCatalog({ file: '123' }, idx).name, 'Chair base');       // no ext
  assert.equal(matchCatalog({ file: 'C:\\n\\123.ZZX' }, idx).name, 'Chair base'); // case+path
  assert.equal(matchCatalog({ file: 'nope.zzx' }, idx), null);
});

test('tagJobs attaches catName/catPhoto only on matches', () => {
  const idx = buildCatalogIndex(cat);
  const out = tagJobs([{ file: '123.zzx' }, { file: 'nope.zzx' }], idx);
  assert.equal(out[0].catName, 'Chair base');
  assert.equal(out[0].catPhoto, 'data:img/base');
  assert.equal(out[1].catName, undefined);
});

test('tagJobs passes jobs through unchanged when index empty', () => {
  const jobs = [{ file: '123.zzx' }];
  assert.equal(tagJobs(jobs, new Map()), jobs);
});

test('sizeCatalog: single name, mixed, or none', () => {
  assert.equal(sizeCatalog([{ catName: 'A' }, { catName: 'A' }, {}]).name, 'A');
  assert.equal(sizeCatalog([{ catName: 'A' }, { catName: 'B' }]), null); // mixed
  assert.equal(sizeCatalog([{}, {}]), null);                            // none
});
