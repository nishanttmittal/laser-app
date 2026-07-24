import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterProgramOptions,
  mergeMachineManifest,
  normalizeMachineManifest,
  parseMachineManifest,
  programImageKind,
  programMachines,
  programPreviews,
} from './machineManifest.js'

const manifest = {
  schemaVersion: 1,
  generatedAt: '2026-07-24T12:00:00.000Z',
  sourceRoot: 'D:\\ProgramSoft',
  programs: [
    {
      fileName: 'Rail.ZX',
      sourceApp: 'TubeST',
      sourceVersion: '7.1.51.1',
      sourcePath: 'D:\\ProgramSoft\\Rail.ZX',
      modifiedAt: '2026-07-20T10:00:00.000Z',
      sha256: 'abc',
      preview: {
        fileName: 'Rail.png',
        sourcePath: 'D:\\ProgramSoft\\Rail.png',
        dataUrl: 'data:image/png;base64,AA==',
        matchEvidence: 'same-directory-exact-stem',
      },
      details: { section: '40x20', thickness: 1.2, tubeLength: 6000 },
      evidence: ['Exact filename stem in the same folder'],
    },
    { fileName: 'Old.zzx', sourceApp: 'TubePro', modifiedAt: '2025-01-01T00:00:00.000Z' },
  ],
}

test('normalizes a generated machine manifest and keeps safe preview data', () => {
  const result = normalizeMachineManifest(manifest)
  assert.equal(result.programs.length, 2)
  assert.equal(result.programs[0].fileName, 'Rail.ZX')
  assert.equal(result.programs[0].details.thickness, 1.2)
  assert.equal(result.programs[0].sourceVersion, '7.1.51.1')
  assert.equal(result.programs[0].preview.matchEvidence, 'same-directory-exact-stem')
})

test('normalizes multiple embedded geometry previews and keeps the primary preview', () => {
  const result = normalizeMachineManifest({
    programs: [{
      fileName: 'nest.zx',
      previews: [
        { sourcePath: 'nest.zx#Thumbnail/100', dataUrl: 'data:image/png;base64,AA==' },
        { sourcePath: 'nest.zx#Thumbnail/200', dataUrl: 'data:image/png;base64,AQ==' },
      ],
    }],
  })
  assert.equal(result.programs[0].previews.length, 2)
  assert.equal(result.programs[0].preview.sourcePath, 'nest.zx#Thumbnail/100')
})

test('parseMachineManifest reports invalid JSON and invalid shape', () => {
  assert.throws(() => parseMachineManifest('{'), /not valid JSON/)
  assert.throws(() => parseMachineManifest('{"jobs":[]}'), /not a machine program manifest/)
})

test('merges exact machine metadata and includes manifest-only programs', () => {
  const merged = mergeMachineManifest([
    { key: 'rail.zx', fileName: 'rail.zx', runs: 4, pieces: 80, lastDay: '20260723', lastTime: '10:00' },
  ], normalizeMachineManifest(manifest))
  assert.equal(merged.length, 2)
  assert.equal(merged[0].machine.sourceApp, 'TubeST')
  assert.equal(merged[0].machine.preview.fileName, 'Rail.png')
  assert.equal(merged[1].fileName, 'Old.zzx')
  assert.equal(merged[1].runs, 0)
})

test('does not use an ambiguous extension-free machine match', () => {
  const ambiguous = normalizeMachineManifest({
    programs: [
      { fileName: 'same.zx', sourceApp: 'TubeST' },
      { fileName: 'same.zzx', sourceApp: 'TubePro' },
    ],
  })
  const merged = mergeMachineManifest([
    { key: 'same', fileName: 'same', runs: 1, pieces: 1, lastDay: '20260723', lastTime: '10:00' },
  ], ambiguous)
  assert.equal(merged.find((item) => item.fileName === 'same').machine, undefined)
})

test('a unique cross-extension match does not also create a manifest-only duplicate', () => {
  const source = normalizeMachineManifest({ programs: [{ fileName: 'part.zzx', sourceApp: 'TubeST' }] })
  const merged = mergeMachineManifest([
    { key: 'part.zx', fileName: 'part.zx', runs: 2, pieces: 10, lastDay: '20260723', lastTime: '10:00' },
  ], source)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].machine.fileName, 'part.zzx')
})

test('deduplicates identical copies of the same machine filename', () => {
  const source = normalizeMachineManifest({
    programs: [
      { fileName: 'part.zx', sourcePath: 'D:\\A\\part.zx', sha256: 'same', modifiedAt: '2026-01-01' },
      { fileName: 'part.zx', sourcePath: 'D:\\B\\part.zx', sha256: 'same', modifiedAt: '2026-02-01' },
    ],
  })
  const merged = mergeMachineManifest([
    { key: 'part.zx', fileName: 'part.zx', runs: 1, pieces: 2, lastDay: '20260723', lastTime: '10:00' },
  ], source)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].machine.sourcePath, 'D:\\B\\part.zx')
  assert.equal(merged[0].machineCandidates, undefined)
})

