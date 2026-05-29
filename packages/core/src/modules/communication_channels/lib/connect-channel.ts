import type { EntityManager } from '@mikro-orm/postgresql'
import { CommunicationChannel } from '../data/entities'
import type { ChannelAdapter } from './adapter'

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
        ? 300
        : null
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
  await em.flush()
  return channel
}
