import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/**
 * TC-CAT-COMP-002: Variant typed-GTIN validation and hs_code round-trip
 * (spec: .ai/specs/2026-06-11-catalog-compliance-and-commercial-product-fields.md).
 *
 * Verified contract:
 * - POST /api/catalog/variants with gtinType requires a checksum-valid barcode
 *   (payload-level zod refinement) -> 400 with details[].path ['barcode']
 *   (schema-level rejections use the platform-wide zod details contract).
 * - PUT carrying only one half of (gtinType, barcode) re-validates against the
 *   merged stored state in catalog.variants.update.
 * - Duplicate (tenant, org, gtin_type, barcode) is enforced by the partial
 *   unique index catalog_product_variants_gtin_scope_unique (deleted_at IS NULL,
 *   typed barcodes only) and rethrown as 400 with fieldErrors.barcode.
 * - Untyped barcodes stay free-form and duplicable.
 * - GET /api/catalog/variants?id=<uuid> items expose gtin_type + hs_code.
 *
 * Typed EAN-13 fixtures are generated per run (timestamp-derived body + GS1
 * check digit) so the tenant-scoped unique index never collides across runs;
 * deleting the parent product cleans up its variants.
 */

const VARIANTS_PATH = '/api/catalog/variants'

type VariantItem = Record<string, unknown>

function gs1CheckDigit(body: string): number {
  let sum = 0
  let weight = 3
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += (body.charCodeAt(index) - 48) * weight
    weight = weight === 3 ? 1 : 3
  }
  return (10 - (sum % 10)) % 10
}

function uniqueEan13(stamp: number, index: number): string {
  const body = `5${String(stamp).slice(-9)}${String(index).padStart(2, '0')}`
  return `${body}${gs1CheckDigit(body)}`
}

const INVALID_CHECKSUM_EAN13 = '5901234123456'

async function readVariantById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<VariantItem> {
  const response = await apiRequest(
    request,
    'GET',
    `${VARIANTS_PATH}?id=${encodeURIComponent(id)}&page=1&pageSize=1`,
    { token },
  )
  expect(response.status(), `variant read-back failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: VariantItem[] }>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === id) ?? null
  expect(item, `variant ${id} should be present in the list read-back`).toBeTruthy()
  return item as VariantItem
}

async function createVariant(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', VARIANTS_PATH, { token, data })
  expect(response.status(), `variant create failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id === 'string' && body.id.length > 0, 'variant create should return an id').toBe(true)
  return body!.id as string
}

function expectBarcodeFieldError(body: unknown, label: string): void {
  const fieldErrors =
    body && typeof body === 'object'
      ? ((body as Record<string, unknown>).fieldErrors as Record<string, unknown> | undefined)
      : undefined
  expect(
    typeof fieldErrors?.barcode === 'string' && (fieldErrors.barcode as string).length > 0,
    `${label}: response should carry fieldErrors.barcode`,
  ).toBe(true)
}

// Schema-level rejections (zod, via parseScopedCommandInput) use the platform-wide
// `details[].path` contract instead of the command-level `fieldErrors` map.
function expectBarcodeDetailError(body: unknown, label: string): void {
  const details =
    body && typeof body === 'object'
      ? ((body as Record<string, unknown>).details as Array<Record<string, unknown>> | undefined)
      : undefined
  const hasBarcodeIssue =
    Array.isArray(details) &&
    details.some((issue) => Array.isArray(issue.path) && (issue.path as unknown[]).includes('barcode'))
  expect(hasBarcodeIssue, `${label}: response details should target the barcode field`).toBe(true)
}

