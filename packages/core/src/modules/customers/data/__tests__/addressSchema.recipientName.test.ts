import { addressCreateSchema, addressUpdateSchema } from '../validators'

const BASE_CREATE_INPUT = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  entityId: '33333333-3333-4333-8333-333333333333',
  addressLine1: 'Baker Street 10',
}

describe('addressCreateSchema / addressUpdateSchema — recipientName + phone (Phase 3, #5232)', () => {
  it('accepts recipientName and phone on create', () => {
    const parsed = addressCreateSchema.parse({
      ...BASE_CREATE_INPUT,
      recipientName: 'Alice Smith',
      phone: '+48 600 100 200',
    })
    expect(parsed.recipientName).toBe('Alice Smith')
    expect(parsed.phone).toBe('+48 600 100 200')
  })

  it('leaves both optional — omitting them still validates', () => {
    const parsed = addressCreateSchema.parse(BASE_CREATE_INPUT)
    expect(parsed.recipientName).toBeUndefined()
    expect(parsed.phone).toBeUndefined()
  })

  it('accepts a partial update carrying only recipientName or only phone', () => {
    const id = '44444444-4444-4444-8444-444444444444'
    expect(addressUpdateSchema.parse({ id, recipientName: 'Bob' }).recipientName).toBe('Bob')
    expect(addressUpdateSchema.parse({ id, phone: '123' }).phone).toBe('123')
  })

  it('rejects a recipientName over the 200-char cap', () => {
    expect(() => addressCreateSchema.parse({
      ...BASE_CREATE_INPUT,
      recipientName: 'x'.repeat(201),
    })).toThrow()
  })

  it('rejects a phone over the 50-char cap', () => {
    expect(() => addressCreateSchema.parse({
      ...BASE_CREATE_INPUT,
      phone: 'x'.repeat(51),
    })).toThrow()
  })
})
