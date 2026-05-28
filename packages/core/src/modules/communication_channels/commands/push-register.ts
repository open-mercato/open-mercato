import { z } from 'zod'
import crypto from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { getChannelAdapterRegistry } from '../lib/adapter-registry-singleton'
import { refreshCredentialsIfNeeded } from '../lib/credential-refresh'
import { emitCommunicationChannelsEvent } from '../events'
import type { PushRegistration } from '../lib/adapter'

/**
 * Spec C § Phase C5 — Register provider push delivery for a channel.
 *
 * Resolves credentials + tenant OAuth client config, mints a fresh
 * `clientState` (Microsoft only) and persists it encrypted, then calls
 * `adapter.registerPush(...)`. Applies the returned state patch to
 * `channel.channelState` and flips `pollIntervalSeconds` to the
 * adapter's recommendation (or leaves it as-is on failure so polling
 * fallback continues).
 *
 * Idempotent: calling on a channel that already has `pushStatus='active'`
 * is OK — the adapter re-issues the underlying registration and we update
 * the cursor / expiry to the new value.
 */

export const pushRegisterSchema = z.object({
  channelId: z.string().uuid(),
})

export interface PushRegisterScope {
  tenantId: string
  organizationId: string
  userId?: string | null
}

export interface PushRegisterResult {
  channelId: string
  pushStatus: 'active' | 'failed'
  channelState: Record<string, unknown>
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

export async function pushRegister(params: {
  container: AwilixContainer
  scope: PushRegisterScope
  input: { channelId: string }
}): Promise<PushRegisterResult> {
  const input = pushRegisterSchema.parse(params.input)
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
      deletedAt: null,
    },
    undefined,
    dscope,
  )
  if (!channel) {
    throw createCrudFormError(
      'Channel not found',
      { channelId: 'Channel not found' },
      { status: 404 },
    )
  }
  if (!channel.isActive || channel.status !== 'connected') {
    throw createCrudFormError(
      'Channel must be connected to register push',
      { channelId: `Channel status is ${channel.status}` },
      { status: 400 },
    )
  }

  const adapter = getChannelAdapterRegistry().get(channel.providerKey)
  if (!adapter) {
    throw createCrudFormError(
      'Channel provider is not available',
      { channelId: `No adapter for provider "${channel.providerKey}"` },
      { status: 400 },
    )
  }
  if (typeof adapter.registerPush !== 'function') {
    throw createCrudFormError(
      'Push delivery is not supported on this provider',
      { channelId: `Provider "${channel.providerKey}" does not implement registerPush` },
      { status: 409 },
    )
  }

  // Credentials.
  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = container.resolve('integrationCredentialsService') as CredentialsServiceLike
  } catch {
    credentialsService = null
  }
  const credentialsScope = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
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
  const refreshed = await refreshCredentialsIfNeeded(
    { adapter, channelId: channel.id, credentials, scope: credentialsScope },
    { credentialsService },
  )
  credentials = refreshed.credentials

  // Per-provider provider config.
  const notificationBaseUrl = process.env.OM_MICROSOFT_WEBHOOK_BASE_URL ?? ''
  let providerConfig: Record<string, unknown> | undefined
  let notificationUrl = ''
  let lifecycleNotificationUrl: string | undefined
  let mintedClientState: string | null = null

  if (channel.providerKey === 'gmail') {
    const topic = process.env.OM_GMAIL_PUBSUB_TOPIC
    providerConfig = { pubsubTopic: topic ?? '' }
    notificationUrl = '' // Gmail does not use a per-call URL; Pub/Sub subscription is preconfigured.
  } else if (channel.providerKey === 'microsoft') {
    mintedClientState = crypto.randomBytes(32).toString('base64url')
    providerConfig = { clientState: mintedClientState }
    // Microsoft uses subscriptionId in the URL path. Until the subscription
    // exists, we need a placeholder; the adapter posts the notificationUrl
    // verbatim to Graph (Graph then POSTs back with a validationToken).
    if (!notificationBaseUrl) {
      throw createCrudFormError(
        'OM_MICROSOFT_WEBHOOK_BASE_URL not configured',
        { channelId: 'Operator must set OM_MICROSOFT_WEBHOOK_BASE_URL' },
        { status: 503 },
      )
    }
    // Microsoft sends validation handshake to whatever URL we configure.
    // Pattern: <base>/api/communication_channels/webhooks/microsoft/<channelId>
    // — channelId is used as a placeholder; the route looks up by
    // subscriptionId once Graph returns it on creation.
    notificationUrl = `${notificationBaseUrl.replace(/\/$/, '')}/api/communication_channels/webhooks/microsoft/${channel.id}`
    lifecycleNotificationUrl = `${notificationUrl}/lifecycle`
  }

  let registration: PushRegistration
  try {
    registration = await adapter.registerPush({
      channelId: channel.id,
      credentials,
      scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
      notificationUrl,
      lifecycleNotificationUrl,
      providerConfig,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'registerPush threw'
    throw createCrudFormError(
      'Push registration failed',
      { channelId: message.slice(0, 500) },
      { status: 502 },
    )
  }

  // Persist results.
  const previousState = (channel.channelState as Record<string, unknown> | null) ?? {}
  channel.channelState = { ...previousState, ...registration.channelStatePatch }
  if (registration.status === 'active' && typeof registration.recommendedPollIntervalSeconds === 'number') {
    channel.pollIntervalSeconds = registration.recommendedPollIntervalSeconds
  }
  if (mintedClientState && registration.status === 'active') {
    ;(channel as { clientStateEncrypted?: string | null }).clientStateEncrypted = mintedClientState
  }
  await em.flush()

  if (registration.status === 'active') {
    await emitCommunicationChannelsEvent(
      'communication_channels.push.registered',
      {
        channelId: channel.id,
        providerKey: channel.providerKey,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true },
    )
  } else {
    await emitCommunicationChannelsEvent(
      'communication_channels.push.failed',
      {
        channelId: channel.id,
        providerKey: channel.providerKey,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        error: registration.error ?? null,
      },
      { persistent: true },
    )
  }

  return {
    channelId: channel.id,
    pushStatus: registration.status,
    channelState: (channel.channelState as Record<string, unknown> | null) ?? {},
    error: registration.error,
  }
}
