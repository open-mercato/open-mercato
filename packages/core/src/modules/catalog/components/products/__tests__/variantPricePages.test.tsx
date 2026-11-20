/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import type { CrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import EditVariantPage from '../../../backend/catalog/products/[productId]/variants/[variantId]/page'
import CreateVariantPage from '../../../backend/catalog/products/[productId]/variants/create/page'
import type { VariantFormValues } from '../variantForm'

type FormProps = {
  initialValues: VariantFormValues
  isLoading: boolean
  onSubmit: (values: VariantFormValues) => Promise<void>
  groups: CrudFormGroup[]
}

let mockForm: FormProps | null = null
let mockStoredPrice = '246.0000'
const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: FormProps) => { mockForm = props; return null },
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/catalog/products/product-1/variants/variant-1',
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(), updateCrud: jest.fn(), deleteCrud: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(), readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: unknown, run: () => Promise<unknown>) => run()),
}))
jest.mock('@open-mercato/core/modules/catalog/components/PriceEditorOmnibusRow', () => ({ PriceEditorOmnibusRow: () => null }))

const priceVersion = '2026-11-18T10:00:00.000Z'

describe.each(['create', 'edit'] as const)('Variant %s price submission', (mode) => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockForm = null
    mockStoredPrice = '246.0000'
    jest.mocked(createCrud).mockResolvedValue({ result: { id: 'variant-1' } } as never)
    jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: [
      { id: 'retail', code: 'regular', title: 'Retail', currency_code: 'USD', display_mode: 'including-tax' },
      { id: 'wholesale', code: 'wholesale', title: 'Wholesale', currency_code: 'USD', display_mode: 'excluding-tax' },
    ] })
    jest.mocked(apiCall).mockImplementation(async (url) => {
      const path = String(url)
      const items = path.includes('/catalog/variants?')
        ? [{ id: 'variant-1', product_id: 'product-1', name: 'Variant', option_values: {}, updated_at: '2026-11-19T10:00:00.000Z' }]
        : path.includes('/catalog/prices?')
          ? [{ id: 'price-1', price_kind_id: 'retail', unit_price_gross: mockStoredPrice, updated_at: priceVersion }]
          : path.includes('/catalog/products?') ? [{ id: 'product-1', title: 'Product' }] : []
      return { ok: true, result: { items } } as never
    })
  })

  async function loadForm(): Promise<FormProps> {
    render(mode === 'edit'
      ? <EditVariantPage params={{ productId: 'product-1', variantId: 'variant-1' }} />
      : <CreateVariantPage params={{ productId: 'product-1' }} />)
    await waitFor(() => expect(mockForm?.isLoading).toBe(false))
    return mockForm!
  }

  if (mode === 'edit') {
    it.each([
      ['en', '19.99'], ['pl', '19.99'], ['pl', '0.000000000000000001'],
    ])('reopens the exact stored decimal string in the %s text input (%s)', async (locale, exact) => {
      const previousLanguage = document.documentElement.lang
      document.documentElement.lang = locale
      mockStoredPrice = exact
      try {
        const form = await loadForm()
        const pricesGroup = form.groups.find((group) => group.id === 'prices')!
        render(<>{pricesGroup.component!({ values: form.initialValues, setValue: jest.fn(), errors: {} })}</>)
        const amount = screen.getByLabelText('Retail')
        expect(amount).toHaveAttribute('type', 'text')
        expect(amount).toHaveAttribute('inputmode', 'decimal')
        expect(amount).toHaveValue(exact)
      } finally {
        document.documentElement.lang = previousLanguage
      }
    })
  }

  it.each([
    ['149,99', '149.99'], ['149.99', '149.99'], ['0', '0'],
    ['12345678901234,123456789', '12345678901234.123456789'],
    ['0,000000000000000001', '0.000000000000000001'],
  ])('sends %s as the exact price string %s for gross and net amounts', async (amount, exact) => {
    const form = await loadForm()
    await act(async () => form.onSubmit({
      ...form.initialValues,
      name: 'Variant',
      prices: {
        ...form.initialValues.prices,
        retail: { ...form.initialValues.prices?.retail, priceKindId: 'retail', amount, displayMode: 'including-tax' },
        wholesale: { priceKindId: 'wholesale', amount, displayMode: 'excluding-tax' },
      },
    }))
    const grossWriter = mode === 'edit' ? updateCrud : createCrud
    expect(grossWriter).toHaveBeenCalledWith('catalog/prices', expect.objectContaining({ unitPriceGross: exact }))
    expect(createCrud).toHaveBeenCalledWith('catalog/prices', expect.objectContaining({ unitPriceNet: exact }))
    if (mode === 'edit') {
      expect(withScopedApiRequestHeaders).toHaveBeenCalledWith(buildOptimisticLockHeader(priceVersion), expect.any(Function))
    }
  })

  it.each(['-1,50', '12,3,4', '1.234,56', 'abc'])('rejects %s before any writes and displays the error beside the field', async (amount) => {
    const form = await loadForm()
    const values: VariantFormValues = {
      ...form.initialValues,
      name: 'Variant',
      prices: { retail: { priceKindId: 'retail', amount, displayMode: 'including-tax' } },
    }
    let fieldErrors: CrudFormError['fieldErrors']
    await act(async () => {
      try { await form.onSubmit(values) } catch (error) { fieldErrors = (error as CrudFormError).fieldErrors }
    })
    expect(fieldErrors).toEqual({ prices: 'Provide a valid non-negative price.' })
    expect(createCrud).not.toHaveBeenCalled()
    expect(updateCrud).not.toHaveBeenCalled()
    const pricesGroup = form.groups.find((group) => group.id === 'prices')!
    render(<>{pricesGroup.component!({ values, setValue: jest.fn(), errors: fieldErrors as Record<string, string> })}</>)
    expect(screen.getByRole('alert')).toHaveTextContent('Provide a valid non-negative price.')
    expect(screen.getByLabelText('Retail')).toHaveAttribute('aria-invalid', 'true')
  })

  it('preserves clearing an existing price or leaving a new price empty', async () => {
    const form = await loadForm()
    await act(async () => form.onSubmit({
      ...form.initialValues, name: 'Variant',
      prices: { retail: { ...form.initialValues.prices?.retail, priceKindId: 'retail', amount: '', displayMode: 'including-tax' } },
    }))
    if (mode === 'edit') expect(deleteCrud).toHaveBeenCalledWith('catalog/prices', 'price-1')
    expect(jest.mocked(createCrud).mock.calls.filter(([entity]) => entity === 'catalog/prices')).toEqual([])
    expect(jest.mocked(updateCrud).mock.calls.filter(([entity]) => entity === 'catalog/prices')).toEqual([])
  })
})
