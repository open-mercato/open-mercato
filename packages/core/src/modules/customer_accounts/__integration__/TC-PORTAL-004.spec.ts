import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-004 [P0]: Portal user DELETE blocks self-deletion and revokes the
 * deleted user's sessions atomically.
 *
 * Surface: DELETE /api/customer_accounts/portal/users/[id]
 * Source: issue #2463.
 *
 * Verified contract:
 *   - delete self → 400 { error:'Cannot delete your own account' } (no soft delete)
 *   - delete same-company user → 200 { ok:true } + soft delete + session revoked
 *   - re-delete the same user → 404 (proves soft delete)
 *   - missing portal.users.manage → 403 (the feature gate runs first)
 */

type OkResponse = { ok: boolean; error?: string }

test.describe('TC-PORTAL-004: portal user deletion guards', () => {
  test('blocks self-deletion, removes others, and revokes their sessions', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let company: string | null = null
    let roleId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null

    try {
      company = await createCustomerCompanyFixture(request, adminToken)

      const role = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.users.manage'],
      })
      roleId = role.id

      const userA = await createCustomerUserFixture(request, adminToken, {
        roleIds: [role.id],
        customerEntityId: company,
      })
      userAId = userA.id
      const userB = await createCustomerUserFixture(request, adminToken, {
        roleIds: [role.id],
        customerEntityId: company,
      })
      userBId = userB.id

      const sessionA = await portalLogin(request, {
        email: userA.email,
        password: userA.password,
        tenantId,
      })
      const sessionB = await portalLogin(request, {
        email: userB.email,
        password: userB.password,
        tenantId,
      })

      // Self-delete is rejected.
      const selfRes = await request.delete(`/api/customer_accounts/portal/users/${userA.id}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(selfRes.status(), 'self-delete should be 400').toBe(400)
      const selfBody = await readJsonSafe<OkResponse>(selfRes)
      expect(selfBody?.ok).toBe(false)
      expect(selfBody?.error).toBe('Cannot delete your own account')

      // userA is unaffected by the rejected self-delete.
      const stillAlive = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(sessionA),
      })
      expect(stillAlive.status(), 'userA session should remain valid').toBe(200)

      // userB's session is valid before deletion.
      const bBefore = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(sessionB),
      })
      expect(bBefore.status(), 'userB session valid before delete').toBe(200)

      // Delete userB (same company) succeeds.
      const delRes = await request.delete(`/api/customer_accounts/portal/users/${userB.id}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(delRes.status(), 'deleting another user should be 200').toBe(200)
      const delBody = await readJsonSafe<OkResponse>(delRes)
      expect(delBody?.ok).toBe(true)

      // userB's sessions are revoked → its portal calls are now rejected.
      const bAfter = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(sessionB),
      })
      expect(bAfter.status(), 'userB session revoked after deletion').toBe(401)

      // The 401 above is also produced by the user soft-delete, so assert the
      // session rows directly: revokeAllUserSessions must have set deleted_at on
      // every CustomerUserSession for userB (the atomic-revocation side effect).
      const sessionRows = await withClient((client) =>
        client
          .query<{ deleted_at: Date | null }>(
            'select deleted_at from customer_user_sessions where user_id = $1',
            [userB.id],
          )
          .then((result) => result.rows),
      )
      expect(sessionRows.length, 'userB should have had at least one session row').toBeGreaterThanOrEqual(1)
      expect(
        sessionRows.every((row) => row.deleted_at !== null),
        'all of userB sessions must be revoked (deleted_at set)',
      ).toBe(true)

      // Re-deleting userB returns 404 — it is soft-deleted (no longer active).
      const reDelRes = await request.delete(`/api/customer_accounts/portal/users/${userB.id}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(reDelRes.status(), 'second delete should be 404 (soft-deleted)').toBe(404)
      userBId = null // already deleted
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userAId)
      await deleteCustomerUserFixture(request, adminToken, userBId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, company)
    }
  })

  test('denies deletion when the caller lacks portal.users.manage', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let company: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      company = await createCustomerCompanyFixture(request, adminToken)
      // Role without portal.users.manage — the feature gate runs before the
      // company / self / lookup checks, so any DELETE target returns 403.
      const role = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.account.manage'],
      })
      roleId = role.id
      const user = await createCustomerUserFixture(request, adminToken, {
        roleIds: [role.id],
        customerEntityId: company,
      })
      userId = user.id
      const session = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })

      const res = await request.delete(`/api/customer_accounts/portal/users/${randomUUID()}`, {
        headers: portalCookieHeaders(session),
      })
      expect(res.status(), 'delete without manage feature should be 403').toBe(403)
      const body = await readJsonSafe<OkResponse>(res)
      expect(body?.ok).toBe(false)
      expect(body?.error).toBe('Insufficient permissions')
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, company)
    }
  })
})
