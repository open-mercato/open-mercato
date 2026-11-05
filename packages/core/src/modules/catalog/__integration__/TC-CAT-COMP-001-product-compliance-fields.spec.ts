import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/**
 * TC-CAT-COMP-001: Product compliance & commercial fields round-trip
 * (spec: .ai/specs/2026-06-11-catalog-compliance-and-commercial-product-fields.md).
 *
 * Verified contract:
 * - POST /api/catalog/products accepts the camelCase compliance payload and
 *   normalizes server-side: countryOfOriginCode is upper-cased, gtuCodes are
 *   deduped + sorted, unNumber gains the 'UN' prefix.
 * - GET /api/catalog/products?id=<uuid> returns the snake_case projection
 *   (country_of_origin_code, gtu_codes, un_number, ... is_quote_only).
 * - Partial PUT only touches fields that are present (undefined guards in
 *   catalog.products.update); explicit nulls clear nullable columns.
 * - Cross-field/zod violations reject with 400.
 */

const PRODUCTS_PATH = '/api/catalog/products'

type ProductItem = Record<string, unknown>

async function readProductById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<ProductItem> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRODUCTS_PATH}?id=${encodeURIComponent(id)}&page=1&pageSize=1`,
    { token },
  )
  expect(response.status(), `product read-back failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: ProductItem[] }>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === id) ?? null
  expect(item, `product ${id} should be present in the list read-back`).toBeTruthy()
  return item as ProductItem
}

function expectIsoDate(value: unknown, expectedIso: string, label: string): void {
  expect(value, `${label} should be present`).toBeTruthy()
  expect(new Date(String(value)).toISOString(), label).toBe(expectedIso)
}

