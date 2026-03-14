import type { UnifiedShipmentStatus } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'

const INPOST_STATUS_MAP: Record<string, UnifiedShipmentStatus> = {
  created: 'label_created',
  offers_prepared: 'label_created',
  offer_selected: 'label_created',
  confirmed: 'label_created',
  dispatched_by_sender: 'picked_up',
  collected_from_sender: 'picked_up',
  taken_by_courier: 'in_transit',
  adopted_at_source_branch: 'in_transit',
  sent_from_source_branch: 'in_transit',
  adopted_at_sorting_center: 'in_transit',
  sent_from_sorting_center: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  ready_to_pickup: 'out_for_delivery',
  stack_in_box_machine: 'out_for_delivery',
  delivered: 'delivered',
  pickup_time_expired: 'failed_delivery',
  avizo: 'failed_delivery',
  returned_to_sender: 'returned',
  canceled: 'cancelled',
}

export function mapInpostStatus(inpostStatus: string): UnifiedShipmentStatus {
  return INPOST_STATUS_MAP[inpostStatus] ?? 'unknown'
}

export const SERVICE_CODE_MAP: Record<string, string> = {
  locker_standard: 'inpost_locker_standard',
  locker_economy: 'inpost_locker_economy',
  courier_standard: 'inpost_courier_standard',
  courier_c2c: 'inpost_courier_c2c',
}

const LOCKER_SERVICE_CODES = new Set([
  'locker_standard',
  'locker_economy',
  'inpost_locker_standard',
  'inpost_locker_economy',
  'inpost_locker_allegro',
  'inpost_locker_pass_thru',
  'inpost_locker_standard_smart',
  'inpost_locker_allegro_smart',
])

export function isLockerService(serviceCode: string): boolean {
  return LOCKER_SERVICE_CODES.has(serviceCode)
}

export function mapServiceCodeToInpost(serviceCode: string): string {
  return SERVICE_CODE_MAP[serviceCode] ?? serviceCode
}
