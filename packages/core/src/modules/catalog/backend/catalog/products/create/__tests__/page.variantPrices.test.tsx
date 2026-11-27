/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudFormGroup, CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import type { ProductFormValues } from '@open-mercato/core/modules/catalog/components/products/productForm'
import CreateCatalogProductPage from '../page'
import { createVariantDraft } from '@open-mercato/core/modules/catalog/components/products/productForm'

const mockPush = jest.fn()
const mockTranslate = (key: string, fallback?: string, variables?: Record<string, unknown>) =>
  (fallback ?? key).replace(/\{(\w+)\}/g, (match, token: string) => String(variables?.[token] ?? match))
let mockForm: {
  initialValues: ProductFormValues
  groups: CrudFormGroup[]
  onSubmit: (values: ProductFormValues) => Promise<void>
} | null = null

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate, useLocale: () => 'en' }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ error: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: NonNullable<typeof mockForm>) => { mockForm = props; return null },
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn(), readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/inputs/MarkdownField', () => ({ __esModule: true, default: () => null }))
jest.mock('@open-mercato/ui/backend/inputs/TagsInput', () => ({ TagsInput: () => null }))
jest.mock('@open-mercato/core/modules/catalog/components/products/ProductCategorizeSection', () => ({ ProductCategorizeSection: () => null }))
jest.mock('@open-mercato/core/modules/catalog/components/products/ProductUomSection', () => ({ ProductUomSection: () => null }))
jest.mock('@open-mercato/core/modules/catalog/components/products/ProductComplianceSection', () => ({ ProductComplianceSection: () => null }))

const readApiResultMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>


it('keeps every native input edit and the other price kind before the parent rerenders', async () => {
  jest.clearAllMocks()
  mockForm = null
  readApiResultMock.mockImplementation(async (url) => ({ items: String(url).includes('price-kinds') ? [
    { id: 'regular', title: 'Regular', code: 'regular', currencyCode: 'USD', displayMode: 'excluding-tax' },
    { id: 'sale', title: 'Sale', code: 'sale', currencyCode: 'USD', displayMode: 'excluding-tax', isPromotion: true },
  ] : [] }) as never)
  await act(async () => { render(<CreateCatalogProductPage />) })
  await waitFor(() => expect(readApiResultMock).toHaveBeenCalledTimes(2))
  const form = mockForm!
  const values = { ...form.initialValues, variants: [createVariantDraft(null, { id: 'draft-1', isDefault: true })] }
  const setValue = jest.fn()
  const builder = form.groups[0].component!({ values, setValue, errors: {} } as CrudFormGroupComponentProps)
  render(<>{builder}</>)
  fireEvent.click(screen.getByRole('button', { name: 'Variants', exact: true }))
  const inputs = screen.getAllByPlaceholderText('0.00')
  expect(inputs).toHaveLength(2)
  for (const amount of ['1', '12', '12,', '12,5', '12,50']) {
    const input = inputs[0] as HTMLInputElement
    input.value = amount
    fireEvent.input(input)
  }
  const saleInput = inputs[1] as HTMLInputElement
  saleInput.value = '2,50'
  fireEvent.input(saleInput)
  expect(setValue).toHaveBeenLastCalledWith('variants', [expect.objectContaining({
    id: 'draft-1',
    prices: { regular: { amount: '12,50' }, sale: { amount: '2,50' } },
  })])
})
