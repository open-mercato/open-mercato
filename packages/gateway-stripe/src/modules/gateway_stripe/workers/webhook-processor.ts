import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { getGatewayAdapter } from '@open-mercato/core/modules/payment_gateways/lib/adapter-registry'
import type { GatewayWebhookEvent } from '@open-mercato/core/modules/payment_gateways/lib/adapter'

export const metadata: WorkerMeta = {
  queue: 'stripe-webhook',
  id: 'gateway_stripe:webhook-processor',
  concurrency: 5,
}

type WebhookJobPayload = {
  provider: string
  tenantId: string
  organizationId: string
  verifiedEvent: GatewayWebhookEvent
  settings: Record<string, unknown>
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

export default async function handle(job: QueuedJob<WebhookJobPayload>, ctx: HandlerContext): Promise<void> {
  const payload = job.payload
  if (payload.provider !== 'stripe') return

  const adapter = getGatewayAdapter('stripe', '2024-12-18')
  if (!adapter) throw new Error('Stripe adapter not registered')

  const integrationLog = ctx.resolve('integrationLog') as {
    scoped: (
      integrationId: string,
      correlationId: string | null | undefined,
      scope: { tenantId: string; organizationId?: string | null },
    ) => {
      info: (code: string, message: string, details?: Record<string, unknown>) => Promise<void>
      warning: (code: string, message: string, details?: Record<string, unknown>) => Promise<void>
    }
  }

  const gatewayTransactionService = ctx.resolve('gatewayTransactionService') as {
    syncFromGatewayStatus: (input: {
      providerKey: string
      providerSessionId: string
      status: {
        gatewayStatus: string
        unifiedStatus: string
        providerData?: Record<string, unknown>
      }
      webhookEventId?: string | null
      tenantId: string
      organizationId: string
    }) => Promise<{ id: string } | null>
  }

  const log = integrationLog.scoped('gateway_stripe', payload.verifiedEvent.idempotencyKey ?? null, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })

  const providerSessionId = payload.verifiedEvent.sessionId
  if (!providerSessionId) {
    await log.warning('webhook.skip', 'Stripe webhook without payment session id', {
      eventType: payload.verifiedEvent.eventType,
      eventId: payload.verifiedEvent.eventId,
    })
    return
  }

  const providerStatus = payload.verifiedEvent.gatewayStatus ?? payload.verifiedEvent.eventType
  const unifiedStatus = payload.verifiedEvent.unifiedStatus
    ?? adapter.mapStatus(providerStatus, payload.verifiedEvent.eventType)

  const updated = await gatewayTransactionService.syncFromGatewayStatus({
    providerKey: 'stripe',
    providerSessionId,
    status: {
      gatewayStatus: providerStatus,
      unifiedStatus,
      providerData: payload.verifiedEvent.payload,
    },
    webhookEventId: payload.verifiedEvent.eventId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })

  if (!updated) {
    await log.warning('webhook.unmatched', 'No gateway transaction found for Stripe webhook', {
      providerSessionId,
      eventType: payload.verifiedEvent.eventType,
    })
    return
  }

  await log.info('webhook.processed', 'Stripe webhook processed', {
    transactionId: updated.id,
    providerSessionId,
    eventType: payload.verifiedEvent.eventType,
    unifiedStatus,
  })
}
