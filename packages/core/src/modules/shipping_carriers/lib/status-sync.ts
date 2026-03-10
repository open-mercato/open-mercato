import type { UnifiedShipmentStatus } from './adapter'
import type { CarrierShipment } from '../data/entities'

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
