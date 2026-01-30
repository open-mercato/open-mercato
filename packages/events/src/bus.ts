import { createQueue } from '@open-mercato/queue'
import type { Queue } from '@open-mercato/queue'
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

/**
 * Match an event name against a pattern.
 *
 * Supports:
 * - Exact match: `customers.people.created`
 * - Wildcard `*` matches single segment: `customers.*` matches `customers.people` but not `customers.people.created`
 * - Global wildcard: `*` alone matches all events
 *
 * @param eventName - The actual event name
 * @param pattern - The pattern to match against
 * @returns True if the event matches the pattern
 */
function matchEventPattern(eventName: string, pattern: string): boolean {
  // Global wildcard matches all events
  if (pattern === '*') return true

  // Exact match
  if (pattern === eventName) return true

  // No wildcards in pattern means we need exact match, which already failed
  if (!pattern.includes('*')) return false

  // Convert pattern to regex:
  // - Escape regex special chars (except *)
  // - Replace * with [^.]+ (match one or more non-dot chars)
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^.]+')
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(eventName)
}

/** Job data structure for queued events */
type EventJobData = {
  event: string
  payload: EventPayload
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
  const listeners = new Map<string, Set<SubscriberHandler>>()

  // Determine queue strategy from options or environment
  const queueStrategy = opts.queueStrategy ??
    (process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local')

  // Lazy-initialized queue for persistent events
  let queue: Queue<EventJobData> | null = null

  /**
   * Gets or creates the queue instance for persistent events.
   */
  function getQueue(): Queue<EventJobData> {
    if (!queue) {
      if (queueStrategy === 'async') {
        const redisUrl = process.env.REDIS_URL || process.env.QUEUE_REDIS_URL
        if (!redisUrl) {
          console.warn('[events] No REDIS_URL configured, falling back to localhost:6379')
        }
        queue = createQueue<EventJobData>(EVENTS_QUEUE_NAME, 'async', {
          connection: { url: redisUrl }
        })
      } else {
        queue = createQueue<EventJobData>(EVENTS_QUEUE_NAME, 'local')
      }
    }
    return queue
  }

  /**
   * Delivers an event to all registered in-memory handlers.
   * Supports wildcard pattern matching for event patterns.
   */
  async function deliver(event: string, payload: EventPayload): Promise<void> {
    // Check all registered patterns (including wildcards)
    for (const [pattern, handlers] of listeners) {
      if (!matchEventPattern(event, pattern)) continue
      if (!handlers || handlers.size === 0) continue

      for (const handler of handlers) {
        try {
          // Pass eventName in context for wildcard handlers
          await Promise.resolve(handler(payload, {
            resolve: opts.resolve,
            eventName: event,
          }))
        } catch (error) {
          console.error(`[events] Handler error for "${event}" (pattern: "${pattern}"):`, error)
        }
      }
    }
  }

  /**
   * Registers a handler for an event.
   */
  function on(event: string, handler: SubscriberHandler): void {
    if (!listeners.has(event)) {
      listeners.set(event, new Set())
    }
    listeners.get(event)!.add(handler)
  }

  /**
   * Registers multiple module subscribers at once.
   */
  function registerModuleSubscribers(subs: SubscriberDescriptor[]): void {
    for (const sub of subs) {
      on(sub.event, sub.handler)
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
    // Always deliver to in-memory handlers first
    await deliver(event, payload)

    // If persistent, also enqueue for async processing
    if (options?.persistent) {
      const q = getQueue()
      await q.enqueue({ event, payload })
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
