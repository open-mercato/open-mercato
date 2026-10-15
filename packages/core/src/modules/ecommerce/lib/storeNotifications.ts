import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import type { NotificationService } from '../../notifications/lib/notificationService'
import { E } from '#generated/entities.ids.generated'
import { notificationTypes } from '../notifications'
import {
  asPayloadRecord,
  readEventScope,
  readPayloadString,
  tryResolveService,
  type EcommerceSubscriberContext,
} from './subscriberSupport'

/**
 * Store-manager alerts (SPEC-029 §9.4) delivered through `NotificationService.createForFeature`.
 * Emitters already throttle per hour; the `groupKey` (store + UTC hour) additionally makes a
 * retried or duplicated delivery refresh the recipient's existing notification instead of adding one.
 */

export const STORE_NOTIFICATION_FEATURE = 'ecommerce.stores.manage'

export type StoreNotificationType = 'ecommerce.store.channel_binding_missing' | 'ecommerce.store.assortment_empty'

type FeatureNotifier = Pick<NotificationService, 'createForFeature'>

export function storeNotificationGroupKey(storeId: string, now: Date): string {
  return `${storeId}:${now.toISOString().slice(0, 13)}`
}

export async function notifyStoreManagers(
  payload: unknown,
  ctx: EcommerceSubscriberContext,
  type: StoreNotificationType,
  now: Date = new Date(),
): Promise<boolean> {
  const record = asPayloadRecord(payload)
  const storeId = readPayloadString(record, 'storeId') ?? readPayloadString(record, 'id')
  const { tenantId, organizationId } = readEventScope(record, ctx)
  if (!storeId || !tenantId || !organizationId) return false
  const notificationService = tryResolveService<FeatureNotifier>(ctx, 'notificationService')
  if (!notificationService) return false
  const typeDef = notificationTypes.find((definition) => definition.type === type)
  if (!typeDef) return false
  const input = buildFeatureNotificationFromType(typeDef, {
    requiredFeature: STORE_NOTIFICATION_FEATURE,
    sourceEntityType: E.ecommerce.ecommerce_store,
    sourceEntityId: storeId,
    linkHref: `/backend/config/ecommerce/${encodeURIComponent(storeId)}`,
    groupKey: storeNotificationGroupKey(storeId, now),
  })
  await notificationService.createForFeature(
    { ...input, restrictRecipientsToOrganization: true },
    { tenantId, organizationId },
  )
  return true
}
