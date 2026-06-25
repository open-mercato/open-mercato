import {
  applyWeekendVisibility,
  buildDragRange,
  isWeekendDay,
  offsetYToMinutes,
} from '../grid'

const HOUR_HEIGHT_PX = 120

// June 2026: 8th = Monday … 14th = Sunday
function weekDays(): Date[] {
  return Array.from({ length: 7 }, (_, index) => new Date(2026, 5, 8 + index, 0, 0, 0, 0))
}

describe('isWeekendDay', () => {
  it('flags Saturday and Sunday only', () => {
    expect(isWeekendDay(new Date(2026, 5, 13))).toBe(true) // Sat
    expect(isWeekendDay(new Date(2026, 5, 14))).toBe(true) // Sun
    expect(isWeekendDay(new Date(2026, 5, 8))).toBe(false) // Mon
    expect(isWeekendDay(new Date(2026, 5, 12))).toBe(false) // Fri
  })
})

describe('applyWeekendVisibility', () => {
  it('keeps every day when weekends are shown', () => {
    const days = weekDays()
    expect(applyWeekendVisibility(days, true)).toHaveLength(7)
  })

  it('drops Saturday and Sunday when weekends are hidden', () => {
    const visible = applyWeekendVisibility(weekDays(), false)
    expect(visible).toHaveLength(5)
    expect(visible.every((day) => !isWeekendDay(day))).toBe(true)
  })

  it('falls back to the original days when every day is a weekend (day view)', () => {
    const weekendOnly = [new Date(2026, 5, 13), new Date(2026, 5, 14)]
    expect(applyWeekendVisibility(weekendOnly, false)).toEqual(weekendOnly)
  })
})

describe('offsetYToMinutes', () => {
  it('converts pixels to minutes snapped to the 15-minute grid', () => {
    expect(offsetYToMinutes(HOUR_HEIGHT_PX, HOUR_HEIGHT_PX)).toBe(60)
    expect(offsetYToMinutes(HOUR_HEIGHT_PX / 2, HOUR_HEIGHT_PX)).toBe(30)
    // 70px of a 120px hour ≈ 35min → snaps to 30
    expect(offsetYToMinutes(70, HOUR_HEIGHT_PX)).toBe(30)
  })

  it('clamps to the day bounds', () => {
    expect(offsetYToMinutes(-40, HOUR_HEIGHT_PX)).toBe(0)
    expect(offsetYToMinutes(HOUR_HEIGHT_PX * 30, HOUR_HEIGHT_PX)).toBe(24 * 60)
  })
})

describe('buildDragRange', () => {
  const dayStart = new Date(2026, 5, 15, 0, 0, 0, 0)

  it('orders the bounds and builds local Date times', () => {
    const range = buildDragRange(dayStart, 600, 540) // 10:00 .. 9:00 (reversed)
    expect(range.start.getHours()).toBe(9)
    expect(range.start.getMinutes()).toBe(0)
    expect(range.end.getHours()).toBe(10)
    expect(range.end.getMinutes()).toBe(0)
  })

  it('enforces a minimum 30-minute duration', () => {
    const range = buildDragRange(dayStart, 600, 600)
    expect((range.end.getTime() - range.start.getTime()) / 60000).toBe(30)
  })

  it('clamps the end to the end of the day', () => {
    const range = buildDragRange(dayStart, 24 * 60, 24 * 60)
    expect((range.end.getTime() - range.start.getTime()) / 60000).toBe(30)
    expect(range.end.getTime()).toBeLessThanOrEqual(new Date(2026, 5, 16, 0, 0, 0, 0).getTime())
  })
})
