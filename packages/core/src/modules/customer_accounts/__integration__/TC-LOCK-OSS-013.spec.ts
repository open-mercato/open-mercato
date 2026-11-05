import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-LOCK-OSS-013: OSS optimistic locking on the customer_accounts ADMIN user
 * route (QA round-5, PR #2055).
 *
 * Unlike the makeCrudRoute-backed entities (covered by TC-LOCK-OSS-001..004),
 * `/api/customer_accounts/admin/users/[id]` is a CUSTOM route. QA found it was
 * last-write-wins: the client sent the version header but the server never
 * enforced it, and `em.nativeUpdate` did not bump `updated_at`. The fix adds
 * `enforceCommandOptimisticLock` to PUT + DELETE and bumps/returns `updated_at`.
 *
 * This spec proves end-to-end:
 *   - GET detail exposes `updatedAt`.
 *   - PUT/DELETE without the header succeed (strictly additive).
 *   - PUT with a fresh header succeeds and advances `updatedAt`.
 *   - PUT with a stale header returns 409 with the structured conflict body.
 *   - DELETE with a stale header returns 409; with a fresh header it deletes.
 *
 * Requires `OM_OPTIMISTIC_LOCK=all` (CI default).
 */
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

async function fetchUserUpdatedAt(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  userId: string,
): Promise<string> {
  const res = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users/${userId}`, { token })
  expect(res.status(), 'GET admin user detail should return 200').toBe(200)
  const body = (await res.json()) as Record<string, unknown>
  const raw = body.updatedAt ?? body.updated_at
  expect(typeof raw, 'admin user detail should expose updatedAt as a string').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

function authHeaders(token: string, headerValue?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (headerValue !== undefined) headers[OPTIMISTIC_LOCK_HEADER] = headerValue
  return headers
}

test.describe('TC-LOCK-OSS-013: customer_accounts admin user optimistic-lock guard (custom route)', () => {
  test('stale PUT/DELETE return 409; fresh succeeds; header-less stays backward-compatible', async ({ request }) => {
    const stamp = Date.now()
    const email = `qa-lock-013-${stamp}@test.local`
    let token: string | null = null
    let userId: string | null = null
    let deleted = false
    try {
      token = await getAuthToken(request, 'admin')

      const createRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token,
        data: { email, password: `Pass${stamp}!`, displayName: `QA Lock 013 ${stamp}` },
      })
      expect(createRes.status(), 'customer user should be created').toBe(201)
      userId = ((await createRes.json()) as { user?: { id?: string } }).user?.id ?? null
      expect(userId, 'created user id should be returned').toBeTruthy()

      // Header-less PUT succeeds (strictly additive).
      const nohdr = await request.fetch(`/api/customer_accounts/admin/users/${userId}`, {
        method: 'PUT',
        headers: authHeaders(token),
        data: { displayName: `QA Lock 013 nohdr ${stamp}` },
      })
      expect(nohdr.status(), 'PUT without header should succeed').toBeLessThan(300)

      // Snapshot t0, then a fresh-header PUT advances the version.
      const t0 = await fetchUserUpdatedAt(request, token, userId!)
      const ok = await request.fetch(`/api/customer_accounts/admin/users/${userId}`, {
        method: 'PUT',
        headers: authHeaders(token, t0),
        data: { displayName: `QA Lock 013 v1 ${stamp}` },
      })
      expect(ok.status(), 'PUT with fresh header should succeed').toBeLessThan(300)
      const t1 = await fetchUserUpdatedAt(request, token, userId!)
      expect(t1, 'updatedAt should advance after a successful PUT').not.toBe(t0)

      // Stale PUT → 409 with structured body.
      const conflict = await request.fetch(`/api/customer_accounts/admin/users/${userId}`, {
        method: 'PUT',
        headers: authHeaders(token, t0),
        data: { displayName: `QA Lock 013 v2 ${stamp}` },
      })
      expect(conflict.status(), 'PUT with stale header should return 409').toBe(409)
      expect((await conflict.json()) as Record<string, unknown>).toMatchObject({
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: t0,
      })

      // Stale DELETE → 409; fresh DELETE → succeeds.
      const delConflict = await request.fetch(`/api/customer_accounts/admin/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(token, t0),
      })
      expect(delConflict.status(), 'DELETE with stale header should return 409').toBe(409)

      const delOk = await request.fetch(`/api/customer_accounts/admin/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(token, t1),
      })
      expect(delOk.status(), 'DELETE with fresh header should succeed').toBeLessThan(300)
      deleted = true
    } finally {
      if (userId && token && !deleted) {
        await request.fetch(`/api/customer_accounts/admin/users/${userId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined)
      }
    }
  })
})
