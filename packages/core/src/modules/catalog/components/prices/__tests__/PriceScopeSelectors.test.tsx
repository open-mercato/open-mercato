/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { PricePriceKindSelect } from '../PriceScopeSelectors'

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
