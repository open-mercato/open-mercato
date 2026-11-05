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
 * TC-PORTAL-007 [P2]: Portal feature-check returns the granted subset of the
 * requested features, honouring wildcard grants and the portal-admin policy.
 *
 * Surface: POST /api/customer_accounts/portal/feature-check
 * Source: issue #2463.
 *
 * Verified contract:
 *   - granted = requested features that match the user's ACL (wildcard-aware)
 *   - portal admin (isPortalAdmin) → active requested features granted
 *   - 401 without auth; body schema requires 1..100 features (empty → 400)
 */

type FeatureCheckResponse = { ok: boolean; granted?: string[]; error?: string }

const ENDPOINT = '/api/customer_accounts/portal/feature-check'
const JSON_HEADER = { 'Content-Type': 'application/json' }

test.describe('TC-PORTAL-007: portal feature-check matching', () => {
  test('matches exact and wildcard grants and bypasses for portal admins', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    const roleIds: string[] = []
    const userIds: string[] = []

    try {
      const specificRole = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.users.view', 'portal.users.manage'],
      })
      roleIds.push(specificRole.id)
      const wildcardRole = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.*'],
      })
      roleIds.push(wildcardRole.id)
      const adminRole = await createCustomerRoleFixture(request, adminToken, {
        features: [],
        isPortalAdmin: true,
      })
      roleIds.push(adminRole.id)

      const specificUser = await createCustomerUserFixture(request, adminToken, { roleIds: [specificRole.id] })
      userIds.push(specificUser.id)
      const wildcardUser = await createCustomerUserFixture(request, adminToken, { roleIds: [wildcardRole.id] })
      userIds.push(wildcardUser.id)
      const adminUser = await createCustomerUserFixture(request, adminToken, { roleIds: [adminRole.id] })
      userIds.push(adminUser.id)

      const specificSession = await portalLogin(request, {
        email: specificUser.email,
        password: specificUser.password,
        tenantId,
      })
      const wildcardSession = await portalLogin(request, {
        email: wildcardUser.email,
        password: wildcardUser.password,
        tenantId,
      })
      const adminSession = await portalLogin(request, {
        email: adminUser.email,
        password: adminUser.password,
        tenantId,
      })

      const requested = [
        'portal.users.view',
        'portal.users.manage',
        'portal.users.roles.manage',
        'nonexistent.feature',
      ]

      // Exact grants only — no wildcard, no unrelated feature.
      const specificRes = await request.post(ENDPOINT, {
        data: { features: requested },
        headers: portalCookieHeaders(specificSession, JSON_HEADER),
      })
      expect(specificRes.status()).toBe(200)
      const specific = await readJsonSafe<FeatureCheckResponse>(specificRes)
      expect(specific?.ok).toBe(true)
      const specificGranted = specific?.granted ?? []
      expect(specificGranted).toContain('portal.users.view')
      expect(specificGranted).toContain('portal.users.manage')
      expect(specificGranted).not.toContain('portal.users.roles.manage')
      expect(specificGranted).not.toContain('nonexistent.feature')

      // Wildcard portal.* matches every requested portal.* feature.
      const wildcardRes = await request.post(ENDPOINT, {
        data: { features: requested },
        headers: portalCookieHeaders(wildcardSession, JSON_HEADER),
      })
      expect(wildcardRes.status()).toBe(200)
      const wildcard = await readJsonSafe<FeatureCheckResponse>(wildcardRes)
      const wildcardGranted = wildcard?.granted ?? []
      expect(wildcardGranted).toContain('portal.users.view')
      expect(wildcardGranted).toContain('portal.users.manage')
      expect(wildcardGranted).toContain('portal.users.roles.manage')
      expect(wildcardGranted).not.toContain('nonexistent.feature')

      // Portal admin bypasses grants, but the shared policy still rejects
      // requirements that are not owned by an enabled module.
      const adminRes = await request.post(ENDPOINT, {
        data: { features: ['portal.account.manage', 'anything.else'] },
        headers: portalCookieHeaders(adminSession, JSON_HEADER),
      })
      expect(adminRes.status()).toBe(200)
      const adminBody = await readJsonSafe<FeatureCheckResponse>(adminRes)
      expect(adminBody?.granted).toEqual(['portal.account.manage'])
    } finally {
      for (const id of userIds) await deleteCustomerUserFixture(request, adminToken, id)
      for (const id of roleIds) await deleteCustomerRoleFixture(request, adminToken, id)
    }
  })

  test('requires auth and a 1..100 features array', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let userId: string | null = null

    try {
      // Unauthenticated → 401.
      const anon = await request.post(ENDPOINT, {
        data: { features: ['portal.users.view'] },
        headers: JSON_HEADER,
      })
      expect(anon.status(), 'feature-check should be 401 without auth').toBe(401)

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

      // Empty features array violates the min(1) schema → 400.
      const emptyRes = await request.post(ENDPOINT, {
        data: { features: [] },
        headers: portalCookieHeaders(session, JSON_HEADER),
      })
      expect(emptyRes.status(), 'empty features should be 400').toBe(400)
      expect((await readJsonSafe<FeatureCheckResponse>(emptyRes))?.ok).toBe(false)

      // Exactly 100 features is accepted (schema upper bound).
      const maxFeatures = Array.from({ length: 100 }, (_, i) => `portal.feature.${i}`)
      const maxRes = await request.post(ENDPOINT, {
        data: { features: maxFeatures },
        headers: portalCookieHeaders(session, JSON_HEADER),
      })
      expect(maxRes.status(), '100 features should be accepted').toBe(200)

      // 101 features exceeds the limit → 400.
      const overRes = await request.post(ENDPOINT, {
        data: { features: [...maxFeatures, 'portal.feature.100'] },
        headers: portalCookieHeaders(session, JSON_HEADER),
      })
      expect(overRes.status(), '101 features should be 400').toBe(400)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })
})
