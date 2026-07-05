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
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  assignClaim,
  cleanupDraftClaimWithLines,
  createClaimFixture,
  deleteClaimIfExists,
  listClaimLines,
  listClaims,
  submitClaim,
  transitionClaim,
  uniqueLabel,
  updateClaim,
} from './helpers'

test.describe('TC-WC-001: warranty claims CRUD API', () => {
  test('enforces auth, feature gates, filters, locking, immutable status, and draft-only delete', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-001')
    const noFeatureEmail = `${stamp}@test.invalid`
    const noFeaturePassword = 'Valid1!Pass'

    let roleId: string | null = null
    let noFeatureUserId: string | null = null
    let danglingOrderClaimId: string | null = null
    let draftClaimId: string | null = null
    let submittedClaimId: string | null = null

    try {
      const unauthenticated = await request.get('/api/warranty_claims')
      expect(unauthenticated.status(), 'GET /api/warranty_claims should require staff auth').toBe(401)

      roleId = await createRoleFixture(request, adminToken, { name: `QA WC no feature ${stamp}` })
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
        name: `QA WC no feature ${stamp}`,
      })
      const noFeatureToken = await getAuthToken(request, noFeatureEmail, noFeaturePassword)
      const forbidden = await apiRequest(request, 'GET', '/api/warranty_claims', { token: noFeatureToken })
      expect(forbidden.status(), 'user without warranty_claims.view should be forbidden').toBe(403)

      const danglingOrderCreate = await apiRequest(request, 'POST', '/api/warranty_claims', {
        token: adminToken,
        data: {
          claimType: 'return',
          channel: 'staff',
          customerName: `QA WC Dangling Order ${stamp}`,
          orderId: randomUUID(),
          reasonCode: 'damaged',
          currencyCode: 'USD',
        },
      })
      const danglingOrderBody = await readJsonSafe<{ id?: string | null; error?: string }>(danglingOrderCreate)
      expect(danglingOrderCreate.status(), `dangling orderId should return 400: ${JSON.stringify(danglingOrderBody)}`).toBe(400)
      expect(danglingOrderBody?.error).toBe('warranty_claims.errors.invalidReference')

      const claim = await createClaimFixture(request, adminToken, {
        claimType: 'return',
        channel: 'staff',
        priority: 'normal',
        customerName: `QA WC Customer ${stamp}`,
        reasonCode: 'damaged',
        notes: `Initial notes ${stamp}`,
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-001-A-${stamp}`,
            productName: 'QA Warranty Part A',
            serialNumber: `SER-A-${stamp}`,
            faultDescription: 'Leaking during acceptance test',
            qtyClaimed: 2,
            creditAmount: 25,
          },
          {
            lineNo: 2,
            sku: `WC-001-B-${stamp}`,
            productName: 'QA Warranty Part B',
            serialNumber: `SER-B-${stamp}`,
            faultDescription: 'Damaged housing',
            qtyClaimed: 1,
            creditAmount: 15,
          },
        ],
      })
      draftClaimId = claim.id
      expect(draftClaimId, 'created claim id should be present').toBeTruthy()
      expect(claim.claimNumber, 'claim number should be generated').toMatch(/^RMA-/)
      expect(claim.updatedAt, 'claim readback should include updatedAt').toBeTruthy()

      const initialLines = await listClaimLines(request, adminToken, draftClaimId!)
      expect(initialLines, 'create should persist two initial lines').toHaveLength(2)

      const byStatus = await listClaims(request, adminToken, 'status=draft&pageSize=100')
      expect(byStatus.some((item) => item.id === draftClaimId), 'status=draft filter should include the claim').toBe(true)
      const byType = await listClaims(request, adminToken, 'claimType=return&pageSize=100')
      expect(byType.some((item) => item.id === draftClaimId), 'claimType=return filter should include the claim').toBe(true)
      const byIds = await listClaims(request, adminToken, `ids=${encodeURIComponent(draftClaimId!)}&pageSize=100`)
      expect(byIds.map((item) => item.id)).toEqual([draftClaimId])

      await new Promise((resolve) => setTimeout(resolve, 5))
      const validUpdate = await updateClaim(
        request,
        adminToken,
        { id: draftClaimId, notes: `Updated intake notes ${stamp}`, priority: 'high' },
        claim.updatedAt,
      )
      expect(validUpdate.status(), 'fresh optimistic-lock PUT should return 200').toBe(200)
      let updated = (await listClaims(request, adminToken, `ids=${encodeURIComponent(draftClaimId!)}&pageSize=10`))[0]
      expect(updated.notes).toBe(`Updated intake notes ${stamp}`)
      expect(updated.priority).toBe('high')
      expect(updated.updatedAt, 'successful update should refresh updatedAt').toBeTruthy()
      expect(updated.updatedAt).not.toBe(claim.updatedAt)

      const staleUpdate = await updateClaim(
        request,
        adminToken,
        { id: draftClaimId, notes: `Stale update ${stamp}` },
        claim.updatedAt,
      )
      expect(staleUpdate.status(), 'stale optimistic-lock PUT should return 409').toBe(409)
      const staleBody = await readJsonSafe<Record<string, unknown>>(staleUpdate)
      expect(staleBody).toMatchObject({
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: claim.updatedAt,
      })

      updated = (await listClaims(request, adminToken, `ids=${encodeURIComponent(draftClaimId!)}&pageSize=10`))[0]
      const statusUpdate = await updateClaim(
        request,
        adminToken,
        { id: draftClaimId, status: 'submitted' },
        updated.updatedAt,
      )
      expect(statusUpdate.status(), 'generic PUT must reject direct status changes').toBe(400)

      const invalidAssignee = await assignClaim(
        request,
        adminToken,
        { id: draftClaimId!, assigneeUserId: randomUUID() },
        updated.updatedAt,
      )
      expect(invalidAssignee.status(), 'assigning a non-tenant/random user id should return 400').toBe(400)
      const invalidAssigneeBody = await readJsonSafe<{ error?: string }>(invalidAssignee)
      expect(invalidAssigneeBody?.error).toBe('warranty_claims.errors.invalidAssignee')

      const submitted = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Non Draft ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      submittedClaimId = submitted.id
      const submitResponse = await submitClaim(request, adminToken, submittedClaimId!, submitted.updatedAt)
      expect(submitResponse.status(), 'submit fixture claim should return 200').toBe(200)
      const deleteSubmitted = await apiRequest(
        request,
        'DELETE',
        `/api/warranty_claims?id=${encodeURIComponent(submittedClaimId!)}`,
        { token: adminToken },
      )
      expect(deleteSubmitted.status(), 'DELETE should reject non-draft/non-cancelled claims').toBe(400)

      const submittedReadback = (await listClaims(request, adminToken, `ids=${encodeURIComponent(submittedClaimId!)}&pageSize=10`))[0]
      await transitionClaim(request, adminToken, { id: submittedClaimId!, toStatus: 'cancelled' }, submittedReadback.updatedAt)
      const deleteCancelled = await apiRequest(
        request,
        'DELETE',
        `/api/warranty_claims?id=${encodeURIComponent(submittedClaimId!)}`,
        { token: adminToken },
      )
      expect(deleteCancelled.status(), 'DELETE should allow cancelled claims').toBe(200)
      submittedClaimId = null

      await cleanupDraftClaimWithLines(request, adminToken, draftClaimId)
      const deletedReadback = await listClaims(request, adminToken, `ids=${encodeURIComponent(draftClaimId!)}&pageSize=10`)
      expect(deletedReadback, 'deleted draft claim should disappear from list readback').toHaveLength(0)
      draftClaimId = null
    } finally {
      await deleteClaimIfExists(request, adminToken, submittedClaimId)
      await cleanupDraftClaimWithLines(request, adminToken, draftClaimId)
      await cleanupDraftClaimWithLines(request, adminToken, danglingOrderClaimId)
      await deleteUserIfExists(request, adminToken, noFeatureUserId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
