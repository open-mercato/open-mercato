import type { AwilixContainer } from 'awilix'
import type { Kysely } from 'kysely'
import { applyLocalizedContent } from '@open-mercato/shared/lib/localization/resolver'
import { batchLoadTranslations } from './batch'

function resolveDb(container: AwilixContainer): Kysely<any> {
  const em = container.resolve('em') as { getKysely<T = any>(): Kysely<T> }
  return em.getKysely<any>()
}

export async function applyTranslationOverlays(
  items: Record<string, unknown>[],
  options: {
    entityType: string
    locale: string
    tenantId?: string | null
    organizationId?: string | null
    container: AwilixContainer
  },
): Promise<Record<string, unknown>[]> {
  const db = resolveDb(options.container)
  const entityIds = items.map((item) => String(item.id)).filter(Boolean)
  const translationsMap = await batchLoadTranslations(db, options.entityType, entityIds, {
    tenantId: options.tenantId,
    organizationId: options.organizationId,
  })

  return items.map((item) => {
    const entityId = String(item.id)
    const translations = translationsMap.get(entityId)
    return applyLocalizedContent(item, translations ?? null, options.locale)
  })
}
