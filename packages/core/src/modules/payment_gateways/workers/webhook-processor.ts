import type { EntityManager } from '@mikro-orm/postgresql'
import type { WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import type { PaymentGatewayService } from '../lib/gateway-service'
import { processPaymentGatewayWebhookJob, type PaymentGatewayWebhookJobPayload } from '../lib/webhook-processor'

type WebhookJobPayload = PaymentGatewayWebhookJobPayload & {
  event: WebhookEvent
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'payment-gateways-webhook',
  id: 'payment-gateways:webhook-processor',
  concurrency: 5,
}

export default async function handle(job: QueuedJob<WebhookJobPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const paymentGatewayService = ctx.resolve<PaymentGatewayService>('paymentGatewayService')
  const integrationLogService = ctx.resolve<IntegrationLogService>('integrationLogService')
  await processPaymentGatewayWebhookJob(
    { em, paymentGatewayService, integrationLogService },
    job.payload,
  )
}
