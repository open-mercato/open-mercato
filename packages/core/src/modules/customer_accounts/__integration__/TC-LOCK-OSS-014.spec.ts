import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-LOCK-OSS-014: OSS optimistic locking on the customer_accounts ADMIN role
 * route (QA round-5 server enforcement + round-6 client surfacing, PR #2055).
 *
 * Like the user route (TC-LOCK-OSS-013), `/api/customer_accounts/admin/roles/[id]`
 * is a CUSTOM route. The round-6 client fix routes its 409 through the unified
 * conflict bar; this spec proves the server contract the UI relies on:
 *   - GET detail exposes `updatedAt`.
 *   - PUT/DELETE without the header succeed (strictly additive).
 *   - PUT with a fresh header succeeds and advances `updatedAt`.
 *   - PUT with a stale header returns 409 with the structured conflict body.
 *   - DELETE with a stale header returns 409; with a fresh header it deletes.
 *
 * Requires `OM_OPTIMISTIC_LOCK=all` (CI default).
 */
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

async function fetchRoleUpdatedAt(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  roleId: string,
): Promise<string> {
  const res = await apiRequest(request, 'GET', `/api/customer_accounts/admin/roles/${roleId}`, { token })
  expect(res.status(), 'GET admin role detail should return 200').toBe(200)
  const body = (await res.json()) as Record<string, unknown>
  const raw = body.updatedAt ?? body.updated_at
  expect(typeof raw, 'admin role detail should expose updatedAt as a string').toBe('string')
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

test.describe('TC-LOCK-OSS-014: customer_accounts admin role optimistic-lock guard (custom route)', () => {
  test('stale PUT/DELETE return 409; fresh succeeds; header-less stays backward-compatible', async ({ request }) => {
    const stamp = Date.now()
    const slug = `qa-lock-014-${stamp}`
    let token: string | null = null
    let roleId: string | null = null
    let deleted = false
    try {
      token = await getAuthToken(request, 'admin')

      const createRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/roles', {
        token,
        data: { name: `QA Lock 014 ${stamp}`, slug, description: 'QA lock fixture' },
      })
      expect(createRes.status(), 'customer role should be created').toBeLessThan(300)
      roleId = ((await createRes.json()) as { role?: { id?: string } }).role?.id ?? null
      expect(roleId, 'created role id should be returned').toBeTruthy()

      // Header-less PUT succeeds (strictly additive).
      const nohdr = await request.fetch(`/api/customer_accounts/admin/roles/${roleId}`, {
        method: 'PUT',
        headers: authHeaders(token),
        data: { name: `QA Lock 014 nohdr ${stamp}` },
      })
      expect(nohdr.status(), 'PUT without header should succeed').toBeLessThan(300)

      const t0 = await fetchRoleUpdatedAt(request, token, roleId!)
      const ok = await request.fetch(`/api/customer_accounts/admin/roles/${roleId}`, {
        method: 'PUT',
        headers: authHeaders(token, t0),
        data: { name: `QA Lock 014 v1 ${stamp}` },
      })
      expect(ok.status(), 'PUT with fresh header should succeed').toBeLessThan(300)
      const t1 = await fetchRoleUpdatedAt(request, token, roleId!)
      expect(t1, 'updatedAt should advance after a successful PUT').not.toBe(t0)

      // Stale PUT → 409 with structured body.
      const conflict = await request.fetch(`/api/customer_accounts/admin/roles/${roleId}`, {
        method: 'PUT',
        headers: authHeaders(token, t0),
        data: { name: `QA Lock 014 v2 ${stamp}` },
      })
      expect(conflict.status(), 'PUT with stale header should return 409').toBe(409)
      expect((await conflict.json()) as Record<string, unknown>).toMatchObject({
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: t0,
      })

      // Stale DELETE → 409; fresh DELETE → succeeds.
      const delConflict = await request.fetch(`/api/customer_accounts/admin/roles/${roleId}`, {
        method: 'DELETE',
        headers: authHeaders(token, t0),
      })
      expect(delConflict.status(), 'DELETE with stale header should return 409').toBe(409)

      const delOk = await request.fetch(`/api/customer_accounts/admin/roles/${roleId}`, {
        method: 'DELETE',
        headers: authHeaders(token, t1),
      })
      expect(delOk.status(), 'DELETE with fresh header should succeed').toBeLessThan(300)
      deleted = true
    } finally {
      if (roleId && token && !deleted) {
        await request.fetch(`/api/customer_accounts/admin/roles/${roleId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined)
      }
    }
  })
})
