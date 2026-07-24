import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMachineManifest } from './machineManifest.js'
import { buildQuoteProgramChoices, quoteDraftFromProgram, updateExactProgramField } from './quotePrograms.js'

const job = (overrides = {}) => ({
  file: 'Circular Tube R38.25x996.5.zx',
  day: '20260720',
  startTime: '10:00',
  partAmount: 10,
  timeTaken: 80,
  aborted: false,
  sizeKey: 'Circular Tube R38.25 Thickness 1.5',
  section: '',
  thickness: 1.5,
  ...overrides,
})

test('buildQuoteProgramChoices joins exact geometry to measured good-run speed', () => {
  const manifest = normalizeMachineManifest({
    programs: [{
      fileName: 'Circular Tube R38.25x996.5.zx',
      sha256: 'program-1',
      details: { section: 'Circle', thickness: 1.5, partLength: 996.5 },
      preview: { dataUrl: 'data:image/png;base64,AA==', sha256: 'preview-1' },
    }],
  })
  const choices = buildQuoteProgramChoices([
    job(),
    job({ partAmount: 99, timeTaken: 999, aborted: true }),
  ], manifest)

  assert.equal(choices.length, 1)
  assert.equal(choices[0].section, 'R38.25')
  assert.equal(choices[0].thickness, 1.5)
  assert.equal(choices[0].length, 996.5)
  assert.equal(choices[0].secPerPiece, 8)
  assert.equal(choices[0].imageKind, 'geometry')
})

test('ambiguous machine files keep exact history but withhold the drawing', () => {
  const manifest = normalizeMachineManifest({
    programs: [
      { fileName: 'part.zx', sourcePath: 'D:\\A\\part.zx', sha256: 'one', preview: { dataUrl: 'data:image/png;base64,AA==' } },
      { fileName: 'part.zx', sourcePath: 'D:\\B\\part.zx', sha256: 'two', preview: { dataUrl: 'data:image/png;base64,AQ==' } },
    ],
  })
  const [choice] = buildQuoteProgramChoices([
    job({ file: 'part.zx', sizeKey: '40x20 t1.2', section: '40x20', thickness: 1.2 }),
  ], manifest)

  assert.equal(choice.ambiguous, true)
  assert.equal(choice.image, '')
  assert.equal(choice.secPerPiece, 8)
})

test('quoteDraftFromProgram fills exact rate without overwriting an entered length when unavailable', () => {
  const draft = quoteDraftFromProgram({
    fileName: 'rail.zx',
    name: 'Side rail',
    section: '40x20',
    thickness: 1.2,
    length: '',
    secPerPiece: 7.125,
  }, { length: '650', qty: '100' })

  assert.equal(draft.name, 'Side rail')
  assert.equal(draft.length, '650')
  assert.equal(draft.qty, '100')
  assert.equal(draft.secPerPiece, '7.13')
  assert.equal(draft.matchSizeKey, 'Exact program · rail.zx')
})

test('exact program speed survives unchanged fields and clears on a real tube-size change', () => {
  const exact = {
    section: '40x20',
    thickness: 1.2,
    secPerPiece: '7.13',
    matchSizeKey: 'Exact program · rail.zx',
  }
  assert.deepEqual(updateExactProgramField(exact, 'section', '40x20'), exact)
  assert.deepEqual(updateExactProgramField(exact, 'length', '650'), { ...exact, length: '650' })
  assert.deepEqual(updateExactProgramField(exact, 'thickness', '1.5'), {
    ...exact,
    thickness: '1.5',
    secPerPiece: '',
    matchSizeKey: '',
  })
})
