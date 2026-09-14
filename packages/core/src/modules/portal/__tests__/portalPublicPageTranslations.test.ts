/** @jest-environment node */

import path from 'path'
import fs from 'fs'

type LocaleMap = Record<string, string>

const moduleDir = path.join(__dirname, '..')

function loadLocale(locale: string): LocaleMap {
  const file = path.join(moduleDir, 'i18n', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LocaleMap
}

// The three <PortalFeatureCard> elements on the unauthenticated landing page
// (frontend/[orgSlug]/portal/page.tsx). Shipped byte-identical to English in
// pl/de/es until issue #5429.
const LANDING_FEATURE_KEYS = [
  'portal.landing.feature.account',
  'portal.landing.feature.account.description',
  'portal.landing.feature.orders',
  'portal.landing.feature.orders.description',
  'portal.landing.feature.security',
  'portal.landing.feature.security.description',
] as const

// The invitation-acceptance page (frontend/[orgSlug]/portal/invite/page.tsx)
// and its nav label. pl was already translated; de/es shipped English.
const INVITE_FLOW_KEYS = [
  'portal.invite.backToLogin',
  'portal.invite.confirmPassword',
  'portal.invite.description',
  'portal.invite.displayName',
  'portal.invite.error.displayNameRequired',
  'portal.invite.error.generic',
  'portal.invite.error.invalidToken',
  'portal.invite.error.noToken',
  'portal.invite.error.passwordMismatch',
  'portal.invite.error.passwordTooShort',
  'portal.invite.loginLink',
  'portal.invite.password',
  'portal.invite.submit',
  'portal.invite.submitting',
  'portal.invite.title',
  'portal.nav.invite',
] as const

// Values that are legitimately identical to English and MUST stay that way:
// the masked-password placeholders are typographic, not prose.
const INTENTIONALLY_IDENTICAL_KEYS = [
  'portal.invite.confirmPassword.placeholder',
  'portal.invite.password.placeholder',
  'portal.resetPassword.confirmPassword.placeholder',
  'portal.resetPassword.password.placeholder',
] as const

const TRANSLATED_LOCALES = ['pl', 'de', 'es'] as const

describe('portal unauthenticated-page translations (regression for issue #5429)', () => {
  const en = loadLocale('en')

  describe.each(TRANSLATED_LOCALES)('%s', (locale) => {
    const dict = loadLocale(locale)

    it.each(LANDING_FEATURE_KEYS)('landing card %s is translated', (key) => {
      expect(en[key]).toBeTruthy()
      expect(dict[key]).toBeTruthy()
      expect(dict[key]).not.toEqual(en[key])
    })

    it('keeps key parity with the English baseline', () => {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort())
    })

    it.each(INTENTIONALLY_IDENTICAL_KEYS)('leaves the masked placeholder %s untranslated', (key) => {
      expect(dict[key]).toEqual(en[key])
    })
  })

  describe.each(['de', 'es'] as const)('%s invitation flow', (locale) => {
    const dict = loadLocale(locale)

    it.each(INVITE_FLOW_KEYS)('%s is translated', (key) => {
      expect(en[key]).toBeTruthy()
      expect(dict[key]).toBeTruthy()
      expect(dict[key]).not.toEqual(en[key])
    })
  })

  it('reuses the terminology already established elsewhere in each file', () => {
    const de = loadLocale('de')
    const es = loadLocale('es')

    expect(de['portal.invite.password']).toEqual(de['portal.login.password'])
    expect(es['portal.invite.password']).toEqual(es['portal.login.password'])
    expect(de['portal.invite.error.passwordMismatch']).toEqual(de['portal.resetPassword.error.passwordMismatch'])
    expect(es['portal.invite.error.passwordMismatch']).toEqual(es['portal.resetPassword.error.passwordMismatch'])
    expect(de['portal.invite.displayName']).toEqual(de['portal.signup.displayName'])
    expect(es['portal.invite.displayName']).toEqual(es['portal.signup.displayName'])
  })

  it('preserves the ellipsis in the in-progress invitation label', () => {
    for (const locale of ['pl', 'de', 'es'] as const) {
      expect(loadLocale(locale)['portal.invite.submitting']).toContain('…')
    }
  })
})
