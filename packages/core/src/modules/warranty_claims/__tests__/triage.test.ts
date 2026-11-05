import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import type { ClaimRiskAssessment, ClaimRiskSignal } from '../lib/risk'

const mockFindOneWithDecryption = jest.fn<Promise<unknown>, unknown[]>()
const mockFindWithDecryption = jest.fn<Promise<unknown[]>, unknown[]>()
const mockEvaluateClaimRisk = jest.fn<Promise<ClaimRiskAssessment>, unknown[]>()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../lib/risk', () => ({
  evaluateClaimRisk: (...args: unknown[]) => mockEvaluateClaimRisk(...args),
}))

import { buildWarrantyClaimTriageSuggestion } from '../lib/triage'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const LINE_ID = '44444444-4444-4444-8444-444444444444'

const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }

const HOUR = 3_600_000
const NOW = new Date('2026-03-01T12:00:00.000Z')

const NO_RISK: ClaimRiskAssessment = { level: 'none', signals: [] }

function riskSignal(level: ClaimRiskSignal['level']): ClaimRiskSignal {
  return { id: 'duplicate_serial', level, messageKey: 'warranty_claims.risk.duplicateSerial' }
}

function riskWith(...levels: ClaimRiskSignal['level'][]): ClaimRiskAssessment {
  return { level: levels.includes('high') ? 'high' : 'medium', signals: levels.map(riskSignal) }
}

function makeClaim(overrides: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id: CLAIM_ID,
    claimNumber: 'WC-000123',
    claimType: 'warranty',
    status: 'submitted',
    customerName: 'Ada Lovelace',
    priority: 'normal',
    submittedAt: new Date(NOW.getTime() - HOUR),
    createdAt: new Date(NOW.getTime() - 2 * HOUR),
    slaDueAt: null,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    ...overrides,
  } as unknown as WarrantyClaim
}

function makeLine(overrides: Partial<WarrantyClaimLine> = {}): WarrantyClaimLine {
  return {
    id: LINE_ID,
    lineNo: 1,
    sku: 'SKU-1',
    productName: 'Widget',
    serialNumber: 'SN-1',
    qtyClaimed: '1',
    purchaseDate: new Date('2025-01-15T00:00:00.000Z'),
    warrantyMonths: 24,
    warrantyExpiresAt: null,
    ...overrides,
  } as unknown as WarrantyClaimLine
}

type BuildOptions = {
  claim?: WarrantyClaim
  lines?: WarrantyClaimLine[]
  risk?: ClaimRiskAssessment | null
  now?: Date
}

function buildSuggestion(options: BuildOptions = {}) {
  mockFindOneWithDecryption.mockResolvedValue(options.claim ?? makeClaim())
  mockFindWithDecryption.mockResolvedValue(options.lines ?? [makeLine()])
  return buildWarrantyClaimTriageSuggestion({
    em: {} as EntityManager,
    claimId: CLAIM_ID,
    scope: SCOPE,
    now: options.now ?? NOW,
    ...(options.risk === null ? {} : { risk: options.risk ?? NO_RISK }),
  })
}

async function firstLine(options: BuildOptions = {}) {
  const suggestion = await buildSuggestion(options)
  return suggestion.lines[0]
}

beforeEach(() => {
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockEvaluateClaimRisk.mockReset()
  mockEvaluateClaimRisk.mockResolvedValue(NO_RISK)
})

