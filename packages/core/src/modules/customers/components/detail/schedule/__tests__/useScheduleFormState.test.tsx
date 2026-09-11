/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { resolveDefaultActivityStart, useScheduleFormState } from '../useScheduleFormState'
import type { ScheduleActivityEditData } from '../useScheduleFormState'

function localDate(year: number, month: number, day: number, hours: number, minutes: number): Date {
  return new Date(year, month - 1, day, hours, minutes, 0, 0)
}

function presetCreateData(overrides: Partial<ScheduleActivityEditData> = {}): ScheduleActivityEditData {
  return {
    id: '',
    interactionType: 'task',
    title: null,
    body: null,
    scheduledAt: null,
    durationMinutes: null,
    location: null,
    allDay: false,
    recurrenceRule: null,
    recurrenceEnd: null,
    participants: null,
    reminderMinutes: null,
    visibility: 'team',
    linkedEntities: null,
    ...overrides,
  }
}

describe('resolveDefaultActivityStart (#5940)', () => {
  it('defaults a task to the end of the working day while that is still ahead', () => {
    const start = resolveDefaultActivityStart('task', localDate(2026, 9, 11, 9, 5))
    expect(start).toEqual(localDate(2026, 9, 11, 17, 0))
  })

  it('moves a late task past the current moment instead of into the morning', () => {
    const start = resolveDefaultActivityStart('task', localDate(2026, 9, 11, 18, 40))
    expect(start).toEqual(localDate(2026, 9, 11, 19, 0))
  })

  it('does not return the end-of-day slot once the clock has reached it', () => {
    const start = resolveDefaultActivityStart('task', localDate(2026, 9, 11, 17, 0))
    expect(start).toEqual(localDate(2026, 9, 11, 17, 30))
  })

  it('rounds a non-task activity up to the next half-hour slot', () => {
    expect(resolveDefaultActivityStart('meeting', localDate(2026, 9, 11, 14, 12))).toEqual(
      localDate(2026, 9, 11, 14, 30),
    )
    expect(resolveDefaultActivityStart('call', localDate(2026, 9, 11, 14, 45))).toEqual(
      localDate(2026, 9, 11, 15, 0),
    )
  })

  it('steps strictly forward when the clock sits exactly on a slot boundary', () => {
    const start = resolveDefaultActivityStart('meeting', localDate(2026, 9, 11, 14, 0))
    expect(start).toEqual(localDate(2026, 9, 11, 14, 30))
  })

  it('rolls over to the next morning rather than crossing midnight', () => {
    expect(resolveDefaultActivityStart('meeting', localDate(2026, 9, 11, 23, 45))).toEqual(
      localDate(2026, 9, 12, 9, 0),
    )
    expect(resolveDefaultActivityStart('task', localDate(2026, 9, 11, 23, 50))).toEqual(
      localDate(2026, 9, 12, 9, 0),
    )
  })
})

describe('useScheduleFormState seeding (#5940)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(localDate(2026, 9, 11, 14, 12))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('treats an empty id as create mode instead of seeding the opening moment', () => {
    const editData = presetCreateData()
    const { result } = renderHook(() => useScheduleFormState({ open: true, editData }))

    expect(result.current.activityType).toBe('task')
    expect(result.current.date).toBe('2026-09-11')
    expect(result.current.startTime).toBe('17:00')
  })

  it('keeps the preset default ahead of "now" for non-task types too', () => {
    const editData = presetCreateData({ interactionType: 'meeting' })
    const { result } = renderHook(() => useScheduleFormState({ open: true, editData }))

    expect(result.current.startTime).toBe('14:30')
  })

  it('still prefills an explicit scheduledAt supplied with an empty id', () => {
    const editData = presetCreateData({
      scheduledAt: localDate(2026, 12, 1, 11, 15).toISOString(),
      title: 'Revisit closed deal',
    })
    const { result } = renderHook(() => useScheduleFormState({ open: true, editData }))

    expect(result.current.date).toBe('2026-12-01')
    expect(result.current.startTime).toBe('11:15')
    expect(result.current.title).toBe('Revisit closed deal')
  })

  it('still restores the original moment when editing a saved activity', () => {
    const editData = presetCreateData({
      id: 'b0a1c2d3-0000-4000-8000-000000000001',
      interactionType: 'meeting',
      occurredAt: localDate(2026, 3, 4, 8, 45).toISOString(),
    })
    const { result } = renderHook(() => useScheduleFormState({ open: true, editData }))

    expect(result.current.date).toBe('2026-03-04')
    expect(result.current.startTime).toBe('08:45')
  })

  it('uses the forward-looking default for a plain create with no editData', () => {
    const { result } = renderHook(() => useScheduleFormState({ open: true, editData: null }))

    expect(result.current.activityType).toBe('meeting')
    expect(result.current.date).toBe('2026-09-11')
    expect(result.current.startTime).toBe('14:30')
  })

  it('applies the per-type reminder default when the user switches type in preset-create mode', () => {
    const editData = presetCreateData({ interactionType: 'meeting' })
    const { result } = renderHook(() => useScheduleFormState({ open: true, editData }))

    expect(result.current.reminderMinutes).toBe(15)

    act(() => {
      result.current.setActivityType('task')
    })

    expect(result.current.reminderMinutes).toBe(1440)
  })

  it('keeps the persisted reminder when the type changes while editing a saved activity', () => {
    const editData = presetCreateData({
      id: 'b0a1c2d3-0000-4000-8000-000000000002',
      interactionType: 'task',
      reminderMinutes: 30,
      scheduledAt: localDate(2026, 10, 2, 9, 0).toISOString(),
    })
    const { result } = renderHook(() => useScheduleFormState({ open: true, editData }))

    expect(result.current.reminderMinutes).toBe(30)

    act(() => {
      result.current.setActivityType('meeting')
    })

    expect(result.current.reminderMinutes).toBe(30)
  })
})
