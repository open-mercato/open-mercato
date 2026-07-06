import { createQueue } from '@open-mercato/queue'
import type { Queue } from '@open-mercato/queue'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { isSingleDeliveryRequested } from './single-delivery'
import { matchEventPattern } from '@open-mercato/shared/lib/events/patterns'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import { isBroadcastEvent } from '@open-mercato/shared/modules/events'
import {
  inferModuleIdFromResourceId,
  withModuleResourceUsage,
} from '@open-mercato/shared/lib/modules/resource-usage'
export { registerCrossProcessEventListener } from './bridge'
import { publishCrossProcessEvent } from './bridge'
import type {
  EventBus,
  CreateBusOptions,
  SubscriberHandler,
  SubscriberDescriptor,
  EventPayload,
  EmitOptions,
} from './types'

/** Queue name for persistent events */
const EVENTS_QUEUE_NAME = 'events'

type RegisteredSubscriber = {
  id?: string
  moduleId?: string
  event: string
  handler: SubscriberHandler
  persistent?: boolean
}

/**
 * When enabled, a persistent emit delivers each subscriber on exactly one path:
 * persistent-marked subscribers are skipped inline (the events worker dispatches
 * them via pattern match, so wildcard persistent subscribers are reached), while
 * ephemeral subscribers keep running inline. Defaults ON; the server bootstrap
 * reconciles the env against worker availability (and may rewrite it to `false`
 * for a worker-less process). Both the bus and the events worker read the same
 * (possibly reconciled) env var, so they always agree within a process.
 */
function isSingleDeliveryEnabled(): boolean {
  return isSingleDeliveryRequested()
}

type GlobalEventTap = (event: string, payload: EventPayload, options?: EmitOptions) => void | Promise<void>
const GLOBAL_EVENT_TAPS_KEY = '__openMercatoEventBusGlobalTaps__'

function hasTenantScope(payload: EventPayload): boolean {
  return typeof (payload as Record<string, unknown>)?.tenantId === 'string'
    && String((payload as Record<string, unknown>).tenantId).trim().length > 0
}

function getGlobalEventTaps(): Set<GlobalEventTap> {
  const existing = (globalThis as Record<string, unknown>)[GLOBAL_EVENT_TAPS_KEY]
  if (existing instanceof Set) {
    return existing as Set<GlobalEventTap>
  }
  const created = new Set<GlobalEventTap>()
  ;(globalThis as Record<string, unknown>)[GLOBAL_EVENT_TAPS_KEY] = created
  return created
}

export function registerGlobalEventTap(handler: GlobalEventTap): () => void {
  const taps = getGlobalEventTaps()
  taps.add(handler)
  return () => {
    taps.delete(handler)
  }
}

/** Job data structure for queued events */
type EventJobData = {
  event: string
  payload: EventPayload
  options?: EmitOptions
}

// Process-wide cache of the async (BullMQ) persistent-events producer queue.
// Each authenticated request builds a fresh DI container and event bus, so a
// per-bus producer queue opened a new ioredis connection per write request that
// was never closed — leaking one Redis connection per request until maxclients
// exhaustion. Memoizing the producer on `globalThis` (keyed by Redis URL, so a
// reconfigured URL still gets its own queue) keeps it at one connection per
// process, mirroring the `GLOBAL_EVENT_TAPS_KEY` and `getCachedRateLimiterService`
// patterns. The local (file-based) strategy holds no pooled connection and its
// base dir is cwd-relative, so it stays per-bus.
const EVENTS_PRODUCER_QUEUE_KEY = '__openMercatoEventsProducerQueues__'
const EVENTS_PRODUCER_SHUTDOWN_KEY = '__openMercatoEventsProducerShutdown__'

function isSharedProducerEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_EVENTS_SHARED_PRODUCER, true)
}

function getProducerQueueRegistry(): Map<string, Queue<EventJobData>> {
  const existing = (globalThis as Record<string, unknown>)[EVENTS_PRODUCER_QUEUE_KEY]
  if (existing instanceof Map) {
    return existing as Map<string, Queue<EventJobData>>
  }
  const created = new Map<string, Queue<EventJobData>>()
  ;(globalThis as Record<string, unknown>)[EVENTS_PRODUCER_QUEUE_KEY] = created
  return created
}

