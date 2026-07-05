import {
  businessMillisBetween,
  slaProgressPct,
  type BusinessHoursConfig,
} from '../lib/businessHours'
import {
  isSlaEscalationCandidate,
  parseEscalationTiers,
  tiersToFire,
  type EscalationTier,
} from '../lib/escalation'

const HOUR_MS = 60 * 60 * 1000

const utcWorkweek: BusinessHoursConfig = {
  timezone: 'UTC',
  week: {
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
  },
}

describe('warranty claim SLA escalation helpers', () => {
  test('businessMillisBetween falls back to wall-clock elapsed time without a config', () => {
    expect(businessMillisBetween(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-01T02:30:00.000Z'),
      null,
    )).toBe(2.5 * HOUR_MS)
  })

  test('businessMillisBetween skips weekends and configured holidays', () => {
    const start = new Date('2026-01-02T16:00:00.000Z')
    const end = new Date('2026-01-05T10:00:00.000Z')

    expect(businessMillisBetween(start, end, utcWorkweek)).toBe(2 * HOUR_MS)
    expect(businessMillisBetween(start, end, {
      ...utcWorkweek,
      holidays: ['2026-01-05'],
    })).toBe(1 * HOUR_MS)
  })

  test('slaProgressPct uses business time and can exceed one hundred percent', () => {
    expect(slaProgressPct(
      new Date('2026-01-05T09:00:00.000Z'),
      new Date('2026-01-05T13:00:00.000Z'),
      8,
      utcWorkweek,
    )).toBe(50)

    expect(slaProgressPct(
      new Date('2026-01-05T09:00:00.000Z'),
      new Date('2026-01-06T13:00:00.000Z'),
      8,
      utcWorkweek,
    )).toBe(150)
  })

  test('parseEscalationTiers sorts valid tiers and drops malformed tiers', () => {
    expect(parseEscalationTiers([
      { atPct: 90, action: 'reassign', toUserId: 'user-2' },
      { atPct: '50', action: 'notify' },
      { atPct: 'bad', action: 'notify' },
      { atPct: 75, action: 'reassign' },
      { atPct: 80, action: 'page' },
      null,
    ])).toEqual([
      { atPct: 50, action: 'notify' },
      { atPct: 90, action: 'reassign', toUserId: 'user-2' },
    ])
  })

  test('tiersToFire only returns crossed tiers above the current escalation level', () => {
    const tiers: EscalationTier[] = [
      { atPct: 50, action: 'notify' },
      { atPct: 75, action: 'notify' },
      { atPct: 90, action: 'reassign', toUserId: 'user-3' },
    ]

    expect(tiersToFire(95, 1, tiers)).toEqual([
      { tierIndex: 2, tier: tiers[1] },
      { tierIndex: 3, tier: tiers[2] },
    ])
    expect(tiersToFire(95, 3, tiers)).toEqual([])
    expect(tiersToFire(70, 0, tiers)).toEqual([{ tierIndex: 1, tier: tiers[0] }])
  })

  test('isSlaEscalationCandidate excludes paused and terminal claims', () => {
    const base = {
      status: 'submitted' as const,
      slaDueAt: new Date('2026-01-05T17:00:00.000Z'),
      submittedAt: new Date('2026-01-05T09:00:00.000Z'),
      slaPausedAt: null,
    }

    expect(isSlaEscalationCandidate(base)).toBe(true)
    expect(isSlaEscalationCandidate({ ...base, slaPausedAt: new Date() })).toBe(false)
    expect(isSlaEscalationCandidate({ ...base, status: 'resolved' })).toBe(false)
    expect(isSlaEscalationCandidate({ ...base, status: 'rejected' })).toBe(false)
    expect(isSlaEscalationCandidate({ ...base, slaDueAt: null })).toBe(false)
  })
})
