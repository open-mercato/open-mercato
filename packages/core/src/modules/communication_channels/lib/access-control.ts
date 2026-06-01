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
 * Throws when the caller may not access a specific channel. Returns silently
 * when access is allowed.
 *
 * Personal mailbox privacy (v1: strict owner-only). A per-user channel
 * (`userId` set) may be acted on ONLY by its owner — not even an admin /
 * superadmin can poll, test-send, import history from, register push on, or
 * delete another user's personal mailbox. Tenant-wide channels
 * (`userId == null`, e.g. WhatsApp Business / Slack workspaces) remain
 * accessible to any caller the route already feature-gated.
 *
 * `userFeatures` is retained on the signature (callers pass it) but no longer
 * grants a bypass; it is reserved for the v2 admin-oversight feature.
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
  void userFeatures
  // Tenant-wide / shared channel — accessible to all callers.
  if (channel.userId == null) return
  // Personal mailbox — owner only, regardless of admin grants (v1).
  if (channel.userId !== currentUserId) {
    throw new ChannelAccessDeniedError(
      'Channel is a personal mailbox owned by another user',
    )
  }
}

/**
 * Authorization for MANAGING (mutating) a channel — disconnect, poll, set
 * primary, import history, register push. Encodes the per-user ownership rule:
 *
 *   - **Personal mailbox** (`userId` set): the **owner has full control** of
 *     their own account; any other caller — admin included — is denied (v1
 *     strict owner-only, no bypass). Routes gate these on
 *     `communication_channels.connect_user_channel` so every email user reaches
 *     this check for their own channels.
 *   - **Tenant-wide / shared channel** (`userId == null`, e.g. WhatsApp
 *     Business / Slack workspaces): requires the route's `elevatedFeature`
 *     (`communication_channels.manage`, `…channel.push.manage`, or
 *     `…channel.import_history`). Wildcard-aware via {@link hasFeature}.
 *
 * Throws `ChannelAccessDeniedError` (route handlers map it to 404, masking
 * existence) when the caller may not manage the channel.
 */
export function assertCanManageChannel(
  channel: { userId?: string | null } | null | undefined,
  currentUserId: string | null | undefined,
  userFeatures: string[] | null | undefined,
  elevatedFeature: string,
): void {
  if (!channel) {
    throw new Error('Channel not found')
  }
  // Personal mailbox — owner only. The owner manages their own account fully
  // (gated by connect_user_channel at the route); no admin bypass in v1.
  if (channel.userId != null) {
    if (channel.userId !== currentUserId) {
      throw new ChannelAccessDeniedError('Channel is a personal mailbox owned by another user')
    }
    return
  }
  // Tenant-wide / shared channel — requires the elevated management feature.
  const grantedFeatures = Array.isArray(userFeatures) ? userFeatures : []
  if (!hasFeature(grantedFeatures, elevatedFeature)) {
    throw new ChannelAccessDeniedError(`Managing a shared channel requires '${elevatedFeature}'`)
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
