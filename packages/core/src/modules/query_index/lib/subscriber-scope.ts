import type { EntityManager } from '@mikro-orm/postgresql'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveRegisteredEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'

export type QueryIndexScope = {
  tenantId: string | null
  organizationId: string | null
}

export type QueryIndexSourceMetadata = {
  table: string
  schema?: string
  tableName?: string
  organizationColumn: string | null
  tenantColumn: string | null
}

export type QueryIndexSourceScope =
  | { kind: 'global' }
  | { kind: 'missing' }
  | { kind: 'row'; scope: QueryIndexScope }

type QueryIndexEntityMetadata = {
  tableName?: unknown
  className?: unknown
  name?: unknown
  schema?: unknown
  properties?: Record<string, { fieldNames?: unknown }>
}

export class QueryIndexScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryIndexScopeError'
  }
}

type ResolveRecordScopeInput = {
  payloadTenantId: string | null | undefined
  payloadOrganizationId: string | null | undefined
  hasPayloadTenantId: boolean
  hasPayloadOrganizationId: boolean
  sourceScope: QueryIndexSourceScope
}

type ResolveReindexScopeInput = {
  tenantId: string | null | undefined
  organizationId: string | null | undefined
  allowAllTenants?: boolean
}

export function resolveQueryIndexSourceMetadata(
  em: EntityManager,
  entityType: string,
): QueryIndexSourceMetadata {
  const registeredEntityIds = Object.values(getEntityIds(false)).flatMap((moduleEntities) => Object.values(moduleEntities ?? {}))
  if (!registeredEntityIds.includes(entityType)) {
    throw new QueryIndexScopeError(`Query index entity type is not registered: ${entityType}`)
  }

  const source = resolveQueryIndexSourceTableMetadata(em, entityType)
  if (!source) throw new QueryIndexScopeError(`Query index entity type has no registered ORM table: ${entityType}`)
  const listed = listEntityMetadata(em).some((metadata) => metadata.tableName === (source.tableName ?? source.table) && (metadata.schema && metadata.schema !== '*' ? metadata.schema : undefined) === source.schema)
  if (!listed) throw new QueryIndexScopeError(`[internal] Query index entity metadata was not found for table: ${source.table}`)
  return source
}

export function resolveQueryIndexSourceTableMetadata(
  em: EntityManager,
  entityType: string,
): QueryIndexSourceMetadata | null {
  const rawName = entityType.split(':').pop() ?? ''
  const className = rawName.split(/[_\s]+/).filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join('')
  const allMetadata = listEntityMetadata(em) as unknown as QueryIndexEntityMetadata[]
  let metadata: QueryIndexEntityMetadata | undefined
  for (const candidate of [className, `${className}Entity`]) {
    const matches = allMetadata.filter((entry) => entry.className === candidate || entry.name === candidate)
    if (matches.length > 1) throw new QueryIndexScopeError(`[internal] Ambiguous query-index entity metadata: ${entityType}`)
    if (matches.length === 1) {
      metadata = matches[0]
      break
    }
  }
  if (!metadata) {
    const table = resolveRegisteredEntityTableName(em, entityType)
    if (!table) return null
    const matches = allMetadata.filter((entry) => entry.tableName === table)
    if (matches.length !== 1) throw new QueryIndexScopeError(`[internal] Ambiguous query-index table metadata: ${entityType}`)
    metadata = matches[0]
  }
  const tableName = String(metadata.tableName ?? '')
  if (!tableName) return null
  const schema = typeof metadata.schema === 'string' && metadata.schema !== '*' ? metadata.schema : undefined
  const table = schema ? `${schema}.${tableName}` : tableName
  return {
    table,
    ...(schema ? { schema, tableName } : {}),
    organizationColumn: resolveScopeColumn(metadata, 'organizationId', table),
    tenantColumn: resolveScopeColumn(metadata, 'tenantId', table),
  }
}

