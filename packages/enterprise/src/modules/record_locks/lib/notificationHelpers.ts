import type { EntityManager } from '@mikro-orm/postgresql'
import { ModuleConfig } from '@open-mercato/core/modules/configs/data/entities'
import {
  DEFAULT_RECORD_LOCK_SETTINGS,
  RECORD_LOCKS_MODULE_ID,
  RECORD_LOCKS_SETTINGS_NAME,
  normalizeRecordLockSettings,
} from './config'
import { notificationTypes } from '../notifications'

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

const RESOURCE_PATHS: Record<string, string> = {
  'catalog.product': '/backend/catalog/products',
  'catalog.product_variant': '/backend/catalog/products',
  'customers.person': '/backend/customers/people',
  'customers.company': '/backend/customers/companies',
  'customers.deal': '/backend/customers/deals',
  'sales.quote': '/backend/sales/quotes',
  'sales.order': '/backend/sales/orders',
}

export function resolveRecordResourceLink(resourceKind: string, resourceId: string): string | undefined {
  const basePath = RESOURCE_PATHS[resourceKind]
  if (!basePath) return undefined
  return `${basePath}/${resourceId}`
}

export function resolveRecordLockNotificationType(type: string) {
  return notificationTypes.find((entry) => entry.type === type)
}

export async function isConflictNotificationEnabled(ctx: ResolverContext): Promise<boolean> {
  try {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const row = await em.findOne(ModuleConfig, {
      moduleId: RECORD_LOCKS_MODULE_ID,
      name: RECORD_LOCKS_SETTINGS_NAME,
    })
    const settings = normalizeRecordLockSettings(row?.valueJson ?? DEFAULT_RECORD_LOCK_SETTINGS)
    return settings.notifyOnConflict
  } catch {
    return DEFAULT_RECORD_LOCK_SETTINGS.notifyOnConflict
  }
}
