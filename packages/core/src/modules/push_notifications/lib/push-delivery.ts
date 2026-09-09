import type { EntityManager } from '@mikro-orm/postgresql'
import { raw, type EntityName } from '@mikro-orm/core'
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
import { resolveStuckThresholdMs } from './reclaim-window'
import { enqueuePushDelivery, type PushDeliveryJob } from './queue'

const logger = createLogger('push_notifications')

export const MAX_ATTEMPTS = 3

// Bound the worker's wait on a single provider send. If a send outlived the stuck-reclaim window the
// reaper would reclaim the row mid-send and a second worker would re-send it, so the wait is capped
// well under that window (see ./reclaim-window). Configurable via OM_PUSH_SEND_TIMEOUT_MS; clamped to
// stay below the reclaim window regardless of the configured value.
//
// NOTE: without an AbortSignal through the adapter contract this bounds the WORKER's wait, not the
// underlying socket — a black-holed SDK call may still complete later, but the lease stays fresh (the
// worker finalizes/retries within the window) so the reaper never steals it and fenced write-backs keep
// terminal state consistent. A timeout is surfaced as a retryable `send_timeout` failure.
const DEFAULT_SEND_TIMEOUT_MS = 60_000
const MIN_SEND_TIMEOUT_MS = 5_000
const SEND_TIMEOUT_SAFETY_MARGIN_MS = 60_000

function resolvePushSendTimeoutMs(): number {
  const ceiling = Math.max(MIN_SEND_TIMEOUT_MS, resolveStuckThresholdMs() - SEND_TIMEOUT_SAFETY_MARGIN_MS)
  const parsed = Number.parseInt(process.env.OM_PUSH_SEND_TIMEOUT_MS ?? '', 10)
  const configured = Number.isFinite(parsed) && parsed >= MIN_SEND_TIMEOUT_MS ? parsed : DEFAULT_SEND_TIMEOUT_MS
  return Math.min(configured, ceiling)
}

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

// Identifies the exact lease a worker holds on a delivery row. `attempts` is the lease-generation token:
// it is incremented in the claim itself, and the reaper resets `sending`→`pending` WITHOUT touching it,
// so the next worker's claim bumps it again. Every write-back is fenced on `(status='sending', attempts)`
// — if the reaper broke this lease and another worker re-claimed, `attempts` has moved on and the fenced
// update matches 0 rows, so this worker abandons instead of clobbering the new owner's state.
type DeliveryLease = { deliveryId: string; tenantId: string; attempts: number }

// The `unregistered` sentinel is shared (`deviceUnregisteredResult` / `DEVICE_UNREGISTERED`) across the
// fcm/apns/expo adapters + the stub, so the device soft-delete below fires uniformly regardless of provider.
function isUnregistered(result: SendMessageResult): boolean {
  return result.metadata?.unregistered === true || result.error === DEVICE_UNREGISTERED
}

// Apply a delivery state transition as a fenced `nativeUpdate` (never `em.flush()`, so a stale
// identity-map copy can never issue an unfenced `UPDATE ... WHERE id`). Returns `true` iff this worker
// still held the lease and the write landed; `false` means the lease was lost (reaper reclaimed it) and
// the caller MUST abandon — no re-enqueue, no event — to avoid corrupting the new owner's state.
async function applyFencedTransition(
  em: EntityManager,
  lease: DeliveryLease,
  patch: Record<string, unknown>,
  fromStatus: PushNotificationDelivery['status'] = 'sending',
): Promise<boolean> {
  const affected = await em.nativeUpdate(
    PushNotificationDelivery,
    { id: lease.deliveryId, tenantId: lease.tenantId, status: fromStatus, attempts: lease.attempts },
    { ...patch, updatedAt: new Date() },
  )
  return affected > 0
}

