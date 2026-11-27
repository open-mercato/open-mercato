/** @jest-environment node */

import path from 'path'
import fs from 'fs'
import { EXAMPLE_PORTAL_ACCOUNTS, isPublicExamplePortalCredential, resolveExamplePortalSeedPassword } from '@open-mercato/core/modules/customer_accounts/lib/exampleAccounts'

type LocaleMap = Record<string, string>

const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

const moduleDir = path.join(__dirname, '..')

function loadLocale(locale: string): LocaleMap {
  const file = path.join(moduleDir, 'i18n', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LocaleMap
}

function readFileInModule(...segments: string[]): string {
  return fs.readFileSync(path.join(moduleDir, ...segments), 'utf8')
}

describe('customer_accounts demo credential copy (regressions for issues #3198 and #5669)', () => {
  const alice = EXAMPLE_PORTAL_ACCOUNTS.find((account) => account.email === 'alice.johnson@example.com')

  it('keeps the seeded example account list intact', () => {
    expect(alice).toBeDefined()
    expect(alice!.password).toBe('Password123!')
  })

  it('requires an explicitly supplied production demo password and excludes public credentials', () => {
    expect(resolveExamplePortalSeedPassword(alice!, { NODE_ENV: 'production' })).toBeUndefined()
    expect(() => resolveExamplePortalSeedPassword(alice!, {
      NODE_ENV: 'production',
      OM_INIT_PORTAL_DEMO_PASSWORD: alice!.password,
    })).toThrow('OM_INIT_PORTAL_DEMO_PASSWORD')
    const operatorPassword = 'test-only-supplied-strong-demo-password'
    expect(resolveExamplePortalSeedPassword(alice!, {
      NODE_ENV: 'production',
      OM_INIT_PORTAL_DEMO_PASSWORD: operatorPassword,
    })).toBe(operatorPassword)
    expect(resolveExamplePortalSeedPassword(alice!, { NODE_ENV: 'development' })).toBe(alice!.password)
    const replacedEnv = jest.replaceProperty(process, 'env', { NODE_ENV: 'production' })
    try {
      expect(isPublicExamplePortalCredential(alice!.email, alice!.password)).toBe(true)
      expect(isPublicExamplePortalCredential(alice!.email, operatorPassword)).toBe(false)
      expect(isPublicExamplePortalCredential('other@example.test', alice!.password)).toBe(false)
    } finally {
      replacedEnv.restore()
    }
  })

  it('seeds portal example users from the shared account list rather than an inline copy (#3198)', () => {
    const setup = readFileInModule('setup.ts')
    expect(setup).toContain('EXAMPLE_PORTAL_ACCOUNTS')
    // An inline seed array is exactly the drift that let the advertised password
    // diverge from the seeded one; the shared constant is the only source now.
    expect(setup).not.toMatch(/const exampleUsers\s*=/)
    expect(setup).not.toContain('alice.johnson@example.com')
  })

  describe.each(LOCALES)('locale: %s', (locale) => {
    it('parametrizes portalInfo.credentials instead of hardcoding an account (#5669)', () => {
      const localeMap = loadLocale(locale)
      const credentials = localeMap['customer_accounts.admin.portalInfo.credentials']
      expect(credentials).toBeTruthy()
      expect(credentials).toContain('{email}')
      expect(credentials).toContain('{password}')
      for (const account of EXAMPLE_PORTAL_ACCOUNTS) {
        expect(credentials).not.toContain(account.email)
        expect(credentials).not.toContain(account.password)
      }
    })

    it('describes the demo credentials as created by example-data seeding (#5669)', () => {
      const localeMap = loadLocale(locale)
      const note = localeMap['customer_accounts.settings.demo_credentials.note']
      expect(note).toBeTruthy()
      expect(localeMap['customer_accounts.settings.demo_credentials.no_role']).toBeTruthy()
    })
  })

  it('renders the users page banner credentials only for accounts that exist in the organization (#5669)', () => {
    const page = readFileInModule('backend', 'customer_accounts', 'users', 'PortalUsersPageClient.tsx')
    expect(page).toContain('useDemoPortalAccounts')
    for (const account of EXAMPLE_PORTAL_ACCOUNTS) {
      expect(page).not.toContain(account.email)
      expect(page).not.toContain(account.password)
    }
  })

  it('renders the settings demo table only for accounts that exist in the organization (#5669)', () => {
    const page = readFileInModule('backend', 'customer_accounts', 'settings', 'CustomerAccountsSettingsPageClient.tsx')
    expect(page).toContain('useDemoPortalAccounts')
    for (const account of EXAMPLE_PORTAL_ACCOUNTS) {
      expect(page).not.toContain(account.email)
      expect(page).not.toContain(account.password)
    }
  })
})
