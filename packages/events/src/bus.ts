import { createQueue } from '@open-mercato/queue'
import type { Queue } from '@open-mercato/queue'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { isSingleDeliveryRequested } from './single-delivery'
import { matchEventPattern } from '@open-mercato/shared/lib/events/patterns'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import {
  isBroadcastEvent,
  isCrossProcessBroadcastEvent,
  isPrivateCrossProcessEventEmitter,
} from '@open-mercato/shared/modules/events'
import {
  inferModuleIdFromResourceId,
  withModuleResourceUsage,
} from '@open-mercato/shared/lib/modules/resource-usage'
export { registerCrossProcessEventListener, CROSS_PROCESS_EVENT_INSTANCE_ID } from './bridge'
import { publishCrossProcessEvent } from './bridge'
import type {
  EventBus,
  CreateBusOptions,
  SubscriberHandler,
  SubscriberDescriptor,
  EventPayload,
  EmitOptions,
  QueuedDispatchResult,
} from './types'

/** Queue name for persistent events */
const EVENTS_QUEUE_NAME = 'events'

const logger = createLogger('events')

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
 * ephemeral subscribers keep running inline. Defaults ON.
 *
 * The bus never second-guesses this against "is a worker running": the queue is
 * durable, so a persistent emit with no worker yet is delayed, not lost, and a
 * worker started later drains the backlog. Delivering inline instead would move
 * the work back onto the caller's request path — exactly what a split app/worker
 * deployment sets `AUTO_SPAWN_WORKERS=false` to avoid.
 *
 * The events worker asks this same bus for its subscribers via `dispatchQueued`,
 * so both halves of single-delivery read one decision.
 */
function isSingleDeliveryEnabled(): boolean {
  return isSingleDeliveryRequested()
}

type GlobalEventTap = (event: string, payload: EventPayload, options?: EmitOptions) => void | Promise<void>
const GLOBAL_EVENT_TAPS_KEY = '__openMercatoEventBusGlobalTaps__'

function hasTrustedTenantScope(options?: EmitOptions): boolean {
  return typeof options?.tenantId === 'string' && options.tenantId.trim().length > 0
}

