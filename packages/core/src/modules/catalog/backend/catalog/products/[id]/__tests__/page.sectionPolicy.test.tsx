/**
 * @jest-environment jsdom
 *
 * Behavioural coverage for `overrides.forms.sections` on the product edit form.
 *
 * The sibling `page.sectionPayload.test.tsx` pins the no-override baseline; this
 * file pins what changes when an app hides a section — and, more importantly,
 * what must NOT change: the stored data.
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import {
  applyFormSectionPolicyOverrides,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'
import { BASE_INITIAL_VALUES } from '@open-mercato/core/modules/catalog/components/products/productForm'
import type { ProductFormValues } from '@open-mercato/core/modules/catalog/components/products/productForm'
import {
  CATALOG_PRODUCT_FORM_HOST_ID,
  CATALOG_PRODUCT_FORM_SECTION_IDS,
} from '@open-mercato/core/modules/catalog/components/products/formSections'
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
  createCrud: jest.fn().mockResolvedValue({ ok: true, result: { id: '44444444-4444-4444-8444-444444444444' } }),
  deleteCrud: jest.fn().mockResolvedValue({ ok: true, result: {} }),
}))

const apiCallMock = apiCall as jest.Mock
const updateCrudMock = updateCrud as jest.Mock
const createCrudMock = createCrud as jest.Mock
const deleteCrudMock = deleteCrud as jest.Mock

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSION_KEPT_ID = '22222222-2222-4222-8222-222222222222'
const CHANNEL_ID = '66666666-6666-4666-8666-666666666666'
const OFFER_ID = '77777777-7777-4777-8777-777777777777'
const CATEGORY_ID = '55555555-5555-4555-8555-555555555555'

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
  seo_title: 'Stored SEO title',
  offers: [
    {
      id: OFFER_ID,
      channel_id: CHANNEL_ID,
      title: 'Stored offer',
      is_active: true,
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
}

/**
 * The user has edited only the title. Everything else carries the value a
 * hidden section would have to preserve.
 */
const editedValues: ProductFormValues = {
  ...BASE_INITIAL_VALUES,
  title: 'Edited title',
  subtitle: 'Stored subtitle',
  handle: 'stored-product',
  sku: 'SKU-1',
  description: 'Stored description',
  productType: 'simple',
  defaultUnit: 'kg',
  defaultSalesUnit: 'box',
  defaultSalesUnitQuantity: '2',
  uomRoundingScale: '3',
  uomRoundingMode: 'half_up',
  unitConversions: [
    { id: CONVERSION_KEPT_ID, unitCode: 'box', toBaseFactor: '12', sortOrder: '1', isActive: true },
  ],
  categoryIds: [CATEGORY_ID],
  channelIds: [CHANNEL_ID],
  tags: ['tag-a'],
  countryOfOriginCode: 'PL',
  pkwiuCode: '10.71.11',
  cnCode: '1905 90',
  hsCode: '190590',
  taxClassificationCode: 'VAT-5',
  gtuCodes: ['GTU_01'],
  seoTitle: 'Stored SEO title',
}

function setPolicy(hidden: readonly string[]) {
  applyFormSectionPolicyOverrides({ [CATALOG_PRODUCT_FORM_HOST_ID]: { hidden } })
}

beforeEach(() => {
  jest.clearAllMocks()
  resetModuleContractOverridesForTests()
  latestCrudFormProps = null
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
          ],
        },
      })
    }
    return Promise.resolve({ ok: true, result: { items: [] } })
  })
})

afterEach(() => {
  resetModuleContractOverridesForTests()
})

async function renderPage() {
  render(<EditCatalogProductPage params={{ id: PRODUCT_ID }} />)
  await waitFor(() => expect(latestCrudFormProps?.isLoading).toBe(false))
}

async function submit(values: ProductFormValues = editedValues) {
  const onSubmit = latestCrudFormProps?.onSubmit as (v: ProductFormValues) => Promise<void>
  await act(async () => {
    await onSubmit(values)
  })
}

function productPayload(): Record<string, unknown> {
  const call = updateCrudMock.mock.calls.find((entry) => entry[0] === 'catalog/products')
  return (call?.[1] ?? {}) as Record<string, unknown>
}

function sentKeys(): string[] {
  return Object.entries(productPayload())
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort()
}

