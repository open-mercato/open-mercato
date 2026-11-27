/** @jest-environment jsdom */
import * as React from 'react'
import { render } from '@testing-library/react'
import { ClaimCustomerSelectionObserver } from '../backend/components/ClaimCustomerSelectionObserver'

describe('claim customer selection', () => {
  it('preserves initial and unchanged customer lines', () => {
    const onChange = jest.fn()
    const lines = [{ orderLineId: 'order-line-a', productName: 'Imported' }]
    const view = render(<ClaimCustomerSelectionObserver customerId="customer-a" lines={lines} onChange={onChange} />)
    view.rerender(<ClaimCustomerSelectionObserver customerId="customer-a" lines={[...lines]} onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears imported references on customer changes while retaining every manual-line field', () => {
    const onChange = jest.fn()
    const manual = { orderLineId: null, productName: 'Manual', qtyClaimed: '2', faultDescription: 'Keep this text', serialNumber: 'Own serial' }
    const lines = [{ orderLineId: 'order-line-a', productName: 'Previous customer item' }, manual]
    const view = render(<ClaimCustomerSelectionObserver customerId="customer-a" lines={lines} onChange={onChange} />)
    view.rerender(<ClaimCustomerSelectionObserver customerId="customer-b" lines={lines} onChange={onChange} />)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith([manual])
    expect(onChange.mock.calls[0][0][0]).toBe(manual)
  })

  it('also clears imported lines when the customer is removed', () => {
    const onChange = jest.fn()
    const lines = [{ orderLineId: 'order-line-a' }]
    const view = render(<ClaimCustomerSelectionObserver customerId="customer-a" lines={lines} onChange={onChange} />)
    view.rerender(<ClaimCustomerSelectionObserver customerId={null} lines={lines} onChange={onChange} />)
    expect(onChange).toHaveBeenCalledWith([])
  })
})
