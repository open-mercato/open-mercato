import { decideRetention } from '../lib/retention'

const NOW = new Date('2026-05-21T00:00:00Z')

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

describe('decideRetention', () => {
  it('keeps submissions forever when retentionDays is null', () => {
    const decision = decideRetention({
      submission: { submittedAt: daysAgo(3650), updatedAt: daysAgo(3650), anonymizedAt: null },
      retentionDays: null,
      now: NOW,
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toBe('no_retention_policy')
  })

  it('treats non-positive retentionDays as keep-forever (fail-safe)', () => {
    for (const retentionDays of [0, -5]) {
      const decision = decideRetention({
        submission: { submittedAt: daysAgo(1000), updatedAt: daysAgo(1000), anonymizedAt: null },
        retentionDays,
        now: NOW,
      })
      expect(decision.eligible).toBe(false)
      expect(decision.reason).toBe('no_retention_policy')
    }
  })

  it('purges a submitted submission older than the window', () => {
    const decision = decideRetention({
      submission: { submittedAt: daysAgo(31), updatedAt: daysAgo(31), anonymizedAt: null },
      retentionDays: 30,
      now: NOW,
    })
    expect(decision.eligible).toBe(true)
    expect(decision.reason).toBe('expired')
    expect(decision.referenceAt).toEqual(daysAgo(31))
  })

  it('keeps a submission still inside the window', () => {
    const decision = decideRetention({
      submission: { submittedAt: daysAgo(10), updatedAt: daysAgo(10), anonymizedAt: null },
      retentionDays: 30,
      now: NOW,
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toBe('within_window')
  })

  it('uses updatedAt as the age anchor for drafts (no submittedAt)', () => {
    const expired = decideRetention({
      submission: { submittedAt: null, updatedAt: daysAgo(40), anonymizedAt: null },
      retentionDays: 30,
      now: NOW,
    })
    expect(expired.eligible).toBe(true)
    expect(expired.referenceAt).toEqual(daysAgo(40))

    const fresh = decideRetention({
      submission: { submittedAt: null, updatedAt: daysAgo(5), anonymizedAt: null },
      retentionDays: 30,
      now: NOW,
    })
    expect(fresh.eligible).toBe(false)
    expect(fresh.reason).toBe('within_window')
  })

  it('never re-purges an already-anonymized submission (idempotency)', () => {
    const decision = decideRetention({
      submission: { submittedAt: daysAgo(1000), updatedAt: daysAgo(1000), anonymizedAt: daysAgo(100) },
      retentionDays: 30,
      now: NOW,
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toBe('already_anonymized')
  })
})
