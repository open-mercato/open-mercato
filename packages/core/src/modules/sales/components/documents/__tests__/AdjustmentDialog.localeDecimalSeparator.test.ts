/**
 * Regression test for issue #9430.
 *
 * The order/quote adjustment dialog parsed net and gross amounts with `Number()`,
 * which only accepts `.` as a decimal separator (and treats `15,99` as NaN). Under
 * a comma-decimal application locale (Polish here), a fixed amount of `15,99` was
 * computed and saved as 15, so 23% VAT produced gross 18.45 instead of 19.67.
 *
 * The locale is pinned to `pl-PL` rather than left to the runner: CI resolves
 * `C.UTF-8` to an en-US ICU default, so an `en-US` pin would pass on the buggy
 * implementation too and a revert of the locale-aware parse would stay green.
 */
import { parseAdjustmentNumber } from '../parseAdjustmentNumber'

const TEST_LOCALE = 'pl-PL'

describe('AdjustmentDialog locale decimal separator (issue #9430)', () => {
  it('parses the Polish decimal comma on net amounts from the issue repro', () => {
    expect(parseAdjustmentNumber('15,99', TEST_LOCALE)).toBe(15.99)
    expect(parseAdjustmentNumber('1234,56', TEST_LOCALE)).toBe(1234.56)
    expect(parseAdjustmentNumber('150,5', TEST_LOCALE)).toBe(150.5)
  })

  it('still accepts a dot, so the workaround users learned keeps working', () => {
    expect(parseAdjustmentNumber('15.99', TEST_LOCALE)).toBe(15.99)
    expect(parseAdjustmentNumber('1234.56', TEST_LOCALE)).toBe(1234.56)
    expect(parseAdjustmentNumber('150.5', 'en-US')).toBe(150.5)
  })

  it('leaves already-numeric API values unchanged', () => {
    expect(parseAdjustmentNumber(15.99, TEST_LOCALE)).toBe(15.99)
    expect(parseAdjustmentNumber(0, TEST_LOCALE)).toBe(0)
  })

  it('returns null for blank or unparseable input instead of a silent zero', () => {
    expect(parseAdjustmentNumber('', TEST_LOCALE)).toBeNull()
    expect(parseAdjustmentNumber('   ', TEST_LOCALE)).toBeNull()
    expect(parseAdjustmentNumber('abc', TEST_LOCALE)).toBeNull()
    expect(parseAdjustmentNumber(null, TEST_LOCALE)).toBeNull()
    expect(parseAdjustmentNumber(undefined, TEST_LOCALE)).toBeNull()
  })
})
