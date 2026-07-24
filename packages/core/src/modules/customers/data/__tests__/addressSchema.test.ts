import { addressCreateSchema, addressUpdateSchema } from '../validators'

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const ADDRESS_ID = '44444444-4444-4444-8444-444444444444'

const validCreateBase = {
  organizationId: ORGANIZATION_ID,
  tenantId: TENANT_ID,
  entityId: ENTITY_ID,
  addressLine1: '1 Test St',
}

describe('address coordinate validation — server-side range bounds', () => {
  it('accepts coordinates within range on create', () => {
    const parsed = addressCreateSchema.safeParse({ ...validCreateBase, latitude: 52.1875, longitude: 21 })
    expect(parsed.success).toBe(true)
  })

  it('rejects an out-of-range latitude on create (the non-UI persistence path is now hardened)', () => {
    const parsed = addressCreateSchema.safeParse({ ...validCreateBase, latitude: 9999, longitude: 21 })
    expect(parsed.success).toBe(false)
  })

  it('rejects an out-of-range longitude on create', () => {
    const parsed = addressCreateSchema.safeParse({ ...validCreateBase, latitude: 52, longitude: 1000 })
    expect(parsed.success).toBe(false)
  })

  it('allows null coordinates on create (clear-on-edit)', () => {
    const parsed = addressCreateSchema.safeParse({ ...validCreateBase, latitude: null, longitude: null })
    expect(parsed.success).toBe(true)
  })

  it('allows omitted coordinates on create', () => {
    const parsed = addressCreateSchema.safeParse(validCreateBase)
    expect(parsed.success).toBe(true)
  })

  it('rejects an out-of-range coordinate on update — bounds propagate through the partial merge', () => {
    const parsed = addressUpdateSchema.safeParse({ id: ADDRESS_ID, latitude: -91 })
    expect(parsed.success).toBe(false)
  })

  it('allows clearing coordinates to null on update', () => {
    const parsed = addressUpdateSchema.safeParse({ id: ADDRESS_ID, latitude: null, longitude: null })
    expect(parsed.success).toBe(true)
  })

  it('accepts an in-range coordinate update', () => {
    const parsed = addressUpdateSchema.safeParse({ id: ADDRESS_ID, latitude: -33.875, longitude: 18.4375 })
    expect(parsed.success).toBe(true)
  })
})
