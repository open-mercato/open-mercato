import { expect, test } from '@playwright/test'
import {
  createCompanyFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-LOCK-OSS-001: OSS opt-in optimistic locking on customers.company
 *
 * Spec: .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md
 *
 * Verifies that when `OM_OPTIMISTIC_LOCK` covers `customers.company`:
 *   - A PUT without the extension header succeeds (guard skips — opt-in semantics).
 *   - A PUT with a fresh `updatedAt` header succeeds.
 *   - A PUT with a stale `updatedAt` header returns 409 with the structured body.
 */
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function fetchCompanyUpdatedAt(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  companyId: string,
): Promise<string> {
  const response = await request.fetch(resolveUrl(`/api/customers/companies?id=${encodeURIComponent(companyId)}`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  expect(response.status(), 'GET /api/customers/companies?id=... should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, 'response should include the requested company').toBeTruthy()
  const raw = item?.updated_at ?? item?.updatedAt
  expect(typeof raw, 'company response should expose updated_at as a string').toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `updated_at should parse as a date, got: ${raw as string}`).toBe(true)
  return new Date(ms).toISOString()
}

async function putCompany(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  companyId: string,
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
  return request.fetch(resolveUrl('/api/customers/companies'), {
    method: 'PUT',
    headers,
    data: { id: companyId, ...data },
  })
}

test.describe('TC-LOCK-OSS-001: customers.company optimistic-lock guard', () => {
  test('writes without the header always succeed (opt-in semantics)', async ({ request }) => {
    test.slow()
    test.setTimeout(120_000)

    let token: string | null = null
    let companyId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-LOCK-OSS-001 nohdr ${Date.now()}`)

      const res = await putCompany(request, token, companyId, { displayName: `QA TC-LOCK-OSS-001 nohdr v2 ${Date.now()}` })
      expect(res.status(), 'PUT without header should succeed (200/204)').toBeLessThan(300)
    } finally {
      if (companyId && token) {
        await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
      }
    }
  })

  test('fresh updatedAt header passes; stale header returns 409 with structured body', async ({ request }) => {
    test.slow()
    test.setTimeout(120_000)

    let token: string | null = null
    let companyId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-LOCK-OSS-001 hdr ${Date.now()}`)

      // T0: snapshot the freshly-created company's updatedAt
      const t0 = await fetchCompanyUpdatedAt(request, token, companyId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // First PUT carries the FRESH token — must succeed
      const ok = await putCompany(
        request,
        token,
        companyId,
        { displayName: `QA TC-LOCK-OSS-001 v1 ${Date.now()}` },
        t0,
      )
      expect(ok.status(), 'PUT with fresh updatedAt header should succeed').toBeLessThan(300)

      // After the update the server's updatedAt has moved forward
      const t1 = await fetchCompanyUpdatedAt(request, token, companyId)
      expect(t1, 'updatedAt should advance after a successful update').not.toBe(t0)

      // Second PUT carries the STALE token (t0) — must return 409 + structured body
      const conflict = await putCompany(
        request,
        token,
        companyId,
        { displayName: `QA TC-LOCK-OSS-001 v2 ${Date.now()}` },
        t0,
      )
      expect(
        conflict.status(),
        'PUT with stale updatedAt header should return 409',
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
      if (companyId && token) {
        await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
      }
    }
  })
})
