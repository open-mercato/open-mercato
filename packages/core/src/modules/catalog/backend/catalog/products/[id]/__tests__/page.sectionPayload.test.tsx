/**
 * @jest-environment jsdom
 *
 * The byte-equality guard for the product edit submit path.
 *
 * `handleSubmit` is being restructured around the `CatalogProductFormSection`
 * descriptor table so that hiding a section can disable its validation, its
 * payload slice and its secondary writes together. That restructure touches the
 * one code path every product edit in every deployment uses, so this test pins
 * the *current* behaviour: for a fully populated form and no section policy,
 * the `catalog/products` update payload and the whole sequence of secondary
 * writes must come out exactly as they do today.
 *
 * It deliberately asserts on the real page component rather than on any helper,
 * so it stays meaningful across the refactor instead of testing the new shape
 * against itself.
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { BASE_INITIAL_VALUES } from '@open-mercato/core/modules/catalog/components/products/productForm'
import type { ProductFormValues } from '@open-mercato/core/modules/catalog/components/products/productForm'
import EditCatalogProductPage from '../page'

let latestCrudFormProps: Record<string, unknown> | null = null

const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    latestCrudFormProps = props
    return null
  },
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useLocale: () => 'en-US',
}))

jest.mock('next/link', () => ({ children }: { children: React.ReactNode }) => <span>{children}</span>)

jest.mock('@open-mercato/ui/backend/messages/SendObjectMessageDialog.tsx', () => ({
  SendObjectMessageDialog: () => null,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn().mockResolvedValue({ items: [] }),
  withScopedApiRequestHeaders: jest.fn(
    (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn().mockResolvedValue({ ok: true, result: { ok: true } }),
  // A literal, not the CONVERSION_NEW_ID const: jest hoists module factories above
  // the const declarations, so referencing one here is a ReferenceError.
  createCrud: jest.fn().mockResolvedValue({ ok: true, result: { id: '44444444-4444-4444-8444-444444444444' } }),
  deleteCrud: jest.fn().mockResolvedValue({ ok: true, result: {} }),
}))

const apiCallMock = apiCall as jest.Mock
const updateCrudMock = updateCrud as jest.Mock
const createCrudMock = createCrud as jest.Mock
const deleteCrudMock = deleteCrud as jest.Mock

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSION_KEPT_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSION_STALE_ID = '33333333-3333-4333-8333-333333333333'
const CONVERSION_NEW_ID = '44444444-4444-4444-8444-444444444444'
const CATEGORY_ID = '55555555-5555-4555-8555-555555555555'

/**
 * A product whose every section carries real stored data, so the payload this
 * test pins exercises each section's contribution rather than its defaults.
 */
const storedProduct = {
  id: PRODUCT_ID,
  title: 'Stored product',
  subtitle: 'Stored subtitle',
  handle: 'stored-product',
  sku: 'SKU-1',
  description: 'Stored description',
  product_type: 'simple',
  updated_at: '2026-01-01T00:00:00.000Z',
  default_unit: 'kg',
  default_sales_unit: 'box',
  default_sales_unit_quantity: 2,
  uom_rounding_scale: 3,
  uom_rounding_mode: 'half_up',
  country_of_origin_code: 'PL',
  pkwiu_code: '10.71.11',
  cn_code: '1905 90',
  hs_code: '190590',
  tax_classification_code: 'VAT-5',
  gtu_codes: ['GTU_01'],
}

/**
 * Fully populated form values — one non-default value per section, so a slice
 * that silently stops contributing shows up as a missing key rather than as an
 * unchanged default.
 */
const fullFormValues: ProductFormValues = {
  ...BASE_INITIAL_VALUES,
  title: 'Edited title',
  subtitle: 'Edited subtitle',
  handle: 'edited-handle',
  sku: 'SKU-EDITED',
  description: 'Edited description',
  productType: 'simple',
  taxRateId: null,
  metadata: { origin: 'test' },
  dimensions: { width: 10, height: 20, depth: 30, unit: 'cm' },
  weight: { value: 5, unit: 'kg' },
  defaultUnit: 'kg',
  defaultSalesUnit: 'box',
  defaultSalesUnitQuantity: '2',
  uomRoundingScale: '3',
  uomRoundingMode: 'half_up',
  unitPriceEnabled: false,
  unitConversions: [
    { id: CONVERSION_KEPT_ID, unitCode: 'box', toBaseFactor: '12', sortOrder: '1', isActive: true },
    { id: null, unitCode: 'pallet', toBaseFactor: '480', sortOrder: '2', isActive: true },
  ],
  categoryIds: [CATEGORY_ID],
  channelIds: [],
  tags: ['tag-a'],
  countryOfOriginCode: 'PL',
  pkwiuCode: '10.71.11',
  cnCode: '1905 90',
  hsCode: '190590',
  taxClassificationCode: 'VAT-5',
  gtuCodes: ['GTU_01'],
  ageMin: '18',
  isExciseGood: true,
  requiresPrescription: false,
  hazmatClass: '3',
  unNumber: 'UN1234',
  containsLithiumBattery: false,
  minOrderQty: '1',
  maxOrderQty: '100',
  orderQtyIncrement: '1',
  requiresShipping: true,
  isQuoteOnly: false,
  seoTitle: 'Edited SEO title',
  seoDescription: 'Edited SEO description',
  canonicalUrl: 'https://example.com/p/edited',
}

