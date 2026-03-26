import { getTerminalShippingEvent, isValidShippingTransition } from '../status-sync'

describe('shipping status sync', () => {
  it('maps returned shipments to the returned lifecycle event', () => {
    expect(getTerminalShippingEvent('returned')).toBe('shipping_carriers.shipment.returned')
    expect(getTerminalShippingEvent('cancelled')).toBe('shipping_carriers.shipment.cancelled')
    expect(getTerminalShippingEvent('delivered')).toBe('shipping_carriers.shipment.delivered')
  })

  it('allows recovered delivery attempts to continue in transit', () => {
    expect(isValidShippingTransition('failed_delivery', 'in_transit')).toBe(true)
  })
})
