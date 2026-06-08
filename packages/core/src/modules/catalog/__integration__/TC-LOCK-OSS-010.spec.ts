import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-010: optimistic locking on catalog product VARIANT delete.
 *
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md
 *
 * Round-4 QA reported a stale variant DELETE succeeding without a conflict.
 * This proves the server-side guard: a DELETE carrying a stale `updated_at`
 * header is refused with the structured 409, while the same DELETE with the
 * fresh token succeeds. The variant CRUD route auto-registers a generic
 * optimistic-lock reader (default-ON), so the delete-op guard fires for the
 * same `resourceKind` the client sends.
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function fetchVariantUpdatedAt(
  request: APIRequestContext,
  token: string,
  variantId: string,
): Promise<string> {
  const res = await request.fetch(
    resolveUrl(`/api/catalog/variants?id=${encodeURIComponent(variantId)}&page=1&pageSize=1`),
    { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  )
  expect(res.status(), 'GET /api/catalog/variants?id=... should return 200').toBe(200)
  const body = (await res.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, 'response should include the requested variant').toBeTruthy()
  const raw = item?.updated_at ?? item?.updatedAt
  expect(typeof raw, 'variant response should expose updated_at as a string').toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `updated_at should parse as a date, got: ${raw as string}`).toBe(true)
  return new Date(ms).toISOString()
}

async function putVariant(
  request: APIRequestContext,
  token: string,
  variantId: string,
  productId: string,
  name: string,
  headerValue: string,
) {
  return request.fetch(resolveUrl('/api/catalog/variants'), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: headerValue,
    },
    data: { id: variantId, productId, name },
  })
}

async function deleteVariant(
  request: APIRequestContext,
  token: string,
  variantId: string,
  headerValue?: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (headerValue !== undefined) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerValue
  return request.fetch(resolveUrl(`/api/catalog/variants?id=${encodeURIComponent(variantId)}`), {
    method: 'DELETE',
    headers,
    data: { id: variantId },
  })
}

test.describe('TC-LOCK-OSS-010: catalog product variant stale delete', () => {
  test('stale DELETE is refused with 409; fresh DELETE succeeds', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      productId = await createProductFixture(request, token, {
        title: `QA TC-LOCK-OSS-010 product ${stamp}`,
        sku: `qa-lock-010-${stamp}`,
      })
      const variantId = await createVariantFixture(request, token, {
        productId,
        name: `QA LOCK-010 variant ${stamp}`,
        sku: `qa-lock-010-v-${stamp}`,
      })

      const t0 = await fetchVariantUpdatedAt(request, token, variantId)

      // "Tab A" edits the variant — advances updated_at to t1.
      const edit = await putVariant(request, token, variantId, productId, `QA LOCK-010 edited ${Date.now()}`, t0)
      expect(edit.status(), 'fresh variant edit should succeed').toBeLessThan(300)
      const t1 = await fetchVariantUpdatedAt(request, token, variantId)
      expect(t1, 'variant updated_at should advance after the edit').not.toBe(t0)

      // "Tab B" deletes with the STALE token — must be refused with 409.
      const staleDelete = await deleteVariant(request, token, variantId, t0)
      expect(staleDelete.status(), 'stale variant DELETE should be refused with 409').toBe(409)
      const body = (await staleDelete.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      })

      // The fresh token deletes successfully.
      const freshDelete = await deleteVariant(request, token, variantId, t1)
      expect(freshDelete.status(), 'variant DELETE with the fresh token should succeed').toBeLessThan(300)
    } finally {
      if (productId && token) {
        await deleteCatalogProductIfExists(request, token, productId)
      }
    }
  })
})