describe('buildWarrantyClaimTriageSuggestion — loading', () => {
  test('scopes the claim and line lookups to the caller tenant and organization', async () => {
    await buildSuggestion()

    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      {},
      WarrantyClaim,
      { id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
      {},
      SCOPE,
    )
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      {},
      WarrantyClaimLine,
      { claim: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
      { orderBy: { lineNo: 'ASC' } },
      SCOPE,
    )
  })

  test('throws a 404 CrudHttpError when the claim is not visible in scope', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    await expect(
      buildWarrantyClaimTriageSuggestion({
        em: {} as EntityManager,
        claimId: CLAIM_ID,
        scope: SCOPE,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      status: 404,
      body: { error: 'warranty_claims.errors.notFound' },
    })
    await expect(
      buildWarrantyClaimTriageSuggestion({ em: {} as EntityManager, claimId: CLAIM_ID, scope: SCOPE }),
    ).rejects.toBeInstanceOf(CrudHttpError)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  test('evaluates risk from the claim and lines when no assessment is supplied', async () => {
    const claim = makeClaim()
    const lines = [makeLine()]
    mockEvaluateClaimRisk.mockResolvedValue(riskWith('medium'))

    const suggestion = await buildSuggestion({ claim, lines, risk: null })

    expect(mockEvaluateClaimRisk).toHaveBeenCalledWith({}, claim, lines)
    expect(suggestion.risk).toEqual(riskWith('medium'))
  })

  test('reuses a supplied risk assessment instead of recomputing it', async () => {
    const supplied = riskWith('high')

    const suggestion = await buildSuggestion({ risk: supplied })

    expect(mockEvaluateClaimRisk).not.toHaveBeenCalled()
    expect(suggestion.risk).toBe(supplied)
  })

  test('projects the claim envelope and stamps generatedAt from the evaluation clock', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({
        customerName: null,
        slaDueAt: new Date('2026-03-02T12:00:00.000Z'),
        submittedAt: new Date('2026-02-28T09:30:00.000Z'),
      }),
    })

    expect(suggestion.claim).toEqual({
      id: CLAIM_ID,
      claimNumber: 'WC-000123',
      claimType: 'warranty',
      status: 'submitted',
      customerName: null,
      submittedAt: '2026-02-28T09:30:00.000Z',
      slaDueAt: '2026-03-02T12:00:00.000Z',
    })
    expect(suggestion.generatedAt).toBe('2026-03-01T12:00:00.000Z')
  })

  test('normalizes unparseable claim timestamps to null', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ submittedAt: new Date('not-a-date') as Date, slaDueAt: null }),
    })

    expect(suggestion.claim.submittedAt).toBeNull()
    expect(suggestion.claim.slaDueAt).toBeNull()
  })

  test('carries line identity through to the suggestion', async () => {
    const line = await firstLine({
      lines: [makeLine({ lineNo: 7, sku: null, productName: null, serialNumber: null })],
    })

    expect(line).toMatchObject({
      lineId: LINE_ID,
      lineNo: 7,
      sku: null,
      productName: null,
      serialNumber: null,
    })
  })
})

