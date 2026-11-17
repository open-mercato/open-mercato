/**
 * @jest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { setClientDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'
import { resolveDefaultActivityStart, useScheduleFormState } from '../useScheduleFormState'
import type { ScheduleActivityEditData } from '../useScheduleFormState'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

// The hook seeds the form in the user's local timezone, so the expectations are
// derived the same way instead of hardcoding a UTC-shaped string.
function localDate(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localTime(iso: string): string {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function editData(overrides: Partial<ScheduleActivityEditData>): ScheduleActivityEditData {
  return { id: 'interaction-1', interactionType: 'task', title: 'Send the offer', ...overrides }
}

function seed(data: ScheduleActivityEditData) {
  const { result } = renderHook(() => useScheduleFormState({ open: true, editData: data }))
  return { date: result.current.date, startTime: result.current.startTime }
}

describe('useScheduleFormState — edit-mode date/time seed precedence (#5939)', () => {
  const scheduledAt = '2026-03-18T15:16:00.000Z'
  const occurredAt = '2026-03-17T15:19:00.000Z'

  it('seeds a completed planned task from scheduledAt so an unrelated edit keeps its due date', () => {
    // A planned task marked done carries both timestamps. The dialog recomputes
    // `scheduledAt` from these fields on save, so seeding from `occurredAt` would
    // persist the completion moment over the original deadline.
    expect(seed(editData({ scheduledAt, occurredAt }))).toEqual({
      date: localDate(scheduledAt),
      startTime: localTime(scheduledAt),
    })
  })

  it('still seeds a purely historical activity from occurredAt when scheduledAt is absent (#1807)', () => {
    expect(seed(editData({ interactionType: 'call', scheduledAt: null, occurredAt }))).toEqual({
      date: localDate(occurredAt),
      startTime: localTime(occurredAt),
    })
  })

  describe.each([
    ['midday', new Date(2026, 8, 11, 12, 0, 0, 0), { date: '2026-09-11', startTime: '12:30' }],
    ['late evening, past the last slot of the day', new Date(2026, 8, 11, 23, 45, 0, 0), { date: '2026-09-12', startTime: '09:00' }],
  ])('with the clock pinned at %s', (_label, now, forwardDefault) => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(now)
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('seeds the forward-looking default when a meeting carries neither timestamp (#5940)', () => {
      expect(seed(editData({ interactionType: 'meeting', scheduledAt: null, occurredAt: null }))).toEqual(forwardDefault)
    })

    it('seeds the forward-looking default when a meeting timestamp is unparseable (#5940)', () => {
      expect(seed(editData({ interactionType: 'meeting', scheduledAt: 'not-a-date' }))).toEqual(forwardDefault)
    })

    it('leaves an undated or unparseable task blank instead of inventing a due date (#5941)', () => {
      expect(seed(editData({ scheduledAt: null, occurredAt: null }))).toEqual({ date: '', startTime: '' })
      expect(seed(editData({ scheduledAt: 'not-a-date' }))).toEqual({ date: '', startTime: '' })
    })
  })
})

describe('useScheduleFormState — seeds on the configured display zone', () => {
  afterEach(() => setClientDateLocaleSettings(null))

  it('opens an activity at the time its card shows, whatever the device zone', () => {
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone: 'Europe/Warsaw' }, env: {} }))
    expect(seed(editData({ interactionType: 'meeting', scheduledAt: '2026-06-12T08:00:00.000Z' }))).toEqual({
      date: '2026-06-12',
      startTime: '10:00',
    })
  })

  it('names the next day when the configured zone has already passed midnight', () => {
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone: 'Asia/Tokyo' }, env: {} }))
    expect(seed(editData({ interactionType: 'meeting', scheduledAt: '2026-06-12T20:30:00.000Z' }))).toEqual({
      date: '2026-06-13',
      startTime: '05:30',
    })
  })
})

describe('resolveDefaultActivityStart in a configured zone', () => {
  it('reads the working day and slots on that zone clock', () => {
    // 01:10 UTC is 10:10 in Tokyo: a task defaults to 17:00 Tokyo, a meeting to the 10:30 slot.
    const now = new Date('2026-06-12T01:10:00.000Z')
    expect(resolveDefaultActivityStart('task', now, 'Asia/Tokyo').toISOString()).toBe('2026-06-12T08:00:00.000Z')
    expect(resolveDefaultActivityStart('meeting', now, 'Asia/Tokyo').toISOString()).toBe('2026-06-12T01:30:00.000Z')
  })

  it('moves a late slot to 09:00 the next day in that zone', () => {
    // 14:50 UTC is 23:50 in Tokyo.
    const now = new Date('2026-06-12T14:50:00.000Z')
    expect(resolveDefaultActivityStart('meeting', now, 'Asia/Tokyo').toISOString()).toBe('2026-06-13T00:00:00.000Z')
  })
})
