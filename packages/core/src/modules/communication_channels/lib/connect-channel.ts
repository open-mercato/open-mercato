import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import type { ChannelAdapter } from './adapter'
import { isUniqueViolation } from './pg-errors'

/**
 * Default poll cadence (seconds) for a polling-only channel — one whose adapter
 * declares `realtimePush: false`. Push-capable channels use `null` (push-driven,
 * no fixed poll). Shared so push teardown restores the same cadence connect uses.
 */
export const POLLING_ONLY_DEFAULT_INTERVAL_SECONDS = 300

/**
 * Thrown by {@link createConnectedChannelRow} when the same mailbox
 * (`externalIdentifier`) is already connected for this user via a DIFFERENT
 * provider. Both channels would poll the same inbox, and the per-channel
 * `(channel_id, external_message_id)` dedup cannot dedupe the same email across
 * channels — so every message would be ingested (and threaded) twice.
 */
export class MailboxAlreadyConnectedError extends Error {
  readonly externalIdentifier: string
  readonly existingProviderKey: string
  constructor(externalIdentifier: string, existingProviderKey: string) {
    super(`Mailbox ${externalIdentifier} is already connected via ${existingProviderKey}`)
    this.name = 'MailboxAlreadyConnectedError'
    this.externalIdentifier = externalIdentifier
    this.existingProviderKey = existingProviderKey
  }
}

export interface CreateConnectedChannelRowArgs {
  em: EntityManager
  adapter: Pick<ChannelAdapter, 'channelType' | 'capabilities'>
  providerKey: string
  displayName: string
  externalIdentifier: string | null
  credentialsRefId: string | null
  /** Connecting user, or `null` for a tenant-wide channel (push: FCM/APNs/Expo). */
  userId: string | null
  scope: { tenantId: string; organizationId: string | null }
  /**
   * Explicit poll-interval override (seconds). When omitted, it is derived from
   * the adapter's push capability (push-capable → null, polling-only → 300).
   */
  pollIntervalSeconds?: number | null
}

/**
 * Create + persist a `CommunicationChannel` row for a connect flow. `userId` is
 * the connecting user for per-user channels (Gmail/IMAP) or `null` for tenant-wide
 * channels (push: FCM/APNs/Expo). Shared by the credential-connect command and the
 * OAuth callback so both entry points use one channel-shape implementation instead
 * of duplicating `em.create`.
 *
 * When credentials could not be persisted (`credentialsRefId === null`) the row
 * is created in `requires_reauth` + `isActive=false` so workers don't poll a
 * credential-less channel; the user reconnects to recover.
 */
