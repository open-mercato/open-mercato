import type { Kysely } from 'kysely'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { normalizeDefinitionConfig, normalizeDefinitionKey } from '@open-mercato/shared/lib/crud/custom-field-definition-index'

export type CustomFieldDefinitionsDatabase = {
  custom_field_defs: {
    entity_id: string
    key: string
    config_json: unknown
    deleted_at: Date | null
    tenant_id: string | null
    organization_id: string | null
  }
}

export type EncryptedCustomFieldScope = { tenantId: string; organizationId?: string | null }

export type EncryptedCustomFieldKeysResolver = (entityId: EntityId, scope?: EncryptedCustomFieldScope) => Promise<Set<string>>

export function createEncryptedCustomFieldKeysResolver(
  db: Kysely<CustomFieldDefinitionsDatabase>,
): EncryptedCustomFieldKeysResolver {
  return async (entityId, scope) => {
    if (!scope?.tenantId) throw new Error('[internal] Trusted search scope is required')
    const definitions = await db
      .selectFrom('custom_field_defs')
      .select(['key', 'config_json'])
      .where('entity_id', '=', entityId)
      .where('deleted_at', 'is', null)
      .where((expression) => expression.or([
        expression.and([expression('tenant_id', 'is', null), expression('organization_id', 'is', null)]),
        expression.and([
          expression('tenant_id', '=', scope.tenantId),
          scope.organizationId
            ? expression.or([expression('organization_id', 'is', null), expression('organization_id', '=', scope.organizationId)])
            : expression('organization_id', 'is', null),
        ]),
      ]))
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
