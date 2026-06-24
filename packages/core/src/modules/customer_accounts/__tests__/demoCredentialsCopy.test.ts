/** @jest-environment node */

import path from 'path'
import fs from 'fs'

type LocaleMap = Record<string, string>

const LOCALES = ['en', 'pl', 'de', 'es'] as const

const moduleDir = path.join(__dirname, '..')

function loadLocale(locale: string): LocaleMap {
  const file = path.join(moduleDir, 'i18n', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LocaleMap
}

function readSeededAliceCredential(): { email: string; password: string } {
  const setup = fs.readFileSync(path.join(moduleDir, 'setup.ts'), 'utf8')
  const match = setup.match(
    /email:\s*'(alice\.johnson@example\.com)'[^}]*password:\s*'([^']+)'/,
  )
  if (!match) {
    throw new Error('Unable to locate seeded alice.johnson example credential in setup.ts')
  }
  return { email: match[1], password: match[2] }
}

describe('customer_accounts demo credential copy (regression for issue #3198)', () => {
  const seeded = readSeededAliceCredential()

  it('seeded example password uses the expected casing', () => {
    expect(seeded.password).toBe('Password123!')
  })

  describe.each(LOCALES)('locale: %s', (locale) => {
    it('portalInfo.credentials matches the seeded example password', () => {
      const localeMap = loadLocale(locale)
      const credentials = localeMap['customer_accounts.admin.portalInfo.credentials']
      expect(credentials).toBeTruthy()
      expect(credentials).toContain(seeded.email)
      expect(credentials).toContain(seeded.password)
    })
  })

  it('users page banner fallback copy matches the seeded example password', () => {
    const page = fs.readFileSync(
      path.join(moduleDir, 'backend', 'customer_accounts', 'users', 'page.tsx'),
      'utf8',
    )
    const match = page.match(
      /customer_accounts\.admin\.portalInfo\.credentials',\s*'([^']+)'/,
    )
    expect(match).toBeTruthy()
    const fallback = match![1]
    expect(fallback).toContain(seeded.email)
    expect(fallback).toContain(seeded.password)
  })
})
