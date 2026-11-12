import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { resolveEntityTableName } from '../query/engine'
import { listEntityMetadata } from './entityMetadata'
import { getTelemetryRuntime } from '../telemetry/runtime'
import { createLogger } from '../logger'

const logger = createLogger('shared.recordScope')

export type EntityScopeColumns = {
  table: string
  organizationColumn: string | null
  tenantColumn: string | null
}

export type EntityRecordScope = {
  organizationId: string | null
  tenantId: string | null
}

type ScopeLookupEntityManager = {
  getKysely: <T = unknown>() => Kysely<T>
  getMetadata?: () => unknown
}

type ScopePropertyMetadata = { fieldNames?: unknown }
type ScopeDatabase = Record<string, Record<string, unknown>>

const ORGANIZATION_COLUMN = 'organization_id'
const TENANT_COLUMN = 'tenant_id'

let probedColumnsCache = new WeakMap<Kysely<ScopeDatabase>, Map<string, { organizationColumn: string | null; tenantColumn: string | null }>>()

function readScopeFieldName(property: ScopePropertyMetadata | undefined): string | null {
  const fieldNames = property?.fieldNames
  if (!Array.isArray(fieldNames) || fieldNames.length !== 1) return null
  const [fieldName] = fieldNames
  return typeof fieldName === 'string' && fieldName.length > 0 ? fieldName : null
}

function resolveScopeColumnsFromMetadata(
  em: ScopeLookupEntityManager,
  table: string,
): { organizationColumn: string | null; tenantColumn: string | null } | null {
  const matches = listEntityMetadata(em).filter((metadata) => metadata.tableName === table)
  if (matches.length !== 1) return null
  const properties = (matches[0].properties ?? {}) as Record<string, ScopePropertyMetadata | undefined>
  return {
    organizationColumn: readScopeFieldName(properties.organizationId),
    tenantColumn: readScopeFieldName(properties.tenantId),
  }
}

async function probeScopeColumns(
  db: Kysely<ScopeDatabase>,
  table: string,
): Promise<{ organizationColumn: string | null; tenantColumn: string | null } | null> {
  let cache = probedColumnsCache.get(db)
  if (!cache) {
    cache = new Map()
    probedColumnsCache.set(db, cache)
  }
  const cached = cache.get(table)
  if (cached) return cached
  try {
    const rows = await db
      .selectFrom('information_schema.columns')
      .select(['column_name'])
      .where(sql<boolean>`table_schema = current_schema()`)
      .where('table_name', '=', table)
      .where('column_name', 'in', [ORGANIZATION_COLUMN, TENANT_COLUMN])
      .execute()
    const columns = new Set(rows.map((row) => typeof row.column_name === 'string' ? row.column_name.toLowerCase() : ''))
    const resolved = {
      organizationColumn: columns.has(ORGANIZATION_COLUMN) ? ORGANIZATION_COLUMN : null,
      tenantColumn: columns.has(TENANT_COLUMN) ? TENANT_COLUMN : null,
    }
    cache.set(table, resolved)
    return resolved
  } catch (error) {
    try {
      getTelemetryRuntime()?.reportError(error, {
        module: 'shared',
        code: 'shared.scope_column_probe_failed',
        attributes: { table },
      })
    } catch (telemetryError) {
      logger.warn('Failed to report a scope column probe error', { err: telemetryError })
    }
    return null
  }
}

/**
 * Resolve which tenant/organization scope columns the table behind `entityType` actually has.
 * Uses ORM metadata when the table is registered; otherwise probes `information_schema.columns`.
 * Returns `null` when the columns cannot be determined, so callers skip the row lookup instead
 * of issuing a select that fails on global tables (e.g. `feature_toggles`).
 */
export async function resolveEntityScopeColumns(
  em: ScopeLookupEntityManager,
  entityType: string,
): Promise<EntityScopeColumns | null> {
  const table = resolveEntityTableName(em as never, entityType)
  if (!table) return null
  const columns = resolveScopeColumnsFromMetadata(em, table)
    ?? await probeScopeColumns(em.getKysely<ScopeDatabase>(), table)
  if (!columns) return null
  return { table, ...columns }
}

/**
 * Read the tenant/organization scope of one record by id, selecting only the scope columns its
 * table has. Returns `null` when the table has no scope columns, the columns cannot be
 * determined, or the row does not exist.
 */
export async function loadEntityRecordScope(
  em: ScopeLookupEntityManager,
  entityType: string,
  recordId: string,
): Promise<EntityRecordScope | null> {
  const columns = await resolveEntityScopeColumns(em, entityType)
  if (!columns) return null
  const selected = [columns.organizationColumn, columns.tenantColumn]
    .filter((column): column is string => column !== null)
  if (selected.length === 0) return null
  const row = await em.getKysely<ScopeDatabase>()
    .selectFrom(columns.table)
    .select(selected)
    .where('id', '=', recordId)
    .executeTakeFirst()
  if (!row) return null
  const organizationId = columns.organizationColumn ? row[columns.organizationColumn] : null
  const tenantId = columns.tenantColumn ? row[columns.tenantColumn] : null
  return {
    organizationId: typeof organizationId === 'string' ? organizationId : null,
    tenantId: typeof tenantId === 'string' ? tenantId : null,
  }
}

export function resetEntityScopeColumnsCacheForTests(): void {
  probedColumnsCache = new WeakMap()
}