export async function loadQueryIndexRowScope(
  em: EntityManager,
  source: QueryIndexSourceMetadata,
  recordId: string,
): Promise<QueryIndexSourceScope> {
  if (!source.organizationColumn && !source.tenantColumn) {
    return { kind: 'global' }
  }

  const db = em.getKysely<any>()
  const columns = [source.organizationColumn, source.tenantColumn].filter((column): column is string => column !== null)
  const row = await db
    .selectFrom(source.table as any)
    .select(columns as any)
    .where('id' as any, '=', recordId)
    .executeTakeFirst() as Record<string, string | null | undefined> | undefined

  if (!row) {
    return { kind: 'missing' }
  }

  return {
    kind: 'row',
    scope: {
      organizationId: source.organizationColumn ? row[source.organizationColumn] ?? null : null,
      tenantId: source.tenantColumn ? row[source.tenantColumn] ?? null : null,
    },
  }
}

export function resolveQueryIndexRecordScope(input: ResolveRecordScopeInput): QueryIndexScope {
  const {
    payloadTenantId,
    payloadOrganizationId,
    hasPayloadTenantId,
    hasPayloadOrganizationId,
    sourceScope,
  } = input

  if (sourceScope.kind === 'global') {
    if (!hasPayloadTenantId || !hasPayloadOrganizationId || payloadTenantId !== null || payloadOrganizationId !== null) {
      throw new QueryIndexScopeError(
        'Query index event for a global entity must explicitly provide tenantId and organizationId as null'
      )
    }

    return {
      tenantId: null,
      organizationId: null,
    }
  }

  if (sourceScope.kind === 'missing') {
    if (!hasPayloadTenantId || !hasPayloadOrganizationId) {
      throw new QueryIndexScopeError(
        'Query index event is missing tenantId/organizationId and source row scope could not be resolved'
      )
    }

    return {
      tenantId: payloadTenantId ?? null,
      organizationId: payloadOrganizationId ?? null,
    }
  }

  const rowScope = sourceScope.scope

  if (hasPayloadTenantId && !isSameScopeValue(payloadTenantId, rowScope.tenantId)) {
    throw new QueryIndexScopeError(
      `Query index event tenantId does not match source row scope (payload=${String(payloadTenantId ?? null)}, row=${String(rowScope.tenantId)})`
    )
  }

  if (hasPayloadOrganizationId && !isSameScopeValue(payloadOrganizationId, rowScope.organizationId)) {
    throw new QueryIndexScopeError(
      `Query index event organizationId does not match source row scope (payload=${String(payloadOrganizationId ?? null)}, row=${String(rowScope.organizationId)})`
    )
  }

  return {
    tenantId: hasPayloadTenantId ? (payloadTenantId ?? null) : rowScope.tenantId,
    organizationId: hasPayloadOrganizationId ? (payloadOrganizationId ?? null) : rowScope.organizationId,
  }
}

export function resolveQueryIndexReindexScope(input: ResolveReindexScopeInput): {
  tenantId: string | null | undefined
  organizationId: string | null | undefined
} {
  if (input.tenantId === undefined && input.allowAllTenants !== true) {
    throw new QueryIndexScopeError(
      'Query index reindex requires tenantId to be set explicitly; all-tenant reindex must opt in with allowAllTenants=true'
    )
  }

  return {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  }
}

function isSameScopeValue(left: string | null | undefined, right: string | null): boolean {
  return (left ?? null) === right
}

function resolveScopeColumn(metadata: QueryIndexEntityMetadata, property: string, table: string): string | null {
  const scopeProperty = metadata.properties?.[property]
  if (!scopeProperty) return null
  const fieldNames = scopeProperty.fieldNames
  if (!Array.isArray(fieldNames) || fieldNames.length !== 1 || typeof fieldNames[0] !== 'string' || !fieldNames[0]) {
    throw new QueryIndexScopeError(
      `Query index ${property} metadata must map exactly one physical column for table: ${table}`
    )
  }
  return fieldNames[0]
}
