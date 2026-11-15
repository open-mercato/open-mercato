import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EmailAttachment, ResolvedEmailPayload } from '@open-mercato/shared/lib/email/send'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { SystemEmailDelivery } from '../data/entities'
import { emitCommunicationChannelsEvent } from '../events'
import { classifyOutboundError } from '../lib/error-classification'
import { COMMUNICATION_CHANNELS_QUEUES } from '../lib/queue'
import { deliverSystemEmail, type SystemEmailBody } from '../lib/system-email'
import { resolveSystemEmailProvider } from '../lib/system-email-provider-config'
import {
  computeSystemEmailBackoffMs,
  enqueueSystemEmailDeliveryJob,
  purgeSystemEmailDeliveryContent,
  resolveSystemEmailMaxAttempts,
  truncateSystemEmailError,
  type SystemEmailDeliveryJob,
} from '../lib/system-email-queue'

const logger = createLogger('communication_channels').child({ component: 'system-email-delivery' })

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.systemEmail,
  id: 'communication_channels:system-email-delivery',
  concurrency: 5,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

function parseAttachments(serialized: string | null | undefined): EmailAttachment[] | undefined {
  if (!serialized) return undefined
  const parsed: unknown = JSON.parse(serialized)
  return Array.isArray(parsed) ? (parsed as EmailAttachment[]) : undefined
}

function toPayload(delivery: SystemEmailDelivery): ResolvedEmailPayload {
  return {
    to: delivery.recipient ?? '',
    subject: delivery.subject ?? '',
    html: delivery.htmlBody ?? undefined,
    text: delivery.textBody ?? undefined,
    from: delivery.fromAddress,
    fromIsInstanceDefault: delivery.fromIsInstanceDefault,
    replyTo: delivery.replyTo ?? undefined,
    attachments: parseAttachments(delivery.attachments),
    tenantId: delivery.tenantId,
    organizationId: delivery.organizationId ?? null,
  }
}

function toBody(delivery: SystemEmailDelivery): SystemEmailBody {
  const html = delivery.htmlBody ?? undefined
  const text = delivery.textBody ?? undefined
  if (html) return { html, text, body: html, bodyFormat: 'html' }
  return { text, body: text ?? '', bodyFormat: 'text' }
}

/**
 * Queued system email delivery.
 *
 * Loads the `system_email_deliveries` row and sends it through the same provider path as a
 * synchronous send. Transient failures are re-enqueued with backoff until the attempt budget is
 * spent; permanent failures and exhausted attempts close the row as `failed`, emit
 * `communication_channels.system_email.delivery_failed` and are reported. Content columns are purged
 * on every terminal state.
 *
 * Like `outbound-delivery`, the worker never throws on a recorded failure, so the queue's own retry
 * policy does not stack on top of this one. It throws only when it cannot record the outcome at all.
 */
export default async function handle(
  job: QueuedJob<SystemEmailDeliveryJob>,
  ctx: HandlerContext,
): Promise<void> {
  const { deliveryId, scope } = job.payload
  const em = ctx.resolve<EntityManager>('em').fork()
  const delivery = await findOneWithDecryption(
    em,
    SystemEmailDelivery,
    { id: deliveryId, tenantId: scope.tenantId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!delivery || delivery.status !== 'pending') return

  const attempt = delivery.attempts + 1
  delivery.providerKey = delivery.providerKey ?? resolveSystemEmailProvider()
  const containerProxy = { resolve: ctx.resolve.bind(ctx) }
  let delivered: { providerKey: string }
  try {
    delivered = await deliverSystemEmail(containerProxy as never, toPayload(delivery), toBody(delivery))
  } catch (error) {
    await recordFailedAttempt(em, delivery, job.payload, attempt, error)
    return
  }

  delivery.attempts = attempt
  delivery.providerKey = delivered.providerKey
  delivery.status = 'sent'
  delivery.sentAt = new Date()
  delivery.lastError = null
  purgeSystemEmailDeliveryContent(delivery)
  await em.flush()
}

async function recordFailedAttempt(
  em: EntityManager,
  delivery: SystemEmailDelivery,
  { deliveryId, scope }: SystemEmailDeliveryJob,
  attempt: number,
  error: unknown,
): Promise<void> {
  const classification = classifyOutboundError(error)
  delivery.attempts = attempt
  delivery.lastError = truncateSystemEmailError(classification.message)

  const maxAttempts = resolveSystemEmailMaxAttempts()
  if (classification.transient && attempt < maxAttempts) {
    await em.flush()
    logger.warn('transient system email failure; re-enqueueing', {
      deliveryId,
      attempt,
      maxAttempts,
      reason: classification.message,
    })
    await enqueueSystemEmailDeliveryJob(
      { deliveryId, scope, attempt: attempt + 1 },
      computeSystemEmailBackoffMs(attempt),
    )
    return
  }

  delivery.status = 'failed'
  purgeSystemEmailDeliveryContent(delivery)
  await em.flush()
  logger.error('giving up on system email delivery', {
    deliveryId,
    attempt,
    transient: classification.transient,
    reason: classification.message,
  })
  getTelemetryRuntime()?.reportError(error, {
    module: 'communication_channels',
    code: 'communication_channels.system_email_delivery_failed',
  })
  await emitCommunicationChannelsEvent(
    'communication_channels.system_email.delivery_failed',
    {
      deliveryId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      providerKey: delivery.providerKey,
      attempts: attempt,
      error: delivery.lastError,
    },
    { persistent: true },
  )
}