describe('warranty eligibility resolution', () => {
  test('reports in_warranty while the computed expiry is still ahead of now', async () => {
    const line = await firstLine()

    expect(line.eligibility).toEqual({
      status: 'in_warranty',
      purchaseDate: '2025-01-15',
      warrantyMonths: 24,
      warrantyExpiresAt: '2027-01-15',
      reason: { messageKey: 'warranty_claims.triage.reason.warrantyStillValid' },
    })
  })

  test('treats an expiry landing exactly on now as still in warranty', async () => {
    const line = await firstLine({
      lines: [makeLine({ purchaseDate: new Date('2025-03-01T12:00:00.000Z'), warrantyMonths: 12 })],
    })

    expect(line.eligibility.status).toBe('in_warranty')
    expect(line.eligibility.warrantyExpiresAt).toBe('2026-03-01')
  })

  test('reports out_of_warranty once the computed expiry is behind now', async () => {
    const line = await firstLine({
      lines: [makeLine({ purchaseDate: new Date('2023-01-15T00:00:00.000Z'), warrantyMonths: 12 })],
    })

    expect(line.eligibility).toEqual({
      status: 'out_of_warranty',
      purchaseDate: '2023-01-15',
      warrantyMonths: 12,
      warrantyExpiresAt: '2024-01-15',
      reason: { messageKey: 'warranty_claims.triage.reason.warrantyExpired' },
    })
  })

  test('treats a zero-month warranty as a real term rather than missing data', async () => {
    const line = await firstLine({ lines: [makeLine({ warrantyMonths: 0 })] })

    expect(line.eligibility.status).toBe('out_of_warranty')
    expect(line.eligibility.warrantyMonths).toBe(0)
    expect(line.eligibility.warrantyExpiresAt).toBe('2025-01-15')
  })

  test.each([
    ['missing purchase date', { purchaseDate: null }],
    ['missing warranty months', { warrantyMonths: null }],
    ['undefined warranty months', { warrantyMonths: undefined }],
  ])('reports unknown eligibility on %s', async (_label, overrides) => {
    const line = await firstLine({ lines: [makeLine(overrides as Partial<WarrantyClaimLine>)] })

    expect(line.eligibility.status).toBe('unknown')
    expect(line.eligibility.reason).toEqual({
      messageKey: 'warranty_claims.triage.reason.missingWarrantyData',
    })
  })

  test('echoes the stored expiry date when warranty data is incomplete', async () => {
    const line = await firstLine({
      lines: [
        makeLine({
          purchaseDate: null,
          warrantyMonths: null,
          warrantyExpiresAt: new Date('2027-06-30T00:00:00.000Z'),
        }),
      ],
    })

    expect(line.eligibility).toEqual({
      status: 'unknown',
      purchaseDate: null,
      warrantyMonths: null,
      warrantyExpiresAt: '2027-06-30',
      reason: { messageKey: 'warranty_claims.triage.reason.missingWarrantyData' },
    })
  })

  // An unparseable purchase date is missing data, not proof the warranty lapsed: an
  // Invalid Date is truthy, so without an explicit NaN guard it reached the `>= now`
  // comparison and denied the claim. Matches computeWarrantyEntitlementPreview
  // (lib/warrantyPreview.ts:17), which guards the same case.
  test('treats a corrupt purchase date as unknown rather than expired', async () => {
    const line = await firstLine({
      lines: [makeLine({ purchaseDate: new Date('not-a-date') as Date, warrantyMonths: 12 })],
    })

    expect(line.eligibility.status).toBe('unknown')
    expect(line.eligibility.purchaseDate).toBeNull()
    expect(line.eligibility.warrantyExpiresAt).toBeNull()
    expect(line.suggestedPath).not.toBe('deny')
  })
})

