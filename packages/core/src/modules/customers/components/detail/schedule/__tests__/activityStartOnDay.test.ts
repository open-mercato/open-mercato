import { resolveActivityStartOnDay, resolveDefaultActivityStart } from '../useScheduleFormState'
import type { ActivityType } from '../fieldConfig'

describe('activity creation on a selected local day', () => {
  const activityTypes: ActivityType[] = ['meeting', 'call', 'task', 'email']

  it.each(activityTypes)('uses the %s day-independent default on a future local day', (type) => {
    const now = new Date(2026, 9, 15, 12, 10)
    const selectedDay = new Date(2026, 10, 1)
    const before = selectedDay.getTime()
    const start = resolveActivityStartOnDay(type, selectedDay, now)

    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 10, 1])
    expect([start.getHours(), start.getMinutes()]).toEqual([type === 'task' ? 17 : 9, 0])
    expect(selectedDay.getTime()).toBe(before)
    expect(now.getTime()).toBe(new Date(2026, 9, 15, 12, 10).getTime())
  })

  it.each(activityTypes)('uses the %s default on a future day after 17:00 today', (type) => {
    const now = new Date(2026, 9, 15, 18, 10)
    const start = resolveActivityStartOnDay(type, new Date(2026, 9, 16, 22, 45), now)

    expect(start).toEqual(new Date(2026, 9, 16, type === 'task' ? 17 : 9))
  })

  it.each(activityTypes)('keeps the forward %s default when today is selected', (type) => {
    const now = new Date(2026, 9, 15, 18, 10)
    const start = resolveActivityStartOnDay(type, new Date(2026, 9, 15), now)

    expect(start).toEqual(resolveDefaultActivityStart(type, now))
    expect(start.getTime()).toBeGreaterThan(now.getTime())
  })

  it.each(activityTypes)('keeps the next-day %s default after 23:30 when today is selected', (type) => {
    const now = new Date(2026, 11, 31, 23, 45)
    const start = resolveActivityStartOnDay(type, new Date(2026, 11, 31), now)

    expect(start).toEqual(new Date(2027, 0, 1, 9))
    expect(start).toEqual(resolveDefaultActivityStart(type, now))
    expect(start.getTime()).toBeGreaterThan(now.getTime())
  })

  it.each(activityTypes)('preserves the clock-derived %s default on a historical day', (type) => {
    const now = new Date(2026, 9, 15, 18, 10)
    const start = resolveActivityStartOnDay(type, new Date(2026, 8, 30), now)

    expect(start).toEqual(new Date(2026, 8, 30, 18, 30))
  })

  it.each([
    new Date(2026, 8, 30),
    new Date(2027, 0, 1),
  ])('keeps the explicit local day near midnight: %s', (selectedDay) => {
    const now = new Date(2026, 9, 15, 23, 45)
    const start = resolveActivityStartOnDay('meeting', selectedDay, now)

    expect(start.toDateString()).toBe(selectedDay.toDateString())
    expect([start.getHours(), start.getMinutes()]).toEqual([9, 0])
    expect(resolveDefaultActivityStart('meeting', now).toDateString()).toBe(new Date(2026, 9, 16).toDateString())
  })
})
