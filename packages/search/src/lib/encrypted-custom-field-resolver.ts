import { sql, type Kysely } from 'kysely'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import {
  normalizeDefinitionConfig,
  normalizeDefinitionKey,
} from '@open-mercato/shared/lib/crud/custom-field-definition-index'

export type EncryptedCustomFieldKeysResolver = (entityId: EntityId, tenantId?: string | null) => Promise<Set<string>>

type CustomFieldDefinitionsTable = {
  entity_id: string
  tenant_id: string | null
  key: string
  config_json: unknown
  deleted_at: Date | null
}

export type CustomFieldDefinitionsDatabase = {
  custom_field_defs: CustomFieldDefinitionsTable
}

/**
 * Resolve the normalized keys of every custom field declared `encrypted` for an entity.
 * Definitions are read for the record's tenant and global ones, as the query engine joins
 * them; the build context has no organization, so every organization of that tenant counts,
 * and inactive definitions are kept: over-excluding a field is preferable to publishing its
 * plaintext. Without a tenant, every tenant's definitions count. Each key is also added in the
 * form the query engine uses for `cf_` aliases, where characters outside `[a-zA-Z0-9_]` become `_`.
 */
export function createEncryptedCustomFieldKeysResolver(
  db: Kysely<CustomFieldDefinitionsDatabase>,
): EncryptedCustomFieldKeysResolver {
  return async (entityId: EntityId, tenantId?: string | null): Promise<Set<string>> => {
    let query = db
      .selectFrom('custom_field_defs')
      .select(['key', 'config_json'])
      .where('entity_id', '=', entityId)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`config_json::text like ${'%encrypted%'}`)
    if (tenantId) {
      query = query.where((eb) => eb.or([eb('tenant_id', '=', tenantId), eb('tenant_id', 'is', null)]))
    }
    const rows = await query.execute()

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
