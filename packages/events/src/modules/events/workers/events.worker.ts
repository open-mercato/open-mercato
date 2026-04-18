import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { getCliModules } from '@open-mercato/shared/modules/registry'

export const EVENTS_QUEUE_NAME = 'events'

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
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

type SubscriberEntry = {
  id: string
  event: string
  handler: (payload: unknown, ctx: unknown) => Promise<void> | void
}

// Cached listener map - built once on first use
let cachedListenerMap: Map<string, SubscriberEntry[]> | null = null

/**
 * Clear the cached listener map (for testing purposes).
 */
export function clearListenerCache(): void {
  cachedListenerMap = null
}

// Build listener map from module subscribers
function buildListenerMap(): Map<string, SubscriberEntry[]> {
  const listeners = new Map<string, SubscriberEntry[]>()
  for (const mod of getCliModules()) {
    const subs = (mod as { subscribers?: SubscriberEntry[] }).subscribers
    if (!subs) continue
    for (const sub of subs) {
      if (!listeners.has(sub.event)) listeners.set(sub.event, [])
      listeners.get(sub.event)!.push(sub)
    }
  }
  return listeners
}

// Get cached listener map, building on first access
function getListenerMap(): Map<string, SubscriberEntry[]> {
  if (!cachedListenerMap) {
    cachedListenerMap = buildListenerMap()
  }
  return cachedListenerMap
}

/**
 * Events worker handler.
 * Dispatches queued events to registered module subscribers.
 * Each subscriber is isolated - failures in one don't affect others.
 */
export default async function handle(
  job: QueuedJob<EventJobPayload>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  const { event, payload, options } = job.payload
  const listeners = getListenerMap()
  const subscribers = listeners.get(event)

  if (!subscribers || subscribers.length === 0) return

  const handlerCtx = {
    resolve: ctx.resolve,
    tenantId: options?.tenantId ?? null,
    organizationId: options?.organizationId ?? null,
  }

  const results = await Promise.allSettled(
    subscribers.map((sub) => Promise.resolve(sub.handler(payload, handlerCtx)))
  )

  const errors: Array<{ subscriberId: string; error: unknown }> = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      const sub = subscribers[i]
      console.error(`[events] Subscriber "${sub.id}" failed for event "${event}":`, result.reason)
      errors.push({ subscriberId: sub.id, error: result.reason })
    }
  }

  if (errors.length > 0) {
    const failedIds = errors.map((e) => e.subscriberId).join(', ')
    throw new Error(
      `${errors.length}/${subscribers.length} subscriber(s) failed for event "${event}": ${failedIds}`
    )
  }
}
