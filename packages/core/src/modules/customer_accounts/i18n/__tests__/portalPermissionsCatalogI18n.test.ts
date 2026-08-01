import fs from 'node:fs'
import path from 'node:path'

// Regression guard for issue #4203: the customer-role portal permission catalog
// (group headers, permission labels + descriptions, "Options" section and
// "Select all") is rendered via `t(key, englishFallback)` in
// backend/customer_accounts/roles/[id]/page.tsx. When a locale is missing those
// keys (or ships English placeholder values), the catalog silently renders in
// English while the surrounding form chrome is localized. This test asserts the
// keys exist and are actually translated in every non-English locale.

const I18N_DIR = path.join(__dirname, '..')
const REFERENCE_LOCALE = 'en'
const TARGET_LOCALES = ['pl', 'es', 'de'] as const

const GROUP_SCOPES = ['profile', 'orders', 'invoices', 'quotes', 'addresses', 'users']
const PORTAL_FEATURE_IDS = [
  'profile.view',
  'profile.edit',
  'orders.view',
  'orders.create',
  'invoices.view',
  'quotes.view',
  'quotes.request',
  'addresses.view',
  'addresses.manage',
  'users.view',
  'users.invite',
  'users.manage',
]

const featureKey = (id: string) => `customer_accounts.admin.portalFeatures.${id}`
const descriptionKey = (id: string) => `${featureKey(id)}.description`
const groupKey = (scope: string) => `customer_accounts.admin.portalFeatures.groups.${scope}`

const CATALOG_KEYS = [
  ...GROUP_SCOPES.map(groupKey),
  ...PORTAL_FEATURE_IDS.map(featureKey),
  ...PORTAL_FEATURE_IDS.map(descriptionKey),
  'customer_accounts.admin.roleDetail.selectAll',
  'customer_accounts.admin.roleDetail.sections.options',
]

function loadLocale(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(I18N_DIR, `${locale}.json`), 'utf8')
  return JSON.parse(raw) as Record<string, string>
}

describe('customer role portal permission catalog i18n (#4203)', () => {
  const reference = loadLocale(REFERENCE_LOCALE)

  it('defines every catalog key in the English baseline', () => {
    const missing = CATALOG_KEYS.filter((key) => typeof reference[key] !== 'string' || reference[key].length === 0)
    expect(missing).toEqual([])
  })

  for (const locale of TARGET_LOCALES) {
    describe(`${locale} locale`, () => {
      const dictionary = loadLocale(locale)

      it('defines every catalog key', () => {
        const missing = CATALOG_KEYS.filter((key) => typeof dictionary[key] !== 'string' || dictionary[key].length === 0)
        expect(missing).toEqual([])
      })

      it('translates every catalog key away from the English placeholder', () => {
        const untranslated = CATALOG_KEYS.filter((key) => dictionary[key] === reference[key])
        expect(untranslated).toEqual([])
      })
    })
  }
})
