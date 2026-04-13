import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'

export type QueryIndexScope = {
  tenantId: string | null
  organizationId: string | null
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
  rowScope: QueryIndexScope | null
}

type ResolveReindexScopeInput = {
  tenantId: string | null | undefined
  organizationId: string | null | undefined
  allowAllTenants?: boolean
}

export async function loadQueryIndexRowScope(
  em: EntityManager,
  entityType: string,
  recordId: string
): Promise<QueryIndexScope | null> {
  const knex = (em as any).getConnection().getKnex()
  const table = resolveEntityTableName(em, entityType)
  const row = await knex(table)
    .select(['organization_id', 'tenant_id'])
    .where({ id: recordId })
    .first()

  if (!row) {
    return null
  }

  return {
    organizationId: row.organization_id ?? null,
    tenantId: row.tenant_id ?? null,
  }
}

export function resolveQueryIndexRecordScope(input: ResolveRecordScopeInput): QueryIndexScope {
  const {
    payloadTenantId,
    payloadOrganizationId,
    hasPayloadTenantId,
    hasPayloadOrganizationId,
    rowScope,
  } = input

  if (!rowScope) {
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
