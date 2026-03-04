import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { getGatewayAdapter } from '../lib/adapter-registry'
import type { GatewayWebhookEvent } from '../lib/adapter'

export const PAYMENT_GATEWAYS_WEBHOOK_QUEUE = 'payment-gateways-webhook'

export const metadata: WorkerMeta = {
  queue: PAYMENT_GATEWAYS_WEBHOOK_QUEUE,
  id: 'payment_gateways:webhook-processor',
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
  const adapter = getGatewayAdapter(payload.provider, '2024-12-18')
  if (!adapter) {
    throw new Error(`No adapter registered for provider '${payload.provider}'`)
  }

  const integrationLog = ctx.resolve('integrationLog') as {
    scoped: (
      integrationId: string,
      correlationId: string | null | undefined,
      scope: { tenantId: string; organizationId?: string | null },
    ) => {
      info: (code: string, message: string, details?: Record<string, unknown>) => Promise<void>
      warning: (code: string, message: string, details?: Record<string, unknown>) => Promise<void>
      error: (code: string, message: string, details?: Record<string, unknown>) => Promise<void>
    }
  }

  const logger = integrationLog.scoped(`gateway_${payload.provider}`, payload.verifiedEvent.idempotencyKey ?? null, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })

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

  const providerSessionId = payload.verifiedEvent.sessionId
  if (!providerSessionId) {
    await logger.warning('webhook.skip', 'Webhook event has no session identifier', {
      eventType: payload.verifiedEvent.eventType,
      eventId: payload.verifiedEvent.eventId,
    })
    return
  }

  const providerStatus = payload.verifiedEvent.gatewayStatus ?? payload.verifiedEvent.eventType
  const unifiedStatus = payload.verifiedEvent.unifiedStatus
    ?? adapter.mapStatus(providerStatus, payload.verifiedEvent.eventType)

  const transaction = await gatewayTransactionService.syncFromGatewayStatus({
    providerKey: payload.provider,
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

  if (!transaction) {
    await logger.warning('webhook.unmatched', 'No gateway transaction found for webhook session', {
      providerSessionId,
      eventType: payload.verifiedEvent.eventType,
      eventId: payload.verifiedEvent.eventId,
    })
    return
  }

  await logger.info('webhook.processed', 'Webhook processed and status synchronized', {
    transactionId: transaction.id,
    providerSessionId,
    eventType: payload.verifiedEvent.eventType,
    unifiedStatus,
  })
}
