import {
  autoFillOppositeAmount,
  deriveUnitPrices,
  formatMoney,
  grossFromNet,
  netFromGross,
  resolveCatalogPriceAmount,
  resolveLineDiscountDisplay,
  resolveAutoFillDecimalPlaces,
  resolveMoneyDecimalPlaces,
  roundAutoFilledAmount,
  roundMoney,
  toExactAmount,
} from '../lineItemUtils'

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

describe('exact money helpers', () => {
  it('formats a decimal string without passing it through a float', () => {
    expect(formatMoney('12345678901234567.89', 'USD', 'en-US')).toBe('$12,345,678,901,234,567.89')
    expect(formatMoney(110.7, 'USD', 'en-US')).toBe('$110.70')
    expect(formatMoney('0.123456789012345678', 'USD', 'en-US', 18)).toBe('$0.123456789012345678')
  })

  it('keeps two decimals without a currency, like before', () => {
    expect(formatMoney(110.7, null)).toBe('110.70')
    expect(formatMoney('1.005', undefined)).toBe('1.01')
  })

  it('reads amounts as exact decimal strings', () => {
    expect(toExactAmount('110.7000')).toBe('110.7')
    expect(toExactAmount(' 0.000000000000000001 ')).toBe('0.000000000000000001')
    expect(toExactAmount(12.5)).toBe('12.5')
    expect(toExactAmount('abc')).toBeNull()
    expect(toExactAmount(Number.NaN)).toBeNull()
    expect(toExactAmount(null)).toBeNull()
  })

  it('rounds to 4 decimals unless the source carries more', () => {
    expect(resolveMoneyDecimalPlaces('12.5')).toBe(4)
    expect(resolveMoneyDecimalPlaces('0.000000000000000001')).toBe(18)
    expect(roundMoney('81.30081300813')).toBe('81.3008')
    expect(roundMoney('0.00005')).toBe('0.0001')
  })

  it('converts between net and gross with exact decimal math', () => {
    expect(grossFromNet('90', 23)).toBe('110.7')
    expect(netFromGross('110.7', 23)).toBe('90')
    expect(grossFromNet('0.000000000000000001', 0)).toBe('0.000000000000000001')
    expect(netFromGross('100', 23)).toBe('81.3008')
    expect(grossFromNet('10.1234', 23)).toBe('12.4518')
    expect(netFromGross('1.230000000000000001', 23)).toBe('1.000000000000000001')
    expect(netFromGross('100', null)).toBe('100')
  })
})

describe('auto-filled dialog amounts', () => {
  it('rounds to the currency digits unless the typed source carries more', () => {
    expect(resolveAutoFillDecimalPlaces({ code: 'USD' }, '10.01')).toBe(2)
    expect(resolveAutoFillDecimalPlaces({ code: 'USD' }, '10.0001')).toBe(4)
    expect(resolveAutoFillDecimalPlaces({ code: 'JPY' }, '100')).toBe(0)
    expect(resolveAutoFillDecimalPlaces({ code: 'ETH' }, '0.000000000000000001')).toBe(18)
  })

  it('prefers the configured currency decimals over the ISO digits', () => {
    expect(resolveAutoFillDecimalPlaces({ code: 'ETH', decimalPlaces: 18 }, '1.5')).toBe(18)
    expect(resolveAutoFillDecimalPlaces({ code: 'USD', decimalPlaces: 3 }, '10.01')).toBe(3)
    expect(resolveAutoFillDecimalPlaces({ code: 'JPY', decimalPlaces: null }, '100')).toBe(0)
    expect(autoFillOppositeAmount('net', '1.5', 23, { code: 'ETH', decimalPlaces: 18 })).toBe('1.845000000000000000')
    expect(autoFillOppositeAmount('net', '1.5', 23, { code: 'ETH', decimalPlaces: 3 })).toBe('1.845')
  })

  it('keeps 4 decimals, or more from the source, for a code without known digits', () => {
    expect(resolveAutoFillDecimalPlaces({ code: 'ETH' }, '1.5')).toBe(4)
    expect(resolveAutoFillDecimalPlaces(null, '7')).toBe(4)
    expect(resolveAutoFillDecimalPlaces({ code: 'ETH' }, '1.123456')).toBe(6)
    expect(autoFillOppositeAmount('net', '1.5', 23, { code: 'ETH' })).toBe('1.8450')
  })

  it('fills the opposite of a typed net or gross amount at the currency precision', () => {
    expect(autoFillOppositeAmount('net', '10.01', 23, { code: 'USD' })).toBe('12.31')
    expect(autoFillOppositeAmount('gross', '12.31', 23, { code: 'USD' })).toBe('10.01')
    expect(autoFillOppositeAmount('net', '10', 23, { code: 'USD' })).toBe('12.30')
    expect(autoFillOppositeAmount('net', '1000', 23, { code: 'JPY' })).toBe('1230')
    expect(autoFillOppositeAmount('net', '10.0001', 23, { code: 'USD' })).toBe('12.3001')
    expect(autoFillOppositeAmount('net', '0.000000000000000001', 23, { code: 'ETH' })).toBe('0.000000000000000001')
    expect(autoFillOppositeAmount('net', '10.01', null, { code: 'USD' })).toBe('10.01')
  })

  it('rounds the exact value once instead of rounding a 4 decimal intermediate', () => {
    expect(grossFromNet('0.09', 5.5)).toBe('0.095')
    expect(autoFillOppositeAmount('net', '0.09', 5.5, { code: 'USD' })).toBe('0.09')
  })

  it('rounds a shipping amount from a fractional quantity to cents', () => {
    expect(roundAutoFilledAmount('15.015', { code: 'USD' }, '10.01')).toBe('15.02')
    expect(roundAutoFilledAmount('20.02', { code: 'USD' }, '10.01')).toBe('20.02')
  })
})

