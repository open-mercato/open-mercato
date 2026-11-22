import type { EntityManager } from '@mikro-orm/postgresql'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { normalizeColumnName } from '@open-mercato/shared/lib/query/ciphertext-search-warning'
import type { ModuleEncryptionFieldRule } from '@open-mercato/shared/modules/encryption'
import { defaultEncryptionMaps } from '../encryption'

type EncryptionMapRow = {
  id: string
  organization_id: string | null
  fields_json: ModuleEncryptionFieldRule[] | null
  is_active: boolean
}

const targetFields = [
  { entityId: 'customers:customer_entity', field: 'primary_email' },
  { entityId: 'customers:customer_company_profile', field: 'domain' },
]

export async function reconcileLookupHashMaps(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
): Promise<Array<{ entityId: string; tenantId: string; organizationId: string }>> {
  const updated = []
  for (const { entityId, field } of targetFields) {
    const rule = defaultEncryptionMaps.find((map) => map.entityId === entityId)?.fields
      .find((entry) => entry.field === field)
    if (!rule?.hashField) throw new Error('[internal] Customer lookup hash rule is missing')

    const maps = await em.execute<EncryptionMapRow[]>(
      `select id, organization_id, fields_json, is_active
       from encryption_maps
       where entity_id = ? and deleted_at is null
         and ((tenant_id = ? and (organization_id = ? or (organization_id is null and is_active)))
           or (tenant_id is null and organization_id is null and is_active))
       order by organization_id nulls last, tenant_id nulls last, created_at, id
       for update`,
      [entityId, tenantId, organizationId],
    )
    const exact = maps.find((map) => map.organization_id === organizationId)
    const map = maps.find((candidate) => candidate.is_active)
    if (!Array.isArray(map?.fields_json)) continue
    const current = map.fields_json.find((entry) => entry?.field && normalizeColumnName(entry.field) === field)
    if (!current) continue
    if (current.hashField) {
      if (normalizeColumnName(current.hashField) === rule.hashField) continue
      throw new Error('[internal] The customer encryption rule uses a different hash column. Review the scoped encryption map before retrying.')
    }
    if (exact && !exact.is_active) {
      throw new Error('[internal] An inactive organization encryption map overrides reconciliation. Review the scoped encryption map before retrying.')
    }
    if (!hashForLookup('customer-lookup-hash-configuration').startsWith('v2:')) {
      throw new Error('[internal] Configure LOOKUP_HASH_PEPPER before enabling customer lookup hashes')
    }

    const fields = JSON.stringify(map.fields_json.map((entry) => entry === current
      ? { ...entry, hashField: rule.hashField }
      : entry))
    if (map.organization_id === organizationId) {
      await em.execute(
        'update encryption_maps set fields_json = ?::jsonb, updated_at = now() where id = ? and tenant_id = ? and organization_id = ?',
        [fields, map.id, tenantId, organizationId],
      )
    } else {
      const inserted = await em.execute<Array<{ id: string }>>(
        `insert into encryption_maps (id, entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at)
         values (gen_random_uuid(), ?, ?, ?, ?::jsonb, true, now(), now())
         on conflict (entity_id, tenant_id, organization_id) where deleted_at is null do nothing
         returning id`,
        [entityId, tenantId, organizationId, fields],
      )
      if (!inserted.length) throw new Error('[internal] Customer encryption map changed during reconciliation. Retry the upgrade action.')
    }
    updated.push({ entityId, tenantId, organizationId })
  }
  return updated
}
