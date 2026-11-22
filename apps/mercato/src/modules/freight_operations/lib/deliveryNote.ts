import type { DeliveryNoteStatus, ExternalWaybillStatus } from '../data/entities'

const DELIVERY_NOTE_TRANSITIONS: Record<DeliveryNoteStatus, readonly DeliveryNoteStatus[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

export function canTransitionDeliveryNote(from: DeliveryNoteStatus, to: DeliveryNoteStatus): boolean {
  return DELIVERY_NOTE_TRANSITIONS[from].includes(to)
}

export function isDeliveryNoteEditable(status: DeliveryNoteStatus): boolean {
  return status === 'draft'
}

export function isDeliveryNoteDeletable(status: DeliveryNoteStatus): boolean {
  return status === 'draft'
}

/**
 * A delivery note may only be cancelled once the external Bayan Naql waybill
 * (when one was recorded) is itself cancelled. Otherwise the internal document
 * would say "cancelled" while the regulator's platform still shows a live
 * transport document for the same shipment.
 */
export function canCancelDeliveryNote(externalStatus: ExternalWaybillStatus): boolean {
  return externalStatus !== 'recorded'
}

export function isExternalWaybillRecorded(status: ExternalWaybillStatus): boolean {
  return status === 'recorded'
}