describe('line disposition suggestions', () => {
  test('routes an in-warranty single-unit line to replacement', async () => {
    const line = await firstLine()

    expect(line).toMatchObject({
      suggestedDisposition: 'replace',
      suggestedPath: 'replace',
      restockingFeePercent: null,
      reason: { messageKey: 'warranty_claims.triage.reason.inWarrantyLowQuantity' },
    })
  })

  test('routes an in-warranty multi-unit line to repair review', async () => {
    const line = await firstLine({ lines: [makeLine({ qtyClaimed: '2' })] })

    expect(line).toMatchObject({
      qtyClaimed: 2,
      suggestedDisposition: 'repair',
      suggestedPath: 'repair_review',
      reason: { messageKey: 'warranty_claims.triage.reason.inWarrantyInspection' },
    })
  })

  test('keeps the replacement path at exactly one unit and switches just above it', async () => {
    const atBoundary = await firstLine({ lines: [makeLine({ qtyClaimed: '1.0000' })] })
    const aboveBoundary = await firstLine({ lines: [makeLine({ qtyClaimed: '1.0001' })] })

    expect(atBoundary.suggestedPath).toBe('replace')
    expect(aboveBoundary.suggestedPath).toBe('repair_review')
  })

  test('credits an out-of-warranty return with a restocking fee', async () => {
    const line = await firstLine({
      claim: makeClaim({ claimType: 'return' }),
      lines: [makeLine({ purchaseDate: new Date('2023-01-15T00:00:00.000Z'), warrantyMonths: 12 })],
    })

    expect(line).toMatchObject({
      suggestedDisposition: 'credit',
      suggestedPath: 'credit_with_restocking_fee',
      restockingFeePercent: 15,
      reason: { messageKey: 'warranty_claims.triage.reason.outOfWarrantyReturnRestocking' },
    })
  })

  test('denies an out-of-warranty non-return claim', async () => {
    const line = await firstLine({
      claim: makeClaim({ claimType: 'warranty' }),
      lines: [makeLine({ purchaseDate: new Date('2023-01-15T00:00:00.000Z'), warrantyMonths: 12 })],
    })

    expect(line).toMatchObject({
      suggestedDisposition: 'deny',
      suggestedPath: 'deny',
      restockingFeePercent: null,
      reason: { messageKey: 'warranty_claims.triage.reason.outsideWarrantyWindow' },
    })
  })

  test('sends unknown eligibility to inspection rather than denial', async () => {
    const line = await firstLine({ lines: [makeLine({ purchaseDate: null })] })

    expect(line).toMatchObject({
      suggestedDisposition: 'repair',
      suggestedPath: 'repair_review',
      restockingFeePercent: null,
      reason: { messageKey: 'warranty_claims.triage.reason.unknownEligibilityInspection' },
    })
  })

  test('core returns take the acceptance path regardless of warranty state', async () => {
    const expired = await firstLine({
      claim: makeClaim({ claimType: 'core_return' }),
      lines: [makeLine({ purchaseDate: new Date('2023-01-15T00:00:00.000Z'), warrantyMonths: 12 })],
    })
    const unknown = await firstLine({
      claim: makeClaim({ claimType: 'core_return' }),
      lines: [makeLine({ purchaseDate: null, warrantyMonths: null, qtyClaimed: '9' })],
    })

    for (const line of [expired, unknown]) {
      expect(line).toMatchObject({
        suggestedDisposition: 'credit',
        suggestedPath: 'core_accept',
        restockingFeePercent: null,
        reason: { messageKey: 'warranty_claims.triage.reason.coreAcceptancePath' },
      })
    }
  })

  test.each([
    ['non-numeric string', 'abc'],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to a single claimed unit when qtyClaimed is %s', async (_label, qtyClaimed) => {
    const line = await firstLine({
      lines: [makeLine({ qtyClaimed } as unknown as Partial<WarrantyClaimLine>)],
    })

    expect(line.qtyClaimed).toBe(1)
    expect(line.suggestedPath).toBe('replace')
  })

  // Number('') and Number('   ') are both 0, so a blank quantity used to produce a
  // zero-unit claim that still recommended "replace 0 units". A blank string is
  // absent input and must take the same single-unit fallback as null/undefined/'abc'.
  test.each([
    ['empty string', ''],
    ['whitespace-only string', '   '],
  ])('falls back to a single unit for a %s qtyClaimed', async (_label, qtyClaimed) => {
    const line = await firstLine({
      lines: [makeLine({ qtyClaimed } as unknown as Partial<WarrantyClaimLine>)],
    })

    expect(line.qtyClaimed).toBe(1)
    expect(line.suggestedPath).toBe('replace')
  })

  test('accepts a numeric qtyClaimed without string coercion', async () => {
    const line = await firstLine({
      lines: [makeLine({ qtyClaimed: 3 } as unknown as Partial<WarrantyClaimLine>)],
    })

    expect(line.qtyClaimed).toBe(3)
    expect(line.suggestedPath).toBe('repair_review')
  })

  test('orders suggestions the same way the lines were fetched', async () => {
    const suggestion = await buildSuggestion({
      lines: [makeLine({ id: 'line-a', lineNo: 1 }), makeLine({ id: 'line-b', lineNo: 2 })],
    })

    expect(suggestion.lines.map((line) => line.lineId)).toEqual(['line-a', 'line-b'])
  })
})

