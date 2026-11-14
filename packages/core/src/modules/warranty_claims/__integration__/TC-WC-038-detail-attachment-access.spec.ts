import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  listClaimLines,
  readClaim,
  readClaimEvents,
  readWarrantyClaimRisk,
  readWarrantyClaimStats,
  uniqueLabel,
} from './helpers'

test.describe('TC-WC-038: claim detail attachment access', () => {
  test('allows all core claim-detail reads while denying attachments to a scoped claim viewer', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-038')
    const viewerEmail = `${stamp}@test.invalid`
    const viewerPassword = `Valid1!${randomUUID()}`
    let roleId: string | null = null
    let userId: string | null = null
    let claimId: string | null = null

    try {
      const claim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA Claim Viewer ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [{ lineNo: 1, productName: `QA Part ${stamp}`, qtyClaimed: 1 }],
      })
      expect(claim.id, 'fixture claim should have an id').toBeTruthy()
      claimId = claim.id!
      roleId = await createRoleFixture(request, adminToken, {
        tenantId,
        name: `QA Claim Viewer ${stamp}`,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['warranty_claims.claim.view'],
        organizations: [organizationId],
      })
      userId = await createUserFixture(request, adminToken, {
        email: viewerEmail,
        password: viewerPassword,
        organizationId,
        roles: [roleId],
        name: `QA Claim Viewer ${stamp}`,
      })
      const viewerToken = await getAuthToken(request, viewerEmail, viewerPassword)
      expect(getTokenContext(viewerToken), 'viewer should share the claim tenant and organization').toEqual({
        tenantId,
        organizationId,
      })

      const featureResponse = await apiRequest(request, 'POST', '/api/auth/feature-check', {
        token: viewerToken,
        data: { features: ['warranty_claims.claim.view', 'attachments.view'] },
      })
      expect(featureResponse.status(), 'feature checks should succeed for the claim viewer').toBe(200)
      const featureResult = await readJsonSafe<{ ok: boolean; granted: string[] }>(featureResponse)
      expect(featureResult?.ok, 'the combined check should deny attachment access').toBe(false)
      expect(featureResult?.granted, 'only claim viewing should be granted').toEqual(['warranty_claims.claim.view'])

      const [visibleClaim, lines, events] = await Promise.all([
        readClaim(request, viewerToken, claimId),
        listClaimLines(request, viewerToken, claimId),
        readClaimEvents(request, viewerToken, claimId),
        readWarrantyClaimRisk(request, viewerToken, claimId),
        readWarrantyClaimStats(request, viewerToken),
      ])
      expect(visibleClaim.claimNumber, 'the viewer should read the created claim').toBe(claim.claimNumber)
      expect(lines, 'the viewer should read the claim lines').toHaveLength(1)
      expect(lines[0].productName).toBe(`QA Part ${stamp}`)
      expect(Array.isArray(events), 'the viewer should read the claim timeline').toBe(true)

      const attachmentsResponse = await apiRequest(
        request,
        'GET',
        `/api/attachments?entityId=${encodeURIComponent('warranty_claims:warranty_claim')}&recordId=${encodeURIComponent(claimId)}`,
        { token: viewerToken },
      )
      expect(attachmentsResponse.status(), 'attachment reads must still require attachments.view').toBe(403)
    } finally {
      await cleanupDraftClaimWithLines(request, adminToken, claimId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
