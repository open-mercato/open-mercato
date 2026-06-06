import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-002 [P1]: Portal profile PUT updates displayName behind the
 * `portal.account.manage` feature gate and validates its input.
 *
 * Surface: PUT /api/customer_accounts/portal/profile
 * Source: issue #2463.
 *
 * Verified contract:
 *   - happy PUT → 200 { ok, user: { id, email, displayName } } (no full profile)
 *   - missing portal.account.manage → 403 { ok:false, error:'Insufficient permissions' }
 *   - empty displayName → 400 { ok:false, error:'Validation failed' }
 */

type PutResponse = {
  ok: boolean
  user?: { id: string; email: string; displayName: string }
  error?: string
}

type ProfileResponse = { ok: boolean; user?: { displayName: string } }

const JSON_HEADER = { 'Content-Type': 'application/json' }

test.describe('TC-PORTAL-002: portal profile update is gated and validated', () => {
  test('updates displayName, persists it, and rejects empty input', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let userId: string | null = null

    try {
      const role = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.account.manage'],
      })
      roleId = role.id
      const user = await createCustomerUserFixture(request, adminToken, { roleIds: [role.id] })
      userId = user.id
      const session = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })

      const newName = `Updated Name ${user.id.slice(0, 8)}`
      const putRes = await request.put('/api/customer_accounts/portal/profile', {
        data: { displayName: newName },
        headers: portalCookieHeaders(session, JSON_HEADER),
      })
      expect(putRes.status(), 'profile update should be 200').toBe(200)
      const putBody = await readJsonSafe<PutResponse>(putRes)
      expect(putBody?.ok).toBe(true)
      expect(putBody?.user?.displayName).toBe(newName)

      // Persistence: re-read via GET reflects the new name.
      const getRes = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(session),
      })
      expect(getRes.status()).toBe(200)
      const getBody = await readJsonSafe<ProfileResponse>(getRes)
      expect(getBody?.user?.displayName).toBe(newName)

      // Validation: empty displayName fails the min(1) zod rule.
      const invalidRes = await request.put('/api/customer_accounts/portal/profile', {
        data: { displayName: '' },
        headers: portalCookieHeaders(session, JSON_HEADER),
      })
      expect(invalidRes.status(), 'empty displayName should be 400').toBe(400)
      const invalidBody = await readJsonSafe<PutResponse>(invalidRes)
      expect(invalidBody?.ok).toBe(false)
      expect(invalidBody?.error).toBe('Validation failed')
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })

  test('denies the update when the role lacks portal.account.manage', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let userId: string | null = null

    try {
      // Role with an unrelated feature only — no portal.account.manage.
      const role = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.catalog.view'],
      })
      roleId = role.id
      const user = await createCustomerUserFixture(request, adminToken, { roleIds: [role.id] })
      userId = user.id
      const session = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })

      const res = await request.put('/api/customer_accounts/portal/profile', {
        data: { displayName: 'Should Be Rejected' },
        headers: portalCookieHeaders(session, JSON_HEADER),
      })
      expect(res.status(), 'update without feature should be 403').toBe(403)
      const body = await readJsonSafe<PutResponse>(res)
      expect(body?.ok).toBe(false)
      expect(body?.error).toBe('Insufficient permissions')
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })
})
