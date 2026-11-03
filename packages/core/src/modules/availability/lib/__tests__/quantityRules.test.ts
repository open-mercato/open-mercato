import { deriveQuantityRules } from '../quantityRules'

const NO_FALLBACK = { minOrderQty: null, maxOrderQty: null, orderQtyIncrement: null }

describe('deriveQuantityRules', () => {
  it('reads all three quantity rules from the resolved policy when it sets them', () => {
    // Baseline from ecommerce's storefrontDetail.test.ts "reads quantity rules from the
    // resolved availability policy" — the product fallback (minOrderQty: 3) is present but
    // unused because the policy decides every field.
    const policy = {
      minOrderQuantity: { value: 2 },
      maxOrderQuantity: { value: 50 },
      quantityIncrement: { value: 2 },
    }
    const product = { minOrderQty: 3, maxOrderQty: null, orderQtyIncrement: null }

    expect(deriveQuantityRules(policy, product)).toEqual({
      minOrderQuantity: 2,
      maxOrderQuantity: 50,
      quantityIncrement: 2,
    })
  })

  it("falls back to the product's own order quantities where the policy sets none", () => {
    // Baseline from ecommerce's storefrontDetail.test.ts "falls back to the product order
    // quantities where the policy sets none".
    const policy = {
      minOrderQuantity: { value: null },
      maxOrderQuantity: { value: null },
      quantityIncrement: { value: null },
    }
    const product = { minOrderQty: 3, maxOrderQty: null, orderQtyIncrement: null }

    expect(deriveQuantityRules(policy, product)).toEqual({
      minOrderQuantity: 3,
      maxOrderQuantity: null,
      quantityIncrement: null,
    })
  })

  it('derives a minimum order quantity from the product when there is no policy', () => {
    const product = { ...NO_FALLBACK, minOrderQty: 5 }

    expect(deriveQuantityRules(null, product)).toEqual({
      minOrderQuantity: 5,
      maxOrderQuantity: null,
      quantityIncrement: null,
    })
  })

  it('derives a step/increment quantity from the product when there is no policy', () => {
    const product = { ...NO_FALLBACK, orderQtyIncrement: 4 }

    expect(deriveQuantityRules(undefined, product)).toEqual({
      minOrderQuantity: null,
      maxOrderQuantity: null,
      quantityIncrement: 4,
    })
  })

  it('derives a maximum order quantity from the product when there is no policy', () => {
    const product = { ...NO_FALLBACK, maxOrderQty: 20 }

    expect(deriveQuantityRules(null, product)).toEqual({
      minOrderQuantity: null,
      maxOrderQuantity: 20,
      quantityIncrement: null,
    })
  })

  it('derives the combination of all three from the product when there is no policy', () => {
    const product = { minOrderQty: 2, maxOrderQty: 24, orderQtyIncrement: 4 }

    expect(deriveQuantityRules(null, product)).toEqual({
      minOrderQuantity: 2,
      maxOrderQuantity: 24,
      quantityIncrement: 4,
    })
  })

  it('decides each field independently when the policy sets some but not others', () => {
    const policy = {
      minOrderQuantity: { value: 10 },
      // maxOrderQuantity omitted entirely — falls back to the product column.
      quantityIncrement: { value: null },
    }
    const product = { minOrderQty: 1, maxOrderQty: 30, orderQtyIncrement: 5 }

    expect(deriveQuantityRules(policy, product)).toEqual({
      minOrderQuantity: 10,
      maxOrderQuantity: 30,
      quantityIncrement: 5,
    })
  })

  it('coerces numeric-string product columns the way the decimal DB columns are stored', () => {
    const product = { minOrderQty: '3', maxOrderQty: '50', orderQtyIncrement: '2' }

    expect(deriveQuantityRules(null, product)).toEqual({
      minOrderQuantity: 3,
      maxOrderQuantity: 50,
      quantityIncrement: 2,
    })
  })
})
