import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type Kysely, type RawBuilder } from 'kysely'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveQueryIndexSourceMetadata } from './subscriber-scope'
import { listTenantGlobalEntityTypes } from './tenant-global'

export type QueryIndexSearchScope = {
  searchableEntityTypes: readonly string[]
  blockedEntityTypes: readonly string[]
  tenantGlobalEntityTypes: readonly string[]
  registeredSourceTypes?: readonly string[]
  customEntityStorage?: boolean
  customEntityStorageSchema?: string | null
}

type ScopeSnapshot = QueryIndexSearchScope & { registeredSourceTypes: readonly string[]; customEntityStorage: boolean; customEntityStorageSchema: string | null }
type ScopeCacheEntry = { signature: string; result: Promise<ScopeSnapshot> }
const SEARCH_SCOPE_CACHE_KEY = Symbol.for('@open-mercato/query-index/verified-search-scope')
type ScopeGlobals = typeof globalThis & { [SEARCH_SCOPE_CACHE_KEY]?: WeakMap<object, ScopeCacheEntry> }

function scopeCache(): WeakMap<object, ScopeCacheEntry> {
  const scope = globalThis as ScopeGlobals
  return scope[SEARCH_SCOPE_CACHE_KEY] ??= new WeakMap<object, ScopeCacheEntry>()
}

export async function resolveQueryIndexSearchScope(entityManager?: EntityManager): Promise<QueryIndexSearchScope> {
  let manager = entityManager
  if (!manager) {
    const { getOrm } = await import('@open-mercato/shared/lib/db/mikro')
    try {
      manager = (await getOrm()).em
    } catch {
      return { searchableEntityTypes: [], tenantGlobalEntityTypes: [], blockedEntityTypes: [...new Set(Object.values(getEntityIds(false)).flatMap((entities) => Object.values(entities)))] }
    }
  }
  const entityTypes = [...new Set(Object.values(getEntityIds(false)).flatMap((entities) => Object.values(entities)))].sort((leftType, rightType) => leftType.localeCompare(rightType))
  if (!entityTypes.length) throw new Error('[internal] Query-index source registry is unavailable; refusing unverified search')
  const declaredTypes = listTenantGlobalEntityTypes().sort((leftType, rightType) => leftType.localeCompare(rightType))
  const metadataSignature = listEntityMetadata(manager).map((metadata) => [metadata.className, metadata.tableName, metadata.schema, metadata.properties?.tenantId?.fieldNames, metadata.properties?.organizationId?.fieldNames])
  const signature = JSON.stringify([entityTypes, declaredTypes, metadataSignature])
  const key = manager.getDriver()
  const cache = scopeCache()
  const cached = cache.get(key)
  const result = cached?.signature === signature ? cached.result : verifySearchScope(manager, entityTypes, new Set(declaredTypes))
  const entry = cached?.signature === signature ? cached : { signature, result }
  cache.set(key, entry)
  try {
    return await result
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key)
    throw error
  }
}

async function verifySearchScope(
  em: EntityManager,
  entityTypes: readonly string[],
  declaredTypes: ReadonlySet<string>,
): Promise<ScopeSnapshot> {
  const metadata = listEntityMetadata(em)
  const sources = entityTypes.flatMap((entityType) => {
    try {
      const source = resolveQueryIndexSourceMetadata(em, entityType)
      return [{ entityType, ...source, table: source.tableName ?? source.table, schema: source.schema ?? null }]
    } catch {
      return []
    }
  })
  const customStorageMatches = metadata.filter((entry) => entry.className === 'CustomEntityStorage' || entry.name === 'CustomEntityStorage')
  const customStorageMetadata = customStorageMatches.length === 1 ? customStorageMatches[0] : undefined
  const customStorageRegistered = Boolean(customStorageMetadata)
  const customEntityStorageSchema = customStorageMetadata?.schema && customStorageMetadata.schema !== '*' ? customStorageMetadata.schema : null
  const physicalSchemas = [...new Set([...sources.flatMap((source) => source.schema ? [source.schema] : []), ...(customEntityStorageSchema ? [customEntityStorageSchema] : [])])]
  if (!sources.length && !customStorageRegistered) return { searchableEntityTypes: [], tenantGlobalEntityTypes: [], registeredSourceTypes: [], blockedEntityTypes: [...entityTypes], customEntityStorage: false, customEntityStorageSchema: null }
  const db = em.getKysely<{ 'information_schema.columns': { table_schema: string; table_name: string; column_name: string } }>()
  const rows = await db.selectFrom('information_schema.columns')
    .select(['table_schema', 'table_name', 'column_name'])
    .select(sql<boolean>`table_schema = current_schema()`.as('is_current_schema'))
    .where((expression) => expression.or([sql<boolean>`table_schema = current_schema()`, ...(physicalSchemas.length ? [expression('table_schema', 'in', physicalSchemas)] : [])]))
    .where('table_name', 'in', [...new Set([...sources.map((source) => source.table), ...(customStorageRegistered ? ['custom_entities_storage'] : [])])])
    .execute()
  const columnsByTable = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = `${row.table_schema}.${row.table_name}`
    const columns = columnsByTable.get(key) ?? new Set<string>()
    columns.add(row.column_name)
    columnsByTable.set(key, columns)
    if (row.is_current_schema) columnsByTable.set(row.table_name, columns)
  }
  const searchableEntityTypes: string[] = []
  const tenantGlobalEntityTypes: string[] = []
  for (const source of sources) {
    const columns = columnsByTable.get(source.schema ? `${source.schema}.${source.table}` : source.table)
    if (!columns?.has('id')) continue
    const hasTenant = columns.has('tenant_id') || Boolean(source.tenantColumn && columns.has(source.tenantColumn))
    const hasOrganization = columns.has('organization_id') || Boolean(source.organizationColumn && columns.has(source.organizationColumn))
    const global = !source.tenantColumn && !source.organizationColumn && !hasTenant && !hasOrganization && declaredTypes.has(source.entityType)
    if (global) tenantGlobalEntityTypes.push(source.entityType)
    if (hasTenant || global) searchableEntityTypes.push(source.entityType)
  }
  return { searchableEntityTypes, tenantGlobalEntityTypes, blockedEntityTypes: sources.map((source) => source.entityType).filter((entityType) => !searchableEntityTypes.includes(entityType)), registeredSourceTypes: sources.map((source) => source.entityType), customEntityStorageSchema, customEntityStorage: customStorageRegistered && ['tenant_id', 'organization_id', 'entity_type', 'entity_id'].every((column) => columnsByTable.get(customEntityStorageSchema ? `${customEntityStorageSchema}.custom_entities_storage` : 'custom_entities_storage')?.has(column)) }
}

