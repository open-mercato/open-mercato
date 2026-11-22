import type { EntityManager } from '@mikro-orm/postgresql'

export type DriverIdentity = {
  id: string
  fullName: string
  phone: string
  status: string
}

type Scope = { tenantId: string; organizationId: string }

function isMissingRelationError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('42P01') || /relation .* does not exist/i.test(message)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/**
 * Resolve the driver record linked to the authenticated staff user. The
 * transport module owns the register, so freight reads it by raw SQL with an
 * explicit tenant/organization scope and tolerates the module being absent –
 * the same pattern as `transportReference.ts`.
 */
export async function resolveDriverForUser(
  em: EntityManager,
  scope: Scope,
  userId: string,
): Promise<DriverIdentity | null> {
  try {
    const rows = await em.getConnection().execute<Record<string, unknown>[]>(
      `select id, full_name, phone, status from transport_drivers
       where tenant_id = ? and organization_id = ? and user_id = ? and deleted_at is null
       limit 1`,
      [scope.tenantId, scope.organizationId, userId],
    )
    const row = rows[0]
    if (!row) return null
    return {
      id: readString(row.id),
      fullName: readString(row.full_name),
      phone: readString(row.phone),
      status: readString(row.status),
    }
  } catch (err) {
    if (isMissingRelationError(err)) return null
    throw err
  }
}
