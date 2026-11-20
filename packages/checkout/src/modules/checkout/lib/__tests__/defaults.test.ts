/**
 * Regression test for issue #9873.
 *
 * `localizeStoredCheckoutCustomerFields` re-resolves a stored built-in field label through the
 * active locale when the label still matches the untranslated default for its key, while
 * leaving anything an operator explicitly customized untouched.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  DEFAULT_CHECKOUT_CUSTOMER_FIELDS,
  SHIPPED_DEFAULT_CHECKOUT_CUSTOMER_FIELD_LABELS,
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

function translateToEnglish(key: string, fallback?: unknown): string {
  const match = key.match(/^checkout\.defaultCustomerFields\.([a-zA-Z]+)\.label$/)
  const field = match ? DEFAULT_CHECKOUT_CUSTOMER_FIELDS.find((candidate) => candidate.key === match[1]) : undefined
  if (field) return field.label
  return typeof fallback === 'string' ? fallback : key
}

describe('localized default labels snapshotted by a non-English merchant', () => {
  it('re-renders untouched Polish-created defaults in English for an English viewer', () => {
    for (const field of DEFAULT_CHECKOUT_CUSTOMER_FIELDS) {
      expect(localizeStoredCheckoutCustomerFieldLabel(field.key, PL_LABELS[field.key], translateToEnglish))
        .toBe(field.label)
    }
  })

  it('does not treat another key’s localized default as untouched', () => {
    expect(localizeStoredCheckoutCustomerFieldLabel('firstName', 'Nazwisko', translateToEnglish))
      .toBe('Nazwisko')
  })

  it('covers every shipped locale translation of each built-in label', () => {
    const i18nDir = path.resolve(__dirname, '../../i18n')
    const localeFiles = fs.readdirSync(i18nDir).filter((file) => file.endsWith('.json'))
    expect(localeFiles.length).toBeGreaterThan(1)
    for (const file of localeFiles) {
      const dictionary = JSON.parse(fs.readFileSync(path.join(i18nDir, file), 'utf8')) as Record<string, string>
      for (const field of DEFAULT_CHECKOUT_CUSTOMER_FIELDS) {
        const translated = dictionary[`checkout.defaultCustomerFields.${field.key}.label`]
        expect({ file, key: field.key, known: SHIPPED_DEFAULT_CHECKOUT_CUSTOMER_FIELD_LABELS[field.key]?.includes(translated) })
          .toEqual({ file, key: field.key, known: true })
      }
    }
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