describe('unit prices derived in the line dialog', () => {
  it('keeps the default precision when no decimal places are passed', () => {
    expect(netFromGross('1', 23)).toBe('0.813')
    expect(netFromGross('1', 23, null)).toBe('0.813')
    expect(grossFromNet('1', 23, undefined)).toBe('1.23')
  })

  it('rounds the derived side to the requested decimal places', () => {
    expect(netFromGross('1', 23, 18)).toBe('0.813008130081300813')
    expect(grossFromNet('0.813008130081300813', 23, 18)).toBe('1')
    expect(netFromGross('100', 23, 2)).toBe('81.3008')
    expect(netFromGross('1.23456789', 23, 4)).toBe('1.00371373')
  })

  it('derives an 18 decimal currency line at its configured precision', () => {
    expect(deriveUnitPrices('gross', '1', 23, { code: 'ETH', decimalPlaces: 18 })).toEqual({
      unitPriceNet: '0.813008130081300813',
      unitPriceGross: '1',
    })
    expect(deriveUnitPrices('net', '0.813008130081300813', 23, { code: 'ETH', decimalPlaces: 18 })).toEqual({
      unitPriceNet: '0.813008130081300813',
      unitPriceGross: '1',
    })
  })

  it('never derives fewer than 4 decimals or fewer than the typed price carries', () => {
    expect(deriveUnitPrices('gross', '100', 23, { code: 'USD' })).toEqual({
      unitPriceNet: '81.3008',
      unitPriceGross: '100',
    })
    expect(deriveUnitPrices('gross', '100', 23, { code: 'JPY', decimalPlaces: 0 })).toEqual({
      unitPriceNet: '81.3008',
      unitPriceGross: '100',
    })
    expect(deriveUnitPrices('gross', '1.230000000001', 23, { code: 'USD', decimalPlaces: 2 })).toEqual({
      unitPriceNet: '1.000000000001',
      unitPriceGross: '1.230000000001',
    })
    expect(deriveUnitPrices('net', '90', null, { code: 'ETH', decimalPlaces: 18 })).toEqual({
      unitPriceNet: '90',
      unitPriceGross: '90',
    })
  })

  it('falls back to the ISO digits, then 4 decimals, when no configured precision is known', () => {
    expect(deriveUnitPrices('gross', '1', 23, { code: 'KWD' }).unitPriceNet).toBe('0.813')
    expect(deriveUnitPrices('gross', '1', 23, { code: 'XYZ' }).unitPriceNet).toBe('0.813')
    expect(deriveUnitPrices('gross', '1', 23, null).unitPriceNet).toBe('0.813')
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
    expect(resolveCatalogPriceAmount(10, null, 'net')).toBe('10')
    expect(resolveCatalogPriceAmount(null, '12.3', 'gross')).toBe('12.3')
  })

  it('uses the amount of the requested mode and falls back only when that amount is missing', () => {
    expect(resolveCatalogPriceAmount('10', '12.3', 'net')).toBe('10')
    expect(resolveCatalogPriceAmount('10', '12.3', 'gross')).toBe('12.3')
    expect(resolveCatalogPriceAmount(null, 12.3, 'net')).toBe('12.3')
    expect(resolveCatalogPriceAmount('10', undefined, 'gross')).toBe('10')
  })

  it('never substitutes the other mode for a zero amount, which would misprice the line', () => {
    expect(resolveCatalogPriceAmount(0, 12.3, 'net')).toBeNull()
    expect(resolveCatalogPriceAmount(10, 0, 'gross')).toBeNull()
  })
})
