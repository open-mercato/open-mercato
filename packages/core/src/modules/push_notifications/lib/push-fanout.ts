import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityName } from '@mikro-orm/core'
import { sql } from 'kysely'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { PushOptions } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import type { UserDevice } from '@open-mercato/core/modules/devices/data/entities'
import type { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { defaultLocale } from '@open-mercato/shared/lib/i18n/config'
import { resolveSupportedLocale } from '@open-mercato/shared/lib/i18n/locale'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  resolveNotificationCopy,
  type NotificationCopySource,
} from '@open-mercato/core/modules/notifications/lib/notificationCopy'
import { enqueuePushDelivery } from './queue'

const logger = createLogger('push_notifications')

export const PUSH_CHANNEL = 'push'

type Resolve = <T = unknown>(name: string) => T

/** The push payload persisted on each delivery row and unpacked by the worker into the send envelope. */
export interface PushFanoutPayload {
  title?: string
  body?: string | null
  data: Record<string, string>
  options?: PushOptions
  silent?: boolean
}

export interface FanOutPushDeliveriesArgs {
  em: EntityManager
  resolve: Resolve
  scope: { tenantId: string; organizationId: string | null }
  userId: string
  /**
   * Restrict the fan-out to a single one of the user's devices (`UserDevice.id`). Still scoped to the
   * same (tenant, org, user), so an id that isn't the user's own matches nothing. Omit to fan out to
   * all of the user's push-capable devices (the default).
   */
  userDeviceId?: string
  /** Source in-app notification id, or `null` for a silent push (no Notification row). */
  notificationId: string | null
  notificationTypeId: string
  payload: PushFanoutPayload
  /**
   * Per-device localizable copy for visible notifications. When present, `title`/`body` are
   * resolved per device using its `locale`. Omit for silent pushes (no user-facing copy).
   */
  copy?: NotificationCopySource
}

function tokenSnapshot(token: string): string {
  // Persist at most the last 8 chars of the (long) provider token — never the full secret.
  return token.slice(-8)
}

/**
 * Resolve a recipient's push-capable devices, route each to its provider's tenant push
 * `CommunicationChannel`, persist one `pending` push delivery row per device, and enqueue a send
 * job per row. Shared by the `push` delivery strategy (visible + silent notifications) and
 * `sendCustomPush` (admin one-off pushes); it is preference-agnostic — the caller decides whether
 * to consult per-channel preferences before fanning out.
 *
 * Cross-module entities are resolved via DI tokens (registered `asValue` by their owning modules)
 * so this stays decoupled from those modules' internals. Returns the number of jobs enqueued.
 */
