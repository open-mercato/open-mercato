import { hasFeature } from '@open-mercato/shared/security/features'

/**
 * Per-user channel access control — service-layer filter helpers.
 *
 * Email integration spec § Hub Deltas → Delta 8: every list / read / write path
 * over channels MUST scope by `user_id = currentUser.id OR user_id IS NULL`
 * unless the caller holds `communication_channels.admin`. This file centralises
 * the rule so route handlers + workers can apply it consistently.
 *
 * IMPORTANT: this is **defence in depth** on top of the SQL-level filter. Routes
 * should still narrow at the database query layer; the helper here also surfaces
 * the rule in code so reviewers can grep for it.
 */

export const ADMIN_FEATURE = 'communication_channels.admin'

/**
 * Returns `true` when the caller can see channels owned by other users.
 * Honours wildcard grants (`*`, `communication_channels.*`).
 */
export function callerHasChannelAdmin(userFeatures: string[] | null | undefined): boolean {
  if (!Array.isArray(userFeatures) || userFeatures.length === 0) return false
  return hasFeature(userFeatures, ADMIN_FEATURE)
}

/**
 * Filter shape understood by both the data engine and direct EntityManager
 * reads — a `$or` array combining "owned by current user" + "tenant-wide".
 *
 * Keys use the entity property name (`userId`, camelCase) — MikroORM's default
 * `NamingStrategy` maps that to the `user_id` column at query time. Don't be
 * tempted to use snake_case here, the filter will be silently ignored.
 */
export type PerUserChannelFilter =
  | undefined
  | {
      $or: Array<{ userId: string } | { userId: null }>
    }

/**
 * Build the per-user filter or return `undefined` when the caller has admin
 * privileges (no filter needed). Callers pass the result straight into their
 * EntityManager read `where` argument:
 *
 * ```ts
 * const filter = buildPerUserChannelFilter(currentUserId, userFeatures)
 * const channels = await findWithDecryption(em, CommunicationChannel, {
 *   tenantId,
 *   deletedAt: null,
 *   ...(filter ?? {}),
 * })
 * ```
 */
export function buildPerUserChannelFilter(
  currentUserId: string | null | undefined,
  userFeatures: string[] | null | undefined,
): PerUserChannelFilter {
  if (callerHasChannelAdmin(userFeatures)) return undefined
  if (!currentUserId) {
    // No user context — restrict to tenant-wide channels only.
    return { $or: [{ userId: null }] }
  }
  return { $or: [{ userId: currentUserId }, { userId: null }] }
}

/**
 * Throws when the caller may not access a specific channel (i.e. the channel is
 * owned by another user and the caller does not have admin). Returns silently
 * when access is allowed.
 *
 * Callers MUST pass the fully decrypted channel row — we read `userId` directly.
 */
export function assertCanAccessChannel(
  channel: { userId?: string | null } | null | undefined,
  currentUserId: string | null | undefined,
  userFeatures: string[] | null | undefined,
): void {
  if (!channel) {
    throw new Error('Channel not found')
  }
  if (callerHasChannelAdmin(userFeatures)) return
  // Tenant-wide channel — visible to all callers (back-compat with existing
  // WhatsApp Business / Slack workspace channels).
  if (channel.userId == null) return
  if (channel.userId !== currentUserId) {
    throw new ChannelAccessDeniedError(
      `Channel is owned by another user; requires '${ADMIN_FEATURE}' feature`,
    )
  }
}

/**
 * Stable error class so route handlers can map to a 403 instead of leaking the
 * underlying message verbatim. Subclasses `Error` for compatibility with the
 * platform's error logging helpers.
 */
export class ChannelAccessDeniedError extends Error {
  override name = 'ChannelAccessDeniedError'
  readonly statusCode = 403
}
