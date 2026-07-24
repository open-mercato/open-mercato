import type { EntityManager } from '@mikro-orm/postgresql'
import type { ClaimRiskAssessment } from '../lib/risk'
import type { WarrantyClaimEffectiveSettings } from '../lib/settings'
import type { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import { createWarrantyAdjudicationEvaluator } from '../services/adjudicationEvaluator'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const LINE_ID = '44444444-4444-4444-8444-444444444444'

const settings: WarrantyClaimEffectiveSettings = {
  slaHours: 48,
  slaPauseOnInfoRequested: true,
  slaAtRiskThresholdPct: 75,
  autoApproveEnabled: true,
  autoApproveMaxAmount: 100,
  autoApproveCurrencyCode: 'USD',
  autoApproveRequireInWarranty: true,
  defaultWarrantyMonths: null,
  businessHours: null,
  escalationTiers: null,
  adjudicationUseRules: false,
  quarantineGrades: null,
  returnLabelProvider: null,
}

const noRisk: ClaimRiskAssessment = { level: 'none', signals: [] }
const highRisk: ClaimRiskAssessment = {
  level: 'high',
  signals: [{ id: 'duplicate_serial', level: 'high', messageKey: 'risk' }],
}

const missingPeerContainer = {
  resolve: <R = unknown>(_name: string): R => {
    throw new Error('missing dependency')
  },
}

function makeClaim(overrides: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id: CLAIM_ID,
    claimType: 'warranty',
    status: 'submitted',
    currencyCode: 'USD',
    totalClaimedAmount: '50.00',
    customerId: null,
    orderId: null,
    reasonCode: null,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    ...overrides,
  } as unknown as WarrantyClaim
}

function makeLine(overrides: Partial<WarrantyClaimLine> = {}): WarrantyClaimLine {
  return {
    id: LINE_ID,
    warrantyStatus: 'in_warranty',
    lineStatus: 'submitted',
    qtyClaimed: '1',
    creditAmount: '50.00',
    disposition: null,
    conditionGrade: null,
    quarantineStatus: 'none',
    ...overrides,
  } as unknown as WarrantyClaimLine
}

async function evaluate(input: {
  claim?: WarrantyClaim
  lines?: WarrantyClaimLine[]
  settings?: WarrantyClaimEffectiveSettings
  risk?: ClaimRiskAssessment
}) {
  const evaluator = createWarrantyAdjudicationEvaluator()
  return evaluator.evaluate({
    claim: input.claim ?? makeClaim(),
    lines: input.lines ?? [makeLine()],
    settings: input.settings ?? settings,
    risk: input.risk ?? noRisk,
    container: missingPeerContainer,
    em: {} as EntityManager,
    scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
  })
}

describe('warranty adjudication evaluator', () => {
  test('flag off and light auto-approve conditions met returns auto_approve', async () => {
    const result = await evaluate({})

    expect(result.decision).toBe('auto_approve')
    expect(result.facts).toMatchObject({
      rule: 'light',
      autoApproveEligible: true,
      forcedManualByRisk: false,
      riskLevel: 'none',
    })
  })

  test('flag off and light auto-approve conditions not met returns manual_review', async () => {
    const result = await evaluate({
      claim: makeClaim({ totalClaimedAmount: '150.00' }),
    })

    expect(result.decision).toBe('manual_review')
    expect(result.facts).toMatchObject({
      rule: 'light',
      autoApproveEligible: false,
      amountWithinLimit: false,
    })
  })

  test('flag on with no business_rules peer falls back to the light rule without crashing', async () => {
    const result = await evaluate({
      settings: { ...settings, adjudicationUseRules: true },
    })

    expect(result.decision).toBe('auto_approve')
    expect(result.facts).toMatchObject({
      rule: 'light',
      autoApproveEligible: true,
    })
  })

  test('high risk forces manual_review even when light conditions would auto-approve', async () => {
    const result = await evaluate({ risk: highRisk })

    expect(result.decision).toBe('manual_review')
    expect(result.facts).toMatchObject({
      rule: 'light',
      forcedManualByRisk: true,
      riskLevel: 'high',
    })
  })
})
