import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-006: deterministic two-session concurrent-edit conflict on
 * `catalog.product`.
 *
 * Spec: .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md +
 *       .ai/specs/2026-05-28-optimistic-locking-coverage-completion.md
 *
 * Pattern (see ../../sales/__integration__/__concurrent_edit_pattern.md):
 * two sessions hold the same pre-edit `updated_at` (t0). Session A wins (→ t1),
 * the stale session B is refused with the structured 409 body. Proves the
 * default-ON optimistic-lock guard covers the catalog CRUD route.
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function fetchProductUpdatedAt(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<string> {
  const response = await request.fetch(
    resolveUrl(`/api/catalog/products?id=${encodeURIComponent(productId)}`),
    { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  )
  expect(response.status(), 'GET /api/catalog/products?id=... should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, 'response should include the requested product').toBeTruthy()
  const raw = item?.updated_at ?? item?.updatedAt
  expect(typeof raw, 'product response should expose updated_at as a string').toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `updated_at should parse as a date, got: ${raw as string}`).toBe(true)
  return new Date(ms).toISOString()
}

async function putProduct(
  request: APIRequestContext,
  token: string,
  productId: string,
  title: string,
  headerValue: string,
) {
  return request.fetch(resolveUrl('/api/catalog/products'), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: headerValue,
    },
    data: { id: productId, title },
  })
}

test.describe('TC-LOCK-OSS-006: catalog.product concurrent edit', () => {
  test('session A wins, stale session B gets 409', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      productId = await createProductFixture(request, token, {
        title: `QA TC-LOCK-OSS-006 product ${stamp}`,
        sku: `qa-lock-006-${stamp}`,
      })

      const t0 = await fetchProductUpdatedAt(request, token, productId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const sessionA = await putProduct(request, token, productId, `QA TC-LOCK-OSS-006 A ${Date.now()}`, t0)
      expect(sessionA.status(), 'session A (fresh t0) PUT should win').toBeLessThan(300)

      const t1 = await fetchProductUpdatedAt(request, token, productId)
      expect(t1, 'updated_at should advance after session A').not.toBe(t0)

      const sessionB = await putProduct(request, token, productId, `QA TC-LOCK-OSS-006 B ${Date.now()}`, t0)
      expect(sessionB.status(), 'stale session B PUT should be refused with 409').toBe(409)
      const body = (await sessionB.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: t0,
      })
      expect(typeof body.currentUpdatedAt, 'conflict body includes currentUpdatedAt as ISO string').toBe('string')
      expect(body.currentUpdatedAt).not.toBe(t0)
    } finally {
      if (productId && token) {
        await deleteCatalogProductIfExists(request, token, productId)
      }
    }
  })
})
