import {
  canTransition,
  evaluateSubmissionGate,
  isAmendWindowOpen,
} from '../statement-lifecycle'

describe('canTransition', () => {
  it('allows only declared statement status transitions', () => {
    expect(canTransition('draft', 'submitted')).toBe(true)
    expect(canTransition('available', 'withdrawn')).toBe(true)
    expect(canTransition('archived', 'draft')).toBe(false)
    expect(canTransition('draft', 'available')).toBe(false)
  })
})

describe('isAmendWindowOpen', () => {
  it('is open for references issued within seventy-two hours', () => {
    const now = new Date('2026-07-06T12:00:00.000Z')

    expect(isAmendWindowOpen(new Date('2026-07-03T12:00:00.000Z'), now)).toBe(true)
    expect(isAmendWindowOpen(new Date('2026-07-03T11:59:59.999Z'), now)).toBe(false)
    expect(isAmendWindowOpen(null, now)).toBe(false)
  })
})

describe('evaluateSubmissionGate', () => {
  it('requires referenced statements only for SME traders', () => {
    expect(evaluateSubmissionGate({
      actorRole: 'sme_trader',
      referencedStatementsCount: 0,
      submissions: [],
      latestAssessment: null,
    })).toEqual({
      allowed: false,
      reasons: ['referencedStatementsRequired'],
    })

    expect(evaluateSubmissionGate({
      actorRole: 'sme_trader',
      referencedStatementsCount: 1,
      submissions: [],
      latestAssessment: null,
    })).toEqual({
      allowed: true,
      reasons: [],
    })
  })

  it('allows non-SME submissions from low-risk countries without an assessment', () => {
    expect(evaluateSubmissionGate({
      actorRole: 'operator',
      referencedStatementsCount: 0,
      submissions: [
        { status: 'verified', completenessScore: 100, originCountry: 'PL' },
        { status: 'verified', completenessScore: 100, originCountry: 'US' },
      ],
      latestAssessment: null,
    })).toEqual({
      allowed: true,
      reasons: [],
    })
  })

  it('requires a negligible risk conclusion for non-low countries', () => {
    expect(evaluateSubmissionGate({
      actorRole: 'operator',
      referencedStatementsCount: 0,
      submissions: [
        { status: 'verified', completenessScore: 100, originCountry: 'BR' },
      ],
      latestAssessment: null,
    })).toEqual({
      allowed: false,
      reasons: ['riskConclusionMissing'],
    })
  })

  it('detects stale, overdue, and incomplete mitigation assessment blockers', () => {
    const result = evaluateSubmissionGate({
      actorRole: 'operator',
      referencedStatementsCount: 0,
      submissions: [
        { status: 'verified', completenessScore: 100, originCountry: 'BR' },
      ],
      latestAssessment: {
        conclusion: 'negligible',
        countryRisks: [{ country: 'US', tier: 'low' }],
        reviewDueAt: '2026-07-01',
        hasConcernAnswers: true,
        hasCompletedMitigation: false,
      },
      now: new Date('2026-07-06T00:00:00.000Z'),
    })

    expect(result).toEqual({
      allowed: false,
      reasons: ['riskAssessmentStale', 'riskReviewOverdue', 'mitigationIncomplete'],
    })
  })

  it('reports evidence readiness blockers', () => {
    const result = evaluateSubmissionGate({
      actorRole: 'operator',
      referencedStatementsCount: 0,
      submissions: [
        { status: 'submitted', completenessScore: 80, originCountry: null },
      ],
      latestAssessment: null,
    })

    expect(result.reasons).toEqual([
      'submissionsNotReady',
      'originCountryMissing',
      'riskConclusionMissing',
    ])
  })
})
