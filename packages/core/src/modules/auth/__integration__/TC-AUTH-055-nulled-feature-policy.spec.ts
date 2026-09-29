import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type FeatureCheckResponse = { ok?: boolean; granted?: string[] }
type AdminNavResponse = { grantedFeatures?: string[] }

const REMOVED_FEATURE = 'example.manage'
const ACTIVE_SIBLING = 'example.todos.view'

async function checkFeatures(
  request: APIRequestContext,
  token: string,
  features: string[],
): Promise<FeatureCheckResponse> {
  const response = await apiRequest(request, 'POST', '/api/auth/feature-check', {
    token,
    data: { features },
  })
  expect(response.status(), 'feature-check should return 200').toBe(200)
  return (await readJsonSafe<FeatureCheckResponse>(response)) ?? {}
}

test.describe('TC-AUTH-055: nulled ACL features are runtime-inert', () => {
  test('denies stale literal, wildcard, and superadmin grants while projecting concrete chrome features', async ({ request }) => {
    const fixtureAdminToken = await getAuthToken(request, 'superadmin')
    const { organizationId } = getTokenContext(fixtureAdminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const roleId = await createRoleFixture(request, fixtureAdminToken, {
      name: `qa-tc-auth-055-${stamp}`,
    })
    const userIds: string[] = []

    const createActor = async (
      label: string,
      acl: { features: string[]; isSuperAdmin?: boolean },
    ): Promise<string> => {
      const email = `qa-tc-auth-055-${label}-${stamp}@test.local`
      const password = 'StrongSecret123!'
      const userId = await createUserFixture(request, fixtureAdminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: `QA TC-AUTH-055 ${label}`,
      })
      userIds.push(userId)

      const response = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: fixtureAdminToken,
        data: {
          userId,
          features: acl.features,
          isSuperAdmin: acl.isSuperAdmin ?? false,
        },
      })
      expect(response.status(), `setting ${label} ACL should return 200`).toBe(200)
      return getAuthToken(request, email, password)
    }

    try {
      const actors = [
        await createActor('literal', { features: [REMOVED_FEATURE, ACTIVE_SIBLING] }),
        await createActor('wildcard', { features: ['example.*'] }),
        await createActor('superadmin', { features: [], isSuperAdmin: true }),
      ]

      for (const token of actors) {
        const removed = await checkFeatures(request, token, [REMOVED_FEATURE])
        expect(removed.ok, `${REMOVED_FEATURE} must be denied`).toBe(false)
        expect(removed.granted ?? []).not.toContain(REMOVED_FEATURE)

        const sibling = await checkFeatures(request, token, [ACTIVE_SIBLING])
        expect(sibling.ok, `${ACTIVE_SIBLING} must remain active`).toBe(true)
        expect(sibling.granted ?? []).toContain(ACTIVE_SIBLING)
      }

      const navResponse = await apiRequest(request, 'GET', '/api/auth/admin/nav', {
        token: actors[2],
      })
      expect(navResponse.status(), 'admin nav should return 200').toBe(200)
      const nav = await readJsonSafe<AdminNavResponse>(navResponse)
      const effective = nav?.grantedFeatures ?? []
      expect(effective.length, 'superadmin chrome features should be non-empty').toBeGreaterThan(0)
      expect(effective).toContain(ACTIVE_SIBLING)
      expect(effective).not.toContain(REMOVED_FEATURE)
      expect(effective.some((feature) => feature === '*' || feature.endsWith('.*'))).toBe(false)
    } finally {
      for (const userId of userIds) {
        await deleteUserIfExists(request, fixtureAdminToken, userId)
      }
      await deleteRoleIfExists(request, fixtureAdminToken, roleId)
    }
  })
})
