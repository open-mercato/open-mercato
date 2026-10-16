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