async function finalize(
  em: EntityManager,
  delivery: PushNotificationDelivery,
  lease: DeliveryLease,
  event: 'push_notifications.delivery.sent' | 'push_notifications.delivery.failed',
  patch: Record<string, unknown>,
): Promise<ProcessResult> {
  // A terminal row never has a pending retry scheduled.
  const held = await applyFencedTransition(em, lease, { ...patch, nextRetryAt: null })
  if (!held) {
    // Lease lost — the reaper reclaimed this row and another actor now owns it. Emitting or re-enqueueing
    // here would corrupt the new owner's terminal state, so abandon quietly.
    logger.warn('Push delivery lease lost before finalize; abandoning', {
      deliveryId: lease.deliveryId,
      tenantId: lease.tenantId,
    })
    return { status: delivery.status, deliveryId: delivery.id }
  }
  const finalStatus = (patch.status as PushNotificationDelivery['status'] | undefined) ?? delivery.status
  await emitPushNotificationsEvent(
    event,
    {
      deliveryId: delivery.id,
      tenantId: delivery.tenantId,
      organizationId: delivery.organizationId ?? null,
      userId: delivery.userId,
      provider: delivery.provider,
      status: finalStatus,
    },
    { persistent: true },
  )
  return { status: finalStatus, deliveryId: delivery.id }
}

async function failTerminal(
  em: EntityManager,
  delivery: PushNotificationDelivery,
  lease: DeliveryLease,
  reason: string,
): Promise<ProcessResult> {
  return finalize(em, delivery, lease, 'push_notifications.delivery.failed', {
    status: 'failed',
    lastError: reason,
  })
}

