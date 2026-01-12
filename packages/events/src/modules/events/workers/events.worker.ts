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
  event: string
  handler: (payload: unknown, ctx: unknown) => Promise<void> | void
}

// Build listener map from module subscribers
function buildListenerMap(): Map<string, Set<SubscriberEntry['handler']>> {
  const listeners = new Map<string, Set<SubscriberEntry['handler']>>()
  for (const mod of getCliModules()) {
    const subs = (mod as { subscribers?: SubscriberEntry[] }).subscribers
    if (!subs) continue
    for (const sub of subs) {
      if (!listeners.has(sub.event)) listeners.set(sub.event, new Set())
      listeners.get(sub.event)!.add(sub.handler)
    }
  }
  return listeners
}

/**
 * Events worker handler.
 * Dispatches queued events to registered module subscribers.
 */
export default async function handle(
  job: QueuedJob<EventJobPayload>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  const { event, payload } = job.payload
  const listeners = buildListenerMap()
  const handlers = listeners.get(event)

  if (!handlers || handlers.size === 0) return

  for (const handler of handlers) {
    await handler(payload, { resolve: ctx.resolve })
  }
}
