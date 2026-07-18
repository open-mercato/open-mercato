import type { EntityManager } from '@mikro-orm/postgresql'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveRegisteredEntityTableName } from '@open-mercato/shared/lib/query/engine'

export type QueryIndexScope = {
  tenantId: string | null
  organizationId: string | null
}

export type QueryIndexSourceMetadata = {
  table: string
  organizationColumn: string | null
  tenantColumn: string | null
}

export type QueryIndexSourceScope =
  | { kind: 'global' }
  | { kind: 'missing' }
  | { kind: 'row'; scope: QueryIndexScope }

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

  const table = resolveRegisteredEntityTableName(em, entityType as never)
  if (!table) {
    throw new QueryIndexScopeError(`Query index entity type has no registered ORM table: ${entityType}`)
  }

  const registry = em.getMetadata?.()
  const allMetadataRaw = typeof registry?.getAll === 'function' ? registry.getAll() : null
  const allMetadata = Array.isArray(allMetadataRaw) ? allMetadataRaw : Object.values(allMetadataRaw ?? {})
  const metadata = allMetadata.find((candidate) => String(candidate?.tableName ?? '') === table)
  if (!metadata) {
    throw new QueryIndexScopeError(`Query index entity metadata was not found for table: ${table}`)
  }

  return {
    table,
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

function resolveScopeColumn(metadata: { properties?: Record<string, { fieldNames?: unknown }> }, property: string, table: string): string | null {
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
