import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createUserFixture,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'

// TC-DEV-009: the devices admin surface identifies a device owner by name, not by UUID (#5591).
// The register form's user picker and the list's owner column both read `/api/auth/users`, so this
// covers the batch `?ids=` lookup that backs them — including the case where the parameter is
// supplied but unusable, which must match nothing rather than fall back to the full first page.

type UserListItem = { id: string; name?: string | null; email?: string | null }
type UserListResponse = { items?: UserListItem[]; total?: number }

const USERS_PATH = '/api/auth/users'
const ADMIN_DEVICES_PATH = '/api/devices/admin/devices'

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

async function listUsers(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<{ status: number; body: UserListResponse | null }> {
  const res = await apiRequest(request, 'GET', `${USERS_PATH}${query}`, { token })
  return { status: res.status(), body: await readJsonSafe<UserListResponse>(res) }
}

test.describe('TC-DEV-009: device owners resolve to a searchable user, not a raw UUID', () => {
  test('resolves a batch of owner ids, and matches nothing when ids is unusable', async ({ request }) => {
    const token = await getAuthToken(request)
    const scope = getTokenScope(token)
    const suffix = uniqueSuffix()
    const createdUserIds: string[] = []
    let deviceId: string | null = null

    try {
      const alice = await createUserFixture(request, token, {
        email: `tc-dev-009-alice-${suffix}@example.test`,
        password: 'Sup3rSecret!pass',
        organizationId: scope.organizationId,
        roles: [],
        name: `TC DEV 009 Alice ${suffix}`,
      })
      createdUserIds.push(alice)
      const bob = await createUserFixture(request, token, {
        email: `tc-dev-009-bob-${suffix}@example.test`,
        password: 'Sup3rSecret!pass',
        organizationId: scope.organizationId,
        roles: [],
        name: `TC DEV 009 Bob ${suffix}`,
      })
      createdUserIds.push(bob)

      // The owner column resolves the ids that are actually on the page in one request.
      const batch = await listUsers(request, token, `?ids=${alice},${bob}`)
      expect(batch.status, 'batch id lookup should succeed').toBe(200)
      const returnedIds = (batch.body?.items ?? []).map((item) => item.id).sort()
      expect(returnedIds).toEqual([alice, bob].sort())

      // `?id=` and `?ids=` intersect instead of widening to the union.
      const intersected = await listUsers(request, token, `?ids=${alice},${bob}&id=${alice}`)
      expect(intersected.status).toBe(200)
      expect((intersected.body?.items ?? []).map((item) => item.id)).toEqual([alice])

      // Supplied but unusable: matching nothing keeps a malformed request from reading back a page
      // of the directory it never named.
      const malformed = await listUsers(request, token, '?ids=not-a-uuid,also-not')
      expect(malformed.status).toBe(200)
      expect(malformed.body?.items ?? []).toHaveLength(0)

      const disjoint = await listUsers(request, token, `?ids=${bob}&id=${alice}`)
      expect(disjoint.status).toBe(200)
      expect(disjoint.body?.items ?? []).toHaveLength(0)

      // A device registered on behalf of that user is listed with an owner the admin can resolve.
      const registered = await apiRequest(request, 'POST', ADMIN_DEVICES_PATH, {
        token,
        data: { userId: alice, deviceId: `tc-dev-009-${suffix}`, platform: 'ios' },
      })
      expect(registered.status(), 'admin register-on-behalf should return 201').toBe(201)
      const created = await readJsonSafe<{ id?: string }>(registered)
      deviceId = created?.id ?? null
      expect(deviceId).toBeTruthy()

      const owners = await listUsers(request, token, `?ids=${alice}`)
      const ownerLabel = owners.body?.items?.[0]
      expect(ownerLabel?.name ?? ownerLabel?.email).toBeTruthy()
    } finally {
      if (deviceId) {
        await apiRequest(request, 'DELETE', `${ADMIN_DEVICES_PATH}/${encodeURIComponent(deviceId)}`, { token })
          .catch(() => undefined)
      }
      for (const userId of createdUserIds) {
        await deleteUserIfExists(request, token, userId)
      }
    }
  })
})
