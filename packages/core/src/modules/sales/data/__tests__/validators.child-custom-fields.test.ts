import { shipmentCreateSchema, paymentCreateSchema } from '../validators'

const SCOPE = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LINE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

describe('shipment item customFields payload normalization (issue #8068 review)', () => {
  it('accepts a plain customFields object', () => {
    const result = shipmentCreateSchema.safeParse({
      ...SCOPE,
      orderId: ORDER_ID,
      items: [{ orderLineId: LINE_ID, quantity: 1, customFields: { priority: 'high' } }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.items?.[0]?.customFields).toEqual({ priority: 'high' })
  })

  it('normalizes customValues into customFields', () => {
    const result = shipmentCreateSchema.safeParse({
      ...SCOPE,
      orderId: ORDER_ID,
      items: [{ orderLineId: LINE_ID, quantity: 1, customValues: { priority: 'high' } }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.items?.[0]?.customFields).toEqual({ priority: 'high' })
  })

  it('normalizes cf_-prefixed keys into customFields', () => {
    const result = shipmentCreateSchema.safeParse({
      ...SCOPE,
      orderId: ORDER_ID,
      items: [{ orderLineId: LINE_ID, quantity: 1, cf_priority: 'high' }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.items?.[0]?.customFields).toEqual({ priority: 'high' })
  })

  it('normalizes cf:-prefixed keys into customFields', () => {
    const result = shipmentCreateSchema.safeParse({
      ...SCOPE,
      orderId: ORDER_ID,
      items: [{ orderLineId: LINE_ID, quantity: 1, 'cf:priority': 'high' }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.items?.[0]?.customFields).toEqual({ priority: 'high' })
  })

  it('normalizes a customFields entries array ({key, value}[])', () => {
    const result = shipmentCreateSchema.safeParse({
      ...SCOPE,
      orderId: ORDER_ID,
      items: [{ orderLineId: LINE_ID, quantity: 1, customFields: [{ key: 'priority', value: 'high' }] }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.items?.[0]?.customFields).toEqual({ priority: 'high' })
  })
})

describe('payment allocation customFields payload normalization (issue #8068 review)', () => {
  it('accepts a plain customFields object', () => {
    const result = paymentCreateSchema.safeParse({
      ...SCOPE,
      amount: 10,
      currencyCode: 'USD',
      allocations: [{ orderId: ORDER_ID, amount: 10, currencyCode: 'USD', customFields: { ref: 'abc' } }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.allocations?.[0]?.customFields).toEqual({ ref: 'abc' })
  })

  it('normalizes customValues into customFields', () => {
    const result = paymentCreateSchema.safeParse({
      ...SCOPE,
      amount: 10,
      currencyCode: 'USD',
      allocations: [{ orderId: ORDER_ID, amount: 10, currencyCode: 'USD', customValues: { ref: 'abc' } }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.allocations?.[0]?.customFields).toEqual({ ref: 'abc' })
  })

  it('normalizes cf_-prefixed keys into customFields', () => {
    const result = paymentCreateSchema.safeParse({
      ...SCOPE,
      amount: 10,
      currencyCode: 'USD',
      allocations: [{ orderId: ORDER_ID, amount: 10, currencyCode: 'USD', cf_ref: 'abc' }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.allocations?.[0]?.customFields).toEqual({ ref: 'abc' })
  })

  it('normalizes cf:-prefixed keys into customFields', () => {
    const result = paymentCreateSchema.safeParse({
      ...SCOPE,
      amount: 10,
      currencyCode: 'USD',
      allocations: [{ orderId: ORDER_ID, amount: 10, currencyCode: 'USD', 'cf:ref': 'abc' }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.allocations?.[0]?.customFields).toEqual({ ref: 'abc' })
  })

  it('normalizes a customFields entries array ({key, value}[])', () => {
    const result = paymentCreateSchema.safeParse({
      ...SCOPE,
      amount: 10,
      currencyCode: 'USD',
      allocations: [
        { orderId: ORDER_ID, amount: 10, currencyCode: 'USD', customFields: [{ key: 'ref', value: 'abc' }] },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.allocations?.[0]?.customFields).toEqual({ ref: 'abc' })
  })
})
