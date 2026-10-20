/**
 * Regression test for issue #6309.
 *
 * After a save the edit page merges the submitted, canonical dot-decimal UoM strings back into
 * the visible form, so a Polish user who typed `2,5` saw `2.5` as soon as the save landed.
 * `withLocaleUomFields` is the inverse of `withCanonicalUomFields`: it renders those strings
 * in the locale's decimal separator again.
 *
 * The locale is pinned to `pl-PL`: CI resolves `C.UTF-8` to an en-US ICU default, so leaving
 * it to the runner would let a revert stay green.
 */
import { BASE_INITIAL_VALUES, withCanonicalUomFields, withLocaleUomFields } from '../productForm'

const TEST_LOCALE = 'pl-PL'

describe('withLocaleUomFields (issue #6309)', () => {
  it('renders canonical UoM numbers with the locale decimal comma', () => {
    const result = withLocaleUomFields(
      {
        ...BASE_INITIAL_VALUES,
        defaultSalesUnitQuantity: '2.5',
        unitPriceBaseQuantity: '1.5',
        unitConversions: [
          { id: null, unitCode: 'kg', toBaseFactor: '1234.56', sortOrder: '10', isActive: true },
        ],
      },
      TEST_LOCALE,
    )
    expect(result.defaultSalesUnitQuantity).toBe('2,5')
    expect(result.unitPriceBaseQuantity).toBe('1,5')
    expect(result.unitConversions[0].toBaseFactor).toBe('1234,56')
  })

  it('keeps the dot under a dot-decimal locale', () => {
    const result = withLocaleUomFields(
      { ...BASE_INITIAL_VALUES, defaultSalesUnitQuantity: '2.5' },
      'en-US',
    )
    expect(result.defaultSalesUnitQuantity).toBe('2.5')
  })

  it('leaves blank and unparseable values untouched', () => {
    const result = withLocaleUomFields(
      { ...BASE_INITIAL_VALUES, defaultSalesUnitQuantity: 'abc', unitPriceBaseQuantity: '' },
      TEST_LOCALE,
    )
    expect(result.defaultSalesUnitQuantity).toBe('abc')
    expect(result.unitPriceBaseQuantity).toBe('')
  })

  it('round-trips with withCanonicalUomFields', () => {
    const typed = { ...BASE_INITIAL_VALUES, defaultSalesUnitQuantity: '12,5' }
    const redisplayed = withLocaleUomFields(withCanonicalUomFields(typed, TEST_LOCALE), TEST_LOCALE)
    expect(redisplayed.defaultSalesUnitQuantity).toBe('12,5')
  })
})
