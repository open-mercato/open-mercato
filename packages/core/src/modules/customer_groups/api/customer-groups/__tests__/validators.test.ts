import {
  assortmentScopeSchema,
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

  it('leaves allowPurchaseOnAccount unset on terms create so it inherits', () => {
    const parsed = customerGroupTermsCreateSchema.parse({ tenantId: TENANT_ID, groupId: GROUP_ID })

    expect(parsed.allowPurchaseOnAccount).toBeUndefined()
  })

  it('accepts an explicit null allowPurchaseOnAccount on a terms update to go back to inheriting', () => {
    const parsed = customerGroupTermsUpdateSchema.parse({ id: GROUP_ID, allowPurchaseOnAccount: null })

    expect(parsed.allowPurchaseOnAccount).toBeNull()
  })
})

describe('customer group column bounds', () => {
  const INT4_MAX = 2147483647
  const NUMERIC_16_2_MAX = 99999999999999.99
  const groupInput = { tenantId: TENANT_ID, code: 'wholesale', name: 'Wholesale', kind: 'b2b' }

  it('accepts priorities down to the floor, including the negative placeholders adopt produces', () => {
    expect(customerGroupCreateSchema.safeParse({ ...groupInput, priority: -1000000000 }).success).toBe(true)
    expect(customerGroupCreateSchema.safeParse({ ...groupInput, priority: INT4_MAX }).success).toBe(true)
    expect(customerGroupUpdateSchema.safeParse({ id: GROUP_ID, tenantId: TENANT_ID, priority: -15 }).success).toBe(true)
  })

  it('rejects priorities outside the range that keeps reorder parking and adopt inside int4', () => {
    expect(customerGroupCreateSchema.safeParse({ ...groupInput, priority: INT4_MAX + 1 }).success).toBe(false)
    expect(customerGroupCreateSchema.safeParse({ ...groupInput, priority: -1000000001 }).success).toBe(false)
    expect(customerGroupCreateSchema.safeParse({ ...groupInput, priority: -2147483648 }).success).toBe(false)
    expect(customerGroupUpdateSchema.safeParse({ id: GROUP_ID, tenantId: TENANT_ID, priority: INT4_MAX + 1 }).success).toBe(false)
  })

  it('bounds paymentTermsDays to int4', () => {
    expect(customerGroupTermsUpdateSchema.safeParse({ id: GROUP_ID, paymentTermsDays: INT4_MAX }).success).toBe(true)
    expect(customerGroupTermsUpdateSchema.safeParse({ id: GROUP_ID, paymentTermsDays: INT4_MAX + 1 }).success).toBe(false)
  })

  it.each(['approvalRequiredAbove', 'minOrderValue', 'defaultCreditLimit'])(
    'bounds %s to numeric(16,2)',
    (field) => {
      expect(customerGroupTermsUpdateSchema.safeParse({ id: GROUP_ID, [field]: NUMERIC_16_2_MAX }).success).toBe(true)
      expect(customerGroupTermsUpdateSchema.safeParse({ id: GROUP_ID, [field]: '100000000000000' }).success).toBe(false)
      expect(customerGroupTermsCreateSchema.safeParse({ tenantId: TENANT_ID, groupId: GROUP_ID, [field]: 1e15 }).success).toBe(false)
    },
  )

  it('still rejects negative terms values', () => {
    expect(customerGroupTermsUpdateSchema.safeParse({ id: GROUP_ID, minOrderValue: -1 }).success).toBe(false)
    expect(customerGroupTermsUpdateSchema.safeParse({ id: GROUP_ID, paymentTermsDays: -1 }).success).toBe(false)
  })
})

describe('assortment scope schema', () => {
  const CATEGORY_ID = '33333333-3333-4333-8333-333333333333'
  const TAG_ID = '44444444-4444-4444-8444-444444444444'
  const PRODUCT_ID = '55555555-5555-4555-8555-555555555555'

  it('accepts every authored id list', () => {
    const scope = {
      categoryIds: [CATEGORY_ID],
      tagIds: [TAG_ID],
      excludeProductIds: [PRODUCT_ID],
      excludeCategoryIds: [CATEGORY_ID],
      excludeTagIds: [TAG_ID],
    }

    expect(assortmentScopeSchema.parse(scope)).toEqual(scope)
  })

  it('accepts null as unrestricted', () => {
    expect(assortmentScopeSchema.parse(null)).toBeNull()
  })

  it('accepts empty id lists', () => {
    expect(assortmentScopeSchema.parse({ categoryIds: [] })).toEqual({ categoryIds: [] })
  })

  it('rejects allOf on an authored scope', () => {
    expect(assortmentScopeSchema.safeParse({ allOf: [{ categoryIds: [CATEGORY_ID] }] }).success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(assortmentScopeSchema.safeParse({ categoryIds: [CATEGORY_ID], productIds: [PRODUCT_ID] }).success).toBe(false)
  })

  it('rejects non-uuid ids', () => {
    expect(assortmentScopeSchema.safeParse({ tagIds: ['not-a-uuid'] }).success).toBe(false)
    expect(assortmentScopeSchema.safeParse({ excludeProductIds: [42] }).success).toBe(false)
  })

  it('carries an assortment scope through terms create and update', () => {
    const scope = { categoryIds: [CATEGORY_ID] }

    expect(customerGroupTermsCreateSchema.parse({ tenantId: TENANT_ID, groupId: GROUP_ID, assortmentScope: scope }).assortmentScope).toEqual(scope)
    expect(customerGroupTermsUpdateSchema.parse({ id: GROUP_ID, assortmentScope: null }).assortmentScope).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(customerGroupTermsUpdateSchema.parse({ id: GROUP_ID }), 'assortmentScope')).toBe(false)
  })

  it('rejects a terms payload whose assortment scope carries allOf', () => {
    const result = customerGroupTermsCreateSchema.safeParse({
      tenantId: TENANT_ID,
      groupId: GROUP_ID,
      assortmentScope: { allOf: [] },
    })

    expect(result.success).toBe(false)
  })
})
