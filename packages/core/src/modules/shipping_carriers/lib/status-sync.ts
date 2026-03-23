import type { UnifiedShipmentStatus } from './adapter'
import type { CarrierShipment } from '../data/entities'
import type { ShippingEventId } from '../events'

export class ShipmentCancelNotAllowedError extends Error {
  constructor(status: string) {
    super(`Shipment cannot be cancelled in its current status: ${status}`)
    this.name = 'ShipmentCancelNotAllowedError'
  }
}

const VALID_SHIPPING_TRANSITIONS: Record<string, UnifiedShipmentStatus[]> = {
  label_created: ['picked_up', 'in_transit', 'cancelled'],
  picked_up: ['in_transit', 'cancelled'],
  in_transit: ['out_for_delivery', 'delivered', 'returned', 'failed_delivery'],
  out_for_delivery: ['delivered', 'returned', 'failed_delivery'],
  failed_delivery: ['in_transit', 'out_for_delivery', 'delivered', 'returned', 'cancelled'],
}

export const TERMINAL_SHIPPING_STATUSES: Set<UnifiedShipmentStatus> = new Set([
  'delivered',
  'returned',
  'cancelled',
])

export function isValidShippingTransition(from: UnifiedShipmentStatus, to: UnifiedShipmentStatus): boolean {
  if (from === to) return false
  const allowed = VALID_SHIPPING_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

export function syncShipmentStatus(shipment: CarrierShipment, newStatus: UnifiedShipmentStatus): boolean {
  const currentStatus = shipment.unifiedStatus as UnifiedShipmentStatus
  if (!isValidShippingTransition(currentStatus, newStatus)) return false
  shipment.unifiedStatus = newStatus
  return true
}

export function getTerminalShippingEvent(status: UnifiedShipmentStatus): ShippingEventId | null {
  if (status === 'delivered') return 'shipping_carriers.shipment.delivered'
  if (status === 'returned') return 'shipping_carriers.shipment.returned'
  if (status === 'cancelled') return 'shipping_carriers.shipment.cancelled'
  return null
}
