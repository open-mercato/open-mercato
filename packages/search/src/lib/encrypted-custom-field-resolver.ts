import type { Kysely } from 'kysely'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import {
  normalizeDefinitionConfig,
  normalizeDefinitionKey,
} from '@open-mercato/shared/lib/crud/custom-field-definition-index'

export type EncryptedCustomFieldKeysResolver = (entityId: EntityId) => Promise<Set<string>>

type CustomFieldDefinitionRow = {
  key?: unknown
  config_json?: unknown
}

/**
 * Resolve the normalized keys of every custom field declared `encrypted` for an entity.
 * Search building has no definition scope at this boundary, so the resolver unions every
 * tenant and organization and keeps inactive definitions: over-excluding a field is
 * preferable to publishing its plaintext.
 */
export function createEncryptedCustomFieldKeysResolver(db: Kysely<any>): EncryptedCustomFieldKeysResolver {
  return async (entityId: EntityId): Promise<Set<string>> => {
    const rows = await db
      .selectFrom('custom_field_defs' as any)
      .select(['key' as any, 'config_json' as any])
      .where('entity_id' as any, '=', entityId)
      .where('deleted_at' as any, 'is', null)
      .execute() as CustomFieldDefinitionRow[]

    const keys = new Set<string>()
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!normalizeDefinitionConfig(row.config_json).encrypted) continue
      const key = normalizeDefinitionKey(row.key)
      if (key) keys.add(key)
    }
    return keys
  }
}
