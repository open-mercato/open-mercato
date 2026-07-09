/**
 * Regression coverage for #3953 — the invite-to-portal widget rendered
 * untranslated English text in non-English UIs. The `customer_accounts.widgets.invite.*`
 * keys existed only with English values in pl/es/de, and the widget's `description`
 * metadata was a hardcoded English sentence instead of an i18n key.
 *
 * This guard asserts that:
 *  - every invite key + the account-status description key is present in all locales,
 *  - the previously-untranslated keys now differ from English in every target locale,
 *  - the widget metadata `description` is a dotted i18n key that resolves in every locale.
 */
import fs from 'node:fs'
import path from 'node:path'
import widget from '../widget'

const I18N_DIR = path.resolve(__dirname, '../../../../i18n')
const LOCALES = ['en', 'pl', 'es', 'de'] as const
const TARGET_LOCALES = ['pl', 'es', 'de'] as const

const DESCRIPTION_KEY = 'customer_accounts.widgets.accountStatus.description'

const INVITE_KEYS = [
  'customer_accounts.widgets.invite.button',
  'customer_accounts.widgets.invite.displayName',
  'customer_accounts.widgets.invite.error.emailRequired',
  'customer_accounts.widgets.invite.error.failed',
  'customer_accounts.widgets.invite.error.roleRequired',
  'customer_accounts.widgets.invite.noRoles',
  'customer_accounts.widgets.invite.roles',
  'customer_accounts.widgets.invite.submit',
  'customer_accounts.widgets.invite.success',
]

// Keys whose translation is genuinely distinct from English in every target locale.
// (invite.roles is excluded: "Roles" is a valid Spanish spelling.)
const MUST_DIFFER_KEYS = [
  'customer_accounts.widgets.invite.button',
  'customer_accounts.widgets.invite.error.emailRequired',
  'customer_accounts.widgets.invite.error.failed',
  'customer_accounts.widgets.invite.error.roleRequired',
  'customer_accounts.widgets.invite.submit',
  'customer_accounts.widgets.invite.success',
  DESCRIPTION_KEY,
]

function loadLocale(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(I18N_DIR, `${locale}.json`), 'utf-8')
  return JSON.parse(raw) as Record<string, string>
}

const dictionaries = Object.fromEntries(LOCALES.map((locale) => [locale, loadLocale(locale)])) as Record<
  (typeof LOCALES)[number],
  Record<string, string>
>

describe('customer_accounts invite widget i18n (#3953)', () => {
  const allKeys = [...INVITE_KEYS, DESCRIPTION_KEY]

  it('defines every invite key and the description key in all locales', () => {
    for (const locale of LOCALES) {
      for (const key of allKeys) {
        expect(dictionaries[locale][key]).toBeTruthy()
      }
    }
  })

  it('translates the previously-untranslated keys away from English in every target locale', () => {
    for (const locale of TARGET_LOCALES) {
      for (const key of MUST_DIFFER_KEYS) {
        expect(dictionaries[locale][key]).not.toBe(dictionaries.en[key])
      }
    }
  })

  it('exposes the widget description as an i18n key that resolves in every locale', () => {
    expect(widget.metadata.description).toBe(DESCRIPTION_KEY)
    for (const locale of LOCALES) {
      expect(dictionaries[locale][DESCRIPTION_KEY]).toBeTruthy()
    }
  })
})
