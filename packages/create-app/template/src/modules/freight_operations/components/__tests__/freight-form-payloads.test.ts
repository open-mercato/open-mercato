/** @jest-environment node */
import { buildOrderFormDefaults, toOrderPayload } from '../FreightOrderForm'
import { buildContractFormDefaults, toContractPayload } from '../FreightContractForm'

const t = (_key: string, fallback: string) => fallback

const snapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'company' as const,
  displayName: 'North Corridor Logistics',
  primaryEmail: null,
  primaryPhone: null,
}

describe('freight order payload', () => {
  // The create schema requires the billing party's snapshot; a form that sends
  // only the id fails validation server-side with a message no operator can act
  // on — this is the regression the picker wiring exists to prevent.
  it('carries the customer snapshot beside the id', () => {
    const values = { ...buildOrderFormDefaults(), customerId: snapshot.id, cargoDescription: 'Steel coils', pickupLocation: 'Riyadh', dropoffLocation: 'Dammam', agreedAmountNet: '1200' }
    const payload = toOrderPayload(values, snapshot, t)
    expect(payload.customerId).toBe(snapshot.id)
    expect(payload.customerSnapshot).toEqual(snapshot)
  })

  it('refuses to submit without a resolvable snapshot', () => {
    const values = { ...buildOrderFormDefaults(), customerId: snapshot.id, cargoDescription: 'Steel', pickupLocation: 'Riyadh', dropoffLocation: 'Dammam', agreedAmountNet: '1' }
    expect(() => toOrderPayload(values, null, t)).toThrow(/Choose a customer/)
  })
})

describe('freight contract payload', () => {
  it('carries the snapshot and keeps the billing defaults', () => {
    const values = { ...buildContractFormDefaults(), customerId: snapshot.id, title: 'North corridor 2026' }
    const payload = toContractPayload(values, snapshot, t)
    expect(payload.customerSnapshot).toEqual(snapshot)
    expect(payload.billingCycle).toBe('monthly')
    expect(payload.currencyCode).toBe('SAR')
    // The form works in whole percents; the API stores the rate as a percent string.
    expect(payload.vatRate).toBe('15')
  })

  it('clears optional values instead of sending empty strings', () => {
    const values = { ...buildContractFormDefaults(), customerId: snapshot.id, title: 'X', signedAt: '', notes: '  ', salesChannelId: '' }
    const payload = toContractPayload(values, snapshot, t)
    expect(payload.signedAt).toBeNull()
    expect(payload.notes).toBeNull()
    expect(payload.salesChannelId).toBeNull()
  })

  it('refuses to submit without a resolvable snapshot', () => {
    const values = { ...buildContractFormDefaults(), customerId: snapshot.id, title: 'X' }
    expect(() => toContractPayload(values, null, t)).toThrow(/Choose a customer/)
  })
})
