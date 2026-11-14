/** @jest-environment jsdom */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import CreateCatalogPricePage from '../../../backend/catalog/prices/create/page'
import EditCatalogPricePage from '../../../backend/catalog/prices/[id]/edit/page'
import type { PriceFormValues } from '../priceFormFields'

const mockCreateCrud = jest.fn()
const mockUpdateCrud = jest.fn()
const mockApiCall = jest.fn()
let mockProps: { onSubmit: (values: PriceFormValues) => Promise<void>; optimisticLockUpdatedAt?: string }
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: typeof mockProps) => { mockProps = props; return null },
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PageBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({ ErrorMessage: () => null, RecordNotFoundState: () => null }))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
  updateCrud: (...args: unknown[]) => mockUpdateCrud(...args),
  deleteCrud: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApiCall(...args) }))
jest.mock('../priceFormFields', () => ({ PRICE_FORM_INITIAL_VALUES: {}, usePriceFormFields: () => ({ fields: [], groups: [] }) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string) => key
  return { useT: () => translate, useLocale: () => 'pl' }
})

const values = { productId: 'product', unitPriceNet: '12,50', unitPriceGross: '15,38' }
const version = '2026-11-12T12:00:00.000Z'

beforeEach(() => {
  jest.clearAllMocks()
  mockApiCall.mockResolvedValue({ ok: true, result: { items: [{ id: 'price', product_id: 'product', unit_price_net: '10.00', updated_at: version }] } })
})

it('create submits canonical amounts and refuses invalid input before calling the API', async () => {
  render(<CreateCatalogPricePage />)
  await mockProps.onSubmit(values)
  expect(mockCreateCrud).toHaveBeenCalledWith('catalog/prices', expect.objectContaining({ unitPriceNet: '12.5', unitPriceGross: '15.38' }))
  mockCreateCrud.mockClear()
  await expect(mockProps.onSubmit({ ...values, unitPriceNet: '-1' })).rejects.toThrow()
  expect(mockCreateCrud).not.toHaveBeenCalled()
})

it('edit preserves the loaded version, canonicalizes repeated saves and refuses malformed input', async () => {
  render(<EditCatalogPricePage params={{ id: 'price' }} />)
  await waitFor(() => expect(mockProps.optimisticLockUpdatedAt).toBe(version))
  await mockProps.onSubmit(values)
  await mockProps.onSubmit({ ...values, unitPriceNet: '12.50' })
  expect(mockUpdateCrud).toHaveBeenCalledTimes(2)
  expect(mockUpdateCrud).toHaveBeenLastCalledWith('catalog/prices', expect.objectContaining({ id: 'price', unitPriceNet: '12.5', unitPriceGross: '15.38' }))
  mockUpdateCrud.mockClear()
  await expect(mockProps.onSubmit({ ...values, unitPriceGross: '1 2' })).rejects.toThrow()
  expect(mockUpdateCrud).not.toHaveBeenCalled()
})
