/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CustomerOrderPicker } from '../backend/components/CustomerOrderPicker'

const mockApiCall = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
}))

function orderResponse(orderId: string) {
  return { ok: true, result: { items: [{ id: orderId, orderNumber: orderId }] } }
}

const defaultProps = {
  customerId: 'customer-a',
  value: '',
  onChange: jest.fn(),
  placeholder: 'Order',
  fallbackLabel: 'Unavailable',
}

async function searchOrders() {
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'ORDER' } })
  await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
}

describe('customer-scoped order picker', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    defaultProps.onChange.mockReset()
  })

  it('discards cached suggestions when switching customers and searches with the new customer', async () => {
    mockApiCall.mockResolvedValue(orderResponse('ORDER-A'))
    const view = render(<CustomerOrderPicker {...defaultProps} />)
    await searchOrders()
    expect(await screen.findByText('ORDER-A')).toBeTruthy()

    mockApiCall.mockClear()
    mockApiCall.mockResolvedValue(orderResponse('ORDER-B'))
    view.rerender(<CustomerOrderPicker {...defaultProps} customerId="customer-b" />)
    expect(screen.queryByText('ORDER-A')).toBeNull()
    expect(defaultProps.onChange).toHaveBeenCalledWith('')
    await searchOrders()
    expect(await screen.findByText('ORDER-B')).toBeTruthy()
    expect(mockApiCall.mock.calls[0][0]).toContain('customerId=customer-b')
  })

  it('preserves the initial order and clears it only when the customer changes', async () => {
    mockApiCall.mockResolvedValue(orderResponse('ORDER-A'))
    const view = render(<CustomerOrderPicker {...defaultProps} value="ORDER-A" />)
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('ORDER-A'))
    expect(defaultProps.onChange).not.toHaveBeenCalled()
    view.rerender(<CustomerOrderPicker {...defaultProps} customerId="customer-b" value="ORDER-A" />)
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(defaultProps.onChange).toHaveBeenCalledWith('')
  })

  it('ignores an old customer response arriving after the customer changes', async () => {
    let finishOldRequest: (response: ReturnType<typeof orderResponse>) => void = () => {}
    mockApiCall.mockImplementationOnce(() => new Promise((resolve) => { finishOldRequest = resolve }))
    const view = render(<CustomerOrderPicker {...defaultProps} />)
    await searchOrders()
    view.rerender(<CustomerOrderPicker {...defaultProps} customerId="customer-b" />)
    await act(async () => { finishOldRequest(orderResponse('ORDER-A')) })
    expect(screen.queryByText('ORDER-A')).toBeNull()
    mockApiCall.mockClear()
    mockApiCall.mockResolvedValue(orderResponse('ORDER-B'))
    await searchOrders()
    expect(await screen.findByText('ORDER-B')).toBeTruthy()
    expect(mockApiCall.mock.calls[0][0]).toContain('customerId=customer-b')
  })
})
