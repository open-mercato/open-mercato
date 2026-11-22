/** @jest-environment node */
import {
  canCancelDeliveryNote,
  canTransitionDeliveryNote,
  isDeliveryNoteDeletable,
  isDeliveryNoteEditable,
} from '../deliveryNote'

describe('delivery note state machine', () => {
  it('allows the documented lifecycle only', () => {
    expect(canTransitionDeliveryNote('draft', 'issued')).toBe(true)
    expect(canTransitionDeliveryNote('draft', 'cancelled')).toBe(true)
    expect(canTransitionDeliveryNote('issued', 'delivered')).toBe(true)
    expect(canTransitionDeliveryNote('issued', 'cancelled')).toBe(true)
  })

  it('refuses to skip the issue step or reopen a closed document', () => {
    expect(canTransitionDeliveryNote('draft', 'delivered')).toBe(false)
    expect(canTransitionDeliveryNote('delivered', 'cancelled')).toBe(false)
    expect(canTransitionDeliveryNote('cancelled', 'issued')).toBe(false)
    expect(canTransitionDeliveryNote('delivered', 'issued')).toBe(false)
  })

  it('edits and deletes only drafts', () => {
    expect(isDeliveryNoteEditable('draft')).toBe(true)
    expect(isDeliveryNoteEditable('issued')).toBe(false)
    expect(isDeliveryNoteDeletable('draft')).toBe(true)
    expect(isDeliveryNoteDeletable('delivered')).toBe(false)
  })

  it('refuses cancellation while the external waybill is live', () => {
    expect(canCancelDeliveryNote('recorded')).toBe(false)
    expect(canCancelDeliveryNote('not_recorded')).toBe(true)
    expect(canCancelDeliveryNote('cancelled')).toBe(true)
  })
})