describe('risk-adjusted dispositions', () => {
  test('downgrades a replacement to repair review when any risk signal is present', async () => {
    const line = await firstLine({ risk: riskWith('low') })

    expect(line).toMatchObject({
      suggestedDisposition: 'repair',
      suggestedPath: 'repair_review',
      restockingFeePercent: null,
      reason: { messageKey: 'warranty_claims.triage.reason.riskSignalsRequireReview' },
    })
  })

  test('leaves a restocking-fee credit untouched when risk signals are present', async () => {
    const line = await firstLine({
      claim: makeClaim({ claimType: 'return' }),
      lines: [makeLine({ purchaseDate: new Date('2023-01-15T00:00:00.000Z'), warrantyMonths: 12 })],
      risk: riskWith('high'),
    })

    expect(line.suggestedPath).toBe('credit_with_restocking_fee')
    expect(line.restockingFeePercent).toBe(15)
  })

  test('leaves a core acceptance untouched when risk signals are present', async () => {
    const line = await firstLine({
      claim: makeClaim({ claimType: 'core_return' }),
      risk: riskWith('high'),
    })

    expect(line.suggestedPath).toBe('core_accept')
  })
})

describe('review eligibility', () => {
  test('fast-tracks a claim whose every line is an in-warranty replacement', async () => {
    const suggestion = await buildSuggestion({
      lines: [makeLine({ id: 'line-a' }), makeLine({ id: 'line-b', lineNo: 2 })],
    })

    expect(suggestion.eligibility).toEqual({
      status: 'fast_track_candidate',
      reason: { messageKey: 'warranty_claims.triage.reason.fastTrackCandidate' },
    })
  })

  test('requires review when any line falls outside the replacement path', async () => {
    const suggestion = await buildSuggestion({
      lines: [makeLine({ id: 'line-a' }), makeLine({ id: 'line-b', lineNo: 2, qtyClaimed: '4' })],
    })

    expect(suggestion.eligibility).toEqual({
      status: 'review_required',
      reason: { messageKey: 'warranty_claims.triage.reason.lineReviewRequired' },
    })
  })

  test('requires review with the signal count when risk signals fire', async () => {
    const suggestion = await buildSuggestion({ risk: riskWith('low', 'medium') })

    expect(suggestion.eligibility).toEqual({
      status: 'review_required',
      reason: {
        messageKey: 'warranty_claims.triage.reason.riskSignalsReviewRequired',
        params: { count: 2 },
      },
    })
  })

  // `every` is vacuously true for an empty list, which previously recommended a claim
  // with no lines for auto-approval — the case that most needs a human.
  test('routes a claim with no lines at all to review, not fast-track', async () => {
    const suggestion = await buildSuggestion({ lines: [] })

    expect(suggestion.lines).toEqual([])
    expect(suggestion.eligibility.status).toBe('review_required')
  })
})

