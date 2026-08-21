import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays'
import { getFetchWindow, getVisibleRange, shiftAnchor } from '../range'

describe('getVisibleRange', () => {
  it('covers exactly the anchor day for the day view', () => {
    const anchor = new Date(2026, 5, 11, 15, 30, 0)
    const range = getVisibleRange('day', anchor, 7)
    expect(range.from.getFullYear()).toBe(2026)
    expect(range.from.getMonth()).toBe(5)
    expect(range.from.getDate()).toBe(11)
    expect(range.from.getHours()).toBe(0)
    expect(range.from.getMinutes()).toBe(0)
    expect(range.to.getDate()).toBe(11)
    expect(range.to.getHours()).toBe(23)
    expect(range.to.getMinutes()).toBe(59)
  })

  it('returns a Monday-start 7-day week containing the anchor', () => {
    const anchorThursday = new Date(2026, 5, 11, 9, 0, 0)
    const range = getVisibleRange('week', anchorThursday, 7)
    expect(range.from.getDay()).toBe(1)
    expect(range.from.getDate()).toBe(8)
    expect(range.to.getDay()).toBe(0)
    expect(range.to.getDate()).toBe(14)
    expect(differenceInCalendarDays(range.to, range.from)).toBe(6)
  })

  it('keeps the week anchored when the anchor itself is a Monday', () => {
    const anchorMonday = new Date(2026, 5, 8, 0, 0, 0)
    const range = getVisibleRange('week', anchorMonday, 7)
    expect(range.from.getDate()).toBe(8)
    expect(range.from.getMonth()).toBe(5)
  })

  it('spans month boundaries when the week crosses them', () => {
    const anchorWednesday = new Date(2026, 6, 1, 12, 0, 0)
    const range = getVisibleRange('week', anchorWednesday, 7)
    expect(range.from.getMonth()).toBe(5)
    expect(range.from.getDate()).toBe(29)
    expect(range.to.getMonth()).toBe(6)
    expect(range.to.getDate()).toBe(5)
  })

  it('keeps a 7-calendar-day week across a DST transition', () => {
    const dstWeekAnchor = new Date(2026, 2, 25, 12, 0, 0)
    const range = getVisibleRange('week', dstWeekAnchor, 7)
    expect(range.from.getDay()).toBe(1)
    expect(range.from.getDate()).toBe(23)
    expect(range.to.getDay()).toBe(0)
    expect(range.to.getDate()).toBe(29)
    expect(differenceInCalendarDays(range.to, range.from)).toBe(6)
  })

  it('covers the month with full Monday-start weeks', () => {
    const anchor = new Date(2026, 5, 15)
    const range = getVisibleRange('month', anchor, 7)
    expect(range.from.getDay()).toBe(1)
    expect(range.from.getMonth()).toBe(5)
    expect(range.from.getDate()).toBe(1)
    expect(range.to.getDay()).toBe(0)
    expect(range.to.getMonth()).toBe(6)
    expect(range.to.getDate()).toBe(5)
    expect((differenceInCalendarDays(range.to, range.from) + 1) % 7).toBe(0)
  })

  it('extends the month grid backwards when the month starts mid-week', () => {
    const anchor = new Date(2026, 7, 10)
    const range = getVisibleRange('month', anchor, 7)
    expect(range.from.getMonth()).toBe(6)
    expect(range.from.getDate()).toBe(27)
    expect(range.from.getDay()).toBe(1)
    expect(range.to.getMonth()).toBe(8)
    expect(range.to.getDate()).toBe(6)
    expect((differenceInCalendarDays(range.to, range.from) + 1) % 7).toBe(0)
  })

  it('covers full weeks for a month containing a DST transition', () => {
    const anchor = new Date(2026, 9, 15)
    const range = getVisibleRange('month', anchor, 7)
    expect(range.from.getDay()).toBe(1)
    expect(range.to.getDay()).toBe(0)
    expect((differenceInCalendarDays(range.to, range.from) + 1) % 7).toBe(0)
  })

  it('spans the agenda horizon from the anchor day', () => {
    const anchor = new Date(2026, 5, 11, 18, 45, 0)
    const range = getVisibleRange('agenda', anchor, 7)
    expect(range.from.getDate()).toBe(11)
    expect(range.from.getHours()).toBe(0)
    expect(differenceInCalendarDays(range.to, range.from)).toBe(7)
    expect(range.to.getHours()).toBe(23)
  })

  it('honors a custom agenda horizon', () => {
    const anchor = new Date(2026, 5, 11)
    const range = getVisibleRange('agenda', anchor, 30)
    expect(differenceInCalendarDays(range.to, range.from)).toBe(30)
  })
})

describe('getFetchWindow', () => {
  it('pads the from boundary by one day and keeps to unchanged', () => {
    const range = getVisibleRange('week', new Date(2026, 5, 11), 7)
    const window = getFetchWindow(range)
    expect(differenceInCalendarDays(range.from, window.from)).toBe(1)
    expect(window.to.getTime()).toBe(range.to.getTime())
  })
})

describe('shiftAnchor', () => {
  it('shifts by one day in day view', () => {
    const anchor = new Date(2026, 5, 11)
    expect(shiftAnchor('day', anchor, 1).getDate()).toBe(12)
    expect(shiftAnchor('day', anchor, -1).getDate()).toBe(10)
  })

  it('shifts by seven days in week view', () => {
    const anchor = new Date(2026, 5, 11)
    expect(differenceInCalendarDays(shiftAnchor('week', anchor, 1), anchor)).toBe(7)
    expect(differenceInCalendarDays(shiftAnchor('week', anchor, -1), anchor)).toBe(-7)
  })

  it('shifts by one month in month view', () => {
    const anchor = new Date(2026, 0, 31)
    const forward = shiftAnchor('month', anchor, 1)
    expect(forward.getMonth()).toBe(1)
    expect(forward.getDate()).toBe(28)
    const backward = shiftAnchor('month', anchor, -1)
    expect(backward.getMonth()).toBe(11)
    expect(backward.getFullYear()).toBe(2025)
  })

  it('shifts by seven days in agenda view', () => {
    const anchor = new Date(2026, 5, 11)
    expect(differenceInCalendarDays(shiftAnchor('agenda', anchor, 1), anchor)).toBe(7)
  })

  it('crosses a DST transition without losing a day', () => {
    const beforeDst = new Date(2026, 2, 28, 12, 0, 0)
    const shifted = shiftAnchor('day', beforeDst, 1)
    expect(shifted.getDate()).toBe(29)
    expect(shifted.getHours()).toBe(12)
  })
})