function normalizePayloadScope(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveCrossProcessEmitOptions(
  event: string,
  payload: EventPayload,
  options?: EmitOptions,
): EmitOptions | undefined {
  if (hasTrustedTenantScope(options)) return options
  // Preserve the public raw EventBus contract for legacy clientBroadcast
  // emitters. These callers are trusted server code and historically supplied
  // their scope in the typed payload. Tenant-managed workflow execution passes
  // scope in options, while private cross-process events never take this path.
  if (!isBroadcastEvent(event)) return options
  const tenantId = normalizePayloadScope((payload as Record<string, unknown>)?.tenantId)
  if (!tenantId) return options
  const organizationId = normalizePayloadScope((payload as Record<string, unknown>)?.organizationId)
  return {
    ...options,
    tenantId,
    ...(organizationId ? { organizationId } : {}),
  }
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
  /**
   * Set by the producer when it already ran the persistent subscribers inline
   * (single-delivery reconciled off). The worker skips such jobs, so the app and
   * the worker staying exactly-once no longer depends on both processes agreeing
   * about `OM_EVENTS_SINGLE_DELIVERY`. Absent on jobs queued before this field
   * existed, which keeps their behavior unchanged.
   */
  persistentDeliveredInline?: boolean
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
   *
   * Handler errors are logged and delivery continues - one bad subscriber must
   * not stop the others. The count of failed PERSISTENT handlers is returned so
   * the caller can decide whether the inline run may be recorded as complete:
   * a persistent subscriber that threw inline has no retry of its own, so the
   * queued job must stay unstamped and let the worker run it again.
   */
  async function deliver(
    event: string,
    payload: EventPayload,
    options?: EmitOptions,
    skipPersistent = false,
  ): Promise<{ persistentFailures: number }> {
    let persistentFailures = 0
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
          if (persistentSubscribers.has(subscriber)) {
            persistentFailures += 1
          }
          logger.error('Handler error', { event, pattern, err: error })
          if (options?.rethrowHandlerErrors) {
            throw error
          }
        }
      }
    }
    return { persistentFailures }
  }

  /**
   * Selects the subscribers the events worker owns for a queued event: every
   * pattern matching `event`, keeping persistent subscribers only, so wildcard
   * (`event: '*'`) persistent subscribers are reached exactly once here.
   *
   * Deliberately does NOT read `OM_EVENTS_SINGLE_DELIVERY`. Whether inline
   * delivery already happened is carried by the job's `persistentDeliveredInline`
   * stamp, so the producer owns that decision entirely and the worker cannot
   * disagree with it across processes. Reading the flag here would reintroduce
   * exactly that skew: a worker whose env has the flag off would fall back to
   * exact-match, re-running ephemeral subscribers the producer already ran inline
   * and never reaching wildcard persistent subscribers - the failure this whole
   * change exists to remove.
   *
   * Every job that reaches this point wants persistent-pattern selection: a job
   * is only dispatched when its stamp is false, which means either the producer
   * had single-delivery on, or the emit was enqueue-only (`deliverInline: false`,
   * documented as "every subscriber to the event is persistent").
   */
  function selectQueuedSubscribers(event: string): RegisteredSubscriber[] {
    const matched: RegisteredSubscriber[] = []
    for (const [pattern, handlers] of listeners) {
      if (!matchEventPattern(event, pattern)) {
        continue
      }
      for (const subscriber of handlers) {
        if (subscriber.persistent) {
          matched.push(subscriber)
        }
      }
    }
    return matched
  }

  /**
   * Dispatches a queued event on behalf of the events worker.
   *
   * Handler failures are returned instead of logged-and-swallowed the way
   * `deliver()` does them: the worker needs them to propagate so the queue retries
   * the job and eventually dead-letters it.
   *
   * Subscribers run against the caller's `resolve` when one is given, falling back
   * to the bus's own. The events worker passes its per-job `ctx.resolve`, which is
   * the container `createPerJobWorkerHandler` built for that job - the handle the
   * queue contract already hands it. Defaulting to `opts.resolve` instead would
   * bind subscribers to whichever container built the bus; that is the same object
   * on the default configuration, but not under `OM_BOOTSTRAP_CACHE`, where the
   * cached bus is replayed into later containers while its captured resolver stays
   * bound to the first.
   */
  async function dispatchQueued(
    event: string,
    payload: EventPayload,
    options?: EmitOptions,
    resolve?: <T = unknown>(name: string) => T,
  ): Promise<QueuedDispatchResult[]> {
    const subscribers = selectQueuedSubscribers(event)
    if (subscribers.length === 0) {
      return []
    }

    const resolver = resolve ?? opts.resolve

    const settled = await Promise.allSettled(
      subscribers.map((subscriber) =>
        withModuleResourceUsage(
          {
            moduleId: subscriber.moduleId ?? inferModuleIdFromResourceId(subscriber.id),
            surface: 'subscriber',
            operation: `${event} -> ${subscriber.id ?? subscriber.event}`,
            resourceId: subscriber.id ?? subscriber.event,
          },
          () => subscriber.handler(payload, {
            resolve: resolver,
            eventName: event,
            tenantId: options?.tenantId ?? null,
            organizationId: options?.organizationId ?? null,
          }),
        ),
      ),
    )

    return settled.map((result, index) => {
      const subscriberId = subscribers[index].id ?? subscribers[index].event
      return result.status === 'rejected'
        ? { subscriberId, ok: false, error: result.reason }
        : { subscriberId, ok: true }
    })
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
        logger.error('Global tap error', { event, err: error })
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
    // Read the mode once so the inline skip and the stamp below cannot disagree.
    const singleDelivery = isSingleDeliveryEnabled()
    let inlinePersistentFailed = false
    if (!enqueueOnly) {
      const skipPersistentInline = Boolean(options?.persistent) && singleDelivery
      const delivered = await deliver(event, payload, options, skipPersistentInline)
      inlinePersistentFailed = delivered.persistentFailures > 0
    }

    // Private coordination always requires trusted envelope scope and module
    // provenance. Legacy declared browser events may promote their typed scope
    // for raw EventBus compatibility; tenant-managed workflow adapters pass
    // authoritative scope in options, which always wins over payload values.
    const crossProcessOptions = resolveCrossProcessEmitOptions(event, payload, options)
    if (
      isCrossProcessBroadcastEvent(event)
      && hasTrustedTenantScope(crossProcessOptions)
      && isPrivateCrossProcessEventEmitter(event, crossProcessOptions?.emitterModuleId)
    ) {
      try {
        await publishCrossProcessEvent(event, payload, crossProcessOptions)
      } catch (error) {
        logger.error('Cross-process publish error', { event, err: error })
      }
    }

    // If persistent, also enqueue for async processing
    if (options?.persistent) {
      const q = getQueue()
      await q.enqueue({
        event,
        payload,
        options,
        // Only record the inline run as complete when every persistent
        // subscriber actually succeeded. Inline delivery logs-and-continues, so a
        // handler that threw has no retry of its own; leaving the job unstamped
        // hands it to the worker, where a failure gets queue retry and
        // dead-lettering. Without this, flipping the flag off (which the
        // `mercato server` guard can do automatically) silently downgrades
        // persistent delivery to at-most-once.
        persistentDeliveredInline: !enqueueOnly && !singleDelivery && !inlinePersistentFailed,
      })
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
    dispatchQueued,
    clearQueue,
  }
}
