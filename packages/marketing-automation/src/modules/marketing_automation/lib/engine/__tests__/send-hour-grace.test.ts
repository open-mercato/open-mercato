import { nextOccurrenceOfHour, SEND_HOUR_GRACE_HOURS } from '../gates'

/**
 * A run parked for an authored hour and resumed late used to wait for the next one.
 *
 * Local hour 10 against an authored 9 walked forward twenty-three hours, so one minute of queue lateness cost
 * a day. Nobody authoring "send at nine" means "or tomorrow if you are five minutes late", and a campaign that
 * drifts a day per hiccup is one an operator stops trusting.
 */
const WARSAW = 'Europe/Warsaw'

/** 09:00 local in Warsaw on a summer day is 07:00Z. */
const at = (localHour: number, minutes = 0): Date =>
  new Date(Date.UTC(2026, 6, 15, localHour - 2, minutes))

describe('nextOccurrenceOfHour', () => {
  it('sends now when the hour has arrived', () => {
    const now = at(9, 37)
    expect(nextOccurrenceOfHour(9, WARSAW, now)).toBe(now)
  })

  it('sends now when the resume is late but inside the grace window', () => {
    const late = at(10, 5)
    expect(nextOccurrenceOfHour(9, WARSAW, late)).toBe(late)
  })

  it('still sends now at the far edge of the grace window', () => {
    const later = at(9 + SEND_HOUR_GRACE_HOURS, 59)
    expect(nextOccurrenceOfHour(9, WARSAW, later)).toBe(later)
  })

  it('waits for the next occurrence once the lateness is worth a day', () => {
    /**
     * The authored hour exists so a message lands at a civilised time: 09:00 slipping to 11:00 keeps that
     * promise and 09:00 slipping to 23:00 does not. Quiet hours would catch the worst of it, but only where
     * an operator configured them.
     */
    const tooLate = at(9 + SEND_HOUR_GRACE_HOURS + 1, 5)
    const next = nextOccurrenceOfHour(9, WARSAW, tooLate)
    expect(next.getTime()).toBeGreaterThan(tooLate.getTime())
    // Tomorrow's nine, snapped to the top of the hour.
    expect(next.getUTCMinutes()).toBe(0)
  })

  it('does not treat an EARLY instant as late', () => {
    // Looking back must not accept 08:05 for a 9 o'clock send; that is a deferral, not a late resume.
    const early = at(8, 5)
    const next = nextOccurrenceOfHour(9, WARSAW, early)
    expect(next.getTime()).toBeGreaterThan(early.getTime())
  })

  it('handles the authored hour sitting across midnight', () => {
    // 00:30 local for an authored 23: looking back an hour finds 23, so it sends now rather than waiting.
    const justAfterMidnight = at(24, 30)
    expect(nextOccurrenceOfHour(23, WARSAW, justAfterMidnight)).toBe(justAfterMidnight)
  })
})