export async function fanOutPushDeliveries(args: FanOutPushDeliveriesArgs): Promise<{ enqueued: number }> {
  const { em, resolve, scope, userId, userDeviceId, notificationId, notificationTypeId, payload, copy } = args
  const { tenantId, organizationId } = scope
  const silent = payload.silent === true

  // Require at least one active push CommunicationChannel for the tenant (push not configured ⇒ skip).
  // This is the cheapest, most selective short-circuit (most tenants have no push channel), so it runs
  // before the per-recipient device lookup. Channels are indexed by providerKey so each device can be
  // routed to its matching provider below (ios→apns, android→fcm, expo→expo). Oldest-first so that when
  // a tenant has more than one active channel for the same provider, the pick is deterministic.
  const ChannelRef = resolve('CommunicationChannel') as EntityName<CommunicationChannel>
  const channels = await em.find(
    ChannelRef,
    {
      tenantId,
      channelType: PUSH_CHANNEL,
      isActive: true,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'asc' } },
  )
  if (channels.length === 0) return { enqueued: 0 }
  const channelsByProvider = new Map<string, CommunicationChannel>()
  for (const channel of channels) {
    if (!channelsByProvider.has(channel.providerKey)) channelsByProvider.set(channel.providerKey, channel)
  }

  // Load the recipient's devices that can receive push (active + has a token). Scoped to the
  // notification's organization so an org-scoped notification never fans out to a device the user
  // registered under a different org — device identity is per (tenant, org, user, device) (see devices
  // module). A tenant-level (null-org) notification targets the user's tenant-level (null-org) devices.
  // `push_token` is encrypted at rest; decrypt on read (no-op when encryption is disabled).
  const DeviceRef = resolve('UserDevice') as EntityName<UserDevice>
  const devices = await findWithDecryption(
    em,
    DeviceRef,
    {
      tenantId,
      organizationId,
      userId,
      // Optionally restrict to a single device; still scoped to this user so a foreign id matches none.
      ...(userDeviceId ? { id: userDeviceId } : {}),
      deletedAt: null,
      pushToken: { $ne: null },
    },
    undefined,
    { tenantId, organizationId },
  )
  if (devices.length === 0) return { enqueued: 0 }

  // Resolve the per-device localized copy. The default-locale case (the common one: device has no
  // locale, an unsupported one, or already speaks the default) reuses the copy already resolved
  // upstream — no dictionary load. Other locales translate via the shared notification-copy helper
  // (dictionaries are memoized by loadDictionary). Silent pushes carry no copy and skip this.
  // Memoized by resolved locale so a user with many same-locale devices derives copy once
  // (O(distinct locales) instead of O(devices)).
  const localizedByLocale = new Map<string, Promise<PushFanoutPayload>>()
  function resolveLocalizedPayload(deviceLocale?: string | null): Promise<PushFanoutPayload> {
    if (!copy) return Promise.resolve(payload)
    const locale = resolveSupportedLocale(deviceLocale) ?? defaultLocale
    let cached = localizedByLocale.get(locale)
    if (!cached) {
      cached = (async () => {
        if (locale === defaultLocale) {
          return { ...payload, title: copy.title, body: copy.body ?? null }
        }
        const { title, body } = await resolveNotificationCopy(copy, locale)
        return { ...payload, title, body }
      })()
      localizedByLocale.set(locale, cached)
    }
    return cached
  }

  // Insert one pending delivery row per device, routing each device to the push channel whose
  // providerKey matches the device's pushProvider. Devices with no provider, or no matching configured
  // channel, are skipped. Insert via INSERT ... ON CONFLICT DO NOTHING on the (notification_id,
  // user_device_id) partial unique index: the `push` strategy runs inside the at-least-once persistent
  // `notifications:deliver` subscriber, so a redelivered event re-runs it — the conflict clause makes
  // the re-fan-out a no-op instead of inserting a duplicate set of rows (and duplicate pushes). Silent
  // pushes carry a null notification_id and are excluded from the partial index (they are triggered
  // explicitly, not via at-least-once redelivery). Only the rows actually inserted are enqueued.
  const builtRows = await Promise.all(
    devices.map(async (device) => {
      const providerKey = device.pushProvider
      if (!providerKey) return null
      const channel = channelsByProvider.get(providerKey)
      if (!channel) return null
      const rowPayload = await resolveLocalizedPayload(device.locale)
      return {
        tenant_id: tenantId,
        organization_id: organizationId,
        notification_id: notificationId,
        notification_type_id: notificationTypeId,
        user_device_id: device.id,
        user_id: userId,
        provider: channel.providerKey,
        token_snapshot: tokenSnapshot(device.pushToken as string),
        silent,
        status: 'pending',
        attempts: 0,
        payload: sql`${JSON.stringify(rowPayload)}::jsonb`,
        created_at: sql`now()`,
        updated_at: sql`now()`,
      }
    }),
  )
  const rows = builtRows.filter((row): row is NonNullable<typeof row> => row !== null)
  // A registered device whose pushProvider has no matching active channel (e.g. an Expo device on an
  // FCM-only tenant) is correctly skipped above — but it produces no delivery row and would otherwise
  // be an invisible no-op. Surface a count so a provider-config gap is diagnosable.
  const skippedNoChannel = devices.length - rows.length
  if (skippedNoChannel > 0) {
    logger.warn('Skipped devices with no matching push channel', {
      tenantId,
      userId,
      notificationId,
      skipped: skippedNoChannel,
    })
  }
  if (rows.length === 0) return { enqueued: 0 }

  const db = em.getKysely<any>()
  const inserted = (await db
    .insertInto('push_notification_deliveries')
    .values(rows)
    .onConflict((oc: any) =>
      oc.columns(['notification_id', 'user_device_id']).where('notification_id', 'is not', null).doNothing(),
    )
    .returning(['id'])
    .execute()) as Array<{ id: string }>

  // Enqueue one send job per inserted row (per-device retry isolation, idempotent on delivery id).
  // Enqueue all rows concurrently — the jobs are independent, so there is no reason to serialize the
  // queue round-trips. If an enqueue fails, mark that row failed instead of leaving it orphaned in
  // `pending` forever (the worker only ever processes rows it receives a job for). Failed rows are
  // grouped by reason and marked in one UPDATE per reason to keep DB round-trips minimal.
  const outcomes = await Promise.allSettled(
    inserted.map((row) => enqueuePushDelivery({ deliveryId: row.id, tenantId, organizationId })),
  )
  const failedIdsByReason = new Map<string, string[]>()
  let enqueued = 0
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      enqueued += 1
      return
    }
    const error = outcome.reason
    const reason = error instanceof Error ? `enqueue_failed: ${error.message}` : 'enqueue_failed'
    const ids = failedIdsByReason.get(reason) ?? []
    ids.push(inserted[index].id)
    failedIdsByReason.set(reason, ids)
  })
  if (failedIdsByReason.size > 0) {
    await Promise.allSettled(
      Array.from(failedIdsByReason.entries()).map(([reason, ids]) =>
        db
          .updateTable('push_notification_deliveries')
          .set({ status: 'failed', last_error: reason, updated_at: sql`now()` })
          .where('id', 'in', ids)
          // Guard on `pending`: if the enqueue reported failure yet the job actually landed and a
          // worker already claimed/finished the row, don't clobber its later status back to `failed`.
          .where('status', '=', 'pending')
          .execute(),
      ),
    )
  }
  return { enqueued }
}
