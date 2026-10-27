import type { Kysely } from 'kysely'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { normalizeDefinitionConfig, normalizeDefinitionKey } from '@open-mercato/shared/lib/crud/custom-field-definition-index'

export type CustomFieldDefinitionsDatabase = {
  custom_field_defs: {
    entity_id: string
    key: string
    config_json: unknown
    deleted_at: Date | null
  }
}

export type EncryptedCustomFieldKeysResolver = (entityId: EntityId) => Promise<Set<string>>

export function createEncryptedCustomFieldKeysResolver(
  db: Kysely<CustomFieldDefinitionsDatabase>,
): EncryptedCustomFieldKeysResolver {
  return async (entityId) => {
    const definitions = await db
      .selectFrom('custom_field_defs')
      .select(['key', 'config_json'])
      .where('entity_id', '=', entityId)
      .where('deleted_at', 'is', null)
      .execute()
    const keys = new Set<string>()
    for (const definition of definitions) {
      if (!normalizeDefinitionConfig(definition.config_json).encrypted) continue
      const key = normalizeDefinitionKey(definition.key)
      if (!key) continue
      keys.add(key)
      keys.add(key.replace(/[^a-z0-9_]/g, '_'))
    }
    return keys
  }
}
