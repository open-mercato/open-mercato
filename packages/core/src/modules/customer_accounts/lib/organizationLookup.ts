import type { EntityManager } from '@mikro-orm/postgresql'

export type OrganizationLookupRow = {
  slug?: string | null
}

// Tenant-bound organization lookup. The (id, tenant_id) pair MUST match
// together so a mismatched body-supplied pair cannot cross-tenant a write.
// See .ai/lessons.md → "Keep raw SQL out of API route handlers".
export async function findOrganizationInTenant(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
): Promise<OrganizationLookupRow | null> {
  const rows = await em.getConnection().execute<OrganizationLookupRow[]>(
    `SELECT slug FROM organizations WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    [organizationId, tenantId],
  )
  return rows[0] ?? null
}
