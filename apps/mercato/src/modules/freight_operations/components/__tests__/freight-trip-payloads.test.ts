/** @jest-environment node */
import { buildTripFormDefaults, toTripPayload } from '../FreightTripForm'
import { buildChargeDraft, chargesTotal, toChargesPayload, toChargeDrafts } from '../TripChargesDialog'
import { toRoutePayload } from '../ContractRouteDialog'

describe('trip payload', () => {
  const contractIdOf = (rateLineId: string) => (rateLineId === 'rate-1' ? 'contract-1' : null)
  const base = {
    ...buildTripFormDefaults(),
    contractRouteId: 'rate-1',
    executionDate: '2026-10-05',
    quantity: '2',
    vehicleId: 'vehicle-1',
    driverId: 'driver-1',
    notes: '  Night run  ',
  }

  it('derives the contract from the chosen rate line on create', () => {
    const payload = toTripPayload(base, 'create', contractIdOf)
    expect(payload.source).toBe('contract')
    expect(payload.contractId).toBe('contract-1')
    expect(payload.contractRouteId).toBe('rate-1')
    expect(payload.freightOrderId).toBeUndefined()
    expect(payload.notes).toBe('Night run')
  })

  it('sends the order instead of a contract for a spot trip', () => {
    const payload = toTripPayload({ ...base, source: 'spot', freightOrderId: 'order-1' }, 'create', contractIdOf)
    expect(payload.source).toBe('spot')
    expect(payload.freightOrderId).toBe('order-1')
    expect(payload.contractId).toBeUndefined()
    expect(payload.contractRouteId).toBeUndefined()
  })

  // The update command ignores the four source fields; sending them would
  // suggest the screen can move a trip to another contract.
  it('omits the source and every foreign key on edit', () => {
    const payload = toTripPayload(base, 'edit', contractIdOf)
    expect(payload).not.toHaveProperty('source')
    expect(payload).not.toHaveProperty('contractId')
    expect(payload).not.toHaveProperty('contractRouteId')
    expect(payload).not.toHaveProperty('freightOrderId')
    expect(payload.executionDate).toBe('2026-10-05')
  })
})

describe('trip charges payload', () => {
  it('replaces the set with the drafts in order', () => {
    const payload = toChargesPayload([
      { id: 'a', kind: 'waiting', description: ' Gate wait ', quantity: '2', unitAmountNet: '50', isTaxable: true, billable: true },
      { id: 'b', kind: 'toll', description: '', quantity: '', unitAmountNet: '', isTaxable: false, billable: false },
    ])
    expect(payload).toEqual([
      { kind: 'waiting', description: 'Gate wait', quantity: '2', unitAmountNet: '50', isTaxable: true, billable: true, position: 0 },
      { kind: 'toll', unitAmountNet: '0', isTaxable: false, billable: false, position: 1 },
    ])
  })

  it('reads stored rows into drafts and adds the amounts', () => {
    const drafts = toChargeDrafts([
      { id: 'x', kind: 'waiting', description: null, quantity: null, unit_amount_net: '50', amount_net: '50', is_taxable: true, billable: true },
      { id: 'y', kind: 'toll', description: 'Salik', quantity: '1', unit_amount_net: '15.5', amount_net: '15.5' },
    ])
    expect(drafts[0]).toMatchObject({ kind: 'waiting', description: '', quantity: '', isTaxable: true, billable: true })
    expect(chargesTotal(drafts)).toBeCloseTo(65.5)
    expect(chargesTotal([...drafts, buildChargeDraft()])).toBeCloseTo(65.5)
  })
})

describe('contract rate payload', () => {
  it('clears optional values and keeps the lane', () => {
    const payload = toRoutePayload({
      id: '',
      lineNumber: '7',
      origin: ' Riyadh ',
      destination: 'Dammam',
      rateBasis: 'per_trip',
      rateAmount: '450',
      minimumCharge: '',
      currencyCode: '',
      vatRateOverride: '',
      isActive: true,
      includesTolls: false,
      includesWaiting: false,
      freeWaitingMinutes: '',
      waitingRatePerHour: '',
      effectiveFrom: '',
      effectiveTo: '',
      updatedAt: null,
    })
    expect(payload).toMatchObject({
      lineNumber: '7',
      origin: 'Riyadh',
      destination: 'Dammam',
      minimumCharge: null,
      currencyCode: 'SAR',
      vatRateOverride: null,
      effectiveFrom: null,
      effectiveTo: null,
    })
  })
})
