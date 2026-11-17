import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-009 [P1]: Staff revoke one of a customer's portal sessions from the
 * customer user detail page, and that session stops authenticating.
 *
 * Surfaces:
 *   - GET /api/customer_accounts/admin/users/[id] (sessions list)
 *   - DELETE /api/customer_accounts/admin/users/[id]/sessions/[sessionId]
 * Source: issue #7086.
 */

type AdminUserDetail = { ok: boolean; sessions?: Array<{ id: string }> }
type OkResponse = { ok: boolean; error?: string }

test.describe('TC-PORTAL-009: admin revokes a customer portal session', () => {
  test('ends the session for the customer and refuses unknown or repeated revocations', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let userId: string | null = null

    try {
      const user = await createCustomerUserFixture(request, adminToken, {})
      userId = user.id

      const portalSession = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })

      const profileBefore = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(portalSession),
      })
      expect(profileBefore.status(), 'portal session works before revocation').toBe(200)

      const detailRes = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users/${user.id}`, { token: adminToken })
      expect(detailRes.status()).toBe(200)
      const detail = await readJsonSafe<AdminUserDetail>(detailRes)
      expect(detail?.sessions?.length, 'admin detail lists the active session').toBe(1)
      const sessionId = detail!.sessions![0].id
      const revokePath = `/api/customer_accounts/admin/users/${user.id}/sessions/${sessionId}`

      const anon = await request.delete(revokePath)
      expect(anon.status(), 'revocation requires staff auth').toBe(401)

      const revokeRes = await apiRequest(request, 'DELETE', revokePath, { token: adminToken })
      expect(revokeRes.status(), 'admin revocation should succeed').toBe(200)
      expect((await readJsonSafe<OkResponse>(revokeRes))?.ok).toBe(true)

      const profileAfter = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(portalSession),
      })
      expect(profileAfter.status(), 'revoked session can no longer authenticate').toBe(401)

      const detailAfterRes = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users/${user.id}`, { token: adminToken })
      const detailAfter = await readJsonSafe<AdminUserDetail>(detailAfterRes)
      expect(detailAfter?.sessions ?? [], 'revoked session is no longer listed').toHaveLength(0)

      const repeatRes = await apiRequest(request, 'DELETE', revokePath, { token: adminToken })
      expect(repeatRes.status(), 'an already revoked session is not found').toBe(404)

      const unknownRes = await apiRequest(
        request,
        'DELETE',
        `/api/customer_accounts/admin/users/${user.id}/sessions/${randomUUID()}`,
        { token: adminToken },
      )
      expect(unknownRes.status(), 'an unknown session is not found').toBe(404)
      expect((await readJsonSafe<OkResponse>(unknownRes))?.error).toBe('Session not found')
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
    }
  })
})
