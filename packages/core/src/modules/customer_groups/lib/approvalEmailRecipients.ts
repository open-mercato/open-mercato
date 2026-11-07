import type { EntityManager } from '@mikro-orm/postgresql'

// Release 5 Phase 4 (G5/G15, D-R5-1/D-R5-6, Step 2.7). Same FK-id-only, direct-SQL
// coupling `lib/creditIdentity.ts` already established for `customer_accounts`'
// own tables — no ORM import of `customer_accounts` (`packages/core/AGENTS.md` →
// Cross-Module Coupling: FK-id + snapshot). `customer_accounts` is an optional peer
// of `customer_groups`; callers resolve `customerRbacService` through `tryResolve`
// and simply skip e-mail recipient resolution when it is absent.
const CUSTOMER_USERS_TABLE = 'customer_users'

export type CompanyCustomerUserCandidate = { id: string; email: string }

// Every active `CustomerUser` of a company, with a valid e-mail — the RAW candidate
// set before the caller filters by the portal decide feature (which requires
// `customerRbacService`, not available from a plain SQL query).
export async function listCompanyCustomerUserCandidates(
  em: EntityManager,
  customerEntityId: string,
  tenantId: string,
): Promise<CompanyCustomerUserCandidate[]> {
  const rows = await em
    .getConnection()
    .execute(
      `select id, email from ${CUSTOMER_USERS_TABLE}
       where tenant_id = ? and customer_entity_id = ? and deleted_at is null and is_active = true
         and email is not null and email <> ''`,
      [tenantId, customerEntityId],
    )
  if (!Array.isArray(rows)) return []
  const candidates: CompanyCustomerUserCandidate[] = []
  for (const row of rows as Array<{ id?: unknown; email?: unknown }>) {
    if (typeof row.id === 'string' && typeof row.email === 'string' && row.email.length > 0) {
      candidates.push({ id: row.id, email: row.email })
    }
  }
  return candidates
}

export async function resolveCustomerUserEmail(
  em: EntityManager,
  customerUserId: string,
  tenantId: string,
): Promise<string | null> {
  const rows = await em
    .getConnection()
    .execute(
      `select email from ${CUSTOMER_USERS_TABLE}
       where id = ? and tenant_id = ? and deleted_at is null and is_active = true
       limit 1`,
      [customerUserId, tenantId],
    )
  const row = Array.isArray(rows) ? (rows[0] as { email?: unknown } | undefined) : undefined
  return typeof row?.email === 'string' && row.email.length > 0 ? row.email : null
}
