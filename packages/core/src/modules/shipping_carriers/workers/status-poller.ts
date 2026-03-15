import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { ShippingCarrierService } from '../lib/shipping-service'

type PollerJobPayload = {
  providerKey: string
  shipmentIds: string[]
  scope: {
    organizationId: string
    tenantId: string
  }
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'shipping-carriers-status-poller',
  id: 'shipping-carriers:status-poller',
  concurrency: 2,
}

export default async function handle(job: QueuedJob<PollerJobPayload>, ctx: HandlerContext): Promise<void> {
  const service = ctx.resolve<ShippingCarrierService>('shippingCarrierService')
  for (const shipmentId of job.payload.shipmentIds) {
    await service.getTracking({
      providerKey: job.payload.providerKey,
      shipmentId,
      organizationId: job.payload.scope.organizationId,
      tenantId: job.payload.scope.tenantId,
    })
  }
}
