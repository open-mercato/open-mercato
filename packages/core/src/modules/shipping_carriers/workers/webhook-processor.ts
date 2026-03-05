import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { CarrierShipment } from '../data/entities'
import { getShippingAdapter } from '../lib/adapter-registry'

type WebhookJobPayload = {
  providerKey: string
  event: {
    eventType: string
    data: Record<string, unknown>
  }
  shipmentId?: string | null
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

  const shipment = job.payload.shipmentId
    ? await em.findOne(CarrierShipment, { id: job.payload.shipmentId })
    : null
  if (!shipment) return

  const carrierStatus = typeof job.payload.event.data.status === 'string'
    ? job.payload.event.data.status
    : job.payload.event.eventType
  const unifiedStatus = adapter.mapStatus(carrierStatus)
  shipment.carrierStatus = carrierStatus
  shipment.unifiedStatus = unifiedStatus
  shipment.lastWebhookAt = new Date()
  await em.flush()
}
