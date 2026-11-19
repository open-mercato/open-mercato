/**
 * Regression test for issue #9873.
 *
 * `localizeStoredCheckoutCustomerFields` re-resolves a stored built-in field label through the
 * active locale when the label still matches the untranslated default for its key, while
 * leaving anything an operator explicitly customized untouched.
 */
import {
  DEFAULT_CHECKOUT_CUSTOMER_FIELDS,
  localizeStoredCheckoutCustomerFieldLabel,
  localizeStoredCheckoutCustomerFields,
} from '../defaults'

const PL_LABELS: Record<string, string> = {
  firstName: 'Imię',
  lastName: 'Nazwisko',
  email: 'E-mail',
  phone: 'Telefon',
  companyName: 'Nazwa firmy',
  companyId: 'NIP / ID firmy',
  address: 'Adres',
}

function translateToPolish(key: string, fallback?: unknown): string {
  const match = key.match(/^checkout\.defaultCustomerFields\.([a-zA-Z]+)\.label$/)
  if (match && PL_LABELS[match[1]]) return PL_LABELS[match[1]]
  return typeof fallback === 'string' ? fallback : key
}

describe('localizeStoredCheckoutCustomerFieldLabel', () => {
  it('translates every built-in default label to the active locale', () => {
    for (const field of DEFAULT_CHECKOUT_CUSTOMER_FIELDS) {
      expect(localizeStoredCheckoutCustomerFieldLabel(field.key, field.label, translateToPolish))
        .toBe(PL_LABELS[field.key])
    }
  })

  it('leaves a customized label untouched even if it happens to match another default key’s text', () => {
    expect(localizeStoredCheckoutCustomerFieldLabel('firstName', 'Mobile number', translateToPolish))
      .toBe('Mobile number')
  })

  it('returns the label unchanged when no translate function is supplied', () => {
    expect(localizeStoredCheckoutCustomerFieldLabel('firstName', 'First name')).toBe('First name')
  })

  it('leaves a non-built-in custom field key untouched', () => {
    expect(localizeStoredCheckoutCustomerFieldLabel('customField1', 'Shoe size', translateToPolish))
      .toBe('Shoe size')
  })
})

describe('localizeStoredCheckoutCustomerFields', () => {
  it('localizes unmodified built-in fields while preserving a customized one', () => {
    const stored = [
      { key: 'firstName', label: 'First name' },
      { key: 'lastName', label: 'Last name' },
      { key: 'phone', label: 'Mobile number' },
      { key: 'companyName', label: 'Company name' },
      { key: 'companyId', label: 'Company ID' },
      { key: 'address', label: 'Address' },
    ]

    const localized = localizeStoredCheckoutCustomerFields(stored, translateToPolish)

    expect(localized.map((field) => field.label)).toEqual([
      'Imię',
      'Nazwisko',
      'Mobile number',
      'Nazwa firmy',
      'NIP / ID firmy',
      'Adres',
    ])
  })
})
