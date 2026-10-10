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

type EntityTranslationsTable = {
  entity_translations: {
    entity_type: string
    entity_id: string
    translations: Record<string, Record<string, unknown>> | null
    tenant_id: string | null
    organization_id: string | null
  }
}

/**
 * Multi-entity-type variant of `batchLoadTranslations`: every request is answered by one query,
 * keyed by entity type and then entity id. Organization matching is exact, as in the single-type helper.
 */
export async function batchLoadTranslationsMany(
  db: Kysely<EntityTranslationsTable>,
  requests: Array<{ entityType: string; entityIds: string[] }>,
  scope: { tenantId?: string | null; organizationId?: string | null },
): Promise<Map<string, Map<string, Record<string, Record<string, unknown>>>>> {
  const result = new Map<string, Map<string, Record<string, Record<string, unknown>>>>()
  const wanted = new Map<string, Set<string>>()
  for (const request of requests) {
    if (!result.has(request.entityType)) result.set(request.entityType, new Map())
    const ids = wanted.get(request.entityType) ?? new Set<string>()
    for (const id of request.entityIds) ids.add(id)
    wanted.set(request.entityType, ids)
  }
  const entityTypes = Array.from(wanted.entries()).filter(([, ids]) => ids.size > 0).map(([entityType]) => entityType)
  if (!entityTypes.length) return result
  const entityIds = Array.from(new Set(entityTypes.flatMap((entityType) => Array.from(wanted.get(entityType) ?? []))))

  const rows = await db
    .selectFrom('entity_translations')
    .select(['entity_type', 'entity_id', 'translations'])
    .where('entity_type', 'in', entityTypes)
    .where('entity_id', 'in', entityIds)
    .where(sql<boolean>`tenant_id is not distinct from ${scope.tenantId ?? null}`)
    .where(sql<boolean>`organization_id is not distinct from ${scope.organizationId ?? null}`)
    .execute()

  for (const row of rows) {
    if (!wanted.get(row.entity_type)?.has(row.entity_id)) continue
    result.get(row.entity_type)?.set(row.entity_id, row.translations ?? {})
  }
  return result
}
