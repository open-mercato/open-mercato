import {
  buildPackageLineInputs,
  resolveCartPackage,
  type CartLinePeerRow,
  type CatalogWeightDimensionsRow,
} from '../cartLinesPeer'
import {
  CHECKOUT_DEFAULT_PACKAGE_HEIGHT_CM,
  CHECKOUT_DEFAULT_PACKAGE_LENGTH_CM,
  CHECKOUT_DEFAULT_PACKAGE_WEIGHT_KG,
  CHECKOUT_DEFAULT_PACKAGE_WIDTH_CM,
} from '../constants'

describe('resolveCartPackage (C13 §5.3)', () => {
  it('returns the single-parcel default for an empty cart', () => {
    expect(resolveCartPackage([])).toEqual({
      weightKg: CHECKOUT_DEFAULT_PACKAGE_WEIGHT_KG,
      lengthCm: CHECKOUT_DEFAULT_PACKAGE_LENGTH_CM,
      widthCm: CHECKOUT_DEFAULT_PACKAGE_WIDTH_CM,
      heightCm: CHECKOUT_DEFAULT_PACKAGE_HEIGHT_CM,
    })
  })

  it('sums weight across quantity, per line', () => {
    const result = resolveCartPackage([
      { quantity: '2', weightKg: 1.5, lengthCm: 10, widthCm: 10, heightCm: 10 },
      { quantity: '1', weightKg: 2, lengthCm: 10, widthCm: 10, heightCm: 10 },
    ])
    expect(result.weightKg).toBeCloseTo(2 * 1.5 + 2)
  })

  it('contributes the single-parcel default when a line has no catalog weight/dimensions', () => {
    const result = resolveCartPackage([{ quantity: '1', weightKg: null, lengthCm: null, widthCm: null, heightCm: null }])
    expect(result).toEqual({
      weightKg: CHECKOUT_DEFAULT_PACKAGE_WEIGHT_KG,
      lengthCm: CHECKOUT_DEFAULT_PACKAGE_LENGTH_CM,
      widthCm: CHECKOUT_DEFAULT_PACKAGE_WIDTH_CM,
      heightCm: CHECKOUT_DEFAULT_PACKAGE_HEIGHT_CM,
    })
  })

  it('takes the largest single-unit dimension across lines (bounding box), never sums dimensions', () => {
    const result = resolveCartPackage([
      { quantity: '1', weightKg: 1, lengthCm: 40, widthCm: 15, heightCm: 5 },
      { quantity: '1', weightKg: 1, lengthCm: 20, widthCm: 25, heightCm: 8 },
    ])
    expect(result.lengthCm).toBe(40)
    expect(result.widthCm).toBe(25)
    expect(result.heightCm).toBe(8)
  })
})

describe('buildPackageLineInputs', () => {
  const line = (overrides: Partial<CartLinePeerRow> = {}): CartLinePeerRow => ({
    lineId: 'line-1',
    productId: 'product-1',
    variantId: null,
    quantity: '1',
    unitPriceNet: '10.00',
    unitPriceGross: '12.00',
    ...overrides,
  })

  it('reads weight/dimensions off the product when there is no variant', () => {
    const products: CatalogWeightDimensionsRow[] = [
      { id: 'product-1', weightValue: '2.5', weightUnit: 'kg', dimensions: { width: 20, height: 10, depth: 30, unit: 'cm' } },
    ]
    const [input] = buildPackageLineInputs([line()], products, [])
    expect(input.weightKg).toBe(2.5)
    expect(input.lengthCm).toBe(30)
    expect(input.widthCm).toBe(20)
    expect(input.heightCm).toBe(10)
  })

  it('prefers the variant weight/dimensions over the product when both exist', () => {
    const products: CatalogWeightDimensionsRow[] = [
      { id: 'product-1', weightValue: '2.5', weightUnit: 'kg', dimensions: { width: 20, height: 10, depth: 30, unit: 'cm' } },
    ]
    const variants: CatalogWeightDimensionsRow[] = [
      { id: 'variant-1', weightValue: '500', weightUnit: 'g', dimensions: { width: 5, height: 5, depth: 5, unit: 'cm' } },
    ]
    const [input] = buildPackageLineInputs([line({ variantId: 'variant-1' })], products, variants)
    expect(input.weightKg).toBe(0.5)
    expect(input.lengthCm).toBe(5)
  })

  it('converts non-metric units to kg/cm', () => {
    const products: CatalogWeightDimensionsRow[] = [
      { id: 'product-1', weightValue: '2', weightUnit: 'lb', dimensions: { width: 10, height: 10, depth: 10, unit: 'in' } },
    ]
    const [input] = buildPackageLineInputs([line()], products, [])
    expect(input.weightKg).toBeCloseTo(2 * 0.45359237)
    expect(input.lengthCm).toBeCloseTo(25.4)
  })

  it('returns nulls (default-eligible) when no catalog row matches the line', () => {
    const [input] = buildPackageLineInputs([line()], [], [])
    expect(input.weightKg).toBeNull()
    expect(input.lengthCm).toBeNull()
  })
})
