import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-LOCK-OSS-015: OSS optimistic locking on the inbox_ops settings PATCH
 * (QA round-5 server enforcement + round-6 client surfacing, PR #2055).
 *
 * `/api/inbox_ops/settings` is a per-tenant SINGLETON custom route. The round-6
 * client fix routes its 409 through the unified conflict bar; this spec proves
 * the server contract the UI relies on:
 *   - GET exposes `updatedAt`.
 *   - PATCH with a fresh header succeeds and advances `updatedAt`.
 *   - PATCH with a stale header returns 409 with the structured conflict body.
 *   - PATCH without the header succeeds (strictly additive).
 *
 * Self-contained: it never relies on a specific working language, restores the
 * original value in teardown, and skips cleanly when the tenant has no inbox
 * settings row yet (the route is opt-in per tenant).
 *
 * Requires `OM_OPTIMISTIC_LOCK=all` (CI default).
 */
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const LANGUAGES = ['en', 'de', 'es', 'pl'] as const

type SettingsBody = { settings: { workingLanguage?: string; updatedAt?: string | null } | null }

async function fetchSettings(
  request: import('@playwright/test').APIRequestContext,
  token: string,
): Promise<SettingsBody['settings']> {
  const res = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token })
  expect(res.status(), 'GET inbox settings should return 200').toBe(200)
  return ((await res.json()) as SettingsBody).settings
}

function authHeaders(token: string, headerValue?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (headerValue !== undefined) headers[OPTIMISTIC_LOCK_HEADER] = headerValue
  return headers
}

test.describe('TC-LOCK-OSS-015: inbox_ops settings PATCH optimistic-lock guard (singleton custom route)', () => {
  test('stale PATCH returns 409; fresh succeeds; header-less stays backward-compatible', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const initial = await fetchSettings(request, token)
    test.skip(!initial, 'Tenant has no inbox_ops settings row — nothing to lock-test')
    const originalLanguage = initial!.workingLanguage ?? 'en'
    const nextLanguage = LANGUAGES.find((lang) => lang !== originalLanguage) ?? 'de'

    try {
      const raw0 = initial!.updatedAt
      expect(typeof raw0, 'settings should expose updatedAt as a string').toBe('string')
      const t0 = new Date(Date.parse(raw0 as string)).toISOString()

      // Fresh-header PATCH advances the version.
      const ok = await request.fetch('/api/inbox_ops/settings', {
        method: 'PATCH',
        headers: authHeaders(token, t0),
        data: { workingLanguage: nextLanguage },
      })
      expect(ok.status(), 'PATCH with fresh header should succeed').toBeLessThan(300)

      const afterOk = await fetchSettings(request, token)
      const t1 = new Date(Date.parse(afterOk!.updatedAt as string)).toISOString()
      expect(t1, 'updatedAt should advance after a successful PATCH').not.toBe(t0)

      // Stale PATCH → 409 with structured body.
      const conflict = await request.fetch('/api/inbox_ops/settings', {
        method: 'PATCH',
        headers: authHeaders(token, t0),
        data: { workingLanguage: originalLanguage },
      })
      expect(conflict.status(), 'PATCH with stale header should return 409').toBe(409)
      expect((await conflict.json()) as Record<string, unknown>).toMatchObject({
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: t0,
      })

      // Header-less PATCH succeeds (strictly additive).
      const nohdr = await request.fetch('/api/inbox_ops/settings', {
        method: 'PATCH',
        headers: authHeaders(token),
        data: { workingLanguage: nextLanguage },
      })
      expect(nohdr.status(), 'PATCH without header should succeed').toBeLessThan(300)
    } finally {
      // Restore the tenant's original working language (header-less to avoid a
      // stale-version conflict during teardown).
      await request.fetch('/api/inbox_ops/settings', {
        method: 'PATCH',
        headers: authHeaders(token),
        data: { workingLanguage: originalLanguage },
      }).catch(() => undefined)
    }
  })
})