test.describe('TC-CAT-COMP-002: variant typed GTIN validation', () => {
  test('typed GTIN + hs_code round-trip; checksum and missing-barcode payloads rejected', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, token, {
        title: `QA COMP-002 GTIN ${stamp}`,
        sku: `QA-COMP-002-A-${stamp}`,
      })

      const validEan = uniqueEan13(stamp, 1)
      const variantId = await createVariant(request, token, {
        productId,
        name: `QA GTIN Variant ${stamp}`,
        sku: `QA-COMP-002-A-V1-${stamp}`,
        barcode: validEan,
        gtinType: 'ean13',
        hsCode: '640399',
      })

      const afterCreate = await readVariantById(request, token, variantId)
      expect(afterCreate.gtin_type, 'gtin_type round-trips').toBe('ean13')
      expect(afterCreate.barcode, 'barcode round-trips').toBe(validEan)
      expect(afterCreate.hs_code, 'hs_code round-trips').toBe('640399')

      const hsUpdate = await apiRequest(request, 'PUT', VARIANTS_PATH, {
        token,
        data: { id: variantId, hsCode: '640411' },
      })
      expect(hsUpdate.status(), `hsCode update failed: ${hsUpdate.status()}`).toBe(200)
      const afterHsUpdate = await readVariantById(request, token, variantId)
      expect(afterHsUpdate.hs_code, 'hs_code updated').toBe('640411')
      expect(afterHsUpdate.gtin_type, 'gtin_type preserved by partial update').toBe('ean13')
      expect(afterHsUpdate.barcode, 'barcode preserved by partial update').toBe(validEan)

      const checksumResponse = await apiRequest(request, 'POST', VARIANTS_PATH, {
        token,
        data: {
          productId,
          name: `QA Bad Checksum ${stamp}`,
          sku: `QA-COMP-002-A-V2-${stamp}`,
          barcode: INVALID_CHECKSUM_EAN13,
          gtinType: 'ean13',
        },
      })
      expect(checksumResponse.status(), 'checksum-invalid ean13 should be rejected').toBe(400)
      expectBarcodeDetailError(await readJsonSafe(checksumResponse), 'checksum-invalid create')

      const missingBarcodeResponse = await apiRequest(request, 'POST', VARIANTS_PATH, {
        token,
        data: {
          productId,
          name: `QA Missing Barcode ${stamp}`,
          sku: `QA-COMP-002-A-V3-${stamp}`,
          gtinType: 'ean13',
        },
      })
      expect(missingBarcodeResponse.status(), 'gtinType without barcode should be rejected').toBe(400)
      expectBarcodeDetailError(await readJsonSafe(missingBarcodeResponse), 'missing-barcode create')
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('two-step partial update validates the merged stored state', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, token, {
        title: `QA COMP-002 Merged ${stamp}`,
        sku: `QA-COMP-002-B-${stamp}`,
      })

      // Stored barcode is a valid EAN-13 -> typing it afterwards succeeds.
      const validEan = uniqueEan13(stamp, 11)
      const validVariantId = await createVariant(request, token, {
        productId,
        name: `QA Merged Valid ${stamp}`,
        sku: `QA-COMP-002-B-V1-${stamp}`,
        barcode: validEan,
      })
      const beforeTyping = await readVariantById(request, token, validVariantId)
      expect(beforeTyping.gtin_type ?? null, 'variant starts untyped').toBeNull()

      const typeValid = await apiRequest(request, 'PUT', VARIANTS_PATH, {
        token,
        data: { id: validVariantId, gtinType: 'ean13' },
      })
      expect(typeValid.status(), 'typing a stored valid EAN-13 should succeed').toBe(200)
      const afterTyping = await readVariantById(request, token, validVariantId)
      expect(afterTyping.gtin_type, 'gtin_type applied from merged-state update').toBe('ean13')
      expect(afterTyping.barcode, 'stored barcode untouched').toBe(validEan)

      // Stored barcode is not a GTIN -> typing it must fail against merged state.
      const invalidVariantId = await createVariant(request, token, {
        productId,
        name: `QA Merged Invalid ${stamp}`,
        sku: `QA-COMP-002-B-V2-${stamp}`,
        barcode: `not-a-gtin-${stamp}`,
      })
      const typeInvalid = await apiRequest(request, 'PUT', VARIANTS_PATH, {
        token,
        data: { id: invalidVariantId, gtinType: 'ean13' },
      })
      expect(typeInvalid.status(), 'typing a stored non-GTIN barcode should be rejected').toBe(400)
      expectBarcodeFieldError(await readJsonSafe(typeInvalid), 'merged-state invalid typing')
      const afterRejectedTyping = await readVariantById(request, token, invalidVariantId)
      expect(afterRejectedTyping.gtin_type ?? null, 'rejected update leaves the variant untyped').toBeNull()
      expect(afterRejectedTyping.barcode, 'rejected update leaves the barcode untouched').toBe(`not-a-gtin-${stamp}`)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('duplicate typed barcode in the same scope is rejected with fieldErrors.barcode', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, token, {
        title: `QA COMP-002 Duplicate ${stamp}`,
        sku: `QA-COMP-002-C-${stamp}`,
      })

      const sharedEan = uniqueEan13(stamp, 21)
      await createVariant(request, token, {
        productId,
        name: `QA Duplicate First ${stamp}`,
        sku: `QA-COMP-002-C-V1-${stamp}`,
        barcode: sharedEan,
        gtinType: 'ean13',
      })

      const duplicateResponse = await apiRequest(request, 'POST', VARIANTS_PATH, {
        token,
        data: {
          productId,
          name: `QA Duplicate Second ${stamp}`,
          sku: `QA-COMP-002-C-V2-${stamp}`,
          barcode: sharedEan,
          gtinType: 'ean13',
        },
      })
      expect(duplicateResponse.status(), 'second typed variant with the same EAN should be rejected').toBe(400)
      expectBarcodeFieldError(await readJsonSafe(duplicateResponse), 'duplicate typed barcode')
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('untyped legacy barcodes stay free-form and duplicable', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, token, {
        title: `QA COMP-002 Legacy ${stamp}`,
        sku: `QA-COMP-002-D-${stamp}`,
      })

      const legacyBarcode = `qa-legacy-${stamp}`
      const firstId = await createVariant(request, token, {
        productId,
        name: `QA Legacy First ${stamp}`,
        sku: `QA-COMP-002-D-V1-${stamp}`,
        barcode: legacyBarcode,
      })
      const secondId = await createVariant(request, token, {
        productId,
        name: `QA Legacy Second ${stamp}`,
        sku: `QA-COMP-002-D-V2-${stamp}`,
        barcode: legacyBarcode,
      })

      const first = await readVariantById(request, token, firstId)
      const second = await readVariantById(request, token, secondId)
      expect(first.barcode, 'first legacy barcode persisted').toBe(legacyBarcode)
      expect(second.barcode, 'second legacy barcode persisted despite duplication').toBe(legacyBarcode)
      expect(first.gtin_type ?? null, 'legacy barcode stays untyped').toBeNull()
      expect(second.gtin_type ?? null, 'legacy barcode stays untyped').toBeNull()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