function registerProducerShutdownHook(): void {
  if ((globalThis as Record<string, unknown>)[EVENTS_PRODUCER_SHUTDOWN_KEY]) return
  const shutdown = () => {
    const registry = getProducerQueueRegistry()
    for (const sharedQueue of registry.values()) {
      Promise.resolve(sharedQueue.close()).catch(() => {})
    }
    registry.clear()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  ;(globalThis as Record<string, unknown>)[EVENTS_PRODUCER_SHUTDOWN_KEY] = true
}

/**
 * Creates an event bus instance.
 *
 * The event bus provides:
 * - In-memory event delivery to registered handlers
 * - Optional persistence via the queue package when `persistent: true`
 *
 * @param opts - Configuration options
 * @returns An EventBus instance
 *
 * @example
 * ```typescript
 * const bus = createEventBus({
 *   resolve: container.resolve.bind(container),
 *   queueStrategy: 'local', // or 'async' for BullMQ
 * })
 *
 * // Register a handler
 * bus.on('user.created', async (payload, ctx) => {
 *   const userService = ctx.resolve('userService')
 *   await userService.sendWelcomeEmail(payload.userId)
 * })
 *
 * // Emit an event (immediate delivery)
 * await bus.emit('user.created', { userId: '123' })
 *
 * // Emit with persistence (for async worker processing)
 * await bus.emit('order.placed', { orderId: '456' }, { persistent: true })
 * ```
 */
export function createEventBus(opts: CreateBusOptions): EventBus {
  // In-memory listeners for immediate event delivery
  const listeners = new Map<string, Set<RegisteredSubscriber>>()
  // Subscribers registered as persistent (worker-dispatched). Used by the
  // single-delivery path to skip them inline on a persistent emit.
  const persistentSubscribers = new Set<RegisteredSubscriber>()

  // Determine queue strategy from options or environment
  const queueStrategy = opts.queueStrategy ??
    (process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local')

  // Lazy-initialized queue for persistent events
  let queue: Queue<EventJobData> | null = null

  /**
   * Gets or creates the queue instance for persistent events.
   *
   * The async (BullMQ) producer is memoized process-wide so the per-request
   * event bus reuses one Redis connection instead of leaking one per write
   * request. The local strategy stays per-bus (no pooled connection, cwd-relative
   * base dir). Set `OM_EVENTS_SHARED_PRODUCER=0` to fall back to per-bus producers.
   */
  function getQueue(): Queue<EventJobData> {
    if (queueStrategy !== 'async' || !isSharedProducerEnabled()) {
      if (!queue) {
        queue = queueStrategy === 'async'
          ? createQueue<EventJobData>(EVENTS_QUEUE_NAME, 'async', {
              connection: { url: getRedisUrlOrThrow('QUEUE') },
            })
          : createQueue<EventJobData>(EVENTS_QUEUE_NAME, 'local')
      }
      return queue
    }

    const redisUrl = getRedisUrlOrThrow('QUEUE')
    const registry = getProducerQueueRegistry()
    const cacheKey = `async:${redisUrl}`
    let shared = registry.get(cacheKey)
    if (!shared) {
      shared = createQueue<EventJobData>(EVENTS_QUEUE_NAME, 'async', {
        connection: { url: redisUrl },
      })
      registry.set(cacheKey, shared)
      registerProducerShutdownHook()
    }
    return shared
  }

  /**
   * Delivers an event to all registered in-memory handlers.
   * Supports wildcard pattern matching for event patterns.
   */
  async function deliver(
    event: string,
    payload: EventPayload,
    options?: EmitOptions,
    skipPersistent = false,
  ): Promise<void> {
    // Check all registered patterns (including wildcards)
    for (const [pattern, handlers] of listeners) {
      if (!matchEventPattern(event, pattern)) continue
      if (!handlers || handlers.size === 0) continue

      for (const subscriber of handlers) {
        // Single-delivery: persistent subscribers are dispatched by the worker,
        // so skip them inline to avoid double execution.
        if (skipPersistent && persistentSubscribers.has(subscriber)) continue
        try {
          // Pass eventName in context for wildcard handlers
          const moduleId = subscriber.moduleId ?? inferModuleIdFromResourceId(subscriber.id)
          await withModuleResourceUsage(
            {
              moduleId,
              surface: 'subscriber',
              operation: `${event} -> ${subscriber.id ?? subscriber.event}`,
              resourceId: subscriber.id ?? subscriber.event,
            },
            () => subscriber.handler(payload, {
              resolve: opts.resolve,
              eventName: event,
              tenantId: options?.tenantId ?? null,
              organizationId: options?.organizationId ?? null,
            }),
          )
        } catch (error) {
          console.error(`[events] Handler error for "${event}" (pattern: "${pattern}"):`, error)
        }
      }
    }
  }

  /**
   * Registers a handler for an event. Pass `moduleId` whenever the subscribing
   * module is known (e.g. a module reacting to another module's event) so
   * resource-usage telemetry attributes the handler correctly instead of
   * guessing a module id from the event name.
   */
  function on(
    event: string,
    handler: SubscriberHandler,
    options?: { persistent?: boolean; moduleId?: string; id?: string },
  ): void {
    if (!listeners.has(event)) {
      listeners.set(event, new Set())
    }
    const subscriber: RegisteredSubscriber = {
      id: options?.id,
      moduleId: options?.moduleId,
      event,
      handler,
      persistent: options?.persistent,
    }
    listeners.get(event)!.add(subscriber)
    if (options?.persistent) {
      persistentSubscribers.add(subscriber)
    }
  }

  /**
   * Registers multiple module subscribers at once.
   */
  function registerModuleSubscribers(subs: SubscriberDescriptor[]): void {
    for (const sub of subs) {
      on(sub.event, sub.handler, { persistent: sub.persistent, moduleId: sub.moduleId, id: sub.id })
    }
  }

  /**
   * Emits an event to all registered handlers.
   *
   * If `persistent: true`, also enqueues the event for async processing.
   */
  async function emit(
    event: string,
    payload: EventPayload,
    options?: EmitOptions
  ): Promise<void> {
    const taps = getGlobalEventTaps()
    for (const tap of taps) {
      try {
        await Promise.resolve(tap(event, payload, options))
      } catch (error) {
        console.error(`[events] Global tap error for "${event}":`, error)
      }
    }

    // Deliver to in-memory handlers first. Under single-delivery, persistent
    // subscribers are skipped inline on a persistent emit because the events
    // worker will dispatch them from the queue.
    //
    // `deliverInline: false` on a persistent emit is enqueue-only: skip inline
    // delivery entirely so a heavy persistent job runs solely in the events
    // worker, off the caller's request path (the queued enqueue below still
    // happens). Without this, a persistent emit dual-dispatches by default and
    // runs the subscriber inline in the caller's request too.
    const enqueueOnly = Boolean(options?.persistent) && options?.deliverInline === false
    if (!enqueueOnly) {
      const skipPersistentInline = Boolean(options?.persistent) && isSingleDeliveryEnabled()
      await deliver(event, payload, options, skipPersistentInline)
    }

    if (isBroadcastEvent(event) && hasTenantScope(payload)) {
      try {
        await publishCrossProcessEvent(event, payload, options)
      } catch (error) {
        console.error(`[events] Cross-process publish error for "${event}":`, error)
      }
    }

    // If persistent, also enqueue for async processing
    if (options?.persistent) {
      const q = getQueue()
      await q.enqueue({ event, payload, options })
    }
  }

  /**
   * Clears all events from the persistent queue.
   */
  async function clearQueue(): Promise<{ removed: number }> {
    const q = getQueue()
    return q.clear()
  }

  // Backward compatibility alias
  const emitEvent = emit

  return {
    emit,
    emitEvent, // Alias for backward compatibility
    on,
    registerModuleSubscribers,
    clearQueue,
  }
}
