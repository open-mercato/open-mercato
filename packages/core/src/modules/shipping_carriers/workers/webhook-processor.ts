import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CarrierShipment } from '../data/entities'
import { emitShippingEvent } from '../events'
import { getShippingAdapter } from '../lib/adapter-registry'
import { getTerminalShippingEvent, syncShipmentStatus, TERMINAL_SHIPPING_STATUSES } from '../lib/status-sync'

type WebhookJobPayload = {
  providerKey: string
  event: {
    eventType: string
    data: Record<string, unknown>
  }
  shipmentId?: string | null
  scope?: {
    organizationId: string
    tenantId: string
  } | null
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'shipping-carriers-webhook',
  id: 'shipping-carriers:webhook-processor',
  concurrency: 5,
}

export default async function handle(job: QueuedJob<WebhookJobPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const adapter = getShippingAdapter(job.payload.providerKey)
  if (!adapter) return

  const shipment = job.payload.shipmentId && job.payload.scope
    ? await findOneWithDecryption(
      em,
      CarrierShipment,
      {
        id: job.payload.shipmentId,
        organizationId: job.payload.scope.organizationId,
        tenantId: job.payload.scope.tenantId,
        deletedAt: null,
      },
      undefined,
      job.payload.scope,
    )
    : null
  if (!shipment) return

  const carrierStatus = typeof job.payload.event.data.status === 'string'
    ? job.payload.event.data.status
    : job.payload.event.eventType
  const unifiedStatus = adapter.mapStatus(carrierStatus)
  shipment.carrierStatus = carrierStatus
  shipment.lastWebhookAt = new Date()

  const transitionApplied = syncShipmentStatus(shipment, unifiedStatus)
  if (!transitionApplied) return

  await em.flush()

  const eventPayload = {
    shipmentId: shipment.id,
    providerKey: job.payload.providerKey,
    previousStatus: carrierStatus,
    newStatus: unifiedStatus,
    organizationId: shipment.organizationId,
    tenantId: shipment.tenantId,
  }
  await emitShippingEvent('shipping_carriers.shipment.status_changed', eventPayload)
  if (TERMINAL_SHIPPING_STATUSES.has(unifiedStatus)) {
    const terminalEvent = getTerminalShippingEvent(unifiedStatus)
    if (!terminalEvent) return
    await emitShippingEvent(terminalEvent, eventPayload)
  }
}
