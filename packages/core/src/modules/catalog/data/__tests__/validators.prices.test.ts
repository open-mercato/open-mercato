import { priceCreateSchema, priceUpdateSchema } from '../validators'

const scope = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
}

const basePrice = {
  ...scope,
  productId: '44444444-4444-4444-8444-444444444444',
  currencyCode: 'USD',
  priceKindId: '55555555-5555-4555-8555-555555555555',
}

describe('price cross-field validators', () => {
  it('accepts a full payload with a quantity tier and validity window', () => {
    const result = priceCreateSchema.safeParse({
      ...basePrice,
      minQuantity: 10,
      maxQuantity: 50,
      unitPriceNet: '9.99',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-12-31T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('allows an open-ended maxQuantity ("and above")', () => {
    const result = priceCreateSchema.safeParse({
      ...basePrice,
      minQuantity: 10,
    })
    expect(result.success).toBe(true)
  })

  it('allows an open-ended endsAt (no expiry)', () => {
    const result = priceCreateSchema.safeParse({
      ...basePrice,
      startsAt: '2026-01-01T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects maxQuantity below minQuantity on create and update', () => {
    const createResult = priceCreateSchema.safeParse({
      ...basePrice,
      minQuantity: 10,
      maxQuantity: 5,
    })
    expect(createResult.success).toBe(false)
    if (!createResult.success) {
      expect(createResult.error.issues[0]?.path).toEqual(['maxQuantity'])
    }

    const updateResult = priceUpdateSchema.safeParse({
      id: '66666666-6666-4666-8666-666666666666',
      minQuantity: 10,
      maxQuantity: 5,
    })
    expect(updateResult.success).toBe(false)
  })

  it('rejects endsAt before startsAt on create and update', () => {
    const createResult = priceCreateSchema.safeParse({
      ...basePrice,
      startsAt: '2026-12-31T00:00:00.000Z',
      endsAt: '2026-01-01T00:00:00.000Z',
    })
    expect(createResult.success).toBe(false)
    if (!createResult.success) {
      expect(createResult.error.issues[0]?.path).toEqual(['endsAt'])
    }

    const updateResult = priceUpdateSchema.safeParse({
      id: '66666666-6666-4666-8666-666666666666',
      startsAt: '2026-12-31T00:00:00.000Z',
      endsAt: '2026-01-01T00:00:00.000Z',
    })
    expect(updateResult.success).toBe(false)
  })

  it('still allows partial updates that touch neither quantity nor date fields', () => {
    const result = priceUpdateSchema.safeParse({
      id: '66666666-6666-4666-8666-666666666666',
      unitPriceNet: '12.50',
    })
    expect(result.success).toBe(true)
  })
})
