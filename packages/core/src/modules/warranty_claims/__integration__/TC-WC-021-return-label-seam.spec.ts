import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  readClaim,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  type ClaimItem,
  type WarrantyClaimSettingsResult,
} from './helpers'

type ReturnLabelClaimItem = ClaimItem & {
  returnLabelUrl?: string | null
  returnTrackingNumber?: string | null
  returnCarrier?: string | null
}

type ReturnLabelResponse = {
  status?: 'created' | 'notConfigured'
  labelUrl?: string | null
  trackingNumber?: string | null
  carrier?: string | null
  error?: string
}

async function saveReturnLabelProvider(
  request: Parameters<typeof readWarrantyClaimSettings>[0],
  token: string,
  current: WarrantyClaimSettingsResult,
  provider: string | null,
): Promise<void> {
  await saveWarrantyClaimSettings(request, token, {
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
    returnLabelProvider: provider,
  }, current.updatedAt)
}

async function readReturnLabelClaim(
  request: Parameters<typeof readClaim>[0],
  token: string,
  claimId: string,
): Promise<ReturnLabelClaimItem> {
  return readClaim(request, token, claimId) as Promise<ReturnLabelClaimItem>
}

test.describe('TC-WC-021: warranty claim return-label seam', () => {
  test('degrades without a provider, persists manual label fields, and gates generated labels by status', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-021')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)

    let approvedClaimId: string | null = null
    let draftClaimId: string | null = null

    try {
      await saveReturnLabelProvider(request, adminToken, settingsBefore, null)

      let approved = await createClaimFixture(request, adminToken, {
        claimType: 'return',
        customerName: `QA WC Return Label ${stamp}`,
        reasonCode: 'damaged',
        currencyCode: 'USD',
      })
      approvedClaimId = approved.id
      approved = await submitAndExpect(request, adminToken, approved)
      approved = await transitionAndExpect(request, adminToken, approved, 'in_review')
      approved = await transitionAndExpect(request, adminToken, approved, 'approved')

      const notConfiguredResponse = await apiRequest(request, 'POST', '/api/warranty_claims/return-label', {
        token: adminToken,
        data: { claimId: approved.id, updatedAt: approved.updatedAt },
      })
      const notConfiguredBody = await readJsonSafe<ReturnLabelResponse>(notConfiguredResponse)
      expect(
        notConfiguredResponse.status(),
        `provider-less return label generation should return 200: ${JSON.stringify(notConfiguredBody)}`,
      ).toBe(200)
      expect(notConfiguredBody?.status).toBe('notConfigured')

      const labelUrl = `https://labels.test.invalid/${stamp}.pdf`
      const trackingNumber = `TRK-${stamp}`
      const carrier = `Carrier ${stamp}`
      const manualResponse = await apiRequest(request, 'POST', '/api/warranty_claims/return-label', {
        token: adminToken,
        data: {
          claimId: approved.id,
          manual: true,
          labelUrl,
          trackingNumber,
          carrier,
          updatedAt: approved.updatedAt,
        },
      })
      const manualBody = await readJsonSafe<ReturnLabelResponse>(manualResponse)
      expect(
        manualResponse.status(),
        `manual return label should return 200: ${JSON.stringify(manualBody)}`,
      ).toBe(200)
      expect(manualBody).toMatchObject({
        status: 'created',
        labelUrl,
        trackingNumber,
        carrier,
      })

      const readback = await readReturnLabelClaim(request, adminToken, approved.id!)
      expect(readback.returnLabelUrl).toBe(labelUrl)
      expect(readback.returnTrackingNumber).toBe(trackingNumber)
      expect(readback.returnCarrier).toBe(carrier)

      const draft = await createClaimFixture(request, adminToken, {
        claimType: 'return',
        customerName: `QA WC Return Label Draft ${stamp}`,
        reasonCode: 'damaged',
        currencyCode: 'USD',
      })
      draftClaimId = draft.id
      const invalidStatusResponse = await apiRequest(request, 'POST', '/api/warranty_claims/return-label', {
        token: adminToken,
        data: { claimId: draft.id, updatedAt: draft.updatedAt },
      })
      const invalidStatusBody = await readJsonSafe<ReturnLabelResponse>(invalidStatusResponse)
      expect(
        invalidStatusResponse.status(),
        `draft generated return label should be rejected: ${JSON.stringify(invalidStatusBody)}`,
      ).toBe(400)
      expect(invalidStatusBody?.error).toBe('warranty_claims.errors.returnLabelInvalidStatus')
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      await cancelThenDeleteClaimIfPossible(request, adminToken, draftClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, approvedClaimId)
    }
  })
})
