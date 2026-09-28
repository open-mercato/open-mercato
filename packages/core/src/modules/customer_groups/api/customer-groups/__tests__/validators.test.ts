import {
  customerGroupCreateSchema,
  customerGroupTermsCreateSchema,
  customerGroupTermsUpdateSchema,
  customerGroupUpdateSchema,
} from '../../../data/validators'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'

describe('customer group update schemas', () => {
  it('does not inject create-time defaults into a partial group update', () => {
    const parsed = customerGroupUpdateSchema.parse({ id: GROUP_ID, tenantId: TENANT_ID, name: 'Renamed' })

    expect(parsed).toEqual({ id: GROUP_ID, tenantId: TENANT_ID, name: 'Renamed' })
    expect(Object.prototype.hasOwnProperty.call(parsed, 'isDefault')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(parsed, 'isActive')).toBe(false)
  })

  it('still carries explicitly sent flags on a group update', () => {
    const parsed = customerGroupUpdateSchema.parse({ id: GROUP_ID, tenantId: TENANT_ID, isDefault: true, isActive: false })

    expect(parsed.isDefault).toBe(true)
    expect(parsed.isActive).toBe(false)
  })

  it('keeps the defaults on group create', () => {
    const parsed = customerGroupCreateSchema.parse({
      tenantId: TENANT_ID,
      code: 'wholesale',
      name: 'Wholesale',
      kind: 'b2b',
      priority: 10,
    })

    expect(parsed.isDefault).toBe(false)
    expect(parsed.isActive).toBe(true)
  })

  it('does not inject allowPurchaseOnAccount into a partial terms update', () => {
    const parsed = customerGroupTermsUpdateSchema.parse({ id: GROUP_ID, paymentTermsDays: 30 })

    expect(parsed).toEqual({ id: GROUP_ID, paymentTermsDays: 30 })
    expect(Object.prototype.hasOwnProperty.call(parsed, 'allowPurchaseOnAccount')).toBe(false)
  })

  it('keeps the allowPurchaseOnAccount default on terms create', () => {
    const parsed = customerGroupTermsCreateSchema.parse({ tenantId: TENANT_ID, groupId: GROUP_ID })

    expect(parsed.allowPurchaseOnAccount).toBe(false)
  })
})
