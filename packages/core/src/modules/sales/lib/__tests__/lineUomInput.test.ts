import { buildLineUomInput, canConvertLineUnitPrices } from '../lineUomInput'

const PRODUCT_A = '11111111-1111-4111-8111-111111111111'
const PRODUCT_B = '22222222-2222-4222-8222-222222222222'
const VARIANT_1 = '33333333-3333-4333-8333-333333333333'
const VARIANT_2 = '44444444-4444-4444-8444-444444444444'

const storedBoxLine = {
  productId: PRODUCT_A,
  productVariantId: VARIANT_1,
  quantity: 2,
  quantityUnit: 'box',
  normalizedQuantity: 24,
  normalizedUnit: 'pc',
  uomSnapshot: null,
}

describe('buildLineUomInput', () => {
  it('keeps the unit and normalization when only the variant changes', () => {
    const input = buildLineUomInput({ productVariantId: VARIANT_2 }, storedBoxLine)

    expect(input).toMatchObject({
      productId: PRODUCT_A,
      productVariantId: VARIANT_2,
      quantityUnit: 'box',
      normalizedQuantity: 24,
      normalizedUnit: 'pc',
    })
  })

  it('drops the previous product unit data when the product changes', () => {
    const input = buildLineUomInput({ productId: PRODUCT_B, productVariantId: null }, storedBoxLine)

    expect(input).toMatchObject({ productId: PRODUCT_B, quantityUnit: null, normalizedQuantity: null, uomSnapshot: null })
  })

  it('keeps a free-text unit but recomputes the normalized quantity for a line without a product', () => {
    const storedServiceLine = {
      productId: null,
      quantity: 3,
      quantityUnit: 'h',
      normalizedQuantity: 3,
      normalizedUnit: 'h',
      uomSnapshot: null,
    }

    const input = buildLineUomInput({ quantity: 5 }, storedServiceLine)

    expect(input).toMatchObject({ productId: null, quantity: 5, quantityUnit: 'h', normalizedQuantity: null, normalizedUnit: null })
  })

  it('prefers the unit the caller sends', () => {
    expect(buildLineUomInput({ quantityUnit: 'pc' }, storedBoxLine).quantityUnit).toBe('pc')
  })
})

describe('canConvertLineUnitPrices', () => {
  it('converts when the caller changes the unit of the same product', () => {
    const parsed = { quantityUnit: 'pc' }
    expect(canConvertLineUnitPrices(parsed, buildLineUomInput(parsed, storedBoxLine), storedBoxLine)).toBe(true)
  })

  it('does not convert on a variant-only change without a unit', () => {
    const parsed = { productVariantId: VARIANT_2 }
    expect(canConvertLineUnitPrices(parsed, buildLineUomInput(parsed, storedBoxLine), storedBoxLine)).toBe(false)
  })

  it('does not convert when the product changes, even with an explicit unit', () => {
    const parsed = { productId: PRODUCT_B, quantityUnit: 'pc' }
    expect(canConvertLineUnitPrices(parsed, buildLineUomInput(parsed, storedBoxLine), storedBoxLine)).toBe(false)
  })

  it('does not convert a new line', () => {
    const parsed = { productId: PRODUCT_A, quantityUnit: 'box' }
    expect(canConvertLineUnitPrices(parsed, buildLineUomInput(parsed, null), null)).toBe(false)
  })
})
