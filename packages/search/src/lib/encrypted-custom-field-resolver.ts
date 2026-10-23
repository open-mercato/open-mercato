import type { Kysely } from 'kysely'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import {
  normalizeDefinitionConfig,
  normalizeDefinitionKey,
} from '@open-mercato/shared/lib/crud/custom-field-definition-index'

export type EncryptedCustomFieldKeysResolver = (entityId: EntityId) => Promise<Set<string>>

type CustomFieldDefinitionsTable = {
  entity_id: string
  key: string
  config_json: unknown
  deleted_at: Date | null
}

export type CustomFieldDefinitionsDatabase = {
  custom_field_defs: CustomFieldDefinitionsTable
}

/**
 * Resolve the normalized keys of every custom field declared `encrypted` for an entity.
 * Search building has no definition scope at this boundary, so the resolver unions every
 * tenant and organization and keeps inactive definitions: over-excluding a field is
 * preferable to publishing its plaintext. Each key is also added in the form the query engine
 * uses for `cf_` aliases, where characters outside `[a-zA-Z0-9_]` become `_`.
 */
export function createEncryptedCustomFieldKeysResolver(
  db: Kysely<CustomFieldDefinitionsDatabase>,
): EncryptedCustomFieldKeysResolver {
  return async (entityId: EntityId): Promise<Set<string>> => {
    const rows = await db
      .selectFrom('custom_field_defs')
      .select(['key', 'config_json'])
      .where('entity_id', '=', entityId)
      .where('deleted_at', 'is', null)
      .execute()

    const keys = new Set<string>()
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!normalizeDefinitionConfig(row.config_json).encrypted) continue
      const key = normalizeDefinitionKey(row.key)
      if (!key) continue
      keys.add(key)
      keys.add(key.replace(/[^a-z0-9_]/g, '_'))
    }
    return keys
  }
}