test('flags same-name files with different hashes instead of choosing one', () => {
  const source = normalizeMachineManifest({
    programs: [
      { fileName: 'part.zx', sourcePath: 'D:\\A\\part.zx', sha256: 'first' },
      { fileName: 'part.zx', sourcePath: 'D:\\B\\part.zx', sha256: 'second' },
    ],
  })
  const merged = mergeMachineManifest([
    { key: 'part.zx', fileName: 'part.zx', runs: 1, pieces: 2, lastDay: '20260723', lastTime: '10:00' },
  ], source)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].machine, undefined)
  assert.equal(merged[0].machineCandidates.length, 2)
})

test('carries an exact machine-file catalog photo across a safe history extension bridge', () => {
  const source = normalizeMachineManifest({
    programs: [{ fileName: 'part.zzx', sourceApp: 'TubePro', sha256: 'part-hash' }],
  })
  const merged = mergeMachineManifest([
    { key: 'part.zx', fileName: 'part.zx', runs: 2, pieces: 10, lastDay: '20260723', lastTime: '10:00' },
  ], source, [
    { id: 'photo-1', name: 'Desk connector', fileName: 'part.zzx', photo: 'data:image/jpeg;base64,AA==' },
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].machine.fileName, 'part.zzx')
  assert.equal(merged[0].linkedId, 'photo-1')
  assert.equal(merged[0].linkedName, 'Desk connector')
  assert.equal(merged[0].linkedPhoto, 'data:image/jpeg;base64,AA==')
})

test('links a manifest-only program to an existing exact-file catalog photo', () => {
  const source = normalizeMachineManifest({
    programs: [{ fileName: 'new-part.zx', sourceApp: 'TubeST', sha256: 'new-part-hash' }],
  })
  const merged = mergeMachineManifest([], source, [
    { id: 'photo-2', name: 'New part', fileName: 'new-part.zx', photo: 'photo' },
  ])
  assert.equal(merged[0].linkedId, 'photo-2')
  assert.equal(merged[0].linkedName, 'New part')
})

test('does not attach a catalog photo to ambiguous same-name machine files', () => {
  const source = normalizeMachineManifest({
    programs: [
      { fileName: 'part.zx', sourceApp: 'TubeST', sha256: 'one' },
      { fileName: 'part.zx', sourceApp: 'TubeST', sha256: 'two' },
    ],
  })
  const merged = mergeMachineManifest([], source, [
    { id: 'unsafe', name: 'Unsafe guess', fileName: 'part.zx', photo: 'photo' },
  ])
  assert.equal(merged[0].machineCandidates.length, 2)
  assert.equal(merged[0].linkedId, '')
})

test('collects candidate previews and classifies product, geometry, profile, and history images', () => {
  const geometry = {
    machine: {
      sha256: 'machine-1',
      previews: [
        { sha256: 'preview-1', dataUrl: 'data:image/png;base64,AA==' },
        { sha256: 'preview-1', dataUrl: 'data:image/png;base64,AA==' },
      ],
    },
  }
  const ambiguous = {
    machineCandidates: [
      { sha256: 'machine-a', preview: { sha256: 'preview-a', dataUrl: 'data:image/png;base64,AQ==' } },
      { sha256: 'machine-b', preview: { sha256: 'preview-b', dataUrl: 'data:image/png;base64,Ag==' } },
    ],
  }
  assert.equal(programMachines(ambiguous).length, 2)
  assert.equal(programPreviews(geometry).length, 1)
  assert.equal(programPreviews(ambiguous).length, 2)
  assert.equal(programPreviews(ambiguous)[1].machineIndex, 1)
  assert.equal(programImageKind({ ...geometry, linkedPhoto: 'product-photo' }), 'product')
  assert.equal(programImageKind(geometry), 'geometry')
  assert.equal(programImageKind({ machine: { previews: [] } }), 'profile')
  assert.equal(programImageKind({ fileName: 'history-only.zx' }), 'none')
})

test('filters machine image review states without hiding history permanently', () => {
  const options = [
    { fileName: 'product.zx', linkedPhoto: 'photo', machine: {} },
    { fileName: 'geometry.zx', machine: { preview: { dataUrl: 'data:image/png;base64,AA==' } } },
    { fileName: 'profile.zx', machine: {} },
    { fileName: 'ambiguous.zx', machineCandidates: [{}, {}] },
    { fileName: 'history.zx' },
  ]
  assert.equal(filterProgramOptions(options, 'machine').length, 4)
  assert.equal(filterProgramOptions(options, 'product')[0].fileName, 'product.zx')
  assert.equal(filterProgramOptions(options, 'geometry')[0].fileName, 'geometry.zx')
  assert.deepEqual(filterProgramOptions(options, 'profile').map((item) => item.fileName), ['profile.zx', 'ambiguous.zx'])
  assert.equal(filterProgramOptions(options, 'ambiguous')[0].fileName, 'ambiguous.zx')
  assert.equal(filterProgramOptions(options, 'history')[0].fileName, 'history.zx')
})
