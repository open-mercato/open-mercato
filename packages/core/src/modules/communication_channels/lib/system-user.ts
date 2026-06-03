import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Sentinel UUID — used as a last-resort `senderUserId` for inbound channel
 * messages when no per-tenant system user is available. Matches the pattern
 * in `inbox_ops/lib/messagesIntegration.ts`.
 */
export const COMMUNICATION_CHANNELS_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Configurable email pattern for per-tenant channel-bot users. Implementations
 * (provider packages, onboarding scripts) may create a real `auth.user` row
 * matching this convention so inbound channel messages get a meaningful sender
 * display name in the unified inbox.
 *
 * Format: `system+communication_channels@<tenantId>.local`
 */
export function systemUserEmail(tenantId: string): string {
  return `system+communication_channels@${tenantId}.local`
}

/**
 * Resolve a tenant-scoped system user id to attribute inbound channel messages to.
 *
 * Lookup order:
 *   1. Per-tenant channel-bot user (by convention email — see `systemUserEmail`).
 *   2. (Optional, caller-supplied) seed fallback — a specific override id.
 *   3. Sentinel UUID (`00000000-...`) — backward-compatible default.
 *
 * The function is fail-soft: when the lookup throws, it falls back to the
 * sentinel. The inbound-processor must never refuse to ingest a message
 * because the channel-bot user doesn't exist.
 *
 * @param em            EntityManager scoped to the tenant.
 * @param tenantId      Tenant id for which to resolve the system user.
 * @param fallbackId    Optional caller-supplied fallback (e.g., the channel's
 *                      assigned user) used when the channel-bot lookup misses.
 */
export async function resolveCommunicationChannelsSystemUserId(
  em: EntityManager,
  tenantId: string,
  fallbackId?: string | null,
): Promise<string> {
  try {
    const expectedEmail = systemUserEmail(tenantId)
    // Untyped QB by design — the helper is intentionally cross-module
    // (resolving an `auth.user` from the hub) and must not pull the User
    // entity class. MikroORM v7's typed builder requires an entity ref;
    // we keep the lookup table-name-driven so the helper compiles without
    // a cross-module import. The mocks in `__tests__/system-user.test.ts`
    // exercise this code path through a duck-typed `createQueryBuilder` stub.
    type RawQueryBuilder = {
      select: (fields: string[]) => RawQueryBuilder
      where: (cond: Record<string, unknown>) => RawQueryBuilder
      limit: (count: number) => RawQueryBuilder
      execute: (mode: string) => Promise<unknown>
    }
    const qb = (
      em as unknown as { createQueryBuilder: (table: string, alias: string) => RawQueryBuilder }
    ).createQueryBuilder('auth.users', 'u')
    const row = await qb
      .select(['u.id'])
      .where({ email: expectedEmail, tenant_id: tenantId })
      .limit(1)
      .execute('get')
      .catch(() => null)
    const id = (row as { id?: string } | null)?.id
    if (typeof id === 'string' && id.length > 0) return id
  } catch {
    // ignore — fall through to fallback
  }
  if (typeof fallbackId === 'string' && fallbackId.length > 0) return fallbackId
  return COMMUNICATION_CHANNELS_SYSTEM_USER_ID
}
