import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityName } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { ChannelAdapter, SendMessageResult } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { DEVICE_UNREGISTERED } from '@open-mercato/core/modules/communication_channels/lib/push-adapter'
import { refreshCredentialsIfNeeded } from '@open-mercato/core/modules/communication_channels/lib/credential-refresh'
import type { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import type { PushOptions } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import type { UserDevice } from '@open-mercato/core/modules/devices/data/entities'
import { calculateBackoffDelayMs } from '@open-mercato/shared/lib/delivery/retry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PushNotificationDelivery } from '../data/entities'
import { emitPushNotificationsEvent } from '../events'
import { enqueuePushDelivery, type PushDeliveryJob } from './queue'

const logger = createLogger('push_notifications')

export const MAX_ATTEMPTS = 3

type Resolve = <T = unknown>(name: string) => T

interface ChannelAdapterRegistryLike {
  get(providerKey: string): ChannelAdapter | undefined
}

interface CredentialsServiceLike {
  resolve(
    integrationId: string,
    scope: { tenantId: string; organizationId: string; userId?: string | null },
  ): Promise<Record<string, unknown> | null>
}

type PushPayload = {
  title?: string
  body?: string | null
  data?: Record<string, string>
  options?: PushOptions
  silent?: boolean
}

type ProcessResult = { status: PushNotificationDelivery['status']; deliveryId: string } | null

// The `unregistered` sentinel is shared (`deviceUnregisteredResult` / `DEVICE_UNREGISTERED`) across the
// fcm/apns/expo adapters + the stub, so the device soft-delete below fires uniformly regardless of provider.
function isUnregistered(result: SendMessageResult): boolean {
  return result.metadata?.unregistered === true || result.error === DEVICE_UNREGISTERED
}

async function finalize(
  em: EntityManager,
  delivery: PushNotificationDelivery,
  event: 'push_notifications.delivery.sent' | 'push_notifications.delivery.failed',
): Promise<ProcessResult> {
  // A terminal row never has a pending retry scheduled.
  delivery.nextRetryAt = null
  await em.flush()
  await emitPushNotificationsEvent(
    event,
    {
      deliveryId: delivery.id,
      tenantId: delivery.tenantId,
      organizationId: delivery.organizationId ?? null,
      userId: delivery.userId,
      provider: delivery.provider,
      status: delivery.status,
    },
    { persistent: true },
  )
  return { status: delivery.status, deliveryId: delivery.id }
}

async function failTerminal(
  em: EntityManager,
  delivery: PushNotificationDelivery,
  reason: string,
): Promise<ProcessResult> {
  delivery.status = 'failed'
  delivery.lastError = reason
  return finalize(em, delivery, 'push_notifications.delivery.failed')
}

async function handleRetryableFailure(
  em: EntityManager,
  delivery: PushNotificationDelivery,
  job: PushDeliveryJob,
  reason: string,
  providerResponse: Record<string, unknown> | null,
): Promise<ProcessResult> {
  delivery.lastError = reason
  delivery.providerResponse = providerResponse
  if (delivery.attempts < MAX_ATTEMPTS) {
    // Release the claim (`pending`) and re-enqueue with exponential backoff + jitter; per-delivery
    // isolation. Jitter avoids a thundering herd when a provider outage fails many deliveries at once.
    const delayMs = calculateBackoffDelayMs(delivery.attempts)
    delivery.status = 'pending'
    delivery.nextRetryAt = new Date(Date.now() + delayMs)
    await em.flush()
    try {
      await enqueuePushDelivery(job, delayMs)
    } catch (error) {
      delivery.status = 'failed'
      delivery.lastError = error instanceof Error ? `retry_scheduling_failed: ${error.message}` : 'retry_scheduling_failed'
      return finalize(em, delivery, 'push_notifications.delivery.failed')
    }
    await emitPushNotificationsEvent(
      'push_notifications.delivery.failed',
      {
        deliveryId: delivery.id,
        tenantId: delivery.tenantId,
        organizationId: delivery.organizationId ?? null,
        userId: delivery.userId,
        provider: delivery.provider,
        // The row is reset to `pending` to release the claim for the re-enqueued attempt, but the
        // logical outcome of THIS attempt is "failed, retry scheduled". Emit `retrying` (not the reset
        // row status `pending`) so subscribers keying off `status` aren't misled; `willRetry` still gates
        // ultimate-failure counters.
        status: 'retrying',
        willRetry: true,
      },
      { persistent: true },
    )
    return { status: delivery.status, deliveryId: delivery.id }
  }
  // Retries exhausted: distinct terminal `expired` status (vs `failed` for terminal errors), so the
  // admin log can tell "gave up after N attempts" from "channel unavailable / no adapter".
  delivery.status = 'expired'
  return finalize(em, delivery, 'push_notifications.delivery.failed')
}

// Soft-delete the device through the devices module's own command (audit/events/undo stay
// consistent) rather than mutating its table directly. Dispatched by command id with a trusted
// system context — no business-logic import, no authenticated actor.
export async function softDeleteUnregisteredDevice(
  resolve: Resolve,
  input: { id: string; tenantId: string; userId: string; organizationId: string | null },
): Promise<void> {
  try {
    const commandBus = resolve('commandBus') as CommandBus
    await commandBus.execute('devices.user_devices.deactivate', {
      input,
      ctx: {
        container: { resolve } as never,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: input.organizationId,
        organizationIds: input.organizationId ? [input.organizationId] : null,
        systemActor: true,
      } as never,
    })
  } catch (error) {
    logger.error('Failed to deactivate unregistered device', {
      userDeviceId: input.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Send one push delivery row through the communication_channels hub.
 *
 * Idempotent on the delivery id: the row is claimed atomically, so a redelivered job that cannot win
 * the claim (already `sending`/terminal) is a no-op. Mirrors the `test-send` route flow — resolve
 * channel → adapter → credentials → convertOutbound → sendMessage — but adds delivery-row
 * bookkeeping, retry/backoff, and device soft-delete on `unregistered`.
 */
export async function processPushDeliveryJob(
  em: EntityManager,
  job: PushDeliveryJob,
  resolve: Resolve,
): Promise<ProcessResult> {
  // Atomically claim the row (`pending` → `sending`) so a redelivered/duplicated job — inherent to
  // at-least-once queues — is processed by exactly one worker. Only the worker whose update wins the
  // race proceeds; the loser (or a non-pending/terminal row) is a no-op. Mirrors the `messages`
  // send-email claim pattern, which is stronger than a plain read-then-check status guard.
  const claimed = await em.nativeUpdate(
    PushNotificationDelivery,
    { id: job.deliveryId, tenantId: job.tenantId, status: 'pending' },
    { status: 'sending', updatedAt: new Date() },
  )
  const delivery = await em.findOne(PushNotificationDelivery, { id: job.deliveryId, tenantId: job.tenantId })
  if (!delivery) return null
  if (claimed === 0) return { status: delivery.status, deliveryId: delivery.id }

  // Count the attempt at CLAIM time and persist it BEFORE the provider send.
  // Previously the increment happened only just before `sendMessage` and was
  // flushed later alongside the terminal status — so a crash after the send but
  // before that flush lost the increment, the reaper re-enqueued the row, and the
  // provider could be hit more than MAX_ATTEMPTS times. Persisting here makes
  // MAX_ATTEMPTS a real cap on provider sends. A crash in the tiny window between
  // this flush and `sendMessage` re-runs with no duplicate (no send happened yet).
  delivery.attempts += 1
  await em.flush()

  // Resolve the device for its full (secret) push token. Soft via DI token to avoid coupling.
  // `push_token` is encrypted at rest, so decrypt on read (no-op when encryption is disabled).
  const DeviceRef = resolve('UserDevice') as EntityName<UserDevice>
  const device = await findOneWithDecryption(
    em,
    DeviceRef,
    { id: delivery.userDeviceId, tenantId: job.tenantId, deletedAt: null },
    undefined,
    { tenantId: job.tenantId, organizationId: job.organizationId ?? null },
  )
  if (!device || !device.pushToken) {
    delivery.status = 'skipped'
    delivery.lastError = 'device_unavailable'
    await em.flush()
    return { status: delivery.status, deliveryId: delivery.id }
  }

  // Resolve the tenant's push channel matching the snapshotted provider.
  const ChannelRef = resolve('CommunicationChannel') as EntityName<CommunicationChannel>
  const channel = await em.findOne(ChannelRef, {
    tenantId: job.tenantId,
    providerKey: delivery.provider,
    channelType: 'push',
    isActive: true,
    deletedAt: null,
  })
  if (!channel) return failTerminal(em, delivery, 'channel_unavailable')

  const registry = resolve('channelAdapterRegistry') as ChannelAdapterRegistryLike | undefined
  const adapter = registry?.get(delivery.provider)
  // No provider package registered this provider's adapter (e.g. channel-fcm/apns/expo not installed).
  // Terminal, no retry.
  if (!adapter) return failTerminal(em, delivery, 'no_adapter')

  // Resolve credentials (best-effort, mirrors test-send).
  let credentialsService: CredentialsServiceLike | undefined
  try {
    credentialsService = resolve('integrationCredentialsService') as CredentialsServiceLike | undefined
  } catch {
    credentialsService = undefined
  }
  // Credentials are keyed by the CHANNEL's org context, not the notification's: at connect time they
  // are stored under `channel.organizationId ?? tenantId` (see communication_channels
  // connect-credential-channel). Using the notification's `job.organizationId` here would miss the
  // creds whenever a tenant-level (org-less) channel serves an org-scoped notification.
  const credentialScope = {
    tenantId: job.tenantId,
    organizationId: channel.organizationId ?? job.tenantId,
    userId: channel.userId ?? null,
  }
  let credentials: Record<string, unknown> = {}
  if (channel.credentialsRef && credentialsService) {
    credentials = (await credentialsService.resolve(`channel_${delivery.provider}`, credentialScope).catch(() => null)) ?? {}
  }

  // Mirror the test-send flow: refresh near-expiry OAuth credentials before sending so providers with
  // short-lived access tokens (FCM/APNs in Phase 4) don't fail with a stale token. No-op for adapters
  // without `refreshCredentials` (e.g. the push_stub). Best-effort — on failure we keep current creds.
  try {
    const refreshed = await refreshCredentialsIfNeeded(
      { adapter, channelId: channel.id, credentials, scope: credentialScope },
      { credentialsService: credentialsService ?? null },
    )
    credentials = refreshed.credentials
  } catch (error) {
    logger.error('Credential refresh failed; sending with current credentials', {
      deliveryId: delivery.id,
      provider: delivery.provider,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const scope = { tenantId: job.tenantId, organizationId: job.organizationId ?? job.tenantId }
  const payload = (delivery.payload ?? {}) as PushPayload
  const body = payload.body ?? payload.title ?? ''

  try {
    const converted = await adapter.convertOutbound({ body, bodyFormat: 'text' })
    const result = await adapter.sendMessage({
      content: {
        ...converted.content,
        raw: {
          title: payload.title ?? '',
          body: payload.body ?? null,
          data: payload.data ?? {},
          options: payload.options ?? {},
          silent: payload.silent === true,
        },
      },
      credentials,
      scope,
      metadata: {
        pushToken: device.pushToken,
        platform: device.platform,
        userDeviceId: device.id,
        provider: delivery.provider,
      },
    })

    if (result.status === 'sent' || result.status === 'queued') {
      delivery.status = 'sent'
      delivery.sentAt = new Date()
      delivery.lastError = null
      delivery.providerResponse = result.metadata ?? { externalMessageId: result.externalMessageId }
      return finalize(em, delivery, 'push_notifications.delivery.sent')
    }

    if (isUnregistered(result)) {
      delivery.status = 'failed'
      delivery.lastError = DEVICE_UNREGISTERED
      delivery.providerResponse = result.metadata ?? null
      const outcome = await finalize(em, delivery, 'push_notifications.delivery.failed')
      await softDeleteUnregisteredDevice(resolve, {
        id: device.id,
        tenantId: device.tenantId,
        userId: device.userId,
        organizationId: device.organizationId ?? null,
      })
      return outcome
    }

    return handleRetryableFailure(em, delivery, job, result.error ?? 'send_failed', result.metadata ?? null)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'send_failed'
    return handleRetryableFailure(em, delivery, job, message, null)
  }
}
