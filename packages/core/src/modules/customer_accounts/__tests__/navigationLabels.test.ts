/** @jest-environment node */

import path from 'path'
import fs from 'fs'

import { metadata as customerMetaUsers } from '../backend/customer_accounts/users/page.meta'
import { metadata as customerMetaRoles } from '../backend/customer_accounts/roles/page.meta'
import { metadata as authMetaUsers } from '../../auth/backend/users/page.meta'
import { metadata as authMetaRoles } from '../../auth/backend/roles/page.meta'

type LocaleMap = Record<string, string>

const LOCALES = ['en', 'pl', 'de', 'es'] as const

function loadLocale(moduleDir: string, locale: string): LocaleMap {
  const file = path.join(moduleDir, 'i18n', `${locale}.json`)
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw) as LocaleMap
}

const customerAccountsDir = path.join(__dirname, '..')
const authDir = path.join(__dirname, '..', '..', 'auth')

describe('customer_accounts sidebar labels (regression for issue #1551)', () => {
  describe.each(LOCALES)('locale: %s', (locale) => {
    let customerLocale: LocaleMap
    let authLocale: LocaleMap

    beforeAll(() => {
      customerLocale = loadLocale(customerAccountsDir, locale)
      authLocale = loadLocale(authDir, locale)
    })

    it('customer_accounts.nav.users label differs from auth.nav.users', () => {
      const customerLabel = customerLocale['customer_accounts.nav.users']
      const authLabel = authLocale['auth.nav.users']
      expect(customerLabel).toBeTruthy()
      expect(authLabel).toBeTruthy()
      expect(customerLabel).not.toEqual(authLabel)
    })

    it('customer_accounts.nav.roles label differs from auth.nav.roles', () => {
      const customerLabel = customerLocale['customer_accounts.nav.roles']
      const authLabel = authLocale['auth.nav.roles']
      expect(customerLabel).toBeTruthy()
      expect(authLabel).toBeTruthy()
      expect(customerLabel).not.toEqual(authLabel)
    })
  })

  it('customer_accounts users page metadata uses distinct English pageTitle from auth', () => {
    expect(customerMetaUsers.pageTitle).toBeTruthy()
    expect(authMetaUsers.pageTitle).toBeTruthy()
    expect(customerMetaUsers.pageTitle).not.toEqual(authMetaUsers.pageTitle)
  })

  it('customer_accounts roles page metadata uses distinct English pageTitle from auth', () => {
    expect(customerMetaRoles.pageTitle).toBeTruthy()
    expect(authMetaRoles.pageTitle).toBeTruthy()
    expect(customerMetaRoles.pageTitle).not.toEqual(authMetaRoles.pageTitle)
  })

  it('customer_accounts and auth users pages live in different sidebar groups', () => {
    expect(customerMetaUsers.pageGroupKey).not.toEqual(authMetaUsers.pageGroupKey)
  })

  it('customer_accounts and auth roles pages live in different sidebar groups', () => {
    expect(customerMetaRoles.pageGroupKey).not.toEqual(authMetaRoles.pageGroupKey)
  })
})
