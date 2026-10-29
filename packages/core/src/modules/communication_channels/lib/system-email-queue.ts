import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ResolvedEmailPayload } from '@open-mercato/shared/lib/email/send'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { SystemEmailDelivery } from '../data/entities'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from './queue'
import type { SystemEmailBody } from './system-email'

export type SystemEmailDeliveryJob = {
  deliveryId: string
  scope: {
    tenantId: string
    organizationId: string | null
  }
  /** Attempt number, 1-based. */
  attempt?: number
}

const DEFAULT_MAX_ATTEMPTS = 8
const MIN_MAX_ATTEMPTS = 1
const MAX_MAX_ATTEMPTS = 20
const BACKOFF_BASE_MS = 30_000
const BACKOFF_CAP_MS = 30 * 60_000
const BACKOFF_JITTER_RATIO = 0.1
const LAST_ERROR_MAX_LENGTH = 1000

export function resolveSystemEmailMaxAttempts(): number {
  const configured = Number.parseInt(process.env.OM_SYSTEM_EMAIL_MAX_ATTEMPTS ?? '', 10)
  if (!Number.isFinite(configured)) return DEFAULT_MAX_ATTEMPTS
  return Math.min(MAX_MAX_ATTEMPTS, Math.max(MIN_MAX_ATTEMPTS, configured))
}

function resolveBackoffBaseMs(): number {
  const configured = Number.parseInt(process.env.OM_SYSTEM_EMAIL_RETRY_BASE_MS ?? '', 10)
  return Number.isFinite(configured) && configured > 0 ? configured : BACKOFF_BASE_MS
}

/**
 * Delay before the attempt that follows `attemptNumber`. Starts at 30 s and doubles up to 30 min, so
 * the default 8 attempts span roughly two hours — long enough to outlive a typical provider incident.
 */
export function computeSystemEmailBackoffMs(attemptNumber: number, random: () => number = Math.random): number {
  const exponential = resolveBackoffBaseMs() * Math.pow(2, Math.max(0, attemptNumber - 1))
  const base = Math.min(exponential, BACKOFF_CAP_MS)
  return base + Math.floor(base * BACKOFF_JITTER_RATIO * random())
}

export function truncateSystemEmailError(message: string): string {
  return message.length > LAST_ERROR_MAX_LENGTH ? `${message.slice(0, LAST_ERROR_MAX_LENGTH)}…` : message
}

/** Clears every column that can carry recipient data or one-time links. */
export function purgeSystemEmailDeliveryContent(delivery: SystemEmailDelivery): void {
  delivery.recipient = null
  delivery.subject = null
  delivery.htmlBody = null
  delivery.textBody = null
  delivery.attachments = null
  delivery.replyTo = null
}

export async function enqueueSystemEmailDeliveryJob(job: SystemEmailDeliveryJob, delayMs?: number): Promise<void> {
  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.systemEmail)
  await queue.enqueue(job as unknown as Record<string, unknown>, delayMs ? { delayMs } : undefined)
}

/**
 * Persist a queued system email and enqueue its delivery job. The job carries the row id only; the
 * rendered body stays in the encrypted row. When the enqueue itself fails the row is closed as
 * `failed` and the error is rethrown, so the caller sees the same failure a synchronous send would.
 */
export async function enqueueSystemEmailDelivery(
  container: AppContainer,
  payload: ResolvedEmailPayload,
  body: SystemEmailBody,
): Promise<string> {
  const tenantId = payload.tenantId
  if (!tenantId) {
    throw new Error('[internal] queued system email requires a tenantId')
  }
  const organizationId = payload.organizationId ?? null
  const em = (container.resolve('em') as EntityManager).fork()
  const delivery = em.create(SystemEmailDelivery, {
    tenantId,
    organizationId,
    status: 'pending',
    attempts: 0,
    recipient: payload.to,
    subject: payload.subject,
    htmlBody: body.html ?? null,
    textBody: body.text ?? null,
    attachments: payload.attachments?.length ? JSON.stringify(payload.attachments) : null,
    fromAddress: payload.from,
    fromIsInstanceDefault: payload.fromIsInstanceDefault ?? false,
    replyTo: payload.replyTo ?? null,
  })
  await em.persist(delivery).flush()

  try {
    await enqueueSystemEmailDeliveryJob({
      deliveryId: delivery.id,
      scope: { tenantId, organizationId },
      attempt: 1,
    })
  } catch (error) {
    delivery.status = 'failed'
    delivery.lastError = truncateSystemEmailError(error instanceof Error ? error.message : String(error))
    purgeSystemEmailDeliveryContent(delivery)
    await em.flush()
    getTelemetryRuntime()?.reportError(error, {
      module: 'communication_channels',
      code: 'communication_channels.system_email_enqueue_failed',
    })
    throw error
  }
  return delivery.id
}
