/** @jest-environment node */
import {
  createContractSchema,
  createOrderSchema,
  createTripSchema,
  generateAbstractSchema,
  recordPaymentSchema,
  updateOrderSchema,
  voidPaymentSchema,
} from '../validators'

const CUSTOMER_ID = '5c2f7dc0-4a0e-4a4f-a63f-9a73572f3f6a'
const OTHER_ID = '8c1f7dc0-4a0e-4a4f-a63f-9a73572f3f6b'

const customerSnapshot = {
  id: CUSTOMER_ID,
  kind: 'company' as const,
  displayName: 'Acme Logistics',
}

function validOrder() {
  return {
    customerId: CUSTOMER_ID,
    customerSnapshot,
    cargoDescription: 'Cement bags',
    pickupLocation: 'Riyadh',
    dropoffLocation: 'Dammam',
    agreedAmountNet: 1200,
  }
}

describe('createOrderSchema', () => {
  it('coerces numeric input into the decimal strings the columns store', () => {
    const parsed = createOrderSchema.parse({ ...validOrder(), adjustmentAmountNet: -50, cargoWeightKg: 12.5 })
    expect(parsed.agreedAmountNet).toBe('1200')
    expect(parsed.adjustmentAmountNet).toBe('-50')
    expect(parsed.cargoWeightKg).toBe('12.5')
  })

  it('rejects a non-numeric amount instead of storing garbage', () => {
    expect(createOrderSchema.safeParse({ ...validOrder(), agreedAmountNet: 'twelve' }).success).toBe(false)
  })

  it('rejects a negative agreed amount', () => {
    expect(createOrderSchema.safeParse({ ...validOrder(), agreedAmountNet: -1 }).success).toBe(false)
  })

  it('requires a customer snapshot rather than trusting an id alone', () => {
    const { customerSnapshot: _snapshot, ...withoutSnapshot } = validOrder()
    expect(createOrderSchema.safeParse(withoutSnapshot).success).toBe(false)
  })

  it('update is partial but still demands a uuid id', () => {
    expect(updateOrderSchema.safeParse({ id: CUSTOMER_ID, notes: 'call before loading' }).success).toBe(true)
    expect(updateOrderSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('createContractSchema', () => {
  it('refuses a validity period that ends before it starts', () => {
    const result = createContractSchema.safeParse({
      customerId: CUSTOMER_ID,
      customerSnapshot,
      title: 'Annual haulage',
      validFrom: '2026-01-01',
      validTo: '2025-12-31',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid period and defaults nothing into the payload beyond what was given', () => {
    const parsed = createContractSchema.parse({
      customerId: CUSTOMER_ID,
      customerSnapshot,
      title: 'Annual haulage',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      requiresCustomerApproval: false,
    })
    expect(parsed.requiresCustomerApproval).toBe(false)
    expect(parsed.validFrom).toBe('2026-01-01')
  })
})

describe('createTripSchema', () => {
  it('requires a contract and rate line for a contract trip', () => {
    const result = createTripSchema.safeParse({ executionDate: '2026-10-01' })
    expect(result.success).toBe(false)
  })

  it('requires an order for a spot trip', () => {
    const result = createTripSchema.safeParse({ source: 'spot', executionDate: '2026-10-01' })
    expect(result.success).toBe(false)
  })

  it('accepts a contract trip with its rate line', () => {
    const parsed = createTripSchema.parse({
      contractId: CUSTOMER_ID,
      contractRouteId: OTHER_ID,
      executionDate: '2026-10-01',
      quantity: 12.5,
    })
    expect(parsed.quantity).toBe('12.5')
  })
})

describe('generateAbstractSchema', () => {
  it('refuses an inverted period', () => {
    const result = generateAbstractSchema.safeParse({
      contractId: CUSTOMER_ID,
      periodFrom: '2026-10-31',
      periodTo: '2026-10-01',
    })
    expect(result.success).toBe(false)
  })
})

describe('recordPaymentSchema', () => {
  const base = { amount: '500', receivedAt: '2026-10-09' }

  it('accepts exactly one target', () => {
    expect(recordPaymentSchema.safeParse({ ...base, orderId: CUSTOMER_ID }).success).toBe(true)
    expect(recordPaymentSchema.safeParse({ ...base, abstractId: OTHER_ID }).success).toBe(true)
  })

  it('refuses both targets and neither target', () => {
    expect(recordPaymentSchema.safeParse({ ...base, orderId: CUSTOMER_ID, abstractId: OTHER_ID }).success).toBe(false)
    expect(recordPaymentSchema.safeParse(base).success).toBe(false)
  })

  it('refuses a zero or negative amount', () => {
    expect(recordPaymentSchema.safeParse({ ...base, amount: '0', orderId: CUSTOMER_ID }).success).toBe(false)
    expect(recordPaymentSchema.safeParse({ ...base, amount: '-5', orderId: CUSTOMER_ID }).success).toBe(false)
  })
})

describe('voidPaymentSchema', () => {
  it('requires a reason in the record, not only in the UI', () => {
    expect(voidPaymentSchema.safeParse({ id: CUSTOMER_ID, reason: 'duplicate transfer' }).success).toBe(true)
    expect(voidPaymentSchema.safeParse({ id: CUSTOMER_ID, reason: '' }).success).toBe(false)
  })
})
