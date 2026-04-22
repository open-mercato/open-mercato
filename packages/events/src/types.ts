/**
 * Events Package Type Definitions
 *
 * Provides type-safe abstractions for the event bus system.
 */

// ============================================================================
// Core Types
// ============================================================================

/** Payload type for events - can be any value */
export type EventPayload = unknown

/** Metadata for subscriber definitions */
export type SubscriberMeta = {
  /** Event name to subscribe to */
  event: string
  /** Optional unique identifier for the subscriber */
  id?: string
}

/** Context passed to event handlers */
export type SubscriberContext = {
  /** DI container resolve function */
  resolve: <T = unknown>(name: string) => T
  /** Event name (useful for wildcard handlers to know which event was triggered) */
  eventName?: string
}

/** Event handler function signature */
export type SubscriberHandler = (
  payload: EventPayload,
  ctx: SubscriberContext
) => Promise<void> | void

/** Full descriptor for a module subscriber */
export type SubscriberDescriptor = {
  /** Unique identifier for this subscriber */
  id: string
  /** Event name to subscribe to */
  event: string
  /** Handler function */
  handler: SubscriberHandler
}

// ============================================================================
// Event Bus Types
// ============================================================================

/** Options for emitting events */
export type EmitOptions = {
  /** If true, the event will be persisted to a queue for async processing */
  persistent?: boolean
}

/** Options for creating an event bus */
export type CreateBusOptions = {
  /** DI container resolve function */
  resolve: <T = unknown>(name: string) => T
  /** Queue strategy for persistent events: 'local' (file-based) or 'async' (BullMQ) */
  queueStrategy?: 'local' | 'async'
}

/**
 * Main EventBus interface.
 *
 * The event bus handles:
 * - In-memory event delivery to registered handlers
 * - Optional persistence of events to a queue for async processing
 */
export interface EventBus {
  /**
   * Emit an event to all registered handlers.
   *
   * @param event - Event name
   * @param payload - Event payload data
   * @param options - Emit options
   *
   * @example
   * ```typescript
   * // Immediate delivery only
   * await bus.emit('user.created', { userId: '123' })
   *
   * // Immediate delivery + queue for async processing
   * await bus.emit('order.placed', { orderId: '456' }, { persistent: true })
   * ```
   */
  emit(event: string, payload: EventPayload, options?: EmitOptions): Promise<void>

  /**
   * Register a handler for an event.
   *
   * @param event - Event name to listen for
   * @param handler - Handler function
   */
  on(event: string, handler: SubscriberHandler): void

  /**
   * Register multiple module subscribers at once.
   *
   * @param subs - Array of subscriber descriptors
   */
  registerModuleSubscribers(subs: SubscriberDescriptor[]): void

  /**
   * Clear all events from the persistent queue.
   *
   * @returns Count of removed events
   */
  clearQueue(): Promise<{ removed: number }>

  /**
   * Alias for emit() for backward compatibility.
   * @deprecated Use emit() instead
   */
  emitEvent(event: string, payload: EventPayload, options?: EmitOptions): Promise<void>
}

// ============================================================================
// Legacy Types (for backwards compatibility)
// ============================================================================

/** @deprecated Use QueuedJob from @open-mercato/queue instead */
export type QueuedEvent = {
  id: number
  event: string
  payload: EventPayload
  persistent?: boolean
  createdAt: string
}

/** @deprecated Use EventBus interface instead */
export type EventStrategy = {
  emit: (evt: Omit<QueuedEvent, 'id' | 'createdAt'> & { createdAt?: string }) => Promise<void>
  on: (event: string, handler: SubscriberHandler) => void
  registerModuleSubscribers: (subs: SubscriberDescriptor[]) => void
  processOffline: (opts?: { limit?: number }) => Promise<{ processed: number; lastId?: number }>
  clearQueue: () => Promise<{ removed: number }>
  clearProcessed: () => Promise<{ removed: number; lastId?: number }>
}
