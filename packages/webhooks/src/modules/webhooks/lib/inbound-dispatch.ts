import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  WebhookHandlerContext,
  WebhookHandlerPayload,
  WebhookHandlerResult,
} from '@open-mercato/shared/lib/webhooks'
import { WebhookIngestionEntity } from '../data/entities'
import { emitWebhooksEvent } from '../events'
import { resolveWebhookHandlers } from './inbound-registry'

const MAX_HANDLER_RESULTS = 50
const MAX_ERROR_MESSAGE_LENGTH = 1024

export type InboundDispatchJob = {
  ingestionId: string
  sourceKey: string
  eventType: string
  tenantId: string
  organizationId: string
}

function truncateError(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message
}

function moduleOfHandler(handlerId: string): string {
  const separatorIndex = handlerId.indexOf(':')
  return separatorIndex > 0 ? handlerId.slice(0, separatorIndex) : handlerId
}

/**
 * Process a queued inbound-dispatch job: load the ingestion, run every matching
 * handler independently (a failing handler never blocks the others), record
 * per-handler results, and emit lifecycle events. The payload and headers are
 * read from the (decrypted) ingestion row rather than carried on the job, so the
 * queue never stores the raw webhook body. Idempotent — a job whose ingestion is
 * already `processed` returns early, and a retry after a partial failure re-runs
 * only the handlers that have not already succeeded.
 */
export async function processInboundDispatchJob(
  em: EntityManager,
  job: InboundDispatchJob,
  ctx: WebhookHandlerContext,
): Promise<void> {
  const startedAtMs = Date.now()
  const ingestion = await findOneWithDecryption(
    em,
    WebhookIngestionEntity,
    {
      id: job.ingestionId,
      tenantId: job.tenantId,
      organizationId: job.organizationId,
    },
    {},
  )

  if (!ingestion || ingestion.status === 'processed') return

  ingestion.status = 'processing'
  await em.flush()

  const handlers = resolveWebhookHandlers(job.sourceKey, job.eventType)
  const payload: WebhookHandlerPayload = {
    data: ingestion.payload,
    eventType: job.eventType,
    sourceKey: job.sourceKey,
    headers: ingestion.headers ?? {},
    ingestionId: job.ingestionId,
    tenantId: job.tenantId,
    organizationId: job.organizationId,
  }

  const previousResults = Array.isArray(ingestion.handlerResults) ? ingestion.handlerResults : []
  const alreadySucceeded = new Map(
    previousResults
      .filter((result) => result?.status === 'success')
      .map((result) => [result.handlerId, result]),
  )

  const results: WebhookHandlerResult[] = []
  let failedCount = 0

  for (const entry of handlers) {
    const previousSuccess = alreadySucceeded.get(entry.meta.id)
    if (previousSuccess) {
      results.push(previousSuccess)
      continue
    }

    const handlerStartedMs = Date.now()
    const handlerStartedAt = new Date(handlerStartedMs).toISOString()
    try {
      const mod = await entry.handler()
      await mod.default(payload, ctx)
      results.push({
        handlerId: entry.meta.id,
        module: moduleOfHandler(entry.meta.id),
        status: 'success',
        durationMs: Date.now() - handlerStartedMs,
        startedAt: handlerStartedAt,
      })
    } catch (error) {
      failedCount += 1
      const message = truncateError(error instanceof Error ? error.message : String(error))
      results.push({
        handlerId: entry.meta.id,
        module: moduleOfHandler(entry.meta.id),
        status: 'failed',
        errorMessage: message,
        durationMs: Date.now() - handlerStartedMs,
        startedAt: handlerStartedAt,
      })
      await emitWebhooksEvent('webhooks.inbound.handler_failed', {
        ingestionId: job.ingestionId,
        sourceKey: job.sourceKey,
        eventType: job.eventType,
        handlerId: entry.meta.id,
        errorMessage: message,
        tenantId: job.tenantId,
        organizationId: job.organizationId,
      })
    }
  }

  ingestion.handlerCount = handlers.length
  ingestion.handlerResults = results.slice(0, MAX_HANDLER_RESULTS)
  ingestion.status = failedCount > 0 ? 'failed' : 'processed'
  ingestion.processedAt = new Date()
  ingestion.durationMs = Date.now() - startedAtMs
  ingestion.errorMessage = failedCount > 0
    ? `${failedCount}/${handlers.length} handlers failed`
    : null
  await em.flush()

  await emitWebhooksEvent('webhooks.inbound.processed', {
    ingestionId: job.ingestionId,
    sourceKey: job.sourceKey,
    eventType: job.eventType,
    handlerCount: handlers.length,
    failedCount,
    tenantId: job.tenantId,
    organizationId: job.organizationId,
  })
}
