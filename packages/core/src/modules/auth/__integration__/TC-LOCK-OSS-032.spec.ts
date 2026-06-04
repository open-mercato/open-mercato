import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createUserFixture,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectConflictBody,
  putWithLock,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-032 — auth user edit + per-user ACL optimistic-lock conflict bar.
 *
 * Surfaces under test:
 *  - AUTH-03 (browser): the user edit page (`/backend/users/<id>/edit`) is a
 *    `CrudForm` that submits the user PUT (`/api/auth/users`) with an
 *    optimistic-lock header captured from the loaded user's `updatedAt` and
 *    routes a 409 to the unified "Record changed" conflict bar
 *    (`data-testid="record-conflict-banner"`). A stale single-tab save must
 *    surface the bar instead of silently overwriting.
 *  - AUTH-04 (API-level fallback): the per-user ACL route
 *    (`PUT /api/auth/users/acl`) guards writes with
 *    `enforceCommandOptimisticLock` only once a `UserAcl` row exists. The ACL is
 *    edited through the in-page `AclEditor` (no dedicated `data-crud-field-id`
 *    input that maps 1:1 to the ACL version), so the clobber contract is proven
 *    at the API level: seed a `UserAcl` row, advance its `updated_at`
 *    out-of-band, then replay the now-stale write with the original
 *    `expectedUpdatedAt` header → 409 `optimistic_lock_conflict`.
 *
 * Pattern (see `optimisticLockUi.ts`): capture the record's `updated_at`,
 * advance it out-of-band via a header-less write, then replay the stale write to
 * trigger the 409 → conflict bar / 409 body.
 */

const USERS_API = '/api/auth/users'
const USER_ACL_API = '/api/auth/users/acl'

type SeededUser = { id: string; email: string }

async function createLockUser(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  stamp: number,
): Promise<SeededUser> {
  const email = `qa.lock032.${stamp}@example.com`
  const id = await createUserFixture(request, token, {
    email,
    password: 'Secret123!',
    organizationId,
    roles: [],
    name: `QA Lock 032 ${stamp}`,
  })
  return { id, email }
}

async function readUserAclUpdatedAt(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'GET',
    `${USER_ACL_API}?userId=${encodeURIComponent(userId)}`,
    { token },
  )
  expect(response.status(), 'GET user ACL should be 200').toBe(200)
  const body = (await response.json()) as { hasCustomAcl?: boolean; updatedAt?: string | null }
  expect(body.hasCustomAcl, 'user ACL row should exist after seeding').toBe(true)
  expect(typeof body.updatedAt, 'seeded user ACL should expose updatedAt').toBe('string')
  return body.updatedAt as string
}

async function putUserAclHeaderless(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', USER_ACL_API, { token, data: body })
  expect(
    response.status(),
    `out-of-band PUT ${USER_ACL_API} should succeed (additive path), got ${response.status()}`,
  ).toBe(200)
}

async function putUserAclWithLock(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
  lockValue: string,
) {
  return request.fetch(resolveApiUrl(USER_ACL_API), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: lockValue,
    },
    data: body,
  })
}

test.describe('TC-LOCK-OSS-032: auth user edit + per-user ACL optimistic-lock', () => {
  test('AUTH-03 stale user edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const { organizationId } = getTokenContext(token)
    expect(organizationId, 'admin token should carry an organization id').toBeTruthy()
    const stamp = Date.now()
    let user: SeededUser | null = null
    try {
      user = await createLockUser(page.request, token, organizationId, stamp)

      await login(page, 'admin')
      await page.goto(`/backend/users/${user.id}/edit`)

      // The user edit CrudForm captures the loaded user's `updatedAt` at load.
      const emailInput = page.locator('[data-crud-field-id="email"] input').first()
      await expect(emailInput).toBeVisible({ timeout: 10_000 })

      // Advance the user's `updated_at` out-of-band → the form now holds a stale
      // token. The user PUT is a standard makeCrudRoute, so a header-less write
      // succeeds and bumps `updated_at`.
      await bumpRecordViaApi(page.request, token, USERS_API, {
        id: user.id,
        name: `QA Lock 032 bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(emailInput, `qa.lock032.stale.${stamp}@example.com`)
      await emailInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteUserIfExists(page.request, token, user?.id ?? null)
    }
  })

  test('AUTH-04 stale per-user ACL clobber is refused with a 409 conflict (API fallback)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const { organizationId } = getTokenContext(token)
    expect(organizationId, 'admin token should carry an organization id').toBeTruthy()
    const stamp = Date.now()
    let user: SeededUser | null = null
    try {
      user = await createLockUser(page.request, token, organizationId, stamp)

      // Seed a UserAcl row so the route's optimistic lock becomes active (it is a
      // no-op when no ACL row exists yet). `UserAcl.updatedAt` is populated only
      // by MikroORM's `onUpdate` hook (no `onCreate`), so the first PUT creates
      // the row with a NULL `updated_at`; a second PUT triggers `onUpdate` and
      // gives the lock a real version token to compare against.
      await putUserAclHeaderless(page.request, token, {
        userId: user.id,
        features: ['auth.users.list'],
        organizations: null,
      })
      await putUserAclHeaderless(page.request, token, {
        userId: user.id,
        features: ['auth.users.list', 'auth.users.delete'],
        organizations: null,
      })
      const staleUpdatedAt = await readUserAclUpdatedAt(page.request, token, user.id)

      // Advance the ACL's `updated_at` out-of-band via a header-less PUT.
      await putUserAclHeaderless(page.request, token, {
        userId: user.id,
        features: ['auth.users.list', 'auth.users.edit'],
        organizations: null,
      })

      // Replay the now-stale write with the original expected version → 409.
      const conflict = await putUserAclWithLock(
        page.request,
        token,
        { userId: user.id, features: ['auth.users.list'], organizations: null },
        staleUpdatedAt,
      )
      await expectConflictBody(conflict)
    } finally {
      await deleteUserIfExists(page.request, token, user?.id ?? null)
    }
  })
})
