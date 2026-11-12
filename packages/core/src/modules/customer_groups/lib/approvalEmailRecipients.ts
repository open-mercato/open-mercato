import type { EntityManager } from '@mikro-orm/postgresql'

// Release 5 Phase 4 (G5/G15, D-R5-1/D-R5-6, Step 2.7). Same FK-id-only, direct-SQL
// coupling `lib/creditIdentity.ts` already established for `customer_accounts`'
// own tables — no ORM import of `customer_accounts` (`packages/core/AGENTS.md` →
// Cross-Module Coupling: FK-id + snapshot). `customer_accounts` is an optional peer
// of `customer_groups`; callers resolve `customerRbacService` through `tryResolve`
// and simply skip e-mail recipient resolution when it is absent.
const CUSTOMER_USERS_TABLE = 'customer_users'

// #8268 review Major 2: `customer_users.email` is encrypted at rest
// (`customer_accounts/encryption.ts`'s `customer_accounts:customer_user` map) — a plain
// SQL read returns ciphertext, which `approvalEmails.ts` would otherwise send straight
// to as the recipient address. Same container-resolved `tenantEncryptionService`
// pattern `warranty_claims/commands/claims.ts#resolveCustomerName` already uses for a
// cross-module decrypt without an ORM import of the owning module.
const CUSTOMER_USER_ENTITY_ID = 'customer_accounts:customer_user'

export type CompanyCustomerUserCandidate = { id: string; email: string }

export type EncryptionServiceLike = {
  decryptEntityPayload(
    entityId: string,
    payload: Record<string, unknown>,
    tenantId: string | null | undefined,
    organizationId?: string | null,
  ): Promise<Record<string, unknown>>
}

export type RecipientResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

function tryResolveEncryptionService(container: RecipientResolverContainer | undefined): EncryptionServiceLike | null {
  if (!container) return null
  try {
    return container.resolve<EncryptionServiceLike>('tenantEncryptionService') ?? null
  } catch {
    return null
  }
}

async function decryptEmailField(
  encryption: EncryptionServiceLike | null,
  row: Record<string, unknown>,
  tenantId: string,
): Promise<Record<string, unknown>> {
  if (!encryption) return row
  return encryption.decryptEntityPayload(CUSTOMER_USER_ENTITY_ID, row, tenantId)
}

// Every active `CustomerUser` of a company, with a valid e-mail — the RAW candidate
// set before the caller filters by the portal decide feature (which requires
// `customerRbacService`, not available from a plain SQL query).
export async function listCompanyCustomerUserCandidates(
  em: EntityManager,
  customerEntityId: string,
  tenantId: string,
  container?: RecipientResolverContainer,
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
  const encryption = tryResolveEncryptionService(container)
  const candidates: CompanyCustomerUserCandidate[] = []
  for (const row of rows as Array<{ id?: unknown; email?: unknown }>) {
    if (typeof row.id !== 'string' || typeof row.email !== 'string' || row.email.length === 0) continue
    const decrypted = await decryptEmailField(encryption, { email: row.email }, tenantId)
    const email = decrypted.email
    if (typeof email === 'string' && email.length > 0) {
      candidates.push({ id: row.id, email })
    }
  }
  return candidates
}

export async function resolveCustomerUserEmail(
  em: EntityManager,
  customerUserId: string,
  tenantId: string,
  container?: RecipientResolverContainer,
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
  if (typeof row?.email !== 'string' || row.email.length === 0) return null
  const encryption = tryResolveEncryptionService(container)
  const decrypted = await decryptEmailField(encryption, { email: row.email }, tenantId)
  const email = decrypted.email
  return typeof email === 'string' && email.length > 0 ? email : null
}
