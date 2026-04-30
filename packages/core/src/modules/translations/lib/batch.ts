import { type Kysely, sql } from 'kysely'

export async function batchLoadTranslations(
  db: Kysely<any>,
  entityType: string,
  entityIds: string[],
  scope: { tenantId?: string | null; organizationId?: string | null },
): Promise<Map<string, Record<string, Record<string, unknown>>>> {
  if (!entityIds.length) return new Map()

  const rows = await (db as any)
    .selectFrom('entity_translations')
    .select(['entity_id', 'translations'])
    .where('entity_type', '=', entityType)
    .where('entity_id', 'in', entityIds)
    .where(sql<boolean>`tenant_id is not distinct from ${scope.tenantId ?? null}`)
    .where(sql<boolean>`organization_id is not distinct from ${scope.organizationId ?? null}`)
    .execute() as Array<{ entity_id: string; translations: Record<string, Record<string, unknown>> | null }>

  const map = new Map<string, Record<string, Record<string, unknown>>>()
  for (const row of rows) {
    map.set(row.entity_id, row.translations ?? {})
  }
  return map
}
