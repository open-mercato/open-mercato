/**
 * Regression test for issue #5828.
 *
 * `parseDeltaInput` parsed the typed inventory delta with the JS global `Number()`, which
 * only accepts `.` as a decimal separator, so a fractional delta typed under a comma-decimal
 * application locale (Polish here) was silently ignored (the field is a live-typing buffer
 * that no-ops on an unparseable keystroke) — the same defect class #5827 fixed for the shared
 * `CrudForm`/`InjectedField` seams and the sales `LineItemDialog` while deliberately leaving
 * this dialog alone.
 *
 * The locale is pinned to `pl-PL` rather than left to the runner: CI resolves `C.UTF-8` to an
 * en-US ICU default, so an `en-US` pin passes on the buggy implementation too and a revert of
 * the locale-aware parse would stay green.
 */
import { parseDeltaInput } from '../AdjustInventoryDialog'

const TEST_LOCALE = 'pl-PL'

describe('AdjustInventoryDialog locale decimal separator (issue #5828)', () => {
  it('accepts the comma decimal separator', () => {
    expect(parseDeltaInput('2,5', TEST_LOCALE)).toBe(2.5)
    expect(parseDeltaInput('-2,5', TEST_LOCALE)).toBe(-2.5)
  })

  it('still accepts a dot, so the workaround users learned keeps working', () => {
    expect(parseDeltaInput('2.5', TEST_LOCALE)).toBe(2.5)
  })

  it('keeps the sign-only in-progress guard so typing "-" does not reset the field', () => {
    expect(parseDeltaInput('-', TEST_LOCALE)).toBeNull()
    expect(parseDeltaInput('+', TEST_LOCALE)).toBeNull()
    expect(parseDeltaInput('', TEST_LOCALE)).toBeNull()
  })

  it('rejects genuinely unparseable input', () => {
    expect(parseDeltaInput('abc', TEST_LOCALE)).toBeNull()
  })
})
