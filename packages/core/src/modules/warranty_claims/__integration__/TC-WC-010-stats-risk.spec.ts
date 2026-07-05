import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext, getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createCustomerCompanyFixture,
  deleteCustomerCompanyFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  assignClaim,
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  readClaim,
  readWarrantyClaimRisk,
  readWarrantyClaimStats,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  type WarrantyClaimStatsResult,
} from './helpers'

function statusCount(stats: WarrantyClaimStatsResult, status: string): number {
  return stats.openByStatus[status] ?? 0
}

test.describe('TC-WC-010: warranty claim stats and risk', () => {
  test('enforces gates, reports stats deltas, and returns deterministic risk signals', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const { userId: adminUserId } = getTokenScope(adminToken)
    expect(adminUserId, 'admin token should include a user id').toBeTruthy()
    const stamp = uniqueLabel('tc-wc-010')
    const noFeaturePassword = 'Valid1!Pass'
    const noFeatureEmail = `${stamp}@test.invalid`

    let roleId: string | null = null
    let noFeatureUserId: string | null = null
    let repeatCustomerId: string | null = null
    const claimIds: string[] = []

    try {
      const anonymousStats = await request.get('/api/warranty_claims/stats')
      expect(anonymousStats.status(), 'stats should require staff auth').toBe(401)
      const anonymousRisk = await request.get(`/api/warranty_claims/risk?claimId=${randomUUID()}`)
      expect(anonymousRisk.status(), 'risk should require staff auth').toBe(401)

      roleId = await createRoleFixture(request, adminToken, { name: `QA WC Stats no feature ${stamp}` })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [],
        organizations: [organizationId],
      })
      noFeatureUserId = await createUserFixture(request, adminToken, {
        email: noFeatureEmail,
        password: noFeaturePassword,
        organizationId,
        roles: [roleId],
        name: `QA WC Stats no feature ${stamp}`,
      })
      const noFeatureToken = await getAuthToken(request, noFeatureEmail, noFeaturePassword)
      const forbiddenStats = await apiRequest(request, 'GET', '/api/warranty_claims/stats', { token: noFeatureToken })
      expect(forbiddenStats.status(), 'stats should require warranty_claims.claim.view').toBe(403)
      const forbiddenRisk = await apiRequest(request, 'GET', '/api/warranty_claims/risk?claimId=not-a-uuid', { token: noFeatureToken })
      expect(forbiddenRisk.status(), 'risk feature gate should run before claim lookup/body validation').toBe(403)

      const baseline = await readWarrantyClaimStats(request, adminToken)

      let submitted = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Stats Submitted ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      claimIds.push(submitted.id!)
      submitted = await submitAndExpect(request, adminToken, submitted)
      expect(submitted.status).toBe('submitted')

      let inReview = await createClaimFixture(request, adminToken, {
        claimType: 'return',
        customerName: `QA WC Stats In Review ${stamp}`,
        reasonCode: 'damaged',
        currencyCode: 'USD',
      })
      claimIds.push(inReview.id!)
      inReview = await submitAndExpect(request, adminToken, inReview)
      inReview = await transitionAndExpect(request, adminToken, inReview, 'in_review')
      const assigned = await assignClaim(
        request,
        adminToken,
        { id: inReview.id!, assigneeUserId: adminUserId },
        inReview.updatedAt,
      )
      expect(assigned.status(), 'assigning a stats fixture to the current user should return 200').toBe(200)
      inReview = await readClaim(request, adminToken, inReview.id!)
      expect(inReview.assigneeUserId).toBe(adminUserId)

      let approved = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Stats Approved ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      claimIds.push(approved.id!)
      approved = await submitAndExpect(request, adminToken, approved)
      approved = await transitionAndExpect(request, adminToken, approved, 'in_review')
      approved = await transitionAndExpect(request, adminToken, approved, 'approved')
      expect(approved.status).toBe('approved')

      const afterFixtures = await readWarrantyClaimStats(request, adminToken)
      expect(statusCount(afterFixtures, 'submitted')).toBe(statusCount(baseline, 'submitted') + 1)
      expect(statusCount(afterFixtures, 'in_review')).toBe(statusCount(baseline, 'in_review') + 1)
      expect(statusCount(afterFixtures, 'approved')).toBe(statusCount(baseline, 'approved') + 1)
      expect(afterFixtures.assignedToMe).toBe(baseline.assignedToMe + 1)
      expect(afterFixtures.overdue, 'fresh API-created fixtures should not change overdue count').toBe(baseline.overdue)

      const duplicateSerial = `SER-010-DUP-${stamp}`
      const duplicatePrior = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Risk Duplicate Prior ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-010-DUP-A-${stamp}`,
            productName: 'QA duplicate prior part',
            serialNumber: duplicateSerial,
            faultDescription: 'Duplicate serial prior',
            qtyClaimed: 1,
            creditAmount: 10,
          },
        ],
      })
      claimIds.push(duplicatePrior.id!)
      const duplicateTarget = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Risk Duplicate Target ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-010-DUP-B-${stamp}`,
            productName: 'QA duplicate target part',
            serialNumber: duplicateSerial,
            faultDescription: 'Duplicate serial target',
            qtyClaimed: 1,
            creditAmount: 10,
          },
        ],
      })
      claimIds.push(duplicateTarget.id!)
      const duplicateRisk = await readWarrantyClaimRisk(request, adminToken, duplicateTarget.id!)
      const duplicateSignal = duplicateRisk.signals.find((signal) => signal.id === 'duplicate_serial')
      expect(duplicateSignal, 'duplicate serial risk signal should be present').toBeTruthy()
      expect(duplicateSignal?.relatedClaimNumbers).toContain(duplicatePrior.claimNumber)

      repeatCustomerId = await createCustomerCompanyFixture(request, adminToken, `QA WC Repeat ${stamp}`)
      const repeatClaims = []
      for (const index of [1, 2, 3]) {
        const claim = await createClaimFixture(request, adminToken, {
          claimType: 'warranty',
          customerId: repeatCustomerId,
          customerName: `QA WC Repeat ${stamp}`,
          reasonCode: 'defective',
          currencyCode: 'USD',
          lines: [
            {
              lineNo: 1,
              sku: `WC-010-REP-${index}-${stamp}`,
              productName: `QA repeat claimer part ${index}`,
              serialNumber: `SER-010-REP-${index}-${stamp}`,
              faultDescription: `Repeat claimer claim ${index}`,
              qtyClaimed: 1,
              creditAmount: 10,
            },
          ],
        })
        claimIds.push(claim.id!)
        repeatClaims.push(claim)
      }
      const repeatRisk = await readWarrantyClaimRisk(request, adminToken, repeatClaims[2].id!)
      expect(
        repeatRisk.signals.some((signal) => signal.id === 'repeat_claimer'),
        'the third claim for a customer inside the 90-day window should emit repeat_claimer',
      ).toBe(true)
    } finally {
      for (const claimId of [...claimIds].reverse()) {
        await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      }
      await deleteCustomerCompanyFixture(request, adminToken, repeatCustomerId)
      await deleteUserIfExists(request, adminToken, noFeatureUserId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