test.describe('TC-CAT-COMP-001: product compliance fields', () => {
  test('full payload create, partial update preservation, and clearing via nulls', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`
    let productId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', PRODUCTS_PATH, {
        token,
        data: {
          title: `QA COMP-001 Product ${stamp}`,
          sku: `QA-COMP-001-${stamp}`,
          description: 'Compliance coverage product with a long enough description for SEO checks.',
          countryOfOriginCode: 'pl',
          pkwiuCode: '26.20.11.0',
          cnCode: '84713000',
          hsCode: '847130',
          taxClassificationCode: 'VAT-23',
          gtuCodes: ['GTU_13', 'GTU_01', 'GTU_13'],
          ageMin: 18,
          isExciseGood: true,
          exciseCategory: 'alcohol',
          requiresPrescription: true,
          hazmatClass: '3',
          unNumber: '1170',
          hazmatPackingGroup: 'II',
          containsLithiumBattery: true,
          launchAt: '2027-03-01T00:00:00.000Z',
          endOfLifeAt: '2028-03-01T00:00:00.000Z',
          availableFrom: '2027-04-01T00:00:00.000Z',
          availableUntil: '2027-10-01T00:00:00.000Z',
          minOrderQty: 2,
          maxOrderQty: 100,
          orderQtyIncrement: 2,
          requiresShipping: false,
          isQuoteOnly: false,
          seoTitle: `QA Compliance SEO ${stamp}`,
          seoDescription: 'QA compliance SEO description for integration coverage.',
          canonicalUrl: 'https://example.com/qa/compliance-product',
        },
      })
      expect(createResponse.status(), `create product failed: ${createResponse.status()}`).toBe(201)
      const created = await readJsonSafe<{ id?: string }>(createResponse)
      expect(typeof created?.id === 'string' && created.id.length > 0, 'create should return an id').toBe(true)
      productId = created!.id as string

      // ---- Read-back: every compliance field arrives snake_case, normalized.
      const afterCreate = await readProductById(request, token, productId)
      expect(afterCreate.country_of_origin_code, 'country code is upper-cased').toBe('PL')
      expect(afterCreate.pkwiu_code).toBe('26.20.11.0')
      expect(afterCreate.cn_code).toBe('84713000')
      expect(afterCreate.hs_code).toBe('847130')
      expect(afterCreate.tax_classification_code).toBe('VAT-23')
      expect(
        Array.isArray(afterCreate.gtu_codes) ? (afterCreate.gtu_codes as unknown[]).map(String) : afterCreate.gtu_codes,
        'gtu codes are deduped and sorted',
      ).toEqual(['GTU_01', 'GTU_13'])
      expect(Number(afterCreate.age_min)).toBe(18)
      expect(afterCreate.is_excise_good).toBe(true)
      expect(afterCreate.excise_category).toBe('alcohol')
      expect(afterCreate.requires_prescription).toBe(true)
      expect(afterCreate.hazmat_class).toBe('3')
      expect(afterCreate.un_number, 'un number gains the UN prefix').toBe('UN1170')
      expect(afterCreate.hazmat_packing_group).toBe('II')
      expect(afterCreate.contains_lithium_battery).toBe(true)
      expectIsoDate(afterCreate.launch_at, '2027-03-01T00:00:00.000Z', 'launch_at')
      expectIsoDate(afterCreate.end_of_life_at, '2028-03-01T00:00:00.000Z', 'end_of_life_at')
      expectIsoDate(afterCreate.available_from, '2027-04-01T00:00:00.000Z', 'available_from')
      expectIsoDate(afterCreate.available_until, '2027-10-01T00:00:00.000Z', 'available_until')
      expect(Number(afterCreate.min_order_qty)).toBe(2)
      expect(Number(afterCreate.max_order_qty)).toBe(100)
      expect(Number(afterCreate.order_qty_increment)).toBe(2)
      expect(afterCreate.requires_shipping).toBe(false)
      expect(afterCreate.is_quote_only).toBe(false)
      expect(afterCreate.seo_title).toBe(`QA Compliance SEO ${stamp}`)
      expect(afterCreate.seo_description).toBe('QA compliance SEO description for integration coverage.')
      expect(afterCreate.canonical_url).toBe('https://example.com/qa/compliance-product')
      expect(afterCreate, 'pricing decoration key is present on list items').toHaveProperty('pricing')

      // ---- Partial PUT: only pkwiuCode changes, everything else is preserved.
      const partialUpdate = await apiRequest(request, 'PUT', PRODUCTS_PATH, {
        token,
        data: { id: productId, pkwiuCode: '26.20.12.0' },
      })
      expect(partialUpdate.status(), `partial update failed: ${partialUpdate.status()}`).toBe(200)

      const afterPartial = await readProductById(request, token, productId)
      expect(afterPartial.pkwiu_code, 'pkwiu code updated').toBe('26.20.12.0')
      expect(afterPartial.country_of_origin_code, 'country preserved').toBe('PL')
      expect(
        Array.isArray(afterPartial.gtu_codes) ? (afterPartial.gtu_codes as unknown[]).map(String) : afterPartial.gtu_codes,
        'gtu codes preserved',
      ).toEqual(['GTU_01', 'GTU_13'])
      expect(afterPartial.un_number, 'un number preserved').toBe('UN1170')
      expect(afterPartial.tax_classification_code, 'tax classification preserved').toBe('VAT-23')
      expect(Number(afterPartial.age_min), 'age min preserved').toBe(18)
      expect(afterPartial.is_excise_good, 'excise flag preserved').toBe(true)
      expect(afterPartial.excise_category, 'excise category preserved').toBe('alcohol')
      expect(afterPartial.hazmat_packing_group, 'packing group preserved').toBe('II')
      expect(afterPartial.contains_lithium_battery, 'lithium flag preserved').toBe(true)
      expectIsoDate(afterPartial.launch_at, '2027-03-01T00:00:00.000Z', 'launch_at preserved')
      expectIsoDate(afterPartial.available_until, '2027-10-01T00:00:00.000Z', 'available_until preserved')
      expect(Number(afterPartial.min_order_qty), 'min order qty preserved').toBe(2)
      expect(Number(afterPartial.max_order_qty), 'max order qty preserved').toBe(100)
      expect(afterPartial.requires_shipping, 'requires shipping preserved').toBe(false)
      expect(afterPartial.seo_title, 'seo title preserved').toBe(`QA Compliance SEO ${stamp}`)
      expect(afterPartial.canonical_url, 'canonical url preserved').toBe('https://example.com/qa/compliance-product')

      // ---- Clearing: explicit nulls clear every nullable compliance column.
      const clearResponse = await apiRequest(request, 'PUT', PRODUCTS_PATH, {
        token,
        data: {
          id: productId,
          countryOfOriginCode: null,
          pkwiuCode: null,
          cnCode: null,
          hsCode: null,
          taxClassificationCode: null,
          gtuCodes: null,
          ageMin: null,
          exciseCategory: null,
          hazmatClass: null,
          unNumber: null,
          hazmatPackingGroup: null,
          launchAt: null,
          endOfLifeAt: null,
          availableFrom: null,
          availableUntil: null,
          minOrderQty: null,
          maxOrderQty: null,
          orderQtyIncrement: null,
          seoTitle: null,
          seoDescription: null,
          canonicalUrl: null,
        },
      })
      expect(clearResponse.status(), `clearing update failed: ${clearResponse.status()}`).toBe(200)

      const afterClear = await readProductById(request, token, productId)
      const clearedFields = [
        'country_of_origin_code',
        'pkwiu_code',
        'cn_code',
        'hs_code',
        'tax_classification_code',
        'gtu_codes',
        'age_min',
        'excise_category',
        'hazmat_class',
        'un_number',
        'hazmat_packing_group',
        'launch_at',
        'end_of_life_at',
        'available_from',
        'available_until',
        'min_order_qty',
        'max_order_qty',
        'order_qty_increment',
        'seo_title',
        'seo_description',
        'canonical_url',
      ] as const
      for (const field of clearedFields) {
        expect(afterClear[field] ?? null, `${field} should be cleared to null`).toBeNull()
      }
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('invalid compliance payloads are rejected with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`
    const accidentallyCreatedIds: string[] = []

    const invalidCases: Array<{ label: string; extras: Record<string, unknown> }> = [
      { label: 'unknown GTU code GTU_14', extras: { gtuCodes: ['GTU_14'] } },
      { label: '3-letter country code POL', extras: { countryOfOriginCode: 'POL' } },
      { label: 'minOrderQty greater than maxOrderQty', extras: { minOrderQty: 10, maxOrderQty: 5 } },
      {
        label: 'availableUntil before availableFrom',
        extras: {
          availableFrom: '2027-10-01T00:00:00.000Z',
          availableUntil: '2027-04-01T00:00:00.000Z',
        },
      },
      { label: 'relative canonical URL', extras: { canonicalUrl: '/relative' } },
      { label: 'short UN number UN12', extras: { unNumber: 'UN12' } },
    ]

    try {
      for (const [index, invalidCase] of invalidCases.entries()) {
        const response = await apiRequest(request, 'POST', PRODUCTS_PATH, {
          token,
          data: {
            title: `QA COMP-001 invalid ${invalidCase.label} ${stamp}`,
            sku: `QA-COMP-001-INV-${index}-${stamp}`,
            ...invalidCase.extras,
          },
        })
        const body = await readJsonSafe<{ id?: string }>(response)
        if (response.ok() && typeof body?.id === 'string' && body.id.length > 0) {
          accidentallyCreatedIds.push(body.id)
        }
        expect(response.status(), `${invalidCase.label} should be rejected with 400`).toBe(400)
      }
    } finally {
      for (const id of accidentallyCreatedIds) {
        await deleteCatalogProductIfExists(request, token, id)
      }
    }
  })

  test('partial updates cannot invert ranges stored on the record (merged-state validation)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`
    let productId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', PRODUCTS_PATH, {
        token,
        data: {
          title: `QA COMP-001 merged ranges ${stamp}`,
          sku: `QA-COMP-001-MRG-${stamp}`,
          minOrderQty: 10,
          maxOrderQty: 100,
          launchAt: '2026-07-01T00:00:00.000Z',
        },
      })
      expect(createResponse.status(), 'fixture create failed').toBe(201)
      const created = await readJsonSafe<{ id?: string }>(createResponse)
      productId = created?.id ?? null
      expect(productId, 'fixture create should return an id').toBeTruthy()

      const invertedMax = await apiRequest(request, 'PUT', PRODUCTS_PATH, {
        token,
        data: { id: productId, maxOrderQty: 5 },
      })
      expect(
        invertedMax.status(),
        'maxOrderQty below the stored minOrderQty should be rejected',
      ).toBe(400)

      const invertedEol = await apiRequest(request, 'PUT', PRODUCTS_PATH, {
        token,
        data: { id: productId, endOfLifeAt: '2026-01-01T00:00:00.000Z' },
      })
      expect(
        invertedEol.status(),
        'endOfLifeAt before the stored launchAt should be rejected',
      ).toBe(400)

      const consistentUpdate = await apiRequest(request, 'PUT', PRODUCTS_PATH, {
        token,
        data: { id: productId, minOrderQty: 1, maxOrderQty: 5 },
      })
      expect(
        consistentUpdate.status(),
        'a consistent pair carried together should be accepted',
      ).toBe(200)

      const item = await readProductById(request, token, productId!)
      expect(item.min_order_qty, 'minOrderQty persisted').toBe(1)
      expect(item.max_order_qty, 'maxOrderQty persisted').toBe(5)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
