/** @jest-environment node */

import path from 'path'
import fs from 'fs'

type LocaleMap = Record<string, string>

const moduleDir = path.join(__dirname, '..')

function loadLocale(locale: string): LocaleMap {
  const file = path.join(moduleDir, 'i18n', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LocaleMap
}

// Keys rendered across the customer-portal Roles UI (list, create, detail/edit
// incl. the portal-permissions matrix, and the roles nav labels). Every entry
// here MUST be genuinely translated in German — byte-identical English values
// are the exact regression reported in issue #3669.
const GERMAN_TRANSLATED_ROLE_UI_KEYS = [
  'customer_accounts.admin.roles',
  'customer_accounts.admin.roles.actions.create',
  'customer_accounts.admin.roles.actions.delete',
  'customer_accounts.admin.roles.actions.edit',
  'customer_accounts.admin.roles.assignable',
  'customer_accounts.admin.roles.columns.customerAssignable',
  'customer_accounts.admin.roles.columns.description',
  'customer_accounts.admin.roles.columns.isDefault',
  'customer_accounts.admin.roles.confirm.delete',
  'customer_accounts.admin.roles.default',
  'customer_accounts.admin.roles.error.delete',
  // NOTE: `roles.error.deleteSystem` is translated in de.json too, but it is being
  // renamed to `roles.error.deleteDefault` in PR #3652, so it is intentionally not
  // pinned here to avoid a cross-PR test break once that rename lands.
  'customer_accounts.admin.roles.error.load',
  'customer_accounts.admin.roles.flash.deleted',
  'customer_accounts.admin.roles.notAssignable',
  'customer_accounts.admin.roles.searchPlaceholder',
  'customer_accounts.admin.roleCreate.actions.cancel',
  'customer_accounts.admin.roleCreate.actions.create',
  'customer_accounts.admin.roleCreate.actions.saving',
  'customer_accounts.admin.roleCreate.error.nameRequired',
  'customer_accounts.admin.roleCreate.error.required',
  'customer_accounts.admin.roleCreate.error.save',
  'customer_accounts.admin.roleCreate.error.slugFormat',
  'customer_accounts.admin.roleCreate.error.slugRequired',
  'customer_accounts.admin.roleCreate.fields.customerAssignable',
  'customer_accounts.admin.roleCreate.fields.description',
  'customer_accounts.admin.roleCreate.fields.isDefault',
  'customer_accounts.admin.roleCreate.fields.namePlaceholder',
  'customer_accounts.admin.roleCreate.fields.slugHint',
  'customer_accounts.admin.roleCreate.fields.slugPlaceholder',
  'customer_accounts.admin.roleCreate.flash.created',
  'customer_accounts.admin.roleCreate.sections.details',
  'customer_accounts.admin.roleCreate.sections.options',
  'customer_accounts.admin.roleCreate.title',
  'customer_accounts.admin.roleDetail.actions.backToList',
  'customer_accounts.admin.roleDetail.actions.cancel',
  'customer_accounts.admin.roleDetail.actions.delete',
  'customer_accounts.admin.roleDetail.actions.save',
  'customer_accounts.admin.roleDetail.actions.saving',
  'customer_accounts.admin.roleDetail.error.load',
  'customer_accounts.admin.roleDetail.error.notFound',
  'customer_accounts.admin.roleDetail.error.save',
  'customer_accounts.admin.roleDetail.error.saveAcl',
  'customer_accounts.admin.roleDetail.fields.customerAssignable',
  'customer_accounts.admin.roleDetail.fields.description',
  'customer_accounts.admin.roleDetail.fields.isDefault',
  'customer_accounts.admin.roleDetail.flash.saved',
  'customer_accounts.admin.roleDetail.loading',
  'customer_accounts.admin.roleDetail.sections.details',
  'customer_accounts.admin.roleDetail.sections.options',
  'customer_accounts.admin.roleDetail.sections.permissions',
  'customer_accounts.admin.roleDetail.selectAll',
  'customer_accounts.admin.portalFeatures.addresses.manage',
  'customer_accounts.admin.portalFeatures.addresses.view',
  'customer_accounts.admin.portalFeatures.groups.addresses',
  'customer_accounts.admin.portalFeatures.groups.invoices',
  'customer_accounts.admin.portalFeatures.groups.orders',
  'customer_accounts.admin.portalFeatures.groups.profile',
  'customer_accounts.admin.portalFeatures.groups.quotes',
  'customer_accounts.admin.portalFeatures.groups.users',
  'customer_accounts.admin.portalFeatures.invoices.view',
  'customer_accounts.admin.portalFeatures.orders.create',
  'customer_accounts.admin.portalFeatures.orders.view',
  'customer_accounts.admin.portalFeatures.profile.edit',
  'customer_accounts.admin.portalFeatures.profile.view',
  'customer_accounts.admin.portalFeatures.quotes.request',
  'customer_accounts.admin.portalFeatures.quotes.view',
  'customer_accounts.admin.portalFeatures.users.invite',
  'customer_accounts.admin.portalFeatures.users.manage',
  'customer_accounts.admin.portalFeatures.users.view',
  'customer_accounts.nav.role_create',
  'customer_accounts.nav.role_detail',
] as const

describe('customer_accounts German roles UI translations (regression for issue #3669)', () => {
  const en = loadLocale('en')
  const de = loadLocale('de')

  it.each(GERMAN_TRANSLATED_ROLE_UI_KEYS)('%s is present and translated to German', (key) => {
    expect(en[key]).toBeTruthy()
    expect(de[key]).toBeTruthy()
    expect(de[key]).not.toEqual(en[key])
  })

  it('preserves the {{name}} interpolation placeholder in the German delete confirmation', () => {
    expect(de['customer_accounts.admin.roles.confirm.delete']).toContain('{{name}}')
  })

  it('uses the expected German strings spotted in the issue screenshot', () => {
    expect(de['customer_accounts.admin.roles.error.delete']).toBe('Rolle konnte nicht gelöscht werden')
    expect(de['customer_accounts.admin.roles.error.load']).toBe('Rollen konnten nicht geladen werden')
    expect(de['customer_accounts.admin.roles.flash.deleted']).toBe('Rolle gelöscht')
    expect(de['customer_accounts.admin.roles.default']).toBe('Standard')
    expect(de['customer_accounts.admin.roles.notAssignable']).toBe('Nein')
  })
})
