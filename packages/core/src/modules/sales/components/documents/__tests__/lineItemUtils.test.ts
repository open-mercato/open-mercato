import { resolveCatalogPriceAmount, resolveLineDiscountDisplay } from '../lineItemUtils'

describe('resolveLineDiscountDisplay', () => {
  it('returns null when neither a discount amount nor a percentage is recorded', () => {
    expect(resolveLineDiscountDisplay({ discountAmount: 0, discountPercent: 0, unitPriceNet: 10, quantity: 3 })).toBeNull()
    expect(resolveLineDiscountDisplay({ unitPriceNet: 10, quantity: 3 })).toBeNull()
    expect(resolveLineDiscountDisplay({})).toBeNull()
  })

  it('treats absent and zero alike, and ignores negative values', () => {
    expect(resolveLineDiscountDisplay({ discountAmount: undefined, discountPercent: undefined })).toBeNull()
    expect(resolveLineDiscountDisplay({ discountAmount: null, discountPercent: null })).toBeNull()
    expect(resolveLineDiscountDisplay({ discountAmount: -5, discountPercent: -10 })).toBeNull()
  })

  it('reads numeric strings, which is how the numeric columns arrive on some drivers', () => {
    expect(
      resolveLineDiscountDisplay({
        discountAmount: '4.5000',
        discountPercent: '15.0000',
        unitPriceNet: '10.0000',
        quantity: '3',
      }),
    ).toEqual({ amount: 4.5, percent: 15 })
  })

  it('shows the amount alone when no percentage is recorded', () => {
    expect(
      resolveLineDiscountDisplay({ discountAmount: 4.5, discountPercent: 0, unitPriceNet: 10, quantity: 3 }),
    ).toEqual({ amount: 4.5, percent: null })
  })

  it('shows the percentage alongside the amount when it accounts for that amount', () => {
    expect(
      resolveLineDiscountDisplay({ discountAmount: 4.5, discountPercent: 15, unitPriceNet: 10, quantity: 3 }),
    ).toEqual({ amount: 4.5, percent: 15 })
  })

  it('suppresses the percentage when it does not account for the amount', () => {
    // discountAmount 5 was supplied per unit, so 15.00 is persisted for a 3 × 10.00 line
    // while discount_percent stays the raw 15 — 15% of that line is 4.50, not 15.00.
    expect(
      resolveLineDiscountDisplay({ discountAmount: 15, discountPercent: 15, unitPriceNet: 10, quantity: 3 }),
    ).toEqual({ amount: 15, percent: null })
  })

  it('suppresses the percentage when the line net cannot be reconstructed', () => {
    expect(resolveLineDiscountDisplay({ discountAmount: 4.5, discountPercent: 15 })).toEqual({
      amount: 4.5,
      percent: null,
    })
    expect(
      resolveLineDiscountDisplay({ discountAmount: 4.5, discountPercent: 15, unitPriceNet: 10, quantity: 0 }),
    ).toEqual({ amount: 4.5, percent: null })
  })

  it('absorbs per-unit rounding on large quantities instead of suppressing a valid percentage', () => {
    // 7% of 1000 × 0.4999 (a unit price rounded for storage) is 34.993, not the
    // persisted 35 — a percentage-driven line must not lose its percentage to that.
    expect(
      resolveLineDiscountDisplay({ discountAmount: 35, discountPercent: 7, unitPriceNet: 0.4999, quantity: 1000 }),
    ).toEqual({ amount: 35, percent: 7 })
  })

  it('shows the percentage as the primary value when no amount was resolved', () => {
    expect(
      resolveLineDiscountDisplay({ discountAmount: 0, discountPercent: 10, unitPriceNet: 100, quantity: 2 }),
    ).toEqual({ amount: null, percent: 10 })
  })
})

describe('resolveCatalogPriceAmount (issue #6075)', () => {
  it('returns null for a zero-only price, which line submission would reject', () => {
    expect(resolveCatalogPriceAmount(0, 0, 'gross')).toBeNull()
    expect(resolveCatalogPriceAmount(0, 0, 'net')).toBeNull()
    expect(resolveCatalogPriceAmount(null, null, 'gross')).toBeNull()
    expect(resolveCatalogPriceAmount(-5, Number.NaN, 'net')).toBeNull()
  })

  it('keeps net-only and gross-only positive prices selectable', () => {
    expect(resolveCatalogPriceAmount(10, null, 'net')).toBe(10)
    expect(resolveCatalogPriceAmount(null, 12.3, 'gross')).toBe(12.3)
  })

  it('uses the amount of the requested mode and falls back only when that amount is missing', () => {
    expect(resolveCatalogPriceAmount(10, 12.3, 'net')).toBe(10)
    expect(resolveCatalogPriceAmount(10, 12.3, 'gross')).toBe(12.3)
    expect(resolveCatalogPriceAmount(null, 12.3, 'net')).toBe(12.3)
    expect(resolveCatalogPriceAmount(10, undefined, 'gross')).toBe(10)
  })

  it('never substitutes the other mode for a zero amount, which would misprice the line', () => {
    expect(resolveCatalogPriceAmount(0, 12.3, 'net')).toBeNull()
    expect(resolveCatalogPriceAmount(10, 0, 'gross')).toBeNull()
  })
})
