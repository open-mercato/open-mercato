import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'

/**
 * Subscriber: cascade-disconnect a user's communication channels when the user
 * is deleted (`auth.user.deleted` event).
 *
 * Why a subscriber, not a foreign-key CASCADE: per root `AGENTS.md`, modules
 * don't form direct ORM relationships across the auth module boundary —
 * `CommunicationChannel.userId` is a plain `uuid` column, not a FK. The
 * cascade must therefore happen at the event-bridge layer, here, in response
 * to the auth module's lifecycle event.
 *
 * Effects per matched channel:
 *   1. `status = 'disconnected'`        — stops the polling worker (slice 3b
 *                                          skips channels not in `connected`).
 *   2. `is_active = false`              — hides the channel from the hub admin
 *                                          UI and stops adapter resolution.
 *   3. `credentials_ref = null`         — orphans the encrypted credentials
 *                                          blob in `integration_credentials`
 *                                          (the integrations module's own
 *                                          retention policy then sweeps it).
 *   4. `last_error = 'user-deleted'`    — diagnostic breadcrumb.
 *
 * The channel row itself is NOT hard-deleted — keeping it preserves the audit
 * trail of which user owned it and the conversation history that still lives
 * in `external_messages` / `messages`. A future tenant-level GDPR sweep can
 * hard-delete on a schedule.
 *
 * Idempotency: the update is conditional on `status != 'disconnected'`, so
 * replays from the event bus are no-ops.
 */
export const metadata = {
  event: 'auth.user.deleted',
  persistent: true,
  id: 'communication_channels:user-deleted-cascade',
}

type AuthUserDeletedPayload = {
  userId: string
  tenantId?: string
  organizationId?: string | null
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handler(
  payload: AuthUserDeletedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (!payload || typeof payload.userId !== 'string' || !payload.userId) {
    return
  }
  // tenantId MUST be present: an unscoped cascade would touch rows in arbitrary
  // tenants if two tenants ever happened to share a userId (impossible under
  // UUIDv4 but possible after backup-restore). Fail-closed: skip when missing
  // and let an out-of-band sweep clean up.
  if (typeof payload.tenantId !== 'string' || !payload.tenantId) {
    return
  }
  const em = (ctx.resolve('em') as EntityManager).fork()

  const channels = await findWithDecryption(
    em,
    CommunicationChannel,
    {
      userId: payload.userId,
      tenantId: payload.tenantId,
      ...(payload.organizationId !== undefined
        ? { organizationId: payload.organizationId ?? null }
        : {}),
      deletedAt: null,
    },
    undefined,
    {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    },
  )
  if (channels.length === 0) return

  let touched = 0
  for (const channel of channels) {
    // Already disconnected → idempotent skip.
    if (channel.status === 'disconnected' && channel.isActive === false) continue
    channel.status = 'disconnected'
    channel.isActive = false
    channel.credentialsRef = null
    channel.lastError = 'user-deleted'
    channel.isPrimary = false
    channel.lastPolledAt = new Date()
    touched += 1
  }
  if (touched > 0) {
    await em.flush()
  }
}
