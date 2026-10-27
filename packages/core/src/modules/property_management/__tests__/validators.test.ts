import { buildingCreateSchema, floorLayoutSchema, productUseSetSchema } from '../data/validators'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

describe('floorLayoutSchema', () => {
  it('accepts floors numbered from the counts', () => {
    const parsed = floorLayoutSchema.parse({
      below: 1,
      above: 3,
      floors: [-1, 0, 1, 2].map((number) => ({ number, name: `Floor ${number}`, sizeX: 42, sizeY: 18 })),
    })
    expect(parsed.floors).toHaveLength(4)
  })

  it('refuses a gap, a duplicate or a missing row', () => {
    const base = { below: 0, above: 2 }
    expect(floorLayoutSchema.safeParse({ ...base, floors: [{ number: 0, name: 'G', sizeX: 1, sizeY: 1 }, { number: 2, name: 'X', sizeX: 1, sizeY: 1 }] }).success).toBe(false)
    expect(floorLayoutSchema.safeParse({ ...base, floors: [{ number: 0, name: 'G', sizeX: 1, sizeY: 1 }, { number: 0, name: 'G', sizeX: 1, sizeY: 1 }] }).success).toBe(false)
    expect(floorLayoutSchema.safeParse({ ...base, floors: [{ number: 0, name: 'G', sizeX: 1, sizeY: 1 }] }).success).toBe(false)
  })

  it('requires at least the ground floor and a positive size', () => {
    expect(floorLayoutSchema.safeParse({ below: 0, above: 0, floors: [] }).success).toBe(false)
    expect(floorLayoutSchema.safeParse({ below: 0, above: 1, floors: [{ number: 0, name: 'G', sizeX: 0, sizeY: 5 }] }).success).toBe(false)
  })
})

describe('buildingCreateSchema', () => {
  it('requires a name, an address and a layout', () => {
    expect(buildingCreateSchema.safeParse({ ...scope, name: '', address: 'x', layout: { below: 0, above: 1, floors: [{ number: 0, name: 'G', sizeX: 1, sizeY: 1 }] } }).success).toBe(false)
    expect(buildingCreateSchema.safeParse({ ...scope, name: 'Cedar Hall', address: '1 Cedar St', layout: { below: 0, above: 1, floors: [{ number: 0, name: 'G', sizeX: 10, sizeY: 8 }] } }).success).toBe(true)
  })
})

describe('productUseSetSchema', () => {
  const productId = '33333333-3333-4333-8333-333333333333'

  it('bills leasable products per month and bookable ones per hour or day', () => {
    expect(productUseSetSchema.safeParse({ ...scope, catalogProductId: productId, use: 'leasable', billingUnit: 'month' }).success).toBe(true)
    expect(productUseSetSchema.safeParse({ ...scope, catalogProductId: productId, use: 'leasable', billingUnit: 'hour' }).success).toBe(false)
    expect(productUseSetSchema.safeParse({ ...scope, catalogProductId: productId, use: 'bookable', billingUnit: 'day' }).success).toBe(true)
    expect(productUseSetSchema.safeParse({ ...scope, catalogProductId: productId, use: 'bookable', billingUnit: 'month' }).success).toBe(false)
  })

  it('accepts a null use to clear the product', () => {
    expect(productUseSetSchema.safeParse({ ...scope, catalogProductId: productId, use: null }).success).toBe(true)
  })
})
