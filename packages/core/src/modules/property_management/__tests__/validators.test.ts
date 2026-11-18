import { buildingCreateSchema, floorLayoutSchema, floorUpdateSchema, hasCentimetrePrecision, productUseSetSchema, unitUpdateSchema } from '../data/validators'

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

describe('metre fields', () => {
  const id = '44444444-4444-4444-8444-444444444444'

  it('accepts centimetre values, including ones that are inexact in binary', () => {
    for (const value of [0.01, 0.1, 0.29, 12.34, 1.005 + 0.005, 99999.99]) expect(hasCentimetrePrecision(value)).toBe(true)
    const parsed = unitUpdateSchema.parse({ ...scope, id, x: '0.07', y: 3.1, width: 0.01, depth: 99999.99 })
    expect(parsed).toMatchObject({ x: 0.07, y: 3.1, width: 0.01, depth: 99999.99 })
  })

  it('refuses more than two decimal places with a translatable message instead of storing a rounded value', () => {
    const result = unitUpdateSchema.safeParse({ ...scope, id, x: 1.005, width: 2.5 })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['x'], message: 'property_management.errors.metresPrecision' })])
    expect(floorUpdateSchema.safeParse({ ...scope, id, sizeX: 10.123 }).success).toBe(false)
  })

  it('requires a length of at least one centimetre', () => {
    expect(unitUpdateSchema.safeParse({ ...scope, id, width: 0.004 }).success).toBe(false)
    expect(unitUpdateSchema.safeParse({ ...scope, id, width: 0 }).success).toBe(false)
    expect(unitUpdateSchema.safeParse({ ...scope, id, width: 0.01 }).success).toBe(true)
    expect(floorLayoutSchema.safeParse({ below: 0, above: 1, floors: [{ number: 0, name: 'G', sizeX: 0.004, sizeY: 5 }] }).success).toBe(false)
  })
})
