import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TC-MAP-001: per-tenant module availability.
 *
 * Under OM_TEST_MODE the `module_availability_probe` app module registers a
 * tenant module availability provider that governs only the probe module and
 * reads a per-tenant switch toggled through `PUT /api/module_availability_probe/availability`.
 * With the probe module unavailable to the tenant, its feature is denied to a
 * tenant user granted it, to the super admin and to an API key, at the API
 * route guard and the feature-check endpoint; making it available again
 * restores both without touching grants. Page guards and navigation are
 * covered by unit tests, because the probe ships no page. It has no `acl.ts`
 * either: its ping route requires `module_availability_probe.ping`, a feature
 * the probe owns through its module-id prefix and this test grants to a role.
 */

const PROBE_FEATURE = 'module_availability_probe.ping'

type FeatureCheckBody = { ok?: boolean; granted?: string[] }

type Access = {
  routeStatus: number
  featureGranted: boolean
}

async function setProbeAvailability(request: APIRequestContext, token: string, available: boolean): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/module_availability_probe/availability', {
    token,
    data: { available },
  })
  expect(response.status(), `PUT probe availability=${available} should return 200`).toBe(200)
}

async function readTokenAccess(request: APIRequestContext, token: string): Promise<Access> {
  const route = await apiRequest(request, 'GET', '/api/module_availability_probe/ping', { token })
  const featureCheck = await apiRequest(request, 'POST', '/api/auth/feature-check', {
    token,
    data: { features: [PROBE_FEATURE] },
  })
  expect(featureCheck.status(), 'feature-check should return 200').toBe(200)
  const featureBody = (await readJsonSafe<FeatureCheckBody>(featureCheck)) ?? {}
  return {
    routeStatus: route.status(),
    featureGranted: (featureBody.granted ?? []).includes(PROBE_FEATURE),
  }
}

async function readApiKeyRouteStatus(request: APIRequestContext, secret: string): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/module_availability_probe/ping', {
    token: secret,
    headers: { Authorization: `ApiKey ${secret}` },
  })
  return response.status()
}

test.describe('TC-MAP-001: per-tenant module availability', () => {
  test('an unavailable module is denied to tenant users, super admins and API keys until it is available again', async ({ request }) => {
    test.setTimeout(120_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId, tenantId } = getTokenContext(superadminToken)
    expect(tenantId, 'superadmin token should carry a tenant').not.toBe('')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const email = `qa-tc-map-001-${stamp}@example.com`
    const password = 'StrongSecret123!'
    let roleId: string | null = null
    let userId: string | null = null
    let apiKeyId: string | null = null

    try {
      await setProbeAvailability(request, superadminToken, true)
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-map-001-${stamp}` })
      await setRoleAclFeatures(request, superadminToken, { roleId, features: [PROBE_FEATURE] })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-MAP-001',
      })
      const userToken = await getAuthToken(request, email, password)
      const apiKeyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: superadminToken,
        data: { name: `QA TC-MAP-001 ${stamp}`, roles: [roleId], tenantId, organizationId },
      })
      expect(apiKeyResponse.ok(), 'API key fixture should be created').toBeTruthy()
      const apiKey = (await readJsonSafe<{ id?: string; secret?: string }>(apiKeyResponse)) ?? {}
      apiKeyId = apiKey.id ?? null
      const apiKeySecret = apiKey.secret ?? ''
      expect(apiKeySecret, 'API key secret should be returned once').not.toBe('')

      const available: Access = { routeStatus: 200, featureGranted: true }
      const unavailable: Access = { routeStatus: 403, featureGranted: false }

      expect(await readTokenAccess(request, userToken)).toEqual(available)
      expect(await readTokenAccess(request, superadminToken)).toEqual(available)
      expect(await readApiKeyRouteStatus(request, apiKeySecret)).toBe(200)

      await setProbeAvailability(request, superadminToken, false)

      expect(await readTokenAccess(request, userToken)).toEqual(unavailable)
      expect(await readTokenAccess(request, superadminToken)).toEqual(unavailable)
      expect(await readApiKeyRouteStatus(request, apiKeySecret)).toBe(403)

      await setProbeAvailability(request, superadminToken, true)

      expect(await readTokenAccess(request, userToken)).toEqual(available)
      expect(await readTokenAccess(request, superadminToken)).toEqual(available)
      expect(await readApiKeyRouteStatus(request, apiKeySecret)).toBe(200)
    } finally {
      await setProbeAvailability(request, superadminToken, true).catch(() => undefined)
      if (apiKeyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(apiKeyId)}`, {
          token: superadminToken,
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
