import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EventBus, QueuedDispatchResult } from '../../../types'

/** An `EventBus` proven at runtime to implement the optional `dispatchQueued`. */
type DispatchCapableBus = EventBus & Required<Pick<EventBus, 'dispatchQueued'>>

export const EVENTS_QUEUE_NAME = 'events'

const logger = createLogger('events')

const DEFAULT_CONCURRENCY = 1
const envConcurrency = process.env.WORKERS_EVENTS_CONCURRENCY

export const metadata: WorkerMeta = {
  queue: EVENTS_QUEUE_NAME,
  concurrency: envConcurrency ? parseInt(envConcurrency, 10) : DEFAULT_CONCURRENCY,
}

type EventJobPayload = {
  event: string
  payload: unknown
  options?: {
    tenantId?: string | null
    organizationId?: string | null
  }
  /**
   * Producer stamp: the emitting process already ran the persistent subscribers
   * inline because single-delivery was reconciled off there. Dispatching again
   * here would double-run them, so the job is a no-op.
   */
  persistentDeliveredInline?: boolean
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
  eventName?: string
  tenantId?: string | null
  organizationId?: string | null
}

/**
 * Resolves the DI event bus that owns subscriber dispatch for this job.
 *
 * The worker deliberately has no subscriber registry of its own. It used to build
 * one from `getCliModules()`, which is populated only by the `mercato` bin, so any
 * process that started a worker another way dispatched zero subscribers and
 * completed the job silently - dropping webhook deliveries, workflow event
 * triggers and business-rule triggers with no error and no log. The per-job
 * request container already carries a bus with every module subscriber registered,
 * so that is the single source of truth. When it is missing, fail the job loudly
 * rather than repeat the silent drop.
 */
function resolveEventBus(ctx: HandlerContext, event: string): DispatchCapableBus {
  let bus: unknown
  try {
    bus = ctx.resolve('eventBus')
  } catch (error) {
    throw new Error(
      `[internal] Events worker cannot dispatch "${event}": no "eventBus" in the job container ` +
      `(${error instanceof Error ? error.message : String(error)}). The events worker must run inside a ` +
      `bootstrapped process, e.g. \`mercato queue worker events\` or \`mercato queue worker --all\`. ` +
      `Failing the job so it retries instead of dropping the event's subscribers.`,
    )
  }
  if (!bus || typeof (bus as EventBus).dispatchQueued !== 'function') {
    throw new Error(
      `[internal] Events worker cannot dispatch "${event}": the resolved "eventBus" has no ` +
      `dispatchQueued(). Either the bus failed to initialize and the degraded no-op fallback is in ` +
      `place, or a stale @open-mercato/events build is loaded alongside a newer one. Failing the job ` +
      `so it retries instead of dropping the event's subscribers.`,
    )
  }
  return bus as DispatchCapableBus
}

function reportFailures(event: string, results: QueuedDispatchResult[]): void {
  // Keyed on `ok`, never on `error !== undefined`: a handler can reject with
  // `undefined`, which would otherwise be scored as a success and the job
  // completed despite a failed subscriber.
  const failures = results.filter((result) => !result.ok)
  if (failures.length === 0) {
    return
  }

  for (const failure of failures) {
    logger.error('Subscriber failed for event', {
      event,
      subscriberId: failure.subscriberId,
      err: failure.error,
    })
  }

  const failedIds = failures.map((failure) => failure.subscriberId).join(', ')
  throw new Error(
    `${failures.length}/${results.length} subscriber(s) failed for event "${event}": ${failedIds}`,
  )
}

/**
 * Events worker handler.
 * Dispatches queued events to the subscribers registered on the DI event bus.
 * Each subscriber is isolated - failures in one don't affect others.
 */
export default async function handle(
  job: QueuedJob<EventJobPayload>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  const { event, payload, options, persistentDeliveredInline } = job.payload
  if (persistentDeliveredInline) {
    return
  }

  const bus = resolveEventBus(ctx, event)
  const results = await bus.dispatchQueued(event, payload, {
    tenantId: options?.tenantId ?? null,
    organizationId: options?.organizationId ?? null,
  })

  // A resolvable bus with an empty registry is the residual silent-loss path:
  // `core/bootstrap.ts` logs and continues when `getModules()` fails, leaving a
  // valid bus with no subscribers, and this job would then complete green.
  // Zero subscribers is legitimate for an event nobody listens to, so this
  // cannot throw - but at job-dispatch time it is more often a bug than a no-op,
  // so make it visible rather than silent.
  if (results.length === 0) {
    logger.warn('Queued event dispatched to zero subscribers', { event, jobId: ctx.jobId })
    return
  }

  reportFailures(event, results)
}

/**
 * @deprecated The worker no longer keeps a listener cache; subscriber resolution
 * lives on the DI event bus. Kept as a no-op for one minor so existing callers
 * (tests, custom worker harnesses) keep compiling.
 */
export function clearListenerCache(): void {}
