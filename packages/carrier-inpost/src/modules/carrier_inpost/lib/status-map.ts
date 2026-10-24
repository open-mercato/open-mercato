import type { UnifiedShipmentStatus } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'

const INPOST_STATUS_MAP: Record<string, UnifiedShipmentStatus> = {
  // Label / offer preparation
  created: 'label_created',
  offers_prepared: 'label_created',
  offer_selected: 'label_created',
  confirmed: 'label_created',

  // Picked up from sender
  dispatched_by_sender: 'picked_up',
  dispatched_by_sender_to_pok: 'picked_up',
  collected_from_sender: 'picked_up',
  taken_by_courier_from_customer_service_point: 'picked_up',
  taken_by_courier_from_pok: 'picked_up',

  // In transit / sorting
  taken_by_courier: 'in_transit',
  adopted_at_source_branch: 'in_transit',
  sent_from_source_branch: 'in_transit',
  adopted_at_sorting_center: 'in_transit',
  oversized: 'in_transit',
  readdressed: 'in_transit',
  delay_in_delivery: 'in_transit',
  unstack_from_customer_service_point: 'in_transit',
  unstack_from_box_machine: 'in_transit',
  redirect_to_box: 'in_transit',
  canceled_redirect_to_box: 'in_transit',

  // Out for delivery / awaiting pickup
  out_for_delivery: 'out_for_delivery',
  out_for_delivery_to_address: 'out_for_delivery',
  ready_to_pickup: 'out_for_delivery',
  ready_to_pickup_from_pok: 'out_for_delivery',
  ready_to_pickup_from_branch: 'out_for_delivery',
  stack_in_box_machine: 'out_for_delivery',
  stack_in_customer_service_point: 'out_for_delivery',
  pickup_reminder_sent: 'out_for_delivery',
  pickup_reminder_sent_address: 'out_for_delivery',
  courier_avizo_in_customer_service_point: 'out_for_delivery',

  // Delivered
  delivered: 'delivered',

  // Failed delivery
  pickup_time_expired: 'failed_delivery',
  stack_parcel_pickup_time_expired: 'failed_delivery',
  stack_parcel_in_box_machine_pickup_time_expired: 'failed_delivery',
  avizo: 'failed_delivery',
  undelivered: 'failed_delivery',
  undelivered_wrong_address: 'failed_delivery',
  undelivered_cod_cash_receiver: 'failed_delivery',
  rejected_by_receiver: 'failed_delivery',

  // Returned
  returned_to_sender: 'returned',

  // Cancelled
  canceled: 'cancelled',
  claimed: 'cancelled',
}

export function mapInpostStatus(inpostStatus: string): UnifiedShipmentStatus {
  return INPOST_STATUS_MAP[inpostStatus] ?? 'unknown'
}

export const SERVICE_CODE_MAP: Record<string, string> = {
  locker_standard: 'inpost_locker_standard',
  courier_standard: 'inpost_courier_standard',
  courier_c2c: 'inpost_courier_c2c',
}

// Locker services use template-based parcel sizing (small/medium/large).
// courier_c2c also uses templates (small/medium/large/xlarge) but is NOT
// included here because isLockerService is used to add locker-specific
// API fields (e.g. target_point, receiver email) — courier_c2c does not need those.
const LOCKER_SERVICE_CODES = new Set([
  'locker_standard',
  'inpost_locker_standard',
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
