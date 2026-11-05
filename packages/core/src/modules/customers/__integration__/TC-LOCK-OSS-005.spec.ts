import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  createCompanyFixture,
  createPersonFixture,
  createDealFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-005: deterministic two-session concurrent-edit conflict across
 * the CRM entities — `customers.company`, `customers.person`, `customers.deal`.
 *
 * Spec: .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md +
 *       .ai/specs/2026-05-28-optimistic-locking-coverage-completion.md
 *
 * Pattern (see __concurrent_edit_pattern.md): two independent sessions hold the
 * SAME pre-edit `updated_at` (t0). Session A writes first (→ t1, 200). Session B
 * — the stale caller — then writes with t0 and must be refused with the
 * structured 409 body `{ error, code, currentUpdatedAt, expectedUpdatedAt }`.
 *
 * Optimistic locking is default-ON for every `makeCrudRoute` entity and the
 * guard is opt-in per request via `OPTIMISTIC_LOCK_HEADER_NAME`, so no special
 * env is required — sending the header is enough to arm the check.
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function fetchUpdatedAt(
  request: APIRequestContext,
  token: string,
  listPath: string,
  id: string,
): Promise<string> {
  const response = await request.fetch(
    resolveUrl(`${listPath}?id=${encodeURIComponent(id)}`),
    { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  )
  expect(response.status(), `GET ${listPath}?id=... should return 200`).toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, `response should include the requested record from ${listPath}`).toBeTruthy()
  const raw = item?.updated_at ?? item?.updatedAt
  expect(typeof raw, `${listPath} response should expose updated_at as a string`).toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `updated_at should parse as a date, got: ${raw as string}`).toBe(true)
  return new Date(ms).toISOString()
}

async function putWithHeader(
  request: APIRequestContext,
  token: string,
  listPath: string,
  data: Record<string, unknown>,
  headerValue: string,
) {
  return request.fetch(resolveUrl(listPath), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: headerValue,
    },
    data,
  })
}

function expectConflictBody(body: Record<string, unknown>, expectedUpdatedAt: string) {
  expect(body).toMatchObject({
    error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
    code: OPTIMISTIC_LOCK_CONFLICT_CODE,
    expectedUpdatedAt,
  })
  expect(typeof body.currentUpdatedAt, 'conflict body includes currentUpdatedAt as ISO string').toBe('string')
  expect(body.currentUpdatedAt).not.toBe(expectedUpdatedAt)
}

test.describe('TC-LOCK-OSS-005: CRM concurrent edit (company/person/deal)', () => {
  test('customers.company: session A wins, stale session B gets 409', async ({ request }) => {
    let token: string | null = null
    let companyId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-LOCK-OSS-005 company ${Date.now()}`)

      const t0 = await fetchUpdatedAt(request, token, '/api/customers/companies', companyId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const sessionA = await putWithHeader(request, token, '/api/customers/companies', {
        id: companyId,
        displayName: `QA TC-LOCK-OSS-005 company A ${Date.now()}`,
      }, t0)
      expect(sessionA.status(), 'session A (fresh t0) PUT should win').toBeLessThan(300)

      const t1 = await fetchUpdatedAt(request, token, '/api/customers/companies', companyId)
      expect(t1, 'updated_at should advance after session A').not.toBe(t0)

      const sessionB = await putWithHeader(request, token, '/api/customers/companies', {
        id: companyId,
        displayName: `QA TC-LOCK-OSS-005 company B ${Date.now()}`,
      }, t0)
      expect(sessionB.status(), 'stale session B PUT should be refused with 409').toBe(409)
      expectConflictBody((await sessionB.json()) as Record<string, unknown>, t0)
    } finally {
      if (companyId && token) {
        await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
      }
    }
  })

  test('customers.person: session A wins, stale session B gets 409', async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `Lock005 ${stamp}`,
        displayName: `QA TC-LOCK-OSS-005 person ${stamp}`,
      })

      const t0 = await fetchUpdatedAt(request, token, '/api/customers/people', personId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const sessionA = await putWithHeader(request, token, '/api/customers/people', {
        id: personId,
        displayName: `QA TC-LOCK-OSS-005 person A ${Date.now()}`,
      }, t0)
      expect(sessionA.status(), 'session A (fresh t0) PUT should win').toBeLessThan(300)

      const t1 = await fetchUpdatedAt(request, token, '/api/customers/people', personId)
      expect(t1, 'updated_at should advance after session A').not.toBe(t0)

      const sessionB = await putWithHeader(request, token, '/api/customers/people', {
        id: personId,
        displayName: `QA TC-LOCK-OSS-005 person B ${Date.now()}`,
      }, t0)
      expect(sessionB.status(), 'stale session B PUT should be refused with 409').toBe(409)
      expectConflictBody((await sessionB.json()) as Record<string, unknown>, t0)
    } finally {
      if (personId && token) {
        await deleteEntityByBody(request, token, '/api/customers/people', personId)
      }
    }
  })

  test('customers.deal: session A wins, stale session B gets 409', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      dealId = await createDealFixture(request, token, { title: `QA TC-LOCK-OSS-005 deal ${Date.now()}` })

      const t0 = await fetchUpdatedAt(request, token, '/api/customers/deals', dealId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const sessionA = await putWithHeader(request, token, '/api/customers/deals', {
        id: dealId,
        title: `QA TC-LOCK-OSS-005 deal A ${Date.now()}`,
      }, t0)
      expect(sessionA.status(), 'session A (fresh t0) PUT should win').toBeLessThan(300)

      const t1 = await fetchUpdatedAt(request, token, '/api/customers/deals', dealId)
      expect(t1, 'updated_at should advance after session A').not.toBe(t0)

      const sessionB = await putWithHeader(request, token, '/api/customers/deals', {
        id: dealId,
        title: `QA TC-LOCK-OSS-005 deal B ${Date.now()}`,
      }, t0)
      expect(sessionB.status(), 'stale session B PUT should be refused with 409').toBe(409)
      expectConflictBody((await sessionB.json()) as Record<string, unknown>, t0)
    } finally {
      if (dealId && token) {
        await deleteEntityByBody(request, token, '/api/customers/deals', dealId)
      }
    }
  })
})