type SearchRecordIdentity = { entityId: string; recordId: string; tenantId: string; organizationId?: string | null }
type CustomStorageDatabase = {
  custom_entities_storage: { entity_type: string; entity_id: string; tenant_id: string | null; organization_id: string | null }
}

export function buildQueryIndexSearchScopePredicate(
  scope: QueryIndexSearchScope,
  target: { entityTypeRef: string; recordIdRef: string; organizationIdRef: string },
  tenantId: string,
): RawBuilder<boolean> {
  const entityType = sql.ref(target.entityTypeRef)
  const known = scope.searchableEntityTypes.length
    ? sql<boolean>`${entityType} in (${sql.join(scope.searchableEntityTypes)})`
    : sql<boolean>`false`
  if (!scope.customEntityStorage) return known
  const table = sql.id(...(scope.customEntityStorageSchema ? [scope.customEntityStorageSchema, 'custom_entities_storage'] : ['custom_entities_storage']))
  const unknown = scope.registeredSourceTypes?.length
    ? sql<boolean>`${entityType} not in (${sql.join(scope.registeredSourceTypes)})`
    : sql<boolean>`true`
  return sql<boolean>`(${known} or (${unknown} and exists (select 1 from ${table} as om_search_source where om_search_source.entity_type = ${entityType} and om_search_source.entity_id = (${sql.ref(target.recordIdRef)})::text and om_search_source.tenant_id = ${tenantId} and om_search_source.organization_id is not distinct from ${sql.ref(target.organizationIdRef)})))`
}

export async function filterQueryIndexSearchRecords<RecordType extends SearchRecordIdentity>(
  db: Kysely<CustomStorageDatabase> | undefined,
  scope: QueryIndexSearchScope,
  records: readonly RecordType[],
): Promise<RecordType[]> {
  const known = new Set(scope.searchableEntityTypes)
  const unknown = records.filter((record) => !known.has(record.entityId) && !scope.registeredSourceTypes?.includes(record.entityId))
  if (!scope.customEntityStorage || !unknown.length) return records.filter((record) => known.has(record.entityId))
  const source = db ?? (await (await import('@open-mercato/shared/lib/db/mikro')).getOrm()).em.getKysely<CustomStorageDatabase>()
  const sourceDb = scope.customEntityStorageSchema ? source.withSchema(scope.customEntityStorageSchema) : source
  const rows = await sourceDb.selectFrom('custom_entities_storage').select(['entity_type', 'entity_id', 'tenant_id', 'organization_id'])
    .where('entity_type', 'in', [...new Set(unknown.map((record) => record.entityId))])
    .where('entity_id', 'in', [...new Set(unknown.map((record) => record.recordId))])
    .where('tenant_id', 'in', [...new Set(unknown.map((record) => record.tenantId))])
    .execute()
  const identities = new Set(rows.map((row) => JSON.stringify([row.entity_type, row.entity_id, row.tenant_id, row.organization_id])))
  return records.filter((record) => known.has(record.entityId) || identities.has(JSON.stringify([record.entityId, record.recordId, record.tenantId, record.organizationId ?? null])))
}
