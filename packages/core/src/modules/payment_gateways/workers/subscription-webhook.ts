import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import {
  processSubscriptionWebhookJob,
  type PaymentGatewaySubscriptionWebhookJobPayload,
} from '../lib/subscription-webhook-processor'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'payment-gateways-subscription-webhook',
  id: 'payment-gateways:subscription-webhook',
  concurrency: 5,
}

export default async function handle(job: QueuedJob<PaymentGatewaySubscriptionWebhookJobPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  let integrationLogService: IntegrationLogService | undefined
  try {
    integrationLogService = ctx.resolve<IntegrationLogService>('integrationLogService')
  } catch {
    integrationLogService = undefined
  }

  await processSubscriptionWebhookJob(
    { em, integrationLogService },
    job.payload,
  )
}
