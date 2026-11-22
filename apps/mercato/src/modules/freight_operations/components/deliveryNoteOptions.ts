export type DeliveryNoteStatusValue = 'draft' | 'issued' | 'delivered' | 'cancelled'
export type ExternalWaybillStatusValue = 'not_recorded' | 'recorded' | 'cancelled'

export const DELIVERY_NOTE_STATUS_VALUES: DeliveryNoteStatusValue[] = [
  'draft',
  'issued',
  'delivered',
  'cancelled',
]

export const EXTERNAL_WAYBILL_STATUS_VALUES: ExternalWaybillStatusValue[] = [
  'not_recorded',
  'recorded',
  'cancelled',
]

export const DELIVERY_NOTE_STATUS_FALLBACKS: Record<DeliveryNoteStatusValue, string> = {
  draft: 'Draft',
  issued: 'Issued',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const EXTERNAL_WAYBILL_STATUS_FALLBACKS: Record<ExternalWaybillStatusValue, string> = {
  not_recorded: 'Not recorded',
  recorded: 'Recorded',
  cancelled: 'Cancelled',
}

export type FreightDeliveryNoteRow = {
  id: string
  note_number: string
  status: DeliveryNoteStatusValue
  freight_order_id?: string | null
  freight_trip_id?: string | null
  order_number_snapshot?: string | null
  trip_number_snapshot?: string | null
  customer_id: string
  customer_snapshot?: Record<string, unknown> | null
  seller_snapshot?: Record<string, unknown> | null
  consignee_name?: string | null
  consignee_phone?: string | null
  consignee_address?: string | null
  origin: string
  destination: string
  requested_pickup_at?: string | null
  requested_delivery_at?: string | null
  cargo_description: string
  cargo_quantity?: string | null
  cargo_unit?: string | null
  cargo_weight_kg?: string | null
  cargo_volume_m3?: string | null
  cargo_hazardous?: boolean
  cargo_refrigerated?: boolean
  seal_number?: string | null
  vehicle_id?: string | null
  driver_id?: string | null
  vehicle_snapshot?: Record<string, unknown> | null
  driver_snapshot?: Record<string, unknown> | null
  issued_at?: string | null
  delivered_at?: string | null
  received_by_name?: string | null
  received_by_id_number?: string | null
  pod_reference?: string | null
  pod_document_id?: string | null
  pop_reference?: string | null
  pop_document_id?: string | null
  external_waybill_number?: string | null
  external_waybill_status: ExternalWaybillStatusValue
  external_waybill_url?: string | null
  external_waybill_recorded_at?: string | null
  external_waybill_cancelled_at?: string | null
  external_waybill_notes?: string | null
  cancellation_reason?: string | null
  cancelled_at?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

export type DeliveryNoteActionMode = 'issue' | 'deliver' | 'cancel' | 'waybill' | 'waybill_cancel'

export function deliveryNoteSourceLabel(note: FreightDeliveryNoteRow): string {
  if (note.order_number_snapshot) return note.order_number_snapshot
  if (note.trip_number_snapshot) return note.trip_number_snapshot
  return '—'
}

export function snapshotName(snapshot: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!snapshot) return null
  const value = snapshot[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
