import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  buildLineUomInput,
  canConvertLineUnitPrices,
  isCarriedOverLineUnit,
  normalizeWithCarriedUnitFallback,
} from '../lineUomInput'

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

const storedServiceLine = {
  productId: null,
  quantity: 3,
  quantityUnit: 'h',
  normalizedQuantity: 3,
  normalizedUnit: 'h',
  uomSnapshot: null,
}

describe('buildLineUomInput', () => {
  it('keeps the unit and normalization when only the variant changes', () => {
    expect(buildLineUomInput({ productVariantId: VARIANT_2 }, storedBoxLine)).toMatchObject({
      productId: PRODUCT_A,
      productVariantId: VARIANT_2,
      quantityUnit: 'box',
      normalizedQuantity: 24,
      normalizedUnit: 'pc',
    })
  })

  it('carries the stored unit to a different product but drops the old normalization', () => {
    expect(buildLineUomInput({ productId: PRODUCT_B, productVariantId: null }, storedBoxLine)).toMatchObject({
      productId: PRODUCT_B,
      quantityUnit: 'box',
      normalizedQuantity: null,
      normalizedUnit: null,
      uomSnapshot: null,
    })
  })

  it('drops the product unit when the product is cleared', () => {
    expect(buildLineUomInput({ productId: null, productVariantId: null }, storedBoxLine)).toMatchObject({
      productId: null,
      quantityUnit: null,
      normalizedQuantity: null,
    })
  })

  it('keeps a free-text unit but recomputes the normalized quantity for a line without a product', () => {
    expect(buildLineUomInput({ quantity: 5 }, storedServiceLine)).toMatchObject({
      productId: null,
      quantity: 5,
      quantityUnit: 'h',
      normalizedQuantity: null,
      normalizedUnit: null,
    })
  })

  it('treats an explicit null unit as a clear', () => {
    expect(buildLineUomInput({ quantityUnit: null }, storedServiceLine).quantityUnit).toBeNull()
    expect(buildLineUomInput({ quantityUnit: null }, storedBoxLine).quantityUnit).toBeNull()
  })

  it('prefers the unit the caller sends', () => {
    expect(buildLineUomInput({ quantityUnit: 'pc' }, storedBoxLine).quantityUnit).toBe('pc')
  })
})

describe('isCarriedOverLineUnit', () => {
  it('flags a stored unit carried to a different product without an explicit unit', () => {
    expect(isCarriedOverLineUnit({ productId: PRODUCT_B }, storedBoxLine)).toBe(true)
    expect(isCarriedOverLineUnit({ productId: PRODUCT_A }, storedServiceLine)).toBe(true)
  })

  it('does not flag explicit units, unchanged products, cleared products or new lines', () => {
    expect(isCarriedOverLineUnit({ productId: PRODUCT_B, quantityUnit: 'pc' }, storedBoxLine)).toBe(false)
    expect(isCarriedOverLineUnit({ productVariantId: VARIANT_2 }, storedBoxLine)).toBe(false)
    expect(isCarriedOverLineUnit({ productId: null }, storedBoxLine)).toBe(false)
    expect(isCarriedOverLineUnit({ productId: PRODUCT_B }, null)).toBe(false)
  })
})

describe('normalizeWithCarriedUnitFallback', () => {
  const carried = buildLineUomInput({ productId: PRODUCT_B, productVariantId: null }, storedBoxLine)

  it('keeps the carried unit when the new product resolves it', async () => {
    const normalize = jest.fn(async (input: { quantityUnit: string | null }) => input.quantityUnit)

    const outcome = await normalizeWithCarriedUnitFallback(carried, true, normalize)

    expect(outcome.result).toBe('box')
    expect(outcome.lineUomInput.quantityUnit).toBe('box')
    expect(normalize).toHaveBeenCalledTimes(1)
  })

  it.each(['uom.conversion_not_found', 'uom.unit_not_found', 'uom.default_unit_missing'])(
    'falls back to the product default unit when the new product rejects the carried unit (%s)',
    async (code) => {
      const normalize = jest.fn(async (input: { quantityUnit: string | null }) => {
        if (input.quantityUnit === 'box') throw new CrudHttpError(400, { error: code })
        return input.quantityUnit
      })

      const outcome = await normalizeWithCarriedUnitFallback(carried, true, normalize)

      expect(outcome.result).toBeNull()
      expect(outcome.lineUomInput.quantityUnit).toBeNull()
      expect(normalize).toHaveBeenCalledTimes(2)
    },
  )

  it('rethrows when the unit was not carried over or the failure is unrelated', async () => {
    const reject = async () => {
      throw new CrudHttpError(400, { error: 'uom.conversion_not_found' })
    }
    await expect(normalizeWithCarriedUnitFallback(carried, false, reject)).rejects.toMatchObject({ status: 400 })

    const unrelated = async () => {
      throw new CrudHttpError(422, { error: 'uom.precision_overflow' })
    }
    await expect(normalizeWithCarriedUnitFallback(carried, true, unrelated)).rejects.toMatchObject({ status: 422 })
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

  it('never converts the price of a line without a product', () => {
    const parsed = { quantityUnit: 'day' }
    expect(canConvertLineUnitPrices(parsed, buildLineUomInput(parsed, storedServiceLine), storedServiceLine)).toBe(false)
  })

  it('does not convert a new line', () => {
    const parsed = { productId: PRODUCT_A, quantityUnit: 'box' }
    expect(canConvertLineUnitPrices(parsed, buildLineUomInput(parsed, null), null)).toBe(false)
  })
})
