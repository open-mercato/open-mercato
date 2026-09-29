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

type FeatureCheckResponse = { ok?: boolean; granted?: string[] }
type ProfileResponse = {
  ok?: boolean
  resolvedFeatures?: string[]
  isPortalAdmin?: boolean
}
type NavResponse = {
  ok?: boolean
  grantedFeatures?: string[]
  isPortalAdmin?: boolean
}

const REMOVED_FEATURE = 'example.manage'
const ACTIVE_PORTAL_FEATURE = 'portal.account.manage'
const JSON_HEADER = { 'Content-Type': 'application/json' }

test.describe('TC-PORTAL-008: portal admin honors the consolidated feature policy', () => {
  test('denies a nulled feature and exposes concrete portal capabilities with explicit admin state', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    let roleId: string | null = null
    let userId: string | null = null

    try {
      const role = await createCustomerRoleFixture(request, adminToken, {
        features: [],
        isPortalAdmin: true,
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

      const checkResponse = await request.post('/api/customer_accounts/portal/feature-check', {
        data: { features: [REMOVED_FEATURE, ACTIVE_PORTAL_FEATURE] },
        headers: portalCookieHeaders(session, JSON_HEADER),
      })
      expect(checkResponse.status(), 'portal feature-check should return 200').toBe(200)
      const check = await readJsonSafe<FeatureCheckResponse>(checkResponse)
      expect(check?.granted ?? []).not.toContain(REMOVED_FEATURE)
      expect(check?.granted ?? []).toContain(ACTIVE_PORTAL_FEATURE)

      const profileResponse = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(session),
      })
      expect(profileResponse.status(), 'portal profile should return 200').toBe(200)
      const profile = await readJsonSafe<ProfileResponse>(profileResponse)
      expect(profile?.isPortalAdmin).toBe(true)
      expect(profile?.resolvedFeatures?.length ?? 0).toBeGreaterThan(0)
      expect(profile?.resolvedFeatures ?? []).toContain(ACTIVE_PORTAL_FEATURE)
      expect(profile?.resolvedFeatures ?? []).not.toContain(REMOVED_FEATURE)
      expect((profile?.resolvedFeatures ?? []).some((feature) => feature.endsWith('.*'))).toBe(false)

      const navResponse = await request.get('/api/customer_accounts/portal/nav', {
        headers: portalCookieHeaders(session),
      })
      expect(navResponse.status(), 'portal nav should return 200').toBe(200)
      const nav = await readJsonSafe<NavResponse>(navResponse)
      expect(nav?.isPortalAdmin).toBe(true)
      expect(nav?.grantedFeatures?.length ?? 0).toBeGreaterThan(0)
      expect(nav?.grantedFeatures ?? []).not.toContain(REMOVED_FEATURE)
      expect((nav?.grantedFeatures ?? []).some((feature) => feature.endsWith('.*'))).toBe(false)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })
})
