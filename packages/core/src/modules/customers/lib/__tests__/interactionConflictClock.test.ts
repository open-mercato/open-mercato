import { formatConflictClock } from '../interactionConflictClock'

describe('formatConflictClock', () => {
  const instant = new Date('2026-06-12T13:45:00.000Z')

  it('renders the clock in the caller offset', () => {
    expect(formatConflictClock(instant, 120)).toBe('15:45')
    expect(formatConflictClock(instant, -300)).toBe('08:45')
  })

  it('wraps across midnight', () => {
    expect(formatConflictClock(new Date('2026-06-12T23:30:00.000Z'), 120)).toBe('01:30')
  })

  it('falls back to UTC without an offset, independent of the server zone', () => {
    expect(formatConflictClock(instant, undefined)).toBe('13:45')
  })
})
