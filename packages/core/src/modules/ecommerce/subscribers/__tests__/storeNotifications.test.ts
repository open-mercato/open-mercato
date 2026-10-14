import { notifyStoreManagers, storeNotificationGroupKey } from '../../lib/storeNotifications'
import type { EcommerceSubscriberContext } from '../../lib/subscriberSupport'
import misconfiguredHandler, { metadata as misconfiguredMetadata } from '../store-notifications'
import assortmentHandler, { metadata as assortmentMetadata } from '../assortment-empty-notifications'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'

function createCtx(services: Record<string, unknown>, overrides: Partial<EcommerceSubscriberContext> = {}): EcommerceSubscriberContext {
  return {
    resolve: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`not registered: ${name}`)
      return services[name] as T
    },
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    ...overrides,
  }
}

function createNotificationService() {
  return { createForFeature: jest.fn(async () => []) }
}

describe('ecommerce store notification subscribers', () => {
  it('declares persistent subscriptions to the two misconfiguration events', () => {
    expect(misconfiguredMetadata).toMatchObject({ event: 'ecommerce.store.misconfigured', persistent: true })
    expect(assortmentMetadata).toMatchObject({ event: 'ecommerce.assortment.empty_detected', persistent: true })
  })

  it('notifies store managers about a missing default channel binding', async () => {
    const notificationService = createNotificationService()
    await misconfiguredHandler(
      { id: 'store-1', storeId: 'store-1', tenantId: TENANT_ID, organizationId: ORG_ID, reason: 'channel_binding_missing' },
      createCtx({ notificationService }),
    )
    expect(notificationService.createForFeature).toHaveBeenCalledTimes(1)
    const [input, scope] = notificationService.createForFeature.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>]
    expect(input).toMatchObject({
      type: 'ecommerce.store.channel_binding_missing',
      requiredFeature: 'ecommerce.stores.manage',
      sourceModule: 'ecommerce',
      sourceEntityType: 'ecommerce:ecommerce_store',
      sourceEntityId: 'store-1',
      linkHref: '/backend/config/ecommerce/store-1',
      restrictRecipientsToOrganization: true,
      titleKey: 'ecommerce.notifications.store.channelBindingMissing.title',
    })
    expect(typeof input.groupKey).toBe('string')
    expect(String(input.groupKey).startsWith('store-1:')).toBe(true)
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('notifies store managers about an empty assortment without leaking buyer data', async () => {
    const notificationService = createNotificationService()
    await assortmentHandler(
      { id: 'store-1', storeId: 'store-1', channelBindingId: 'binding-1', assortmentScopeHash: 'hash', tenantId: TENANT_ID, organizationId: ORG_ID },
      createCtx({ notificationService }),
    )
    const [input] = notificationService.createForFeature.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(input).toMatchObject({
      type: 'ecommerce.store.assortment_empty',
      requiredFeature: 'ecommerce.stores.manage',
      sourceEntityId: 'store-1',
    })
    expect(input.bodyVariables).toBeUndefined()
  })

  it('dedupes per store and UTC hour through the notification group key', async () => {
    const notificationService = createNotificationService()
    const ctx = createCtx({ notificationService })
    const payload = { storeId: 'store-1', tenantId: TENANT_ID, organizationId: ORG_ID }
    await notifyStoreManagers(payload, ctx, 'ecommerce.store.channel_binding_missing', new Date('2026-10-05T10:05:00Z'))
    await notifyStoreManagers(payload, ctx, 'ecommerce.store.channel_binding_missing', new Date('2026-10-05T10:55:00Z'))
    await notifyStoreManagers(payload, ctx, 'ecommerce.store.channel_binding_missing', new Date('2026-10-05T11:00:00Z'))
    const keys = notificationService.createForFeature.mock.calls.map(
      (call) => (call as unknown as [{ groupKey: string }])[0].groupKey,
    )
    expect(keys).toEqual(['store-1:2026-10-05T10', 'store-1:2026-10-05T10', 'store-1:2026-10-05T11'])
    expect(storeNotificationGroupKey('store-2', new Date('2026-10-05T10:05:00Z'))).toBe('store-2:2026-10-05T10')
  })

  it('uses the trusted emitter scope over payload scope', async () => {
    const notificationService = createNotificationService()
    await misconfiguredHandler(
      { storeId: 'store-1', tenantId: 'tenant-spoofed', organizationId: 'org-spoofed' },
      createCtx({ notificationService }),
    )
    const [, scope] = notificationService.createForFeature.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('is a no-op when the notifications module is absent', async () => {
    await expect(
      misconfiguredHandler({ storeId: 'store-1' }, createCtx({})),
    ).resolves.toBeUndefined()
    expect(await notifyStoreManagers({ storeId: 'store-1' }, createCtx({}), 'ecommerce.store.assortment_empty')).toBe(false)
  })

  it('skips payloads without a store or scope', async () => {
    const notificationService = createNotificationService()
    await misconfiguredHandler({}, createCtx({ notificationService }))
    await misconfiguredHandler({ storeId: 'store-1' }, createCtx({ notificationService }, { tenantId: null, organizationId: null }))
    expect(notificationService.createForFeature).not.toHaveBeenCalled()
  })
})
