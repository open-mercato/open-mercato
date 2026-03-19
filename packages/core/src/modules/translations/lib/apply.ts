import type { AwilixContainer } from 'awilix'
import type { Knex } from 'knex'
import { applyLocalizedContent } from '@open-mercato/shared/lib/localization/resolver'
import { batchLoadTranslations } from './batch'

function resolveKnex(container: AwilixContainer): Knex {
  const em = container.resolve('em') as { getConnection(): { getKnex(): Knex } }
  return em.getConnection().getKnex()
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
  const knex = resolveKnex(options.container)
  const entityIds = items.map((item) => String(item.id)).filter(Boolean)
  const translationsMap = await batchLoadTranslations(knex, options.entityType, entityIds, {
    tenantId: options.tenantId,
    organizationId: options.organizationId,
  })

  return items.map((item) => {
    const entityId = String(item.id)
    const translations = translationsMap.get(entityId)
    return applyLocalizedContent(item, translations ?? null, options.locale)
  })
}
