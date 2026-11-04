const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { createCustomerScopedOrderOptionsLoader } from '../backend/components/orderLookup'

describe('customer-scoped order lookup', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } })
  })

  it('uses the current customer for every search after the selection changes', async () => {
    let customerId: string | null = 'customer-a'
    const loadOptions = createCustomerScopedOrderOptionsLoader(() => customerId)

    await loadOptions('ORDER')
    customerId = 'customer-b'
    await loadOptions('ORDER')

    expect(apiCallMock).toHaveBeenNthCalledWith(
      1,
      '/api/sales/orders?page=1&pageSize=20&search=ORDER&customerId=customer-a',
      undefined,
      { fallback: { items: [] } },
    )
    expect(apiCallMock).toHaveBeenNthCalledWith(
      2,
      '/api/sales/orders?page=1&pageSize=20&search=ORDER&customerId=customer-b',
      undefined,
      { fallback: { items: [] } },
    )
  })
})
