import de from '../i18n/de.json'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'
import pl from '../i18n/pl.json'
import { notificationTypes } from '../notifications'

const dictionaries: Record<string, Record<string, string>> = { de, en, es, ko, pl }

describe('webhook notification catalogue', () => {
  it('uses a static delivery-failure label in every locale', () => {
    const deliveryFailed = notificationTypes.find((definition) => definition.type === 'webhooks.delivery.failed')

    expect(deliveryFailed).toMatchObject({
      labelKey: 'webhooks.notifications.delivery.failed.label',
      titleKey: 'webhooks.notifications.delivery.failed.title',
    })
    expect(deliveryFailed?.labelKey).not.toBe(deliveryFailed?.titleKey)

    for (const dictionary of Object.values(dictionaries)) {
      const label = dictionary[deliveryFailed?.labelKey ?? '']
      expect(label).toBeDefined()
      expect(label).not.toMatch(/\{[^}]+\}/)
      expect(label).not.toBe(deliveryFailed?.labelKey)
    }
  })
})
