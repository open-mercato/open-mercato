import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'

/**
 * Per-user channel access control — service-layer authorization helpers.
 *
 * Personal mailbox privacy (v1: strict owner-only). A per-user channel
 * (`userId` set) may be read or managed ONLY by its owner — not even an admin
 * or superadmin can act on another user's personal mailbox. Tenant-wide /
 * shared channels (`userId == null`, e.g. WhatsApp Business / Slack workspaces)
 * remain accessible to any caller the route already feature-gated.
 *
 * Routes also narrow at the SQL layer (the admin channel list returns
 * `user_id IS NULL` rows only; the profile list filters `user_id =
 * currentUser.id`); these helpers are the per-channel authorization backstop a
 * route calls once it has loaded the row.
 */

export const ADMIN_FEATURE = 'communication_channels.admin'

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
    // Defensive: callers pre-check existence and return 404, so this is
    // unreachable in practice. Throw the typed access error (route-mapped to a
    // masked 404) rather than a bare Error that would surface as a 500.
    throw new ChannelAccessDeniedError('Channel not found')
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
 *     `…channel.import_history`). Evaluated by the shared feature policy.
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
    // Defensive: callers pre-check existence and return 404, so this is
    // unreachable in practice. Throw the typed access error (route-mapped to a
    // masked 404) rather than a bare Error that would surface as a 500.
    throw new ChannelAccessDeniedError('Channel not found')
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
  if (!authorizeFeatures([elevatedFeature], { grantedFeatures })) {
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