async function handleRetryableFailure(
  em: EntityManager,
  delivery: PushNotificationDelivery,
  lease: DeliveryLease,
  job: PushDeliveryJob,
  reason: string,
  providerResponse: Record<string, unknown> | null,
): Promise<ProcessResult> {
  // `lease.attempts` is the count already persisted at claim time, so it is the real cap on provider
  // sends (each claim = one send attempt). Compare against it, not a stale in-memory field.
  if (lease.attempts < MAX_ATTEMPTS) {
    // Release the claim (`pending`) and re-enqueue with exponential backoff + jitter; per-delivery
    // isolation. Jitter avoids a thundering herd when a provider outage fails many deliveries at once.
    const delayMs = calculateBackoffDelayMs(lease.attempts)
    const held = await applyFencedTransition(em, lease, {
      status: 'pending',
      lastError: reason,
      providerResponse,
      nextRetryAt: new Date(Date.now() + delayMs),
    })
    if (!held) {
      // Lease lost mid-flight (reaper reclaimed + another worker re-owns it). Do NOT re-enqueue — that
      // would rewind the new owner's attempt counter and schedule a duplicate job.
      logger.warn('Push delivery lease lost before retry; abandoning', {
        deliveryId: lease.deliveryId,
        tenantId: lease.tenantId,
      })
      return { status: delivery.status, deliveryId: delivery.id }
    }
    try {
      await enqueuePushDelivery(job, delayMs)
    } catch (error) {
      // The row is now `pending` under our lease; fence the terminal failure on that state. If the
      // reaper already grabbed it (it will not — we just stamped updated_at), the write no-ops.
      const failReason = error instanceof Error ? `retry_scheduling_failed: ${error.message}` : 'retry_scheduling_failed'
      const failed = await applyFencedTransition(
        em,
        lease,
        { status: 'failed', lastError: failReason, nextRetryAt: null },
        'pending',
      )
      if (failed) {
        await emitPushNotificationsEvent(
          'push_notifications.delivery.failed',
          {
            deliveryId: delivery.id,
            tenantId: delivery.tenantId,
            organizationId: delivery.organizationId ?? null,
            userId: delivery.userId,
            provider: delivery.provider,
            status: 'failed',
          },
          { persistent: true },
        )
      }
      return { status: 'failed', deliveryId: delivery.id }
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
    return { status: 'pending', deliveryId: delivery.id }
  }
  // Retries exhausted: distinct terminal `expired` status (vs `failed` for terminal errors), so the
  // admin log can tell "gave up after N attempts" from "channel unavailable / no adapter".
  return finalize(em, delivery, lease, 'push_notifications.delivery.failed', {
    status: 'expired',
    lastError: reason,
    providerResponse,
  })
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

// Bound the wait on a single provider send (B3a): a hung/black-holed call must not outlive the
// stuck-reclaim window, or the reaper would reclaim the row mid-send and a second worker would re-send.
// On timeout we return a retryable `send_timeout` result and move on; the underlying SDK promise is left
// to settle on its own (its late rejection is swallowed to avoid an unhandled rejection).
async function sendWithTimeout(
  adapter: ChannelAdapter,
  input: Parameters<ChannelAdapter['sendMessage']>[0],
  timeoutMs: number,
): Promise<SendMessageResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<SendMessageResult>((resolve) => {
    timer = setTimeout(() => resolve({ externalMessageId: '', status: 'failed', error: 'send_timeout' }), timeoutMs)
  })
  const send = adapter.sendMessage(input)
  send.catch(() => {})
  try {
    return await Promise.race([send, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Send one push delivery row through the communication_channels hub.
 *
 * Idempotent on the delivery id: the row is claimed atomically, so a redelivered job that cannot win
 * the claim (already `sending`/terminal) is a no-op. Mirrors the `test-send` route flow — resolve
 * channel → adapter → credentials → convertOutbound → sendMessage — but adds delivery-row
 * bookkeeping, retry/backoff, and device soft-delete on `unregistered`.
 *
 * Lease fencing (B3): the claim increments `attempts` atomically, and every post-claim state write goes
 * through `applyFencedTransition`, fenced on `(status='sending', attempts=<claimed>)`. If the reaper
 * broke this worker's lease and another worker re-claimed the row (bumping `attempts`), this worker's
 * writes match 0 rows and it abandons — so a stolen lease can neither rewind the attempt counter nor
 * overwrite the new owner's terminal state.
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
  // Count the attempt AT CLAIM time, in the same atomic update. `attempts` doubles as the lease token
  // (see DeliveryLease): each claim increments it, the reaper never touches it, so it uniquely tags this
  // lease generation. Persisting it before the send makes MAX_ATTEMPTS a real cap on provider sends
  // (a crash after the send can't lose the increment). Only the worker whose update wins the race
  // proceeds; the loser (or a non-pending/terminal row) is a no-op.
  const claimed = await em.nativeUpdate(
    PushNotificationDelivery,
    { id: job.deliveryId, tenantId: job.tenantId, status: 'pending' },
    { status: 'sending', attempts: raw('"attempts" + 1'), updatedAt: new Date() },
  )
  // Fresh read (forked EM per job → empty identity map → hits DB) so `attempts` reflects the increment.
  const delivery = await em.findOne(
    PushNotificationDelivery,
    { id: job.deliveryId, tenantId: job.tenantId },
    { refresh: true },
  )
  if (!delivery) return null
  if (claimed === 0) return { status: delivery.status, deliveryId: delivery.id }

  const lease: DeliveryLease = { deliveryId: delivery.id, tenantId: delivery.tenantId, attempts: delivery.attempts }

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
    const held = await applyFencedTransition(em, lease, {
      status: 'skipped',
      lastError: 'device_unavailable',
      nextRetryAt: null,
    })
    return { status: held ? 'skipped' : delivery.status, deliveryId: delivery.id }
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
  if (!channel) return failTerminal(em, delivery, lease, 'channel_unavailable')

  const registry = resolve('channelAdapterRegistry') as ChannelAdapterRegistryLike | undefined
  const adapter = registry?.get(delivery.provider)
  // No provider package registered this provider's adapter (e.g. channel-fcm/apns/expo not installed).
  // Terminal, no retry.
  if (!adapter) return failTerminal(em, delivery, lease, 'no_adapter')

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
    const result = await sendWithTimeout(
      adapter,
      {
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
      },
      resolvePushSendTimeoutMs(),
    )

    if (result.status === 'sent' || result.status === 'queued') {
      return finalize(em, delivery, lease, 'push_notifications.delivery.sent', {
        status: 'sent',
        sentAt: new Date(),
        lastError: null,
        providerResponse: result.metadata ?? { externalMessageId: result.externalMessageId },
      })
    }

    if (isUnregistered(result)) {
      const outcome = await finalize(em, delivery, lease, 'push_notifications.delivery.failed', {
        status: 'failed',
        lastError: DEVICE_UNREGISTERED,
        providerResponse: result.metadata ?? null,
      })
      await softDeleteUnregisteredDevice(resolve, {
        id: device.id,
        tenantId: device.tenantId,
        userId: device.userId,
        organizationId: device.organizationId ?? null,
      })
      return outcome
    }

    return handleRetryableFailure(em, delivery, lease, job, result.error ?? 'send_failed', result.metadata ?? null)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'send_failed'
    return handleRetryableFailure(em, delivery, lease, job, message, null)
  }
}
