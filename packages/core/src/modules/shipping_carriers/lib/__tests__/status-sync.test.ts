import type { UnifiedShipmentStatus } from '../adapter'
import { getTerminalShippingEvent, isValidShippingTransition, syncShipmentStatus } from '../status-sync'
import type { CarrierShipment } from '../../data/entities'

const ALL_STATUSES: UnifiedShipmentStatus[] = [
  'label_created',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed_delivery',
  'returned',
  'cancelled',
  'unknown',
]

describe('shipping status sync', () => {
  it('maps returned shipments to the returned lifecycle event', () => {
    expect(getTerminalShippingEvent('returned')).toBe('shipping_carriers.shipment.returned')
    expect(getTerminalShippingEvent('cancelled')).toBe('shipping_carriers.shipment.cancelled')
    expect(getTerminalShippingEvent('delivered')).toBe('shipping_carriers.shipment.delivered')
  })

  it('allows recovered delivery attempts to continue in transit', () => {
    expect(isValidShippingTransition('failed_delivery', 'in_transit')).toBe(true)
  })

  it.each([
    ['label_created', 'out_for_delivery'],
    ['label_created', 'delivered'],
    ['label_created', 'failed_delivery'],
    ['label_created', 'returned'],
    ['picked_up', 'out_for_delivery'],
    ['picked_up', 'delivered'],
    ['picked_up', 'failed_delivery'],
    ['picked_up', 'returned'],
  ] as Array<[UnifiedShipmentStatus, UnifiedShipmentStatus]>)(
    'applies a carrier status that skips intermediate steps (%s -> %s)',
    (from, to) => {
      expect(isValidShippingTransition(from, to)).toBe(true)
      const shipment = { unifiedStatus: from } as CarrierShipment
      expect(syncShipmentStatus(shipment, to)).toBe(true)
      expect(shipment.unifiedStatus).toBe(to)
    },
  )

  it.each([
    ['picked_up', 'label_created'],
    ['in_transit', 'label_created'],
    ['in_transit', 'picked_up'],
    ['out_for_delivery', 'in_transit'],
    ['out_for_delivery', 'picked_up'],
    ['in_transit', 'cancelled'],
    ['out_for_delivery', 'cancelled'],
  ] as Array<[UnifiedShipmentStatus, UnifiedShipmentStatus]>)(
    'refuses a carrier status that moves the shipment backwards (%s -> %s)',
    (from, to) => {
      expect(isValidShippingTransition(from, to)).toBe(false)
      const shipment = { unifiedStatus: from } as CarrierShipment
      expect(syncShipmentStatus(shipment, to)).toBe(false)
      expect(shipment.unifiedStatus).toBe(from)
    },
  )

  it('never moves a shipment out of a terminal status, into unknown, or onto the same status', () => {
    for (const to of ALL_STATUSES) {
      expect(isValidShippingTransition('delivered', to)).toBe(false)
      expect(isValidShippingTransition('returned', to)).toBe(false)
      expect(isValidShippingTransition('cancelled', to)).toBe(false)
      expect(isValidShippingTransition('unknown', to)).toBe(false)
    }
    for (const from of ALL_STATUSES) {
      expect(isValidShippingTransition(from, 'unknown')).toBe(false)
      expect(isValidShippingTransition(from, from)).toBe(false)
    }
  })

  it('keeps the set of statuses a shipment can be cancelled from', () => {
    const cancellableFrom = ALL_STATUSES.filter((from) => isValidShippingTransition(from, 'cancelled'))
    expect(cancellableFrom).toEqual(['label_created', 'picked_up', 'failed_delivery'])
  })
})
