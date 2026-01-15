import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'

/**
 * Resolve the dictionary entry ID for a given order/quote status value.
 * Returns null if the dictionary or entry doesn't exist.
 */
export async function resolveStatusEntryIdByValue(
  em: EntityManager,
  params: { tenantId: string; organizationId: string; value: string }
): Promise<string | null> {
  const normalizedValue = normalizeDictionaryValue(params.value)
  const dictionary = await em.findOne(Dictionary, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    key: 'sales.order_status',
    deletedAt: null,
  })
  if (!dictionary) return null
  const entry = await em.findOne(DictionaryEntry, {
    dictionary,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    normalizedValue,
  })
  return entry?.id ?? null
}