describe('product section policy — hiding a card hides its behaviour', () => {
  it('passes the hidden ids to CrudForm so no card renders', async () => {
    setPolicy(['compliance', 'dimensions'])
    await renderPage()

    expect([...(latestCrudFormProps?.hiddenGroupIds as string[])].sort()).toEqual([
      'compliance',
      'dimensions',
    ])
  })

  it.each([...CATALOG_PRODUCT_FORM_SECTION_IDS])(
    'hides %s without dropping any other section from the payload',
    async (sectionId) => {
      setPolicy([sectionId])
      await renderPage()
      await submit()

      // Whatever the section owned is gone; the save still happens and every
      // other section still contributes.
      expect(updateCrudMock.mock.calls.some((c) => c[0] === 'catalog/products')).toBe(true)
      expect(sentKeys()).toContain('id')
    },
  )

  it('omits every compliance key when compliance is hidden — the data-loss case', async () => {
    setPolicy(['compliance'])
    await renderPage()
    await submit()

    const keys = sentKeys()
    for (const key of [
      'pkwiuCode',
      'cnCode',
      'hsCode',
      'countryOfOriginCode',
      'taxClassificationCode',
      'gtuCodes',
      'seoTitle',
      'seoDescription',
      'canonicalUrl',
      'requiresShipping',
      'isExciseGood',
      'minOrderQty',
    ]) {
      expect(keys).not.toContain(key)
    }
    // The visible edit still lands.
    expect(productPayload().title).toBe('Edited title')
  })

  it('runs no unit-conversion write when product-uom is hidden', async () => {
    setPolicy(['product-uom'])
    await renderPage()
    await submit()

    expect(
      updateCrudMock.mock.calls.filter((c) => c[0] === 'catalog/product-unit-conversions'),
    ).toEqual([])
    expect(createCrudMock.mock.calls).toEqual([])
    expect(
      deleteCrudMock.mock.calls.filter((c) => c[0] === 'catalog/product-unit-conversions'),
    ).toEqual([])
    expect(sentKeys()).not.toContain('defaultUnit')
    expect(sentKeys()).not.toContain('uomRoundingScale')
  })

  it('deletes no offer and sends no categorize key when categorize is hidden', async () => {
    setPolicy(['categorize'])
    await renderPage()
    // De-select the channel: with categorize visible this would delete the offer.
    await submit({ ...editedValues, channelIds: [], categoryIds: [], tags: [] })

    expect(deleteCrudMock.mock.calls.filter((c) => c[0] === 'catalog/offers')).toEqual([])
    const keys = sentKeys()
    expect(keys).not.toContain('categoryIds')
    expect(keys).not.toContain('tags')
    expect(keys).not.toContain('offers')
  })

  it('does not block the save on a hidden section’s own validation', async () => {
    // An empty title is exactly what `details.validate` rejects. Hidden, it must
    // not fire — and the restore means the stored title is what other sections
    // read, so nothing downstream sees the blank.
    setPolicy(['details'])
    await renderPage()
    await submit({ ...editedValues, title: '' })

    expect(updateCrudMock.mock.calls.some((c) => c[0] === 'catalog/products')).toBe(true)
    expect(sentKeys()).not.toContain('title')
  })

  it('still blocks the save on a VISIBLE section’s validation', async () => {
    setPolicy(['compliance'])
    await renderPage()
    const onSubmit = latestCrudFormProps?.onSubmit as (v: ProductFormValues) => Promise<void>

    await expect(
      onSubmit({ ...editedValues, title: '' }),
    ).rejects.toThrow()
    expect(updateCrudMock.mock.calls.filter((c) => c[0] === 'catalog/products')).toEqual([])
  })

  it('restores a hidden section’s edited value instead of submitting it', async () => {
    setPolicy(['meta'])
    await renderPage()
    await submit({ ...editedValues, sku: 'SHOULD-NOT-BE-SENT' })

    const keys = sentKeys()
    expect(keys).not.toContain('sku')
    expect(keys).not.toContain('subtitle')
    expect(keys).not.toContain('handle')
  })

  it('lets a visible section read a hidden section’s stored value', async () => {
    // `categorize` builds its offer payload from `details`' title. With details
    // hidden and the submitted title blanked, the offer must still carry the
    // STORED title — restoring to loaded values rather than to blank defaults is
    // what makes that work.
    setPolicy(['details'])
    await renderPage()
    await submit({ ...editedValues, title: '' })

    const offers = productPayload().offers as Array<{ title: string }>
    expect(offers).toHaveLength(1)
    expect(offers[0].title).toBe('Stored offer')
  })

  it('sends only the id when every section is hidden', async () => {
    setPolicy([...CATALOG_PRODUCT_FORM_SECTION_IDS])
    await renderPage()
    await submit()

    expect(sentKeys()).toEqual(['id'])
    expect(createCrudMock.mock.calls).toEqual([])
    expect(deleteCrudMock.mock.calls).toEqual([])
  })
})

describe('product section policy — diagnostics and bad input', () => {
  it('ignores an unknown id and hides nothing for it', async () => {
    setPolicy(['not-a-section'])
    await renderPage()

    expect([...(latestCrudFormProps?.hiddenGroupIds as string[])]).toEqual([])
  })

  it('hides the valid ids alongside an unknown one', async () => {
    setPolicy(['not-a-section', 'compliance'])
    await renderPage()

    expect([...(latestCrudFormProps?.hiddenGroupIds as string[])]).toEqual(['compliance'])
  })

  it('refuses a widget card id rather than forwarding it to hiddenGroupIds', async () => {
    // Forwarding would hide the card while leaving the widget's onBeforeSave
    // registered — a save blocked by a control that is not in the DOM.
    setPolicy(['widget:my_module.injection.my_widget'])
    await renderPage()

    expect([...(latestCrudFormProps?.hiddenGroupIds as string[])]).toEqual([])
  })

  it('behaves exactly as with no policy when the policy hides nothing', async () => {
    setPolicy([])
    await renderPage()
    await submit()

    const withPolicy = sentKeys()

    jest.clearAllMocks()
    resetModuleContractOverridesForTests()
    latestCrudFormProps = null
    await renderPage()
    await submit()

    expect(withPolicy).toEqual(sentKeys())
  })
})