beforeEach(() => {
  jest.clearAllMocks()
  latestCrudFormProps = null
  createCrudMock.mockResolvedValue({ ok: true, result: { id: CONVERSION_NEW_ID } })
  apiCallMock.mockImplementation((url: string) => {
    if (url.includes('/api/catalog/products?id=')) {
      return Promise.resolve({ ok: true, result: { items: [storedProduct] } })
    }
    if (url.includes('/api/catalog/product-unit-conversions')) {
      return Promise.resolve({
        ok: true,
        result: {
          items: [
            {
              id: CONVERSION_KEPT_ID,
              product_id: PRODUCT_ID,
              unit_code: 'box',
              to_base_factor: 12,
              sort_order: 1,
              is_active: true,
              updated_at: '2026-01-01T00:00:00.000Z',
            },
            {
              id: CONVERSION_STALE_ID,
              product_id: PRODUCT_ID,
              unit_code: 'crate',
              to_base_factor: 24,
              sort_order: 3,
              is_active: true,
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      })
    }
    return Promise.resolve({ ok: true, result: { items: [] } })
  })
})

async function submitFullForm() {
  render(<EditCatalogProductPage params={{ id: PRODUCT_ID }} />)
  await waitFor(() => expect(latestCrudFormProps?.isLoading).toBe(false))
  const onSubmit = latestCrudFormProps?.onSubmit as (values: ProductFormValues) => Promise<void>
  await act(async () => {
    await onSubmit(fullFormValues)
  })
}

describe('EditCatalogProductPage — no-override submit baseline', () => {
  it('sends every section’s payload slice for a fully populated form', async () => {
    await submitFullForm()

    // `updateCrud` serves both the product and its conversions, so filter rather
    // than counting: exactly one product write per save.
    const productWrites = updateCrudMock.mock.calls.filter((call) => call[0] === 'catalog/products')
    expect(productWrites).toHaveLength(1)
    const payload = productWrites[0][1]

    // The wire contract is the set of keys with a DEFINED value: the payload
    // literal also carries a few keys explicitly set to `undefined`, which
    // `JSON.stringify` drops, so pinning raw `Object.keys` would pin noise that a
    // merge-based rebuild is free to spell differently. A dropped section shows up
    // here as a missing key; a new one as an extra.
    const sentKeys = Object.entries(payload as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
      .sort()
    expect(sentKeys).toEqual(
      [
        'ageMin',
        'availableFrom',
        'availableUntil',
        'canonicalUrl',
        'categoryIds',
        'cnCode',
        'containsLithiumBattery',
        'countryOfOriginCode',
        'defaultSalesUnit',
        'defaultSalesUnitQuantity',
        'defaultUnit',
        'description',
        'dimensions',
        'endOfLifeAt',
        'exciseCategory',
        'gtuCodes',
        'handle',
        'hazmatClass',
        'hazmatPackingGroup',
        'hsCode',
        'id',
        'isConfigurable',
        'isExciseGood',
        'isQuoteOnly',
        'launchAt',
        'maxOrderQty',
        'metadata',
        'minOrderQty',
        'offers',
        'orderQtyIncrement',
        'pkwiuCode',
        'productType',
        'requiresPrescription',
        'requiresShipping',
        'seoDescription',
        'seoTitle',
        'sku',
        'subtitle',
        'tags',
        'taxClassificationCode',
        'taxRate',
        'taxRateId',
        'title',
        'unNumber',
        'unitPriceEnabled',
        'uomRoundingMode',
        'uomRoundingScale',
        'weightUnit',
        'weightValue',
      ].sort(),
    )
  })

  it('leaves the conditional keys unset rather than sending an explicit null', async () => {
    await submitFullForm()
    const payload = updateCrudMock.mock.calls.find(
      (call) => call[0] === 'catalog/products',
    )![1] as Record<string, unknown>

    // Each of these is deliberately `undefined` rather than `null` on this fixture:
    // the unit-price fields because the display is disabled, the media fields
    // because the product has no default media, and `customFieldsetCode` because
    // none is bound. `null` would CLEAR the stored value; `undefined` preserves it.
    expect(payload.unitPriceReferenceUnit).toBeUndefined()
    expect(payload.unitPriceBaseQuantity).toBeUndefined()
    expect(payload.defaultMediaId).toBeUndefined()
    expect(payload.defaultMediaUrl).toBeUndefined()
    expect(payload.customFieldsetCode).toBeUndefined()
  })

  it('pins each section’s values, not just its key names', async () => {
    await submitFullForm()
    const payload = updateCrudMock.mock.calls.find(
      (call) => call[0] === 'catalog/products',
    )![1] as Record<string, unknown>

    // details
    expect(payload.title).toBe('Edited title')
    expect(payload.description).toBe('Edited description')
    // meta
    expect(payload.subtitle).toBe('Edited subtitle')
    expect(payload.handle).toBe('edited-handle')
    expect(payload.sku).toBe('SKU-EDITED')
    expect(payload.productType).toBe('simple')
    expect(payload.isConfigurable).toBe(false)
    // dimensions
    expect(payload.dimensions).toEqual({ width: 10, height: 20, depth: 30, unit: 'cm' })
    expect(payload.weightValue).toBe(5)
    expect(payload.weightUnit).toBe('kg')
    // metadata — `buildMetadataPayload` folds the details section's `useMarkdown`
    // flag in under a reserved `__useMarkdown` key rather than sending it top-level.
    expect(payload.metadata).toEqual({ origin: 'test', __useMarkdown: false })
    // product-uom
    expect(payload.defaultUnit).toBe('kg')
    expect(payload.defaultSalesUnit).toBe('box')
    expect(payload.defaultSalesUnitQuantity).toBe(2)
    expect(payload.uomRoundingScale).toBe(3)
    expect(payload.uomRoundingMode).toBe('half_up')
    expect(payload.unitPriceEnabled).toBe(false)
    // compliance
    expect(payload.pkwiuCode).toBe('10.71.11')
    expect(payload.cnCode).toBe('1905 90')
    expect(payload.hsCode).toBe('190590')
    expect(payload.gtuCodes).toEqual(['GTU_01'])
    expect(payload.ageMin).toBe(18)
    expect(payload.isExciseGood).toBe(true)
    expect(payload.unNumber).toBe('UN1234')
    expect(payload.seoTitle).toBe('Edited SEO title')
    expect(payload.canonicalUrl).toBe('https://example.com/p/edited')
    // categorize
    expect(payload.categoryIds).toEqual([CATEGORY_ID])
    expect(payload.tags).toEqual(['tag-a'])
    expect(payload.offers).toEqual([])
  })

  it('runs the unit-conversion secondary writes in the order it runs them today', async () => {
    await submitFullForm()

    // The stale stored conversion is deleted, the kept one updated, the new one created.
    expect(deleteCrudMock.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['catalog/product-unit-conversions', CONVERSION_STALE_ID],
    ])
    expect(updateCrudMock.mock.calls.filter((call) => call[0] === 'catalog/product-unit-conversions')).toEqual([
      [
        'catalog/product-unit-conversions',
        { id: CONVERSION_KEPT_ID, unitCode: 'box', toBaseFactor: 12, sortOrder: 1, isActive: true },
      ],
    ])
    expect(createCrudMock.mock.calls).toEqual([
      [
        'catalog/product-unit-conversions',
        { productId: PRODUCT_ID, unitCode: 'pallet', toBaseFactor: 480, sortOrder: 2, isActive: true },
      ],
    ])
  })

  it('writes the product before its conversions', async () => {
    // Ordering is load-bearing: the conversions reference a product row whose
    // `defaultUnit` the same save may have just changed.
    const order: string[] = []
    updateCrudMock.mockImplementation((resource: string) => {
      order.push(`update:${resource}`)
      return Promise.resolve({ ok: true, result: { ok: true } })
    })
    createCrudMock.mockImplementation((resource: string) => {
      order.push(`create:${resource}`)
      return Promise.resolve({ ok: true, result: { id: CONVERSION_NEW_ID } })
    })
    deleteCrudMock.mockImplementation((resource: string) => {
      order.push(`delete:${resource}`)
      return Promise.resolve({ ok: true, result: {} })
    })

    await submitFullForm()

    expect(order[0]).toBe('update:catalog/products')
    expect(order.slice(1).every((entry) => entry.endsWith('catalog/product-unit-conversions'))).toBe(true)
  })
})
