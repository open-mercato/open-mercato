import { getWeekDays } from '../MiniWeekCalendar'

describe('MiniWeekCalendar getWeekDays', () => {
  const thursday = new Date(2026, 5, 11, 15, 30)

  it('starts the week on Monday when configured', () => {
    const days = getWeekDays(thursday, 1)
    expect(days.map((day) => day.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(days[0].getDate()).toBe(8)
    expect(days[0].getHours()).toBe(0)
  })

  it('starts the week on Sunday when configured', () => {
    const days = getWeekDays(thursday, 0)
    expect(days.map((day) => day.getDay())).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(days[0].getDate()).toBe(7)
  })

  it('keeps the anchor day itself when it is the first day of the week', () => {
    const sunday = new Date(2026, 5, 14)
    expect(getWeekDays(sunday, 0)[0].getDate()).toBe(14)
    expect(getWeekDays(sunday, 1)[0].getDate()).toBe(8)
  })
})
