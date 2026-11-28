import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-AUTH-074 [P1]: the `auth.user-acl.update` command echoes back the ACL
 * row MikroORM actually flushed — the route/command/database seam the PR
 * #8683 review flagged as unproven by `edit-page.acl-composite-save.test.tsx`,
 * since that unit test mocks both writes and supplies the timestamp itself.
 *
 * Drives the real `PUT /api/auth/users/acl` and `PUT /api/auth/users` routes
 * end to end, mirroring the composite save in `edit/page.tsx`'s `onSubmit`:
 * an existing custom ACL is changed, the committed response's `updatedAt` is
 * captured, a subsequent user update fails on a real duplicate-email
 * collision, a corrected retry succeeds without resending the unchanged ACL,
 * and a further genuine ACL edit using the captured version must not 409 —
 * which only holds if the first write's response really is the persisted row,
 * not a value merely computed in memory.
 */

const USER_ACL_API = '/api/auth/users/acl'
const USERS_API = '/api/auth/users'

async function readAclUpdatedAt(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `${USER_ACL_API}?userId=${encodeURIComponent(userId)}`, { token })
  expect(response.status(), 'GET user ACL should be 200').toBe(200)
  const body = await readJsonSafe<{ updatedAt?: string | null }>(response)
  return body?.updatedAt ?? null
}

test.describe('TC-AUTH-074: ACL composite-save retry uses the real persisted version', () => {
  test('a committed ACL write echoes the actual flushed version, usable for the next write with no 409', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const duplicateEmail = `qa-tc-auth-074-dup-${stamp}@example.com`
    const retryEmail = `qa-tc-auth-074-retry-${stamp}@example.com`
    let targetUserId: string | null = null
    let fixtureUserId: string | null = null

    try {
      // Occupies `duplicateEmail`, so the target's first retry attempt below
      // has a real collision to fail against.
      fixtureUserId = await createUserFixture(request, adminToken, {
        email: duplicateEmail,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
        name: 'QA TC-AUTH-074 Fixture',
      })

      targetUserId = await createUserFixture(request, adminToken, {
        email: `qa-tc-auth-074-target-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
        name: 'QA TC-AUTH-074 Target',
      })

      // Seed an existing custom ACL. The `updated_at` column is stamped by
      // MikroORM's `onUpdate` hook only, so the row's own INSERT leaves it
      // `null` — a single PUT would not exercise the lock at all.
      const seedGrant = await apiRequest(request, 'PUT', USER_ACL_API, {
        token: adminToken,
        data: { userId: targetUserId, features: ['auth.users.list'], organizations: null },
      })
      expect(seedGrant.status(), 'seeding the initial ACL grant should succeed').toBe(200)
      const seededUpdatedAt = await readAclUpdatedAt(request, adminToken, targetUserId)
      expect(typeof seededUpdatedAt, 'seeded ACL should carry a real updated_at').toBe('string')

      // "Change its grants" — the composite save's first write, locked
      // against the version just seeded.
      const changeGrant = await apiRequest(request, 'PUT', USER_ACL_API, {
        token: adminToken,
        data: { userId: targetUserId, features: ['auth.users.list', 'auth.users.edit'], organizations: null },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: seededUpdatedAt as string },
      })
      expect(changeGrant.status(), 'the grant change should succeed').toBe(200)
      const changeBody = await readJsonSafe<{ ok?: boolean; updatedAt?: string | null }>(changeGrant)
      expect(changeBody?.ok, 'grant change response should report ok').toBe(true)
      const refreshedUpdatedAt = changeBody?.updatedAt ?? null
      expect(typeof refreshedUpdatedAt, 'the response must echo the row the write actually committed').toBe('string')
      expect(refreshedUpdatedAt, 'the echoed version must advance past the seeded one').not.toBe(seededUpdatedAt)

      // The response's `updatedAt` must match a fresh read of the same row —
      // not a value the handler computed without it reaching the flushed row.
      const persistedUpdatedAt = await readAclUpdatedAt(request, adminToken, targetUserId)
      expect(refreshedUpdatedAt, "the response's updatedAt must match what a fresh GET reads back").toBe(
        persistedUpdatedAt,
      )

      // "Cause the subsequent user update to fail duplicate-email validation."
      const failingUpdate = await apiRequest(request, 'PUT', USERS_API, {
        token: adminToken,
        data: { id: targetUserId, email: duplicateEmail },
      })
      expect(failingUpdate.status(), 'the duplicate-email update should be rejected').toBe(400)

      // The ACL change already committed and must survive the later failure.
      const grantAfterFailure = await readAclUpdatedAt(request, adminToken, targetUserId)
      expect(grantAfterFailure, 'the committed ACL change must survive the later user-update failure').toBe(
        refreshedUpdatedAt,
      )

      // "Correct and retry" — only the user update is resent, mirroring the
      // real edit page's `onSubmit`, which never resends an unchanged ACL.
      const correctedUpdate = await apiRequest(request, 'PUT', USERS_API, {
        token: adminToken,
        data: { id: targetUserId, email: retryEmail },
      })
      expect(correctedUpdate.status(), 'the corrected retry should succeed').toBe(200)

      // "Make another genuine ACL edit" — using the version the real flush
      // echoed back, not the stale seeded one. If the command result were
      // still unpopulated or merely in-memory, this write would 409.
      const secondGrantChange = await apiRequest(request, 'PUT', USER_ACL_API, {
        token: adminToken,
        data: {
          userId: targetUserId,
          features: ['auth.users.list', 'auth.users.edit', 'auth.users.delete'],
          organizations: null,
        },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: refreshedUpdatedAt as string },
      })
      expect(secondGrantChange.status(), 'a further genuine ACL edit using the refreshed version must not 409').toBe(
        200,
      )
    } finally {
      await deleteUserIfExists(request, adminToken, targetUserId)
      await deleteUserIfExists(request, adminToken, fixtureUserId)
    }
  })
})
