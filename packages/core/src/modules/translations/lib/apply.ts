import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isOrmBackedSystemEntityId } from '@open-mercato/shared/lib/data/engine'
import { applyLocalizedContent } from '@open-mercato/shared/lib/localization/resolver'
import { getTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
import { batchLoadTranslations } from './batch'
import { getRegisteredTextFields, resolveTranslationOwnerMetadata } from './registered-fields'

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
  if (!items.length || !getTranslatableFields(options.entityType)?.length) return items
  const em = options.container.resolve<EntityManager>('em')
  const isSystemEntity = isOrmBackedSystemEntityId(em, options.entityType)
  const owner = isSystemEntity ? resolveTranslationOwnerMetadata(em, options.entityType) : null
  if (isSystemEntity && !owner) return items
  const fields = getRegisteredTextFields(options.entityType, owner?.metadata)
  if (!fields.size) return items
  const db = em.getKysely()
  const entityIds = items.map((item) => String(item.id)).filter(Boolean)
  const translationsMap = await batchLoadTranslations(db, options.entityType, entityIds, {
    tenantId: options.tenantId,
    organizationId: options.organizationId,
  })

  return items.map((item) => {
    const entityId = String(item.id)
    const translations = translationsMap.get(entityId)
    return applyLocalizedContent(item, translations, options.locale, options.entityType, fields)
  })
}
