import { expect, test } from '@playwright/test'
import {
  createDealFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-LOCK-OSS-004: OSS opt-in optimistic locking on customers.deal — proves
 * the *auto-registered generic reader* path (Phase 13).
 *
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md §3.5.1
 *
 * Unlike TC-LOCK-OSS-001..003 (which exercise the 3 hand-wired readers
 * in `customers/di.ts` and `sales/di.ts`), `customers.deal` has NO
 * hand-wired reader. The factory hook in `makeCrudRoute` auto-registers
 * a generic reader for every CRUD route at module-load time, so this
 * spec proves that:
 *   - A PUT without the extension header succeeds (guard skips — opt-in semantics).
 *   - A PUT with a fresh `updatedAt` header succeeds.
 *   - A PUT with a stale `updatedAt` header returns 409 with the structured body.
 *   - A DELETE with a stale `updatedAt` header returns 409 (delete-path guard,
 *     QA #2055); a fresh-header DELETE succeeds; a header-less DELETE stays
 *     backward-compatible.
 *
 * Requires `OM_OPTIMISTIC_LOCK=all` (or an allow-list including
 * `customers.deal`) in the CI env — set workflow-wide in `.github/workflows/ci.yml`.
 */
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function fetchDealUpdatedAt(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  dealId: string,
): Promise<string> {
  const response = await request.fetch(resolveUrl(`/api/customers/deals?id=${encodeURIComponent(dealId)}`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  expect(response.status(), 'GET /api/customers/deals?id=... should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, 'response should include the requested deal').toBeTruthy()
  const raw = item?.updated_at ?? item?.updatedAt
  expect(typeof raw, 'deal response should expose updated_at as a string').toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `updated_at should parse as a date, got: ${raw as string}`).toBe(true)
  return new Date(ms).toISOString()
}

async function putDeal(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  dealId: string,
  data: Record<string, unknown>,
  headerValue?: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (headerValue !== undefined) {
    headers[OPTIMISTIC_LOCK_HEADER] = headerValue
  }
  return request.fetch(resolveUrl('/api/customers/deals'), {
    method: 'PUT',
    headers,
    data: { id: dealId, ...data },
  })
}

async function deleteDeal(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  dealId: string,
  headerValue?: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (headerValue !== undefined) {
    headers[OPTIMISTIC_LOCK_HEADER] = headerValue
  }
  return request.fetch(resolveUrl(`/api/customers/deals?id=${encodeURIComponent(dealId)}`), {
    method: 'DELETE',
    headers,
  })
}

test.describe('TC-LOCK-OSS-004: customers.deal optimistic-lock guard (auto-registered generic reader)', () => {
  test('writes without the header always succeed (opt-in semantics)', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      dealId = await createDealFixture(request, token, { title: `QA TC-LOCK-OSS-004 nohdr ${Date.now()}` })

      const res = await putDeal(request, token, dealId, { title: `QA TC-LOCK-OSS-004 nohdr v2 ${Date.now()}` })
      expect(res.status(), 'PUT without header should succeed (200/204)').toBeLessThan(300)
    } finally {
      if (dealId && token) {
        await deleteEntityByBody(request, token, '/api/customers/deals', dealId)
      }
    }
  })

  test('fresh updatedAt header passes; stale header returns 409 with structured body', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      dealId = await createDealFixture(request, token, { title: `QA TC-LOCK-OSS-004 hdr ${Date.now()}` })

      // T0: snapshot the freshly-created deal's updatedAt
      const t0 = await fetchDealUpdatedAt(request, token, dealId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // First PUT carries the FRESH token — must succeed
      const ok = await putDeal(
        request,
        token,
        dealId,
        { title: `QA TC-LOCK-OSS-004 v1 ${Date.now()}` },
        t0,
      )
      expect(ok.status(), 'PUT with fresh updatedAt header should succeed').toBeLessThan(300)

      // After the update the server's updatedAt has moved forward
      const t1 = await fetchDealUpdatedAt(request, token, dealId)
      expect(t1, 'updatedAt should advance after a successful update').not.toBe(t0)

      // Second PUT carries the STALE token (t0) — must return 409 + structured body
      const conflict = await putDeal(
        request,
        token,
        dealId,
        { title: `QA TC-LOCK-OSS-004 v2 ${Date.now()}` },
        t0,
      )
      expect(
        conflict.status(),
        'PUT with stale updatedAt header should return 409 — proves the auto-registered generic reader is wired',
      ).toBe(409)
      const body = (await conflict.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        error: 'record_modified',
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: t0,
      })
      expect(typeof body.currentUpdatedAt, 'response includes currentUpdatedAt as ISO string').toBe('string')
      expect(body.currentUpdatedAt).not.toBe(t0)
    } finally {
      if (dealId && token) {
        await deleteEntityByBody(request, token, '/api/customers/deals', dealId)
      }
    }
  })

  test('stale updatedAt header on DELETE returns 409; fresh header deletes (QA #2055 delete locking)', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null
    let deleted = false
    try {
      token = await getAuthToken(request, 'admin')
      dealId = await createDealFixture(request, token, { title: `QA TC-LOCK-OSS-004 del ${Date.now()}` })

      // T0: snapshot, then advance the version with a fresh PUT so T0 is stale.
      const t0 = await fetchDealUpdatedAt(request, token, dealId)
      const bumped = await putDeal(request, token, dealId, { title: `QA TC-LOCK-OSS-004 del v1 ${Date.now()}` }, t0)
      expect(bumped.status(), 'PUT with fresh updatedAt should succeed').toBeLessThan(300)
      const t1 = await fetchDealUpdatedAt(request, token, dealId)
      expect(t1, 'updatedAt should advance after the update').not.toBe(t0)

      // DELETE carrying the STALE token (t0) must be refused with 409 + structured body.
      const conflict = await deleteDeal(request, token, dealId, t0)
      expect(
        conflict.status(),
        'DELETE with stale updatedAt header should return 409 — proves delete-path guard enforcement',
      ).toBe(409)
      const body = (await conflict.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        error: 'record_modified',
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: t0,
      })

      // DELETE carrying the FRESH token (t1) must succeed.
      const ok = await deleteDeal(request, token, dealId, t1)
      expect(ok.status(), 'DELETE with fresh updatedAt header should succeed').toBeLessThan(300)
      deleted = true
    } finally {
      if (dealId && token && !deleted) {
        await deleteEntityByBody(request, token, '/api/customers/deals', dealId)
      }
    }
  })

  test('DELETE without the header still succeeds (opt-in semantics preserved)', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null
    let deleted = false
    try {
      token = await getAuthToken(request, 'admin')
      dealId = await createDealFixture(request, token, { title: `QA TC-LOCK-OSS-004 del-nohdr ${Date.now()}` })
      const res = await deleteDeal(request, token, dealId)
      expect(res.status(), 'DELETE without header should succeed (backward-compatible)').toBeLessThan(300)
      deleted = true
    } finally {
      if (dealId && token && !deleted) {
        await deleteEntityByBody(request, token, '/api/customers/deals', dealId)
      }
    }
  })
})
