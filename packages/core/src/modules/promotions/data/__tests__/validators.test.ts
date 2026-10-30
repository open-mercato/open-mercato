// QA F2 (High, confirmed live): `promotionUpdateSchema`/`promotionCodeUpdateSchema` were
// derived from a base shape whose fields carried their own `.default(...)`. Zod v4 still
// applies a field's own default when that key is omitted from the input, even once
// `.partial()` makes the key optional at the schema-container level — so an update body
// that omitted `active`/`tags`/etc. got those keys silently filled with CREATE-time
// defaults instead of staying `undefined`. Live repro: `PUT /api/promotions/{id}
// { id, eligibleCurrencies: ['USD'] }` also set `active=false` and `tags=[]` on a
// promotion that was previously active with tags. Mirrors the same assertions already
// proven for `customer_groups` in
// `customer_groups/api/customer-groups/__tests__/validators.test.ts`.

import {
  promotionCreateSchema,
  promotionUpdateSchema,
  promotionCodeCreateSchema,
  promotionCodeUpdateSchema,
  clearableEndOfDayDateSchema,
  ruleInputSchema,
  ruleInputSchemaFull,
  benefitInputSchema,
  PROMOTIONS_HIDDEN_RULE_TYPES,
  PROMOTIONS_HIDDEN_BENEFIT_TYPES,
} from '../validators'

const PROMOTION_ID = '11111111-1111-4111-8111-111111111111'
const CODE_ID = '22222222-2222-4222-8222-222222222222'

describe('promotion update schema', () => {
  it('does not inject create-time defaults into a partial promotion update (QA F2 live repro)', () => {
    const parsed = promotionUpdateSchema.parse({ id: PROMOTION_ID, eligibleCurrencies: ['USD'] })

    expect(parsed.active).toBeUndefined()
    expect(parsed.tags).toBeUndefined()
    expect(parsed.cumulative).toBeUndefined()
    expect(parsed.excludedTags).toBeUndefined()
    expect(parsed.excludeFlags).toBeUndefined()
    expect(parsed.eligibleCurrencies).toEqual(['USD'])
  })

  it('still carries explicitly sent flags on a promotion update', () => {
    const parsed = promotionUpdateSchema.parse({
      id: PROMOTION_ID,
      active: false,
      tags: [],
      cumulative: false,
      excludedTags: ['x'],
      excludeFlags: { gift: true },
    })

    expect(parsed.active).toBe(false)
    expect(parsed.tags).toEqual([])
    expect(parsed.cumulative).toBe(false)
    expect(parsed.excludedTags).toEqual(['x'])
    expect(parsed.excludeFlags).toEqual({ gift: true })
  })
})

describe('promotion create schema', () => {
  it('keeps the defaults on promotion create when omitted (regression guard)', () => {
    const parsed = promotionCreateSchema.parse({ name: 'X', order: 1 })

    expect(parsed.active).toBe(false)
    expect(parsed.cumulative).toBe(true)
    expect(parsed.tags).toEqual([])
    expect(parsed.excludedTags).toEqual([])
    expect(parsed.excludeFlags).toEqual({})
    expect(parsed.eligibleCurrencies).toEqual([])
  })
})

describe('promotion code update schema', () => {
  it('does not inject the create-time active default into a partial code update', () => {
    const parsed = promotionCodeUpdateSchema.parse({ id: CODE_ID, name: 'Renamed' })

    expect(parsed).toEqual({ id: CODE_ID, name: 'Renamed' })
    expect(Object.prototype.hasOwnProperty.call(parsed, 'active')).toBe(false)
  })

  it('still carries an explicitly sent active flag on a code update', () => {
    const parsed = promotionCodeUpdateSchema.parse({ id: CODE_ID, active: false })

    expect(parsed.active).toBe(false)
  })
})

describe('promotion code create schema', () => {
  it('keeps the active default on code create when omitted (regression guard)', () => {
    const parsed = promotionCodeCreateSchema.parse({
      name: 'Launch promo',
      type: 'static',
      code: 'LAUNCH10',
      usage: 'unlimited',
    })

    expect(parsed.active).toBe(true)
  })
})

describe('clearableEndOfDayDateSchema (QA F7)', () => {
  it('bumps a date-only string to 23:59:59.999 UTC of that same calendar day', () => {
    const parsed = clearableEndOfDayDateSchema.parse('2026-10-16')

    expect(parsed?.toISOString()).toBe('2026-10-16T23:59:59.999Z')
  })

  it('passes a full ISO timestamp through unchanged, preserving exact pre-existing semantics', () => {
    const parsed = clearableEndOfDayDateSchema.parse('2026-10-16T14:30:00.000Z')

    expect(parsed?.toISOString()).toBe('2026-10-16T14:30:00.000Z')
  })

  it('stays nullable for null and empty string, same as clearableDateSchema', () => {
    expect(clearableEndOfDayDateSchema.parse(null)).toBeNull()
    expect(clearableEndOfDayDateSchema.parse('')).toBeNull()
    expect(clearableEndOfDayDateSchema.parse(undefined)).toBeUndefined()
  })
})