describe('priority suggestions', () => {
  test('escalates an overdue claim to urgent and reports the SLA breach', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ priority: 'low', slaDueAt: new Date(NOW.getTime() - HOUR) }),
    })

    expect(suggestion.priority).toMatchObject({
      currentPriority: 'low',
      suggestedPriority: 'urgent',
      overdue: true,
      slaDueAt: '2026-03-01T11:00:00.000Z',
      reason: { messageKey: 'warranty_claims.triage.reason.slaOverdue' },
    })
  })

  test('attributes an overdue claim carrying a high risk signal to risk', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ slaDueAt: new Date(NOW.getTime() - HOUR) }),
      risk: riskWith('high'),
    })

    expect(suggestion.priority).toMatchObject({
      suggestedPriority: 'urgent',
      overdue: true,
      reason: { messageKey: 'warranty_claims.triage.reason.highRiskPriority' },
    })
  })

  test('treats an SLA due exactly at now as not yet overdue', async () => {
    const suggestion = await buildSuggestion({ claim: makeClaim({ slaDueAt: NOW }) })

    expect(suggestion.priority.overdue).toBe(false)
    expect(suggestion.priority.suggestedPriority).toBe('high')
    expect(suggestion.priority.reason).toEqual({
      messageKey: 'warranty_claims.triage.reason.slaDueSoon',
      params: { hours: 6 },
    })
  })

  test('raises priority to at least high on a high risk signal', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ priority: 'low' }),
      risk: riskWith('high'),
    })

    expect(suggestion.priority).toMatchObject({
      currentPriority: 'low',
      suggestedPriority: 'high',
      overdue: false,
      reason: { messageKey: 'warranty_claims.triage.reason.highRiskPriority' },
    })
  })

  test('never lowers an urgent claim when a high risk signal fires', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ priority: 'urgent' }),
      risk: riskWith('high'),
    })

    expect(suggestion.priority.suggestedPriority).toBe('urgent')
  })

  test('does not escalate on medium or low risk signals alone', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ priority: 'normal' }),
      risk: riskWith('medium', 'low'),
    })

    expect(suggestion.priority.suggestedPriority).toBe('normal')
    expect(suggestion.priority.reason).toEqual({
      messageKey: 'warranty_claims.triage.reason.priorityConsistent',
    })
  })

  test('flags an SLA falling due within the next six hours', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ slaDueAt: new Date(NOW.getTime() + 6 * HOUR) }),
    })

    expect(suggestion.priority.suggestedPriority).toBe('high')
    expect(suggestion.priority.reason).toEqual({
      messageKey: 'warranty_claims.triage.reason.slaDueSoon',
      params: { hours: 6 },
    })
  })

  test('leaves an SLA falling due just beyond six hours alone', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ slaDueAt: new Date(NOW.getTime() + 6 * HOUR + 1) }),
    })

    expect(suggestion.priority.suggestedPriority).toBe('normal')
    expect(suggestion.priority.reason).toEqual({
      messageKey: 'warranty_claims.triage.reason.priorityConsistent',
    })
  })

  test('escalates a claim that has been open for at least 36 hours', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ submittedAt: new Date(NOW.getTime() - 36 * HOUR) }),
    })

    expect(suggestion.priority).toMatchObject({
      ageHours: 36,
      suggestedPriority: 'high',
      reason: {
        messageKey: 'warranty_claims.triage.reason.openAtLeastHours',
        params: { hours: 36 },
      },
    })
  })

  test('leaves a claim just under the 36 hour threshold alone', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ submittedAt: new Date(NOW.getTime() - 35.9 * HOUR) }),
    })

    expect(suggestion.priority.ageHours).toBe(35.9)
    expect(suggestion.priority.suggestedPriority).toBe('normal')
  })

  test('nudges an idle low-priority claim up to normal', async () => {
    const suggestion = await buildSuggestion({ claim: makeClaim({ priority: 'low' }) })

    expect(suggestion.priority).toMatchObject({
      currentPriority: 'low',
      suggestedPriority: 'normal',
      reason: { messageKey: 'warranty_claims.triage.reason.lowPriorityEscalation' },
    })
  })

  test.each([
    ['normal', 'normal'],
    ['high', 'high'],
    ['urgent', 'urgent'],
  ])('keeps a quiet %s claim at its current priority', async (current, expected) => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ priority: current as WarrantyClaim['priority'] }),
    })

    expect(suggestion.priority.suggestedPriority).toBe(expected)
    expect(suggestion.priority.reason).toEqual({
      messageKey: 'warranty_claims.triage.reason.priorityConsistent',
    })
  })

  test('measures age from createdAt when the claim was never submitted', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ submittedAt: null, createdAt: new Date(NOW.getTime() - 5 * HOUR) }),
    })

    expect(suggestion.priority.ageHours).toBe(5)
  })

  test('reports a null age when the claim carries no timestamps', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ submittedAt: null, createdAt: null as unknown as Date }),
    })

    expect(suggestion.priority.ageHours).toBeNull()
    expect(suggestion.priority.suggestedPriority).toBe('normal')
  })

  test('clamps a future submission timestamp to a zero age', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ submittedAt: new Date(NOW.getTime() + 4 * HOUR) }),
    })

    expect(suggestion.priority.ageHours).toBe(0)
  })

  test('rounds age to a single decimal place', async () => {
    const suggestion = await buildSuggestion({
      claim: makeClaim({ submittedAt: new Date(NOW.getTime() - (2 * HOUR + 15 * 60_000)) }),
    })

    expect(suggestion.priority.ageHours).toBe(2.3)
  })
})
