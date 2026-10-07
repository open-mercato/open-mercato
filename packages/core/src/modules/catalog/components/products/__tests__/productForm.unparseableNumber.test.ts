/**
 * Regression test for issue #6311.
 *
 * An unparseable UoM value (`abc`, or an ambiguous mixed-separator value such as `12.5,6`)
 * is left untouched by `withCanonicalUomFields`, so `productFormSchema` rejects it. The
 * rejection used to carry zod's raw English `Invalid input: expected number, received NaN`,
 * which reached the user verbatim because it is not a translation key. Every UoM number
 * field now reports the localized `catalog.products.validation.invalidNumber` key instead.
 */
import { BASE_INITIAL_VALUES, buildLocaleAwareProductFormSchema, productFormSchema, withCanonicalUomFields } from '../productForm'

const TEST_LOCALE = 'pl-PL'
const INVALID_NUMBER = 'catalog.products.validation.invalidNumber'

function issueMessagesFor(values: Record<string, unknown>, path: string): string[] {
  const parsed = buildLocaleAwareProductFormSchema(TEST_LOCALE).safeParse({
    ...BASE_INITIAL_VALUES,
    title: 'Test product',
    ...values,
  })
  if (parsed.success) return []
  return parsed.error.issues.filter((issue) => issue.path.join('.') === path).map((issue) => issue.message)
}

describe('productForm unparseable number input (issue #6311)', () => {
  it.each(['abc', '12.5,6', '10.9,5'])(
    'rejects %p in the default sales quantity with the localized invalid-number key',
    (raw) => {
      expect(issueMessagesFor({ defaultSalesUnitQuantity: raw }, 'defaultSalesUnitQuantity')).toEqual([INVALID_NUMBER])
    },
  )

  it('rejects an unparseable unit price base quantity with the localized invalid-number key', () => {
    expect(issueMessagesFor({ unitPriceBaseQuantity: 'abc' }, 'unitPriceBaseQuantity')).toEqual([INVALID_NUMBER])
  })

  it('rejects an unparseable conversion factor with the localized invalid-number key', () => {
    expect(
      issueMessagesFor(
        { unitConversions: [{ id: null, unitCode: 'kg', toBaseFactor: '12.5,6', sortOrder: '10', isActive: true }] },
        'unitConversions.0.toBaseFactor',
      ),
    ).toEqual([INVALID_NUMBER])
  })

  it('reports the same key through the plain schema the edit page validates with', () => {
    const parsed = productFormSchema.safeParse(
      withCanonicalUomFields({ ...BASE_INITIAL_VALUES, title: 'Test product', defaultSalesUnitQuantity: 'abc' }, TEST_LOCALE),
    )
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const issue = parsed.error.issues.find((entry) => entry.path.join('.') === 'defaultSalesUnitQuantity')
      expect(issue?.message).toBe(INVALID_NUMBER)
    }
  })

  it('still accepts a single comma or dot decimal separator', () => {
    expect(issueMessagesFor({ defaultSalesUnitQuantity: '2,5' }, 'defaultSalesUnitQuantity')).toEqual([])
    expect(issueMessagesFor({ defaultSalesUnitQuantity: '2.5' }, 'defaultSalesUnitQuantity')).toEqual([])
  })
})