describe('promotion code casing/charset normalization (QA F9 live repro)', () => {
  it('upper-cases a lowercase static code on create', () => {
    const parsed = promotionCodeCreateSchema.parse({
      name: 'Summer promo',
      type: 'static',
      code: 'summer10',
      usage: 'unlimited',
    })

    expect(parsed.code).toBe('SUMMER10')
  })

  it('upper-cases a lowercase prefix/suffix on create', () => {
    const parsed = promotionCodeCreateSchema.parse({
      name: 'Dynamic promo',
      type: 'dynamic',
      amount: 10,
      prefix: 'sum',
      suffix: 'end',
      usage: 'unlimited',
    })

    expect(parsed.prefix).toBe('SUM')
    expect(parsed.suffix).toBe('END')
  })

  it('upper-cases a lowercase code on a partial update', () => {
    const parsed = promotionCodeUpdateSchema.parse({ id: CODE_ID, code: 'summer10' })

    expect(parsed.code).toBe('SUMMER10')
  })

  it('rejects a code containing a space', () => {
    expect(() =>
      promotionCodeCreateSchema.parse({
        name: 'Summer promo',
        type: 'static',
        code: 'summer 10',
        usage: 'unlimited',
      }),
    ).toThrow()
  })

  it('rejects a code containing a symbol', () => {
    expect(() =>
      promotionCodeCreateSchema.parse({
        name: 'Summer promo',
        type: 'static',
        code: 'su#mmer',
        usage: 'unlimited',
      }),
    ).toThrow()
  })

  it('accepts a hyphen or underscore as a separator (real-world promo-code convention)', () => {
    const parsed = promotionCodeCreateSchema.parse({
      name: 'Summer promo',
      type: 'static',
      code: 'summer-2026_promo',
      usage: 'unlimited',
    })

    expect(parsed.code).toBe('SUMMER-2026_PROMO')
  })

  it('rejects a prefix/suffix containing a space or symbol', () => {
    const base = { name: 'Dynamic promo', type: 'dynamic' as const, amount: 10, usage: 'unlimited' as const }
    expect(() => promotionCodeCreateSchema.parse({ ...base, prefix: 'su mmer' })).toThrow()
    expect(() => promotionCodeCreateSchema.parse({ ...base, suffix: 'su#mmer' })).toThrow()
  })

  it('keeps null and omitted code/prefix/suffix valid (regression guard)', () => {
    const omitted = promotionCodeCreateSchema.parse({
      name: 'Dynamic promo',
      type: 'dynamic',
      amount: 10,
      usage: 'unlimited',
    })
    expect(omitted.code).toBeUndefined()
    expect(omitted.prefix).toBeUndefined()
    expect(omitted.suffix).toBeUndefined()

    const nulled = promotionCodeUpdateSchema.parse({ id: CODE_ID, code: null, prefix: null, suffix: null })
    expect(nulled.code).toBeNull()
    expect(nulled.prefix).toBeNull()
    expect(nulled.suffix).toBeNull()

    const emptyString = promotionCodeUpdateSchema.parse({ id: CODE_ID, code: '' })
    expect(emptyString.code).toBeNull()
  })
})

describe('promotionUpdateSchema endsAt (QA F7 live repro)', () => {
  it('stores a date-only endsAt as the end of that day, not the start', () => {
    const parsed = promotionUpdateSchema.parse({ id: PROMOTION_ID, endsAt: '2026-10-16' })

    expect(parsed.endsAt?.toISOString()).toBe('2026-10-16T23:59:59.999Z')
  })

  it('stores a date-only startsAt as the start of that day (unchanged behavior)', () => {
    const parsed = promotionUpdateSchema.parse({ id: PROMOTION_ID, startsAt: '2026-10-16' })

    expect(parsed.startsAt?.toISOString()).toBe('2026-10-16T00:00:00.000Z')
  })
})

describe('rule types without a data source', () => {
  const hiddenRules = [
    { ruleType: 'cart_weight', config: { value: '0.5', operator: 'gte' } },
    { ruleType: 'customer_order_history', config: { value: 1, operator: 'gte' } },
    { ruleType: 'product_attribute', config: { attributeCode: 'style_code', operator: 'eq', value: 'QA-STYLE' } },
  ]

  it.each(hiddenRules)('rejects a $ruleType rule on the write path', (rule) => {
    expect(PROMOTIONS_HIDDEN_RULE_TYPES).toContain(rule.ruleType)
    expect(ruleInputSchema.safeParse(rule).success).toBe(false)
  })

  it.each(hiddenRules)('keeps the $ruleType model in the full schema', (rule) => {
    expect(ruleInputSchemaFull.safeParse(rule).success).toBe(true)
  })
})

describe('delivery_method rule / delivery_discount benefit un-hidden (D-R5-17, amends D-R4-14)', () => {
  it('delivery_method is no longer in PROMOTIONS_HIDDEN_RULE_TYPES and is accepted on the write path', () => {
    expect(PROMOTIONS_HIDDEN_RULE_TYPES).not.toContain('delivery_method')
    const rule = { ruleType: 'delivery_method', config: { deliveryMethodCode: 'standard' } }
    expect(ruleInputSchema.safeParse(rule).success).toBe(true)
  })

  it('delivery_discount is no longer in PROMOTIONS_HIDDEN_BENEFIT_TYPES and is accepted on the write path', () => {
    expect(PROMOTIONS_HIDDEN_BENEFIT_TYPES).not.toContain('delivery_discount')
    const benefit = {
      benefitType: 'delivery_discount',
      appliesTo: 'order',
      config: { deliveryMethodCode: 'standard', discountType: 'percentage', value: '10', labels: { en: 'Free delivery' } },
    }
    expect(benefitInputSchema.safeParse(benefit).success).toBe(true)
  })

  it('rejects a delivery_discount with a quantity cap, same as cart_discount (both appliesTo: order only)', () => {
    const benefit = {
      benefitType: 'delivery_discount',
      appliesTo: 'order',
      config: {
        deliveryMethodCode: 'standard',
        discountType: 'percentage',
        value: '10',
        labels: { en: 'Free delivery' },
        maxQuantity: 5,
      },
    }
    expect(benefitInputSchema.safeParse(benefit).success).toBe(false)
  })
})
