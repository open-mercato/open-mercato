import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import type { ChannelAdapter } from './adapter'
import { isUniqueViolation } from './pg-errors'

/**
 * Default poll cadence (seconds) for a polling-only channel — one whose adapter
 * declares `realtimePush: false`. Push-capable channels use `null` (push-driven,
 * no fixed poll). Shared so push teardown restores the same cadence connect uses.
 */
export const POLLING_ONLY_DEFAULT_INTERVAL_SECONDS = 300

export interface CreateConnectedChannelRowArgs {
  em: EntityManager
  adapter: Pick<ChannelAdapter, 'channelType' | 'capabilities'>
  providerKey: string
  displayName: string
  externalIdentifier: string | null
  credentialsRefId: string | null
  userId: string
  scope: { tenantId: string; organizationId: string | null }
  /**
   * Explicit poll-interval override (seconds). When omitted, it is derived from
   * the adapter's push capability (push-capable → null, polling-only → 300).
   */
  pollIntervalSeconds?: number | null
}

/**
 * Create + persist the per-user `CommunicationChannel` row for a connect flow.
 * Shared by the credential-connect command and the OAuth callback so both entry
 * points use one channel-shape implementation instead of duplicating `em.create`.
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
  const pollIntervalSeconds =
    args.pollIntervalSeconds !== undefined
      ? args.pollIntervalSeconds
      : adapter.capabilities?.realtimePush === false
        ? POLLING_ONLY_DEFAULT_INTERVAL_SECONDS
        : null
  const dscope = { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null }
  const naturalKey = {
    tenantId: scope.tenantId,
    userId,
    providerKey,
    externalIdentifier,
    deletedAt: null,
  }

  // Heal-on-reconnect: a channel for the same (tenant, user, provider, mailbox)
  // already exists when the user re-runs OAuth / reconnects after a
  // `requires_reauth`. Update it in place rather than inserting a duplicate row —
  // a duplicate would stay `isActive` and keep polling + re-emitting reauth
  // banners, and register a second competing push subscription. Only mailboxes
  // with a known `externalIdentifier` participate (the unique index is partial).
  const applyConnectionState = (target: CommunicationChannel): void => {
    target.channelType = adapter.channelType
    target.displayName = displayName
    target.externalIdentifier = externalIdentifier ?? null
    target.credentialsRef = credentialsRefId
    target.capabilities = adapter.capabilities as unknown as Record<string, unknown>
    target.isActive = credentialsAvailable
    target.pollIntervalSeconds = pollIntervalSeconds
    target.status = credentialsAvailable ? 'connected' : 'requires_reauth'
    target.lastError = credentialsAvailable ? null : 'credentials_persist_failed'
  }

  if (externalIdentifier) {
    const existing = await findOneWithDecryption(em, CommunicationChannel, naturalKey, undefined, dscope)
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
    externalIdentifier: externalIdentifier ?? null,
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
    if (!isUniqueViolation(err) || !externalIdentifier) throw err
    const reEm = em.fork()
    const winner = await findOneWithDecryption(reEm, CommunicationChannel, naturalKey, undefined, dscope)
    if (!winner) throw err
    applyConnectionState(winner)
    await reEm.flush()
    return winner
  }
}
