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
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

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
  const { event, payload } = job.payload
  const listeners = getListenerMap()
  const subscribers = listeners.get(event)

  if (!subscribers || subscribers.length === 0) return

  const errors: Array<{ subscriberId: string; error: unknown }> = []

  for (const sub of subscribers) {
    try {
      await sub.handler(payload, { resolve: ctx.resolve })
    } catch (error) {
      // Log error but continue processing other subscribers
      console.error(`[events] Subscriber "${sub.id}" failed for event "${event}":`, error)
      errors.push({ subscriberId: sub.id, error })
    }
  }

  // If all subscribers failed, throw to trigger retry
  if (errors.length === subscribers.length) {
    throw new Error(`All ${errors.length} subscriber(s) failed for event "${event}"`)
  }

  // Log partial failures but don't fail the job
  if (errors.length > 0) {
    console.warn(`[events] ${errors.length}/${subscribers.length} subscriber(s) failed for event "${event}"`)
  }
}
