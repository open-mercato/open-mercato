/**
 * Regression test for issue #5828.
 *
 * `ProductUomSection`'s fields stay raw locale-typed text while being edited (issue #5828,
 * `ProductUomSection.localeDecimalSeparator.test.tsx`), so by the time the form submits,
 * `productFormSchema`'s `z.coerce.number()` fields (which only accept a dot decimal
 * separator) cannot parse them directly. `withCanonicalUomFields` converts them to a
 * canonical dot-decimal string right before validation, and `buildLocaleAwareProductFormSchema`
 * wraps the schema with that conversion so a page that hands `schema` straight to `CrudForm`
 * (rather than calling `.safeParse` by hand) still benefits from it.
 *
 * The locale is pinned to `pl-PL` rather than left to the runner: CI resolves `C.UTF-8` to an
 * en-US ICU default, so an `en-US` pin passes on the buggy implementation too and a revert of
 * the locale-aware parse would stay green.
 */
import { BASE_INITIAL_VALUES, withCanonicalUomFields, buildLocaleAwareProductFormSchema } from '../productForm'

const TEST_LOCALE = 'pl-PL'

describe('productForm locale decimal separator (issue #5828)', () => {
  describe('withCanonicalUomFields', () => {
    it('converts a comma-decimal default sales quantity to a canonical dot-decimal string', () => {
      const result = withCanonicalUomFields(
        { ...BASE_INITIAL_VALUES, defaultSalesUnitQuantity: '2,5' },
        TEST_LOCALE,
      )
      expect(result.defaultSalesUnitQuantity).toBe('2.5')
    })

    it('converts a comma-decimal unit price base quantity', () => {
      const result = withCanonicalUomFields(
        { ...BASE_INITIAL_VALUES, unitPriceBaseQuantity: '1,5' },
        TEST_LOCALE,
      )
      expect(result.unitPriceBaseQuantity).toBe('1.5')
    })

    it('converts grouped input in a conversion factor, unlike the previous hard-coded comma swap', () => {
      const result = withCanonicalUomFields(
        {
          ...BASE_INITIAL_VALUES,
          unitConversions: [
            { id: null, unitCode: 'kg', toBaseFactor: '1 234,56', sortOrder: '10', isActive: true },
          ],
        },
        TEST_LOCALE,
      )
      expect(result.unitConversions[0].toBaseFactor).toBe('1234.56')
    })

    it('leaves an unparseable value untouched so the schema still reports its own error', () => {
      const result = withCanonicalUomFields(
        { ...BASE_INITIAL_VALUES, defaultSalesUnitQuantity: 'abc' },
        TEST_LOCALE,
      )
      expect(result.defaultSalesUnitQuantity).toBe('abc')
    })
  })

  describe('buildLocaleAwareProductFormSchema', () => {
    it('accepts a comma-decimal UoM payload that the plain schema would reject', () => {
      const schema = buildLocaleAwareProductFormSchema(TEST_LOCALE)
      const parsed = schema.safeParse({
        ...BASE_INITIAL_VALUES,
        title: 'Test product',
        defaultSalesUnitQuantity: '2,5',
        unitConversions: [
          { id: null, unitCode: 'kg', toBaseFactor: '12,5', sortOrder: '10', isActive: true },
        ],
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.defaultSalesUnitQuantity).toBe(2.5)
        expect(parsed.data.unitConversions?.[0]?.toBaseFactor).toBe(12.5)
      }
    })
  })
})
