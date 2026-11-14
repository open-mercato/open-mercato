/**
 * Regression test for issue #9430.
 *
 * The warranty auto-approve limit used a native `type=number` input and
 * `Number(amountText)` on submit. In Chromium under `pl-PL`, typing `150,5`
 * became `1505` before JS ran, so claims up to 1505 were auto-approved.
 *
 * The locale is pinned to `pl-PL` rather than left to the runner: CI resolves
 * `C.UTF-8` to an en-US ICU default, so an `en-US` pin would pass on the buggy
 * implementation too and a revert of the locale-aware parse would stay green.
 */
import { parseAutoApproveMaxAmount } from '../parseAutoApproveMaxAmount'

const TEST_LOCALE = 'pl-PL'

describe('parseAutoApproveMaxAmount locale decimal separator (issue #9430)', () => {
  it('parses the Polish decimal comma on amounts from the issue repro', () => {
    expect(parseAutoApproveMaxAmount('150,5', TEST_LOCALE)).toBe(150.5)
    expect(parseAutoApproveMaxAmount('15,99', TEST_LOCALE)).toBe(15.99)
    expect(parseAutoApproveMaxAmount('1234,56', TEST_LOCALE)).toBe(1234.56)
  })

  it('still accepts a dot, so the workaround users learned keeps working', () => {
    expect(parseAutoApproveMaxAmount('150.5', TEST_LOCALE)).toBe(150.5)
    expect(parseAutoApproveMaxAmount('15.99', TEST_LOCALE)).toBe(15.99)
    expect(parseAutoApproveMaxAmount('1234.56', 'en-US')).toBe(1234.56)
  })

  it('treats a blank field as "no limit" and rejects invalid input', () => {
    expect(parseAutoApproveMaxAmount('', TEST_LOCALE)).toBeNull()
    expect(parseAutoApproveMaxAmount('   ', TEST_LOCALE)).toBeNull()
    expect(parseAutoApproveMaxAmount('abc', TEST_LOCALE)).toBeNull()
    expect(parseAutoApproveMaxAmount('-1', TEST_LOCALE)).toBeNull()
  })
})
