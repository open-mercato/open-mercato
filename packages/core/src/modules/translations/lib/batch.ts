import type { Knex } from 'knex'

export async function batchLoadTranslations(
  knex: Knex,
  entityType: string,
  entityIds: string[],
  scope: { tenantId?: string | null; organizationId?: string | null },
): Promise<Map<string, Record<string, Record<string, unknown>>>> {
  if (!entityIds.length) return new Map()

  const rows = await knex('entity_translations')
    .where('entity_type', entityType)
    .whereIn('entity_id', entityIds)
    .andWhereRaw('tenant_id is not distinct from ?', [scope.tenantId ?? null])
    .andWhereRaw('organization_id is not distinct from ?', [scope.organizationId ?? null])
    .select(['entity_id', 'translations'])

  const map = new Map<string, Record<string, Record<string, unknown>>>()
  for (const row of rows) {
    map.set(row.entity_id, row.translations ?? {})
  }
  return map
}
