import type { EntityManager } from '@mikro-orm/postgresql'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'

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
 * That fail-soft design is also what hid #5599 for as long as it did — a broken
 * lookup and an absent user produce the identical outcome — so the two
 * properties the lookup depends on (the column it matches and the table it
 * names) are pinned by `__tests__/system-user.test.ts` rather than left to the
 * next reader to notice.
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
    // Match on `email_hash`, never on `email` (#5599). `users.email` is
    // encrypted at rest with a per-row IV, so its ciphertext is
    // non-deterministic and an equality filter against the plaintext can never
    // hit — which is exactly why the tenant uniqueness index keys on
    // `email_hash` instead (see `auth/data/entities.ts`). The candidate list
    // covers both the keyed `v2:` digest and the legacy unkeyed one, so a
    // deployment that has not yet backfilled still matches.
    //
    // The digests must be computed the same way `auth` writes them
    // (`auth/lib/emailHash.ts` → `hashForLookup(email)`), i.e. with NO hash
    // context. Reusing the shared primitive rather than importing the auth
    // helper keeps this module free of a cross-module code dependency; the two
    // must stay aligned if `auth` ever adopts a context.
    const emailHashes = lookupHashCandidates(expectedEmail)

    // Raw SQL against the table, not `createQueryBuilder('auth.users')`. That
    // call names no registered entity — entities are discovered under their
    // class names — so MikroORM reads the dot as a schema qualifier and looks
    // for `users` in a schema named `auth`, which this project never creates
    // (`Migration20251030150038` puts `users` in the default schema). The helper
    // swallows every error by design, so the miss was indistinguishable from
    // "no channel-bot user exists" and hid behind the same fallback as the
    // plaintext-vs-ciphertext defect above. A parameterized statement names the
    // table unambiguously and still pulls in no cross-module entity class,
    // keeping the decoupling this helper was written for.
    const placeholders = emailHashes.map(() => '?').join(', ')
    const rows = await em
      .getConnection()
      .execute<Array<{ id?: string }>>(
        `SELECT id FROM users WHERE email_hash IN (${placeholders}) AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
        [...emailHashes, tenantId],
      )
    const id = Array.isArray(rows) ? rows[0]?.id : undefined
    if (typeof id === 'string' && id.length > 0) return id
  } catch {
    // ignore — fall through to fallback
  }
  if (typeof fallbackId === 'string' && fallbackId.length > 0) return fallbackId
  return COMMUNICATION_CHANNELS_SYSTEM_USER_ID
}
