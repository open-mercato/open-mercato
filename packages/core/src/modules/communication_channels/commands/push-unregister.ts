import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CommunicationChannel } from '../data/entities'
import { getChannelAdapterRegistry } from '../lib/adapter-registry-singleton'
import { refreshCredentialsIfNeeded } from '../lib/credential-refresh'
import { POLLING_ONLY_DEFAULT_INTERVAL_SECONDS } from '../lib/connect-channel'
import { emitCommunicationChannelsEvent } from '../events'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'push-unregister' })

/**
 * Spec C § Phase C5 — Tear down a previously-registered push delivery.
 *
 * Called from `disconnect-channel.ts` (per-user disconnect path) so the
 * provider-side `users.watch` subscription doesn't keep firing
 * notifications at a webhook that no longer recognises the channel.
 *
 * Idempotent + best-effort: a missing registration, a 404 from the provider,
 * or any adapter error is logged but never raised. The caller still proceeds
 * with the disconnect (the channel row is cleared regardless of whether the
 * provider-side teardown succeeded).
 *
 * Companion to `commands/push-register.ts` — same lib-style helper shape,
 * not a `registerCommand`-style command (push lifecycle has no undo).
 */

export const pushUnregisterSchema = z.object({
  channelId: z.string().uuid(),
})

export interface PushUnregisterScope {
  tenantId: string
  organizationId: string
  userId?: string | null
}

export interface PushUnregisterResult {
  channelId: string
  status: 'unregistered' | 'noop' | 'failed'
  error?: { code: string; message: string }
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
  save?: (
    integrationId: string,
    credentials: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<void>
}

export async function pushUnregister(params: {
  container: AwilixContainer
  scope: PushUnregisterScope
  input: { channelId: string }
}): Promise<PushUnregisterResult> {
  const input = pushUnregisterSchema.parse(params.input)
  const { container, scope } = params

  const em = (container.resolve('em') as EntityManager).fork()
  const dscope = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: input.channelId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    dscope,
  )
  if (!channel) {
    return { channelId: input.channelId, status: 'noop' }
  }

  const adapter = getChannelAdapterRegistry().get(channel.providerKey)
  if (!adapter || typeof adapter.unregisterPush !== 'function') {
    return { channelId: channel.id, status: 'noop' }
  }

  const channelState = (channel.channelState as Record<string, unknown> | null) ?? {}
  const pushStatus = typeof channelState.pushStatus === 'string' ? channelState.pushStatus : null
  if (!pushStatus || pushStatus === 'inactive') {
    return { channelId: channel.id, status: 'noop' }
  }

  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = container.resolve('integrationCredentialsService') as CredentialsServiceLike
  } catch {
    credentialsService = null
  }
  // Resolve credentials at the channel's OWN org (tenant-wide channels store
  // their credentials at `organization_id = tenantId`; see push-register.ts /
  // connect-credential-channel.ts), never the caller's scope org.
  const credentialsScope = {
    tenantId: scope.tenantId,
    organizationId: channel.organizationId ?? scope.tenantId,
    userId: channel.userId ?? null,
  }
  let credentials: Record<string, unknown> = {}
  if (channel.credentialsRef && credentialsService) {
    try {
      credentials =
        (await credentialsService.resolve(`channel_${channel.providerKey}`, credentialsScope)) ?? {}
    } catch {
      credentials = {}
    }
  }
  try {
    const refreshed = await refreshCredentialsIfNeeded(
      { adapter, channelId: channel.id, credentials, scope: credentialsScope },
      { credentialsService },
    )
    credentials = refreshed.credentials
  } catch {
    // Refresh failure is non-fatal — unregister tolerates expired tokens
    // because the provider will simply return 401, which the adapter swallows
    // or we ignore below.
  }

  try {
    await adapter.unregisterPush({
      channelId: channel.id,
      credentials,
      scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
      channelState,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('adapter.unregisterPush failed for channel', { channelId: channel.id, reason: message })
    return {
      channelId: channel.id,
      status: 'failed',
      error: { code: 'adapter_unregister_failed', message: message.slice(0, 500) },
    }
  }

  // Clear push markers from channel state so a subsequent reconnect starts
  // fresh.
  channel.channelState = {
    ...channelState,
    pushStatus: 'inactive',
    watchExpirationMs: null,
  }
  // Restore the polling-only default cadence (matching connect) so the channel
  // keeps working until disconnect itself flips `isActive: false`.
  channel.pollIntervalSeconds = POLLING_ONLY_DEFAULT_INTERVAL_SECONDS
  await em.flush()

  await emitCommunicationChannelsEvent(
    'communication_channels.push.deactivated',
    {
      channelId: channel.id,
      providerKey: channel.providerKey,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      reason: 'unregistered',
    },
    { persistent: true },
  )

  return { channelId: channel.id, status: 'unregistered' }
}
