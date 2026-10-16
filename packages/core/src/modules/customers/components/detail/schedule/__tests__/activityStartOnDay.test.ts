import { resolveActivityStartOnDay, resolveDefaultActivityStart } from '../useScheduleFormState'
import type { ActivityType } from '../fieldConfig'

describe('activity creation on a selected local day', () => {
  const activityTypes: ActivityType[] = ['meeting', 'call', 'task', 'email']

  it.each(activityTypes)('preserves the %s time default while applying the selected day', (type) => {
    const now = new Date(2026, 9, 15, 12, 10)
    const selectedDay = new Date(2026, 10, 1)
    const before = selectedDay.getTime()
    const start = resolveActivityStartOnDay(type, selectedDay, now)
    const defaultStart = resolveDefaultActivityStart(type, now)

    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 10, 1])
    expect([start.getHours(), start.getMinutes()]).toEqual([defaultStart.getHours(), defaultStart.getMinutes()])
    expect(selectedDay.getTime()).toBe(before)
    expect(now.getTime()).toBe(new Date(2026, 9, 15, 12, 10).getTime())
  })

  it.each([
    new Date(2026, 8, 30),
    new Date(2027, 0, 1),
    new Date(2026, 9, 15),
  ])('keeps the explicit local day near midnight: %s', (selectedDay) => {
    const now = new Date(2026, 9, 15, 23, 45)
    const start = resolveActivityStartOnDay('meeting', selectedDay, now)

    expect(start.toDateString()).toBe(selectedDay.toDateString())
    expect([start.getHours(), start.getMinutes()]).toEqual([9, 0])
    expect(resolveDefaultActivityStart('meeting', now).toDateString()).toBe(new Date(2026, 9, 16).toDateString())
  })
})
