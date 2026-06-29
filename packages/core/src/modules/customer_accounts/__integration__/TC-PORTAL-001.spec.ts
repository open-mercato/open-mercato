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
 * TC-PORTAL-001 [P0]: Portal profile GET returns the authenticated user profile
 * with roles and ACL-resolved features.
 *
 * Surface: GET /api/customer_accounts/portal/profile
 * Source: issue #2463.
 */

type ProfileResponse = {
  ok: boolean
  user?: {
    id: string
    email: string
    displayName: string
    emailVerified: boolean
    isActive: boolean
    createdAt: string
    lastLoginAt: string | null
    customerEntityId: string | null
    personEntityId: string | null
  }
  roles?: Array<{ id: string; name: string; slug: string }>
  resolvedFeatures?: string[]
  isPortalAdmin?: boolean
  error?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

test.describe('TC-PORTAL-001: portal profile returns user, roles and features', () => {
  test('GET /portal/profile returns the authenticated profile and rejects anonymous callers', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let userId: string | null = null

    try {
      // Anonymous request must be rejected before any fixture exists.
      const anon = await request.get('/api/customer_accounts/portal/profile')
      expect(anon.status(), 'profile should be 401 without auth').toBe(401)
      const anonBody = await readJsonSafe<ProfileResponse>(anon)
      expect(anonBody?.ok).toBe(false)
      expect(anonBody?.error).toBe('Authentication required')

      const role = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.account.manage'],
      })
      roleId = role.id

      const user = await createCustomerUserFixture(request, adminToken, {
        roleIds: [role.id],
      })
      userId = user.id

      const session = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })

      const res = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(session),
      })
      expect(res.status(), 'authenticated profile should be 200').toBe(200)
      const body = await readJsonSafe<ProfileResponse>(res)
      expect(body?.ok).toBe(true)

      const profile = body?.user
      expect(profile, 'response.user should be present').toBeTruthy()
      expect(profile!.id).toBe(user.id)
      expect(profile!.id).toMatch(UUID_RE)
      expect(profile!.email).toBe(user.email)
      expect(profile!.displayName).toBe(user.displayName)
      expect(typeof profile!.emailVerified).toBe('boolean')
      expect(profile!.emailVerified, 'admin-created users are email-verified').toBe(true)
      expect(profile!.isActive).toBe(true)
      expect(typeof profile!.createdAt).toBe('string')
      expect(Number.isNaN(Date.parse(profile!.createdAt))).toBe(false)

      expect(Array.isArray(body?.roles)).toBe(true)
      expect(body!.roles!.length).toBeGreaterThanOrEqual(1)
      const assigned = body!.roles!.find((entry) => entry.id === role.id)
      expect(assigned, 'assigned role should be present in roles[]').toBeTruthy()
      expect(assigned!.slug).toBe(role.slug)
      expect(assigned!.name).toBe(role.name)

      expect(Array.isArray(body?.resolvedFeatures)).toBe(true)
      expect(body!.resolvedFeatures).toContain('portal.account.manage')
      expect(body?.isPortalAdmin).toBe(false)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })
})
