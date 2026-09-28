import type { EntityManager } from '@mikro-orm/postgresql'
import type { OrganizationScope } from '@open-mercato/shared/lib/auth/principal-service'

// Groups are tenant-scoped, but the customers a membership points at are
// organization-scoped. Every membership read/write that names a customer — and
// the explain-terms panel — must therefore check that the customer is visible in
// the caller's organization scope, or a user limited to organization A could read
// or change the groups (and so the pricing and terms) of organization B's customers.
//
// `customers` is read here purely as data access (raw SQL against its known table
// name, taken from `customers/data/entities.ts` `@Entity({ tableName })`) — never as
// a module import — the same "FK-id + snapshot" coupling rule `lib/reconcile.ts`
// follows for `catalog`/`sales`.
const CUSTOMER_TABLE = 'customer_entities'

export type CustomerScope = {
  tenantId: string
  // Same contract as `CrudCtx.organizationIds`: `null` is an unrestricted caller,
  // an empty array is a caller with no visible organization.
  organizationIds: string[] | null
}

export async function isCustomerInScope(
  em: EntityManager,
  customerId: string,
  scope: CustomerScope,
  options: { includeDeleted?: boolean } = {},
): Promise<boolean> {
  const organizationIds = scope.organizationIds
  if (Array.isArray(organizationIds) && organizationIds.length === 0) return false
  const params: string[] = [customerId, scope.tenantId]
  let sql = `select 1 from ${CUSTOMER_TABLE} where id = ? and tenant_id = ?`
  if (!options.includeDeleted) sql += ' and deleted_at is null'
  if (Array.isArray(organizationIds)) {
    sql += ` and organization_id in (${organizationIds.map(() => '?').join(', ')})`
    params.push(...organizationIds)
  }
  sql += ' limit 1'
  const rows = await em.getConnection().execute(sql, params)
  return Array.isArray(rows) && rows.length > 0
}

// Hand-written routes resolve an `OrganizationScope` themselves; this derives the
// `organizationIds` list exactly the way `makeCrudRoute` derives `ctx.organizationIds`
// from the same scope, so the memberships CRUD and explain-terms enforce one rule.
export function organizationIdsFromScope(
  scope: OrganizationScope | null,
  fallbackOrganizationId: string | null,
): string[] | null {
  if (!scope) return fallbackOrganizationId ? [fallbackOrganizationId] : null
  const filterIds = Array.isArray(scope.filterIds)
    ? scope.filterIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : null
  if (filterIds === null) {
    if (scope.allowedIds === null) return null
    return fallbackOrganizationId ? [fallbackOrganizationId] : null
  }
  if (filterIds.length > 0) return Array.from(new Set(filterIds))
  if (!fallbackOrganizationId) return []
  const allowedIds = Array.isArray(scope.allowedIds) ? scope.allowedIds : null
  if (allowedIds === null || allowedIds.length === 0 || allowedIds.includes(fallbackOrganizationId)) {
    return [fallbackOrganizationId]
  }
  return []
}
