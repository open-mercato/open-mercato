import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { CarrierShipment } from '../data/entities'
import { getShippingAdapter } from '../lib/adapter-registry'

export const metadata: WorkerMeta = {
  queue: 'shipping-carriers-webhook',
  id: 'shipping_carriers:webhook-processor',
  concurrency: 5,
}

type ShippingWebhookPayload = {
  provider: string
  tenantId: string
  organizationId: string
  verifiedEvent: {
    eventType: string
    eventId: string
    shipmentId?: string
    trackingNumber?: string
    status?: string
    payload: Record<string, unknown>
  }
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

export default async function handle(job: QueuedJob<ShippingWebhookPayload>, ctx: HandlerContext): Promise<void> {
  const payload = job.payload
  const em = (ctx.resolve('em') as any).fork()

  const adapter = getShippingAdapter(payload.provider)
  if (!adapter) {
    throw new Error(`Shipping adapter not found for '${payload.provider}'`)
  }

  const status = payload.verifiedEvent.status
    ?? adapter.mapStatus(payload.verifiedEvent.eventType)

  const shipment = await em.findOne(CarrierShipment, {
    providerKey: payload.provider,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    $or: [
      ...(payload.verifiedEvent.shipmentId ? [{ carrierShipmentId: payload.verifiedEvent.shipmentId }] : []),
      ...(payload.verifiedEvent.trackingNumber ? [{ trackingNumber: payload.verifiedEvent.trackingNumber }] : []),
    ],
    deletedAt: null,
  })

  if (!shipment) return

  shipment.status = status
  shipment.carrierData = {
    ...(shipment.carrierData ?? {}),
    lastWebhookEventId: payload.verifiedEvent.eventId,
    lastWebhookEventType: payload.verifiedEvent.eventType,
    lastWebhookPayload: payload.verifiedEvent.payload,
  }

  await em.persistAndFlush(shipment)
}
