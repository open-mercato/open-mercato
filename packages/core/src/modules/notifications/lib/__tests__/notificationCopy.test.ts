import {
  registerModules,
  registerAppDictionaryLoader,
  invalidateDictionaryCache,
} from '@open-mercato/shared/lib/i18n/server'
import { resolveNotificationCopy } from '../notificationCopy'

beforeEach(() => {
  registerAppDictionaryLoader(async () => ({}))
  registerModules([
    {
      translations: {
        en: { orders: { shipped: { title: 'Order {orderNumber} shipped', body: 'On its way' } } },
        pl: { orders: { shipped: { title: 'Zamówienie {orderNumber} wysłane', body: 'W drodze' } } },
      },
    },
  ] as never)
  invalidateDictionaryCache()
})

describe('resolveNotificationCopy', () => {
  it('translates title/body into the requested locale and interpolates variables', async () => {
    const { title, body } = await resolveNotificationCopy(
      {
        titleKey: 'orders.shipped.title',
        bodyKey: 'orders.shipped.body',
        titleVariables: { orderNumber: '42' },
        title: 'Order 42 shipped',
        body: 'On its way',
      },
      'pl',
    )
    expect(title).toBe('Zamówienie 42 wysłane')
    expect(body).toBe('W drodze')
  })

  it('falls back to the provided strings when a key is absent from the dictionary', async () => {
    const { title, body } = await resolveNotificationCopy(
      {
        titleKey: 'orders.unknown.title',
        bodyKey: null,
        titleVariables: { orderNumber: '7' },
        title: 'Fallback {orderNumber}',
        body: 'fallback body',
      },
      'pl',
    )
    expect(title).toBe('Fallback 7')
    expect(body).toBe('fallback body')
  })

  it('returns the raw strings when no i18n keys are provided', async () => {
    const { title, body } = await resolveNotificationCopy({ title: 'Plain', body: null })
    expect(title).toBe('Plain')
    expect(body).toBeNull()
  })
})
