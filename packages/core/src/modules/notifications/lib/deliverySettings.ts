import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleConfigService, type ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import type { NotificationDeliveryConfigInput } from '../data/validators'
import {
  DEFAULT_NOTIFICATION_DELIVERY_CONFIG,
  NOTIFICATIONS_DELIVERY_CONFIG_KEY,
  resolveNotificationDeliveryConfig,
  saveNotificationDeliveryConfig,
} from './deliveryConfig'

const DEFAULT_SETTINGS_VERSION = '1970-01-01T00:00:00.000Z'

type Resolver = Pick<AppContainer, 'resolve'>

export async function readNotificationDeliverySettings(resolver: Resolver, tenantId: string) {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return { settings: await resolveNotificationDeliveryConfig(resolver), updatedAt: DEFAULT_SETTINGS_VERSION }
  }
  const record = await service.getRecord('notifications', NOTIFICATIONS_DELIVERY_CONFIG_KEY, { tenantId })
  const snapshotService: ModuleConfigService = {
    ...service,
    getValue: async <T,>(moduleId: string, name: string, options?: { defaultValue?: T | null; scope?: { tenantId?: string | null } }) => (
      moduleId === 'notifications' && name === NOTIFICATIONS_DELIVERY_CONFIG_KEY && options?.scope?.tenantId === tenantId
        ? (record?.value as T | null | undefined) ?? options.defaultValue ?? null
        : service.getValue<T>(moduleId, name, options)
    ),
  }
  const snapshotResolver = {
    resolve: <T,>(name: string): T => name === 'moduleConfigService' ? snapshotService as T : resolver.resolve<T>(name),
  }
  const settings = await resolveNotificationDeliveryConfig(snapshotResolver, {
    tenantId,
    defaultValue: DEFAULT_NOTIFICATION_DELIVERY_CONFIG,
  })
  return { settings, updatedAt: record?.updatedAt ?? DEFAULT_SETTINGS_VERSION }
}

export async function saveVersionedNotificationDeliverySettings(
  resolver: Resolver,
  tenantId: string,
  config: NotificationDeliveryConfigInput,
  request: Request,
) {
  const em = resolver.resolve<EntityManager>('em')
  const result = await withAdvisoryXactLock(em, `notification_settings:${tenantId}`, async (transactionEm) => {
    const transactionContainer = {
      resolve: <T,>(name: string): T => {
        if (name === 'em') return transactionEm as T
        if (name === 'cache') return null as T
        return resolver.resolve<T>(name)
      },
    } as AppContainer
    const service = createModuleConfigService(transactionContainer)
    const transactionResolver = {
      resolve: <T,>(name: string): T => name === 'moduleConfigService' ? service as T : transactionContainer.resolve<T>(name),
    }
    const current = await readNotificationDeliverySettings(transactionResolver, tenantId)
    enforceCommandOptimisticLock({
      resourceKind: 'notifications.settings',
      resourceId: tenantId,
      current: current.updatedAt,
      request,
    })
    await saveNotificationDeliveryConfig(transactionResolver, config, { tenantId })
    return readNotificationDeliverySettings(transactionResolver, tenantId)
  })
  await resolver.resolve<ModuleConfigService>('moduleConfigService').invalidate('notifications', NOTIFICATIONS_DELIVERY_CONFIG_KEY, { tenantId })
  return result
}
