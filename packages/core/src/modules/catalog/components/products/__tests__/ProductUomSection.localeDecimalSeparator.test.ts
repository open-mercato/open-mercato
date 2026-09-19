/**
 * Regression test for issue #5828.
 *
 * `normalizeDecimalInput`/`toPositiveNumber` swapped `,` for `.` with a hard-coded
 * `value.replace(",", ".")`, which handles a plain `2,5` but breaks on grouped input such as
 * `1 234,56` — the swap does not remove the grouping character, so the resulting string still
 * fails `Number()`. #5827 fixed the same defect class for the shared `CrudForm`/`InjectedField`
 * seams and the sales `LineItemDialog` while deliberately leaving this section alone.
 *
 * The locale is pinned to `pl-PL` rather than left to the runner: CI resolves `C.UTF-8` to an
 * en-US ICU default, so an `en-US` pin passes on the buggy implementation too and a revert of
 * the locale-aware parse would stay green.
 */
import { normalizeDecimalInput, toPositiveNumber } from '../ProductUomSection'

const TEST_LOCALE = 'pl-PL'

describe('ProductUomSection locale decimal separator (issue #5828)', () => {
  describe('normalizeDecimalInput', () => {
    it('canonicalizes a comma-decimal value to a dot-decimal string', () => {
      expect(normalizeDecimalInput('2,5', TEST_LOCALE)).toBe('2.5')
    })

    it('strips locale grouping characters instead of leaving them in the string', () => {
      expect(normalizeDecimalInput('1 234,56', TEST_LOCALE)).toBe('1234.56')
    })

    it('keeps the raw value while it is not yet parseable, so the field stays editable', () => {
      expect(normalizeDecimalInput('-', TEST_LOCALE)).toBe('-')
      expect(normalizeDecimalInput('', TEST_LOCALE)).toBe('')
    })
  })

  describe('toPositiveNumber', () => {
    it('parses a comma-decimal value', () => {
      expect(toPositiveNumber('2,5', TEST_LOCALE)).toBe(2.5)
    })

    it('parses grouped input, unlike the previous hard-coded comma swap', () => {
      expect(toPositiveNumber('1 234,56', TEST_LOCALE)).toBe(1234.56)
    })

    it('still accepts a dot, so the workaround users learned keeps working', () => {
      expect(toPositiveNumber('2.5', TEST_LOCALE)).toBe(2.5)
    })

    it('rejects zero and negative values', () => {
      expect(toPositiveNumber('0', TEST_LOCALE)).toBeNull()
      expect(toPositiveNumber('-1', TEST_LOCALE)).toBeNull()
    })

    it('rejects unparseable input', () => {
      expect(toPositiveNumber('abc', TEST_LOCALE)).toBeNull()
    })
  })
})
