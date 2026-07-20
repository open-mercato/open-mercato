import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityName } from '@mikro-orm/core'
import type { ChannelAdapter } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  DEVICE_UNREGISTERED,
  supportsReceiptChecking,
} from '@open-mercato/core/modules/communication_channels/lib/push-adapter'
import type { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PushNotificationDelivery } from '../data/entities'
import { softDeleteUnregisteredDevice } from './push-delivery'

const logger = createLogger('push_notifications')

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

export type ReceiptReaperResult = { checked: number; unregistered: number }

// A receipt only exists after the provider has attempted handoff to FCM/APNs, so a just-`sent` row has
// nothing to poll yet. Wait MIN_AGE before the first check (Expo recommends ~15m) and stop looking after
// MAX_AGE — a row not resolved within the window is left as `sent` (best-effort hygiene, not a
// correctness guarantee). Both tunable; MAX is clamped above MIN so the window is always non-empty.
// Parse an int env var, falling back to `fallback` only when it is unset/non-numeric — a legitimately
// configured `0` is preserved (`|| fallback` would coerce it, since `0` is falsy).
function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
const RECEIPT_MIN_AGE_MS = Math.max(0, envInt('OM_PUSH_RECEIPT_MIN_AGE_MINUTES', 15) * 60 * 1000)
const RECEIPT_MAX_AGE_MS = Math.max(
  RECEIPT_MIN_AGE_MS + 60 * 1000,
  envInt('OM_PUSH_RECEIPT_MAX_AGE_MINUTES', 60) * 60 * 1000,
)
// Bound the per-tick scan so a busy tenant's `sent` backlog cannot fetch an unbounded row set.
const RECEIPT_BATCH_LIMIT = Math.max(1, envInt('OM_PUSH_RECEIPT_BATCH_LIMIT', 500))

/** The provider ticket id persisted by the send path, or null when there is nothing to poll. */
function ticketIdOf(delivery: PushNotificationDelivery): string | null {
  const id = (delivery.providerResponse as { externalMessageId?: unknown } | null | undefined)?.externalMessageId
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** A row whose receipt was already resolved on a prior sweep — skip it (marker is JSON, no migration). */
function isReceiptChecked(delivery: PushNotificationDelivery): boolean {
  return (delivery.providerResponse as { receiptChecked?: unknown } | null | undefined)?.receiptChecked === true
}

function markReceiptChecked(delivery: PushNotificationDelivery, unregistered: boolean): void {
  delivery.providerResponse = {
    ...(delivery.providerResponse ?? {}),
    receiptChecked: true,
    ...(unregistered ? { unregistered: true } : {}),
  }
}

/**
 * Second-pass hygiene for push providers whose "device unregistered" signal arrives in an ASYNCHRONOUS
 * receipt phase rather than the synchronous send ticket (Expo). Runs on the per-tenant reclaim tick.
 *
 * For each `sent` delivery old enough to have a receipt, group ticket ids by provider, and for every
 * provider whose adapter implements the optional `PushReceiptChecker` capability, poll receipts using
 * the same channel credentials as the send path. A `DeviceNotRegistered` receipt is routed through the
 * SAME `softDeleteUnregisteredDevice` contract the synchronous path uses — no separate deletion path.
 * `MessageRateExceeded` and other transient receipt errors resolve the receipt but never kill the token.
 *
 * Idempotent: each resolved row is marked (`providerResponse.receiptChecked`) so it is never re-polled,
 * and `devices.deactivate` is itself idempotent, so an overlapping tick cannot double-delete.
 */
export async function checkPushReceipts(
  em: EntityManager,
  scope: { tenantId: string },
  resolve: Resolve,
  now: Date = new Date(),
): Promise<ReceiptReaperResult> {
  const registry = resolve('channelAdapterRegistry') as ChannelAdapterRegistryLike | undefined
  if (!registry) return { checked: 0, unregistered: 0 }

  const candidates = await em.find(
    PushNotificationDelivery,
    {
      tenantId: scope.tenantId,
      status: 'sent',
      sentAt: { $gte: new Date(now.getTime() - RECEIPT_MAX_AGE_MS), $lte: new Date(now.getTime() - RECEIPT_MIN_AGE_MS) },
    },
    { limit: RECEIPT_BATCH_LIMIT, orderBy: { sentAt: 'asc' } },
  )

  // Group unchecked rows that have a real ticket id by provider. Providers whose adapter doesn't
  // implement receipt checking (fcm/apns) never issue a network call — they are dropped below.
  const byProvider = new Map<string, { ticketId: string; delivery: PushNotificationDelivery }[]>()
  for (const delivery of candidates) {
    if (isReceiptChecked(delivery)) continue
    const ticketId = ticketIdOf(delivery)
    if (!ticketId) continue
    const list = byProvider.get(delivery.provider) ?? []
    list.push({ ticketId, delivery })
    byProvider.set(delivery.provider, list)
  }
  if (byProvider.size === 0) return { checked: 0, unregistered: 0 }

  let credentialsService: CredentialsServiceLike | undefined
  try {
    credentialsService = resolve('integrationCredentialsService') as CredentialsServiceLike | undefined
  } catch {
    credentialsService = undefined
  }
  const ChannelRef = resolve('CommunicationChannel') as EntityName<CommunicationChannel>

  let checked = 0
  let unregistered = 0

  for (const [provider, entries] of byProvider) {
    const adapter = registry.get(provider)
    if (!adapter || !supportsReceiptChecking(adapter)) continue

    const channel = await em.findOne(ChannelRef, {
      tenantId: scope.tenantId,
      providerKey: provider,
      channelType: 'push',
      isActive: true,
      deletedAt: null,
    })
    if (!channel) continue

    // Credentials are keyed by the CHANNEL's org context, mirroring the send path (see push-delivery).
    const credentialScope = {
      tenantId: scope.tenantId,
      organizationId: channel.organizationId ?? scope.tenantId,
      userId: channel.userId ?? null,
    }
    let credentials: Record<string, unknown> = {}
    if (channel.credentialsRef && credentialsService) {
      credentials = (await credentialsService.resolve(`channel_${provider}`, credentialScope).catch(() => null)) ?? {}
    }

    const byTicket = new Map<string, PushNotificationDelivery[]>()
    for (const entry of entries) {
      const list = byTicket.get(entry.ticketId) ?? []
      list.push(entry.delivery)
      byTicket.set(entry.ticketId, list)
    }

    let outcomes
    try {
      outcomes = await adapter.checkReceipts([...byTicket.keys()], credentials)
    } catch (error) {
      logger.error('Push receipt check failed', {
        tenantId: scope.tenantId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    // Persist the receipt-checked marks first, then run the device deactivations AFTER the flush so a
    // command that reads on the same EntityManager can never discard the pending scalar marks.
    const toDeactivate: Array<{ id: string; tenantId: string; userId: string; organizationId: string | null }> = []
    for (const outcome of outcomes) {
      const deliveries = byTicket.get(outcome.ticketId)
      if (!deliveries) continue
      for (const delivery of deliveries) {
        markReceiptChecked(delivery, outcome.unregistered)
        checked += 1
        if (outcome.unregistered) {
          delivery.lastError = DEVICE_UNREGISTERED
          toDeactivate.push({
            id: delivery.userDeviceId,
            tenantId: delivery.tenantId,
            userId: delivery.userId,
            organizationId: delivery.organizationId ?? null,
          })
          unregistered += 1
        }
      }
    }
    await em.flush()
    for (const input of toDeactivate) {
      await softDeleteUnregisteredDevice(resolve, input)
    }
  }

  return { checked, unregistered }
}