export async function createConnectedChannelRow(
  args: CreateConnectedChannelRowArgs,
): Promise<CommunicationChannel> {
  const { em, adapter, providerKey, displayName, externalIdentifier, credentialsRefId, userId, scope } = args
  const credentialsAvailable = credentialsRefId !== null

  // A tenant-wide push channel (FCM/APNs/Expo, `user_id = NULL`) is a mailbox-less channel keyed on
  // (tenant, provider, channel_type='push', user_id NULL), enforced by
  // `communication_channels_tenant_push_provider_uq`. Push credential schemas are `.passthrough()`, so a
  // stray `email`/`username`/`fromAddress` key can leak through the connect command as an
  // `externalIdentifier`. Left in place it would send a push reconnect down the mailbox dedup branch
  // below — which never matches the existing push row — so the INSERT hits the tenant-push unique index,
  // and the mailbox recovery filter can't find the winner ⇒ an unrecoverable 500. Drop the stray
  // identifier for tenant-wide push so the guard, the dedup key, and the stored row all stay consistent
  // with that index.
  const isTenantWidePush = adapter.channelType === 'push' && userId === null
  const effectiveExternalIdentifier = isTenantWidePush ? null : externalIdentifier
  const pollIntervalSeconds =
    args.pollIntervalSeconds !== undefined
      ? args.pollIntervalSeconds
      : adapter.capabilities?.realtimePush === false
        ? POLLING_ONLY_DEFAULT_INTERVAL_SECONDS
        : null
  const dscope = { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null }

  // Cross-provider duplicate guard: the same mailbox must not be connected via
  // two providers for one user. Both channels would poll the same inbox, and the
  // per-channel `(channel_id, external_message_id)` dedup cannot dedupe the same
  // email across channels — so every message would be ingested (and threaded)
  // twice. Reconnecting the SAME provider/mailbox is fine (healed below); this
  // only blocks a DIFFERENT provider for an already-connected address.
  if (effectiveExternalIdentifier) {
    const normalized = effectiveExternalIdentifier.toLowerCase()
    const userChannels = (await findWithDecryption(
      em,
      CommunicationChannel,
      { tenantId: scope.tenantId, userId, deletedAt: null },
      undefined,
      dscope,
    )) as CommunicationChannel[]
    const conflict = userChannels.find(
      (existing) =>
        existing.providerKey !== providerKey &&
        typeof existing.externalIdentifier === 'string' &&
        existing.externalIdentifier.toLowerCase() === normalized,
    )
    if (conflict) {
      throw new MailboxAlreadyConnectedError(effectiveExternalIdentifier, conflict.providerKey)
    }
  }

  // Heal-on-reconnect dedup key. Two shapes:
  //  - mailbox channels (Gmail/IMAP): keyed on (tenant, user, provider, mailbox);
  //    only rows with a known `externalIdentifier` participate.
  //  - tenant-wide push channels (FCM/APNs/Expo): no mailbox, `user_id = NULL`, so
  //    keyed on (tenant, provider, channel_type='push', user_id NULL). Without this
  //    every admin reconnect would insert a duplicate (fan-out takes the oldest per
  //    provider, so duplicates are silent noise + a concurrent-connect race).
  // `null` ⇒ no dedup key (identifier-less non-push channel): always insert.
  const dedupeFilter = isTenantWidePush
    ? {
        tenantId: scope.tenantId,
        userId: null,
        providerKey,
        channelType: 'push',
        deletedAt: null,
      }
    : effectiveExternalIdentifier
      ? {
          tenantId: scope.tenantId,
          userId,
          providerKey,
          externalIdentifier: effectiveExternalIdentifier,
          deletedAt: null,
        }
      : null

  // Heal-on-reconnect: a channel for the same dedup key already exists when the
  // user re-runs OAuth / reconnects after a `requires_reauth`, or an admin
  // re-submits a tenant push provider's credentials. Update it in place rather
  // than inserting a duplicate row — a duplicate would stay `isActive` and keep
  // polling + re-emitting reauth banners, and register a second competing push
  // subscription. Backed by the partial unique indexes
  // `communication_channels_user_provider_external_uq` (mailbox) and
  // `communication_channels_tenant_push_provider_uq` (tenant push).
  const applyConnectionState = (target: CommunicationChannel): void => {
    target.channelType = adapter.channelType
    target.displayName = displayName
    target.externalIdentifier = effectiveExternalIdentifier ?? null
    target.credentialsRef = credentialsRefId
    target.capabilities = adapter.capabilities as unknown as Record<string, unknown>
    target.isActive = credentialsAvailable
    target.pollIntervalSeconds = pollIntervalSeconds
    target.status = credentialsAvailable ? 'connected' : 'requires_reauth'
    target.lastError = credentialsAvailable ? null : 'credentials_persist_failed'
  }

  if (dedupeFilter) {
    const existing = await findOneWithDecryption(em, CommunicationChannel, dedupeFilter, undefined, dscope)
    if (existing) {
      applyConnectionState(existing)
      await em.flush()
      return existing
    }
  }

  const channel = em.create(CommunicationChannel, {
    providerKey,
    channelType: adapter.channelType,
    displayName,
    externalIdentifier: effectiveExternalIdentifier ?? null,
    credentialsRef: credentialsRefId,
    capabilities: adapter.capabilities as unknown as Record<string, unknown>,
    isActive: credentialsAvailable,
    userId,
    isPrimary: false,
    pollIntervalSeconds,
    status: credentialsAvailable ? 'connected' : 'requires_reauth',
    lastError: credentialsAvailable ? null : 'credentials_persist_failed',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId ?? null,
  })
  em.persist(channel)
  try {
    await em.flush()
    return channel
  } catch (err) {
    // Concurrent connect for the same mailbox won the race (partial unique index
    // rejected ours). Re-select the winner on a clean fork and heal it so the
    // caller still gets a single, connected channel.
    if (!isUniqueViolation(err) || !dedupeFilter) throw err
    const reEm = em.fork()
    const winner = await findOneWithDecryption(reEm, CommunicationChannel, dedupeFilter, undefined, dscope)
    if (!winner) throw err
    applyConnectionState(winner)
    await reEm.flush()
    return winner
  }
}
