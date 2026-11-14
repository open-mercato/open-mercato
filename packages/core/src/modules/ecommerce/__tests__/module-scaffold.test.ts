import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { features } from '../acl'
import setup from '../setup'
import eventsConfig from '../events'
import { notificationTypes } from '../notifications'
import { ecommerceNotificationTypes } from '../notifications.client'

const locales = ['de', 'en', 'es', 'ko', 'pl']

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(__dirname, '..', 'i18n', `${locale}.json`), 'utf8'))
}

describe('ecommerce module scaffold', () => {
  it('namespaces every ACL feature under ecommerce and grants view to employees', () => {
    for (const feature of features) {
      expect(feature.id.startsWith('ecommerce.')).toBe(true)
    }
    expect(setup.defaultRoleFeatures?.admin).toEqual(['ecommerce.*'])
    expect(setup.defaultRoleFeatures?.superadmin).toEqual(['ecommerce.*'])
    expect(setup.defaultRoleFeatures?.employee).toEqual(['ecommerce.stores.view'])
  })

  it('declares the SPEC-029 §9.4 event ids', () => {
    const ids = eventsConfig.events.map((event) => event.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'ecommerce.store.created',
        'ecommerce.store.updated',
        'ecommerce.store.deleted',
        'ecommerce.store_domain_binding.created',
        'ecommerce.store_channel_binding.created',
        'ecommerce.store.branding_updated',
        'ecommerce.store.misconfigured',
        'ecommerce.assortment.empty_detected',
      ]),
    )
  })

  it('keeps server and client notification types aligned and translated in every locale', () => {
    expect(ecommerceNotificationTypes.map((type) => type.type)).toEqual(notificationTypes.map((type) => type.type))
    for (const locale of locales) {
      const messages = readLocale(locale)
      for (const type of notificationTypes) {
        expect(messages[type.titleKey]).toBeTruthy()
        expect(messages[type.bodyKey ?? '']).toBeTruthy()
      }
    }
  })
})
