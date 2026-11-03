import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  readClaim,
  readClaimEvents,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitClaim,
  uniqueLabel,
  type ClaimItem,
  type WarrantyClaimSettingsResult,
} from './helpers'

type BusinessRuleCreateResponse = {
  id?: string | null
  error?: string
}

async function createAdjudicationRule(
  request: APIRequestContext,
  token: string,
  ruleId: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/business_rules/rules', {
    token,
    data: {
      ruleId,
      ruleName: `QA WC Adjudication ${ruleId}`,
      ruleType: 'GUARD',
      entityType: 'warranty_claims:claim',
      eventType: 'warranty_claims.claim.adjudicate',
      enabled: true,
      priority: 999,
      conditionExpression: {
        field: 'claim.reasonCode',
        operator: '=',
        value: 'rules-approve',
      },
      successActions: [{ type: 'ALLOW_TRANSITION', config: {} }],
      failureActions: [{ type: 'BLOCK_TRANSITION', config: {} }],
    },
  })
  const body = await readJsonSafe<BusinessRuleCreateResponse>(response)
  expect(response.status(), `business rule create should return 201: ${JSON.stringify(body)}`).toBe(201)
  expect(body?.id, 'business rule create response should include id').toBeTruthy()
  return body!.id as string
}

async function deleteBusinessRuleIfExists(
  request: APIRequestContext,
  token: string | null,
  ruleId: string | null,
): Promise<void> {
  if (!token || !ruleId) return
  await apiRequest(request, 'DELETE', `/api/business_rules/rules?id=${encodeURIComponent(ruleId)}`, { token }).catch(() => undefined)
}

async function saveAdjudicationSettings(
  request: APIRequestContext,
  token: string,
  current: WarrantyClaimSettingsResult,
  data: Partial<Omit<WarrantyClaimSettingsResult, 'updatedAt'>>,
): Promise<WarrantyClaimSettingsResult> {
  return saveWarrantyClaimSettings(request, token, {
    slaHours: current.slaHours,
    slaPauseOnInfoRequested: current.slaPauseOnInfoRequested,
    slaAtRiskThresholdPct: current.slaAtRiskThresholdPct,
    autoApproveEnabled: current.autoApproveEnabled,
    autoApproveMaxAmount: current.autoApproveMaxAmount,
    autoApproveCurrencyCode: current.autoApproveCurrencyCode,
    autoApproveRequireInWarranty: current.autoApproveRequireInWarranty,
    defaultWarrantyMonths: current.defaultWarrantyMonths,
    businessHours: current.businessHours,
    escalationTiers: current.escalationTiers,
    adjudicationUseRules: current.adjudicationUseRules,
    quarantineGrades: current.quarantineGrades,
    returnLabelProvider: current.returnLabelProvider,
    ...data,
  }, current.updatedAt)
}

async function createAdjudicationClaim(
  request: APIRequestContext,
  token: string,
  stamp: string,
  input: { label: string; reasonCode: string; creditAmount?: number; warrantyStatus?: string },
): Promise<ClaimItem> {
  return createClaimFixture(request, token, {
    claimType: 'warranty',
    customerName: `QA WC Adjudication ${input.label} ${stamp}`,
    reasonCode: input.reasonCode,
    currencyCode: 'USD',
    lines: [
      {
        lineNo: 1,
        sku: `WC-019-${input.label}-${stamp}`,
        productName: `QA adjudication ${input.label}`,
        serialNumber: `SER-019-${input.label}-${stamp}`,
        faultDescription: `Adjudication ${input.label}`,
        qtyClaimed: 1,
        creditAmount: input.creditAmount ?? 10,
        warrantyStatus: input.warrantyStatus ?? 'in_warranty',
      },
    ],
  })
}

async function submitAndReadClaim(
  request: APIRequestContext,
  token: string,
  claim: ClaimItem,
): Promise<ClaimItem> {
  expect(claim.id, 'claim should have id').toBeTruthy()
  const response = await submitClaim(request, token, claim.id!, claim.updatedAt)
  const body = await readJsonSafe<{ ok?: boolean; error?: string }>(response)
  expect(response.status(), `submit should return 200: ${JSON.stringify(body)}`).toBe(200)
  return readClaim(request, token, claim.id!)
}

test.describe('TC-WC-019: warranty claim adjudication rules', () => {
  test('delegates to business rules when enabled and falls back to light-rule adjudication when disabled', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc19')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)
    const createdClaimIds: string[] = []
    let businessRuleId: string | null = null

    try {
      businessRuleId = await createAdjudicationRule(request, adminToken, `wc-adj-${stamp}`)

      let settings = await saveAdjudicationSettings(request, adminToken, settingsBefore, {
        adjudicationUseRules: true,
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: true,
      })

      const rulesApprove = await createAdjudicationClaim(request, adminToken, stamp, {
        label: 'rules-approve',
        reasonCode: 'rules-approve',
      })
      createdClaimIds.push(rulesApprove.id!)
      expect((await submitAndReadClaim(request, adminToken, rulesApprove)).status).toBe('approved')

      const rulesManual = await createAdjudicationClaim(request, adminToken, stamp, {
        label: 'rules-manual',
        reasonCode: 'rules-manual',
      })
      createdClaimIds.push(rulesManual.id!)
      expect((await submitAndReadClaim(request, adminToken, rulesManual)).status).toBe('submitted')

      settings = await saveAdjudicationSettings(request, adminToken, settings, {
        adjudicationUseRules: false,
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
      })
      const fallbackManual = await createAdjudicationClaim(request, adminToken, stamp, {
        label: 'fallback-manual',
        reasonCode: 'rules-approve',
      })
      createdClaimIds.push(fallbackManual.id!)
      expect((await submitAndReadClaim(request, adminToken, fallbackManual)).status).toBe('submitted')

      settings = await saveAdjudicationSettings(request, adminToken, settings, {
        adjudicationUseRules: false,
        autoApproveEnabled: true,
        autoApproveMaxAmount: 50,
        autoApproveCurrencyCode: 'USD',
        autoApproveRequireInWarranty: true,
      })
      expect(settings.autoApproveEnabled).toBe(true)
      const fallbackApprove = await createAdjudicationClaim(request, adminToken, stamp, {
        label: 'fallback-approve',
        reasonCode: 'light-approve',
        creditAmount: 12,
      })
      createdClaimIds.push(fallbackApprove.id!)
      const fallbackApproved = await submitAndReadClaim(request, adminToken, fallbackApprove)
      expect(fallbackApproved.status, 'light-rule fallback should still auto-approve eligible defaults').toBe('approved')
      const fallbackEvents = await readClaimEvents(request, adminToken, fallbackApprove.id!)
      expect(
        fallbackEvents.some((event) => event.kind === 'system' && event.payload?.action === 'auto_approved'),
        'light-rule fallback approval should write the normal auto_approved timeline event',
      ).toBe(true)
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      for (const claimId of createdClaimIds.reverse()) {
        await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      }
      await deleteBusinessRuleIfExists(request, adminToken, businessRuleId)
    }
  })
})
