/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PriceCustomerSelect, PricePriceKindSelect } from '../PriceScopeSelectors'

const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

const SALE_ID = '11111111-1111-4111-8111-111111111111'
const REGULAR_ID = '22222222-2222-4222-8222-222222222222'

const priceKinds = [
  { id: SALE_ID, title: 'Sale', code: 'sale' },
  { id: REGULAR_ID, title: 'Regular', code: 'regular' },
]

function respondLikePriceKindsApi(url: string) {
  const params = new URL(url, 'http://localhost').searchParams
  const ids = params.get('ids')
  const items = ids ? priceKinds.filter((kind) => ids.split(',').includes(kind.id)) : priceKinds
  return Promise.resolve({ items })
}

describe('PricePriceKindSelect', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
  })

  it('shows the label of the stored price kind, not the first kind returned by the API (#7059)', async () => {
    mockReadApiResultOrThrow.mockImplementation(respondLikePriceKindsApi)

    render(<PricePriceKindSelect value={REGULAR_ID} onChange={() => {}} />)

    await waitFor(() => expect(screen.getByDisplayValue('Regular (regular)')).toBeInTheDocument())
    expect(screen.queryByDisplayValue('Sale (sale)')).not.toBeInTheDocument()
    const requestedUrl = String(mockReadApiResultOrThrow.mock.calls[0][0])
    expect(requestedUrl).toContain(`ids=${REGULAR_ID}`)
  })

  it('never labels the stored kind with an unrelated item when the lookup ignores the id', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ items: priceKinds })

    render(<PricePriceKindSelect value={REGULAR_ID} onChange={() => {}} />)

    await waitFor(() => expect(screen.getByDisplayValue('Regular (regular)')).toBeInTheDocument())
    expect(screen.queryByDisplayValue('Sale (sale)')).not.toBeInTheDocument()
  })
})

// Regression coverage for #8107: the customer field only searched/resolved
// against `/api/customers/people`, so company customers could neither be
// found nor labeled. It must now query both `/api/customers/people` and
// `/api/customers/companies` and merge the results.
describe('PriceCustomerSelect (#8107)', () => {
  const PERSON_ID = '33333333-3333-4333-8333-333333333333'
  const COMPANY_ID = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
  })

  it('resolves a company customerId to its display name instead of the raw id', async () => {
    mockReadApiResultOrThrow.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/people')) return Promise.resolve({ items: [] })
      if (url.startsWith('/api/customers/companies')) {
        return Promise.resolve({ items: [{ id: COMPANY_ID, display_name: 'Acme Inc' }] })
      }
      return Promise.resolve({ items: [] })
    })

    render(<PriceCustomerSelect value={COMPANY_ID} onChange={() => {}} />)

    await waitFor(() => expect(screen.getByDisplayValue('Acme Inc')).toBeInTheDocument())
    expect(screen.queryByDisplayValue(COMPANY_ID)).not.toBeInTheDocument()
  })

  it('still resolves a person customerId to its display name', async () => {
    mockReadApiResultOrThrow.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/people')) {
        return Promise.resolve({ items: [{ id: PERSON_ID, displayName: 'Jane Doe' }] })
      }
      return Promise.resolve({ items: [] })
    })

    render(<PriceCustomerSelect value={PERSON_ID} onChange={() => {}} />)

    await waitFor(() => expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument())
  })

  it('merges search suggestions from both people and companies', async () => {
    mockReadApiResultOrThrow.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/people')) {
        return Promise.resolve({ items: [{ id: PERSON_ID, displayName: 'Jane Doe' }] })
      }
      if (url.startsWith('/api/customers/companies')) {
        return Promise.resolve({ items: [{ id: COMPANY_ID, display_name: 'Acme Inc' }] })
      }
      return Promise.resolve({ items: [] })
    })

    render(<PriceCustomerSelect value="" onChange={() => {}} />)

    const input = screen.getByPlaceholderText('Search customers…')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'a' } })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Jane Doe' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Acme Inc' })).toBeInTheDocument()
    })
  })
})
