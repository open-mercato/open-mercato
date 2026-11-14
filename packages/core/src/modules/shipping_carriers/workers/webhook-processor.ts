import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CarrierShipment } from '../data/entities'
import { emitShippingEvent } from '../events'
import type { ShippingWebhookEvent, UnifiedShipmentStatus } from '../lib/adapter'
import { getShippingAdapter } from '../lib/adapter-registry'
import { getTerminalShippingEvent, syncShipmentStatus, TERMINAL_SHIPPING_STATUSES } from '../lib/status-sync'
import { claimWebhookProcessing, releaseWebhookClaim } from '../lib/webhook-utils'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('shipping_carriers').child({ component: 'webhook-processor' })

type WebhookJobPayload = {
  providerKey: string
  event: ShippingWebhookEvent
  shipmentId?: string | null
  scope?: {
    organizationId: string
    tenantId: string
  } | null
}

type LegacyWebhookJobEnvelope = {
  name?: string
  payload: WebhookJobPayload
}

function readWebhookJobPayload(data: WebhookJobPayload | LegacyWebhookJobEnvelope): WebhookJobPayload {
  if ('providerKey' in data) return data
  return data.payload
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'shipping-carriers-webhook',
  id: 'shipping-carriers:webhook-processor',
  concurrency: 5,
}

export default async function handle(job: QueuedJob<WebhookJobPayload | LegacyWebhookJobEnvelope>, ctx: HandlerContext): Promise<void> {
  const payload = readWebhookJobPayload(job.payload)
  try {
    const em = ctx.resolve<EntityManager>('em')
    const adapter = getShippingAdapter(payload.providerKey)
    if (!adapter) return

    const shipment = payload.shipmentId && payload.scope
      ? await findOneWithDecryption(
        em,
        CarrierShipment,
        {
          id: payload.shipmentId,
          organizationId: payload.scope.organizationId,
          tenantId: payload.scope.tenantId,
          deletedAt: null,
        },
        undefined,
        payload.scope,
      )
      : null
    if (!shipment) return

    const scope = { organizationId: shipment.organizationId, tenantId: shipment.tenantId }
    const claimed = await claimWebhookProcessing(
      em,
      payload.event.idempotencyKey,
      payload.providerKey,
      scope,
      payload.event.eventType,
    )
    if (!claimed) {
      return
    }

    const carrierStatus = typeof payload.event.data.status === 'string'
      ? payload.event.data.status
      : payload.event.eventType

    let transition: { previousStatus: string; newStatus: UnifiedShipmentStatus } | null = null
    try {
      const unifiedStatus = adapter.mapStatus(carrierStatus)
      transition = await em.transactional(async (tx) => {
        const locked = await findOneWithDecryption(
          tx,
          CarrierShipment,
          {
            id: shipment.id,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            deletedAt: null,
          },
          { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
          scope,
        )
        if (!locked) return null
        const previousStatus = locked.unifiedStatus
        if (!syncShipmentStatus(locked, unifiedStatus)) return null
        locked.carrierStatus = carrierStatus
        locked.lastWebhookAt = new Date()
        await tx.flush()
        return { previousStatus, newStatus: unifiedStatus }
      }, { clear: true })
    } catch (error) {
      await releaseWebhookClaim(
        em,
        payload.event.idempotencyKey,
        payload.providerKey,
        scope,
      )
      throw error
    }
    if (!transition) return

    const unifiedStatus = transition.newStatus
    const eventPayload = {
      shipmentId: shipment.id,
      providerKey: payload.providerKey,
      previousStatus: transition.previousStatus,
      newStatus: unifiedStatus,
      carrierStatus,
      organizationId: shipment.organizationId,
      tenantId: shipment.tenantId,
    }
    const eventScope = { tenantId: shipment.tenantId, organizationId: shipment.organizationId }
    await emitShippingEvent('shipping_carriers.shipment.status_changed', eventPayload, eventScope)
    if (TERMINAL_SHIPPING_STATUSES.has(unifiedStatus)) {
      const terminalEvent = getTerminalShippingEvent(unifiedStatus)
      if (!terminalEvent) return
      await emitShippingEvent(terminalEvent, eventPayload, eventScope)
    }
  } catch (error) {
    logger.error('Job processing failed', { providerKey: payload.providerKey, shipmentId: payload.shipmentId, err: error })
    throw error
  }
}
