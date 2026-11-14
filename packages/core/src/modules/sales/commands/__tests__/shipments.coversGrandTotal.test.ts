import { coversGrandTotal } from '../shipments'

describe('coversGrandTotal', () => {
  it('treats a legacy total one 4th-decimal unit short as settled', () => {
    expect(coversGrandTotal('99.9999', '100.0000')).toBe(true)
    expect(coversGrandTotal('99.9998', '100.0000')).toBe(false)
  })

  it('narrows the tolerance for totals with more decimals', () => {
    expect(coversGrandTotal('0.999999999999999999', '1.000000000000000000')).toBe(true)
    expect(coversGrandTotal('0.999999999999999998', '1.000000000000000000')).toBe(false)
    expect(coversGrandTotal('0.9999', '1')).toBe(true)
    expect(coversGrandTotal('0.999999999999999999', '1.000000000000000001')).toBe(false)
    expect(coversGrandTotal('1.000000000000000000', '1.000000000000000001')).toBe(true)
  })

  it('uses the currency amount precision instead of 4 decimals for crypto totals', () => {
    expect(coversGrandTotal('1.4999', '1.5', 18)).toBe(false)
    expect(coversGrandTotal('1.499999999999999999', '1.5', 18)).toBe(true)
    expect(coversGrandTotal('1.499999999999999998', '1.5', 18)).toBe(false)
    expect(coversGrandTotal('1.5', '1.5', 18)).toBe(true)
  })

  it('keeps the 4th decimal tolerance for fiat currencies', () => {
    expect(coversGrandTotal('1.4999', '1.5', 4)).toBe(true)
    expect(coversGrandTotal('1.4998', '1.5', 4)).toBe(false)
  })
})
