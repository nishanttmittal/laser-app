import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUSINESS_TIME_ZONE,
  MACHINE_TIME_ZONE,
  businessDateKey,
  businessYmd,
  calendarDayDiff,
  dateKeyInTimeZone,
  displayStartTime,
  machineDateTimeToBusiness,
  machinePackageDateTimeToBusiness,
  machineYmd,
  normalizeJobTime,
} from './time.js'

test('business date uses IST instead of the UTC calendar day', () => {
  const instant = new Date('2026-07-23T18:45:00Z') // 24 Jul 00:15 IST
  assert.equal(businessDateKey(instant), '2026-07-24')
  assert.equal(businessYmd(instant), 20260724)
})

test('machine date uses China time explicitly', () => {
  const instant = new Date('2026-07-23T16:30:00Z') // 24 Jul 00:30 China, 23 Jul 22:00 IST
  assert.equal(dateKeyInTimeZone(instant, MACHINE_TIME_ZONE), '2026-07-24')
  assert.equal(machineYmd(instant), 20260724)
  assert.equal(dateKeyInTimeZone(instant, BUSINESS_TIME_ZONE), '2026-07-23')
})

test('naive China machine timestamp converts to IST across midnight', () => {
  assert.equal(machineDateTimeToBusiness('2026-07-24 00:30:00'), '2026-07-23 22:00:00')
  assert.equal(machineDateTimeToBusiness('2026-07-24T12:00:00'), '2026-07-24 09:30:00')
})

test('timestamp with an explicit offset is treated as an instant', () => {
  assert.equal(machineDateTimeToBusiness('2026-07-24T00:30:00+08:00'), '2026-07-23 22:00:00')
})

test('TubeST package timestamp ignores its misleading Z marker and converts China time to IST', () => {
  assert.equal(machinePackageDateTimeToBusiness('2026-07-24T21:54:54Z'), '2026-07-24 19:24:54')
})

test('normalizeJobTime is additive and idempotent', () => {
  const source = {
    day: '20260724',
    startTime: '2026-07-24 00:30:00',
    endTime: '2026-07-24 01:00:00',
  }
  const once = normalizeJobTime(source)
  const twice = normalizeJobTime(once)

  assert.equal(once.day, '20260724')
  assert.equal(once.startTime, source.startTime)
  assert.equal(once.sourceDay, '20260724')
  assert.equal(once.sourceStartTime, source.startTime)
  assert.equal(once.startTimeIst, '2026-07-23 22:00:00')
  assert.equal(once.businessDay, '20260723')
  assert.equal(once.sourceTimeZone, MACHINE_TIME_ZONE)
  assert.equal(once.businessTimeZone, BUSINESS_TIME_ZONE)
  assert.deepEqual(twice, once)
  assert.equal(displayStartTime(once), '2026-07-23 22:00:00')
})

test('calendarDayDiff compares YYYYMMDD values without host timezone', () => {
  assert.equal(calendarDayDiff(20260722, 20260724), 2)
  assert.equal(calendarDayDiff('2026-07-31', '2026-08-01'), 1)
  assert.ok(Number.isNaN(calendarDayDiff('', 20260724)))
})
