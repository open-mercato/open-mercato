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

async function isCustomerTablePresent(em: EntityManager): Promise<boolean> {
  const rows = await em.getConnection().execute('select to_regclass(?) is not null as present', [CUSTOMER_TABLE])
  return Array.isArray(rows) && (rows[0] as { present?: unknown } | undefined)?.present === true
}

export type CustomerInScope = { organizationId: string | null }

// `customers` is optional: when its table is absent no customer can be resolved, so
// every reference reads as "not found" (the callers' existing 400/404 path).
export async function findCustomerInScope(
  em: EntityManager,
  customerId: string,
  scope: CustomerScope,
  options: { includeDeleted?: boolean } = {},
): Promise<CustomerInScope | null> {
  const organizationIds = scope.organizationIds
  if (Array.isArray(organizationIds) && organizationIds.length === 0) return null
  if (!(await isCustomerTablePresent(em))) return null
  const params: string[] = [customerId, scope.tenantId]
  let sql = `select organization_id from ${CUSTOMER_TABLE} where id = ? and tenant_id = ?`
  if (!options.includeDeleted) sql += ' and deleted_at is null'
  if (Array.isArray(organizationIds)) {
    sql += ` and organization_id in (${organizationIds.map(() => '?').join(', ')})`
    params.push(...organizationIds)
  }
  sql += ' limit 1'
  const rows = await em.getConnection().execute(sql, params)
  if (!Array.isArray(rows) || rows.length === 0) return null
  const row = rows[0] as { organization_id?: unknown } | null | undefined
  const organizationId = row && typeof row.organization_id === 'string' ? row.organization_id : null
  return { organizationId }
}

export async function isCustomerInScope(
  em: EntityManager,
  customerId: string,
  scope: CustomerScope,
  options: { includeDeleted?: boolean } = {},
): Promise<boolean> {
  return (await findCustomerInScope(em, customerId, scope, options)) !== null
}

// Membership ids whose customer is visible in the caller's organization scope. Used
// to narrow membership lists that do not name a customer (by group, by id, or
// unfiltered) so an organization-restricted caller never sees memberships of
// customers outside its organizations. Only call it for a restricted caller
// (`organizationIds` is an array); an empty array yields no ids.
export async function listMembershipIdsInCustomerScope(
  em: EntityManager,
  scope: CustomerScope & { organizationIds: string[] },
  filters: { groupId?: string | null; membershipId?: string | null } = {},
): Promise<string[]> {
  if (scope.organizationIds.length === 0) return []
  if (!(await isCustomerTablePresent(em))) return []
  const params: string[] = [scope.tenantId, scope.tenantId]
  let sql =
    `select m.id from customer_group_memberships m ` +
    `join ${CUSTOMER_TABLE} c on c.id = m.customer_id ` +
    `where m.tenant_id = ? and m.deleted_at is null and c.tenant_id = ?`
  sql += ` and c.organization_id in (${scope.organizationIds.map(() => '?').join(', ')})`
  params.push(...scope.organizationIds)
  if (filters.groupId) {
    sql += ' and m.group_id = ?'
    params.push(filters.groupId)
  }
  if (filters.membershipId) {
    sql += ' and m.id = ?'
    params.push(filters.membershipId)
  }
  const rows = await em.getConnection().execute(sql, params)
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => (row && typeof row === 'object' ? (row as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
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
