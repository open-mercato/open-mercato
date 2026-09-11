/**
 * Event Module Type Definitions
 *
 * Provides type-safe abstractions for the controlled event declaration system.
 * Each module declares which events it can emit via events.ts files.
 */

// =============================================================================
// Event Definition Types
// =============================================================================

/**
 * Category for grouping events in the UI
 */
export type EventCategory = 'crud' | 'lifecycle' | 'system' | 'custom'

/**
 * Event definition structure
 */
export interface EventDefinition {
  /** Event name pattern (e.g., 'customers.people.created') */
  id: string
  /** Human-readable label for UI */
  label: string
  /** Optional description */
  description?: string
  /** Category for grouping */
  category?: EventCategory
  /** Module that declared this event */
  module?: string
  /** Entity associated with event (optional) */
  entity?: string
  /** Whether excluded from workflow triggers */
  excludeFromTriggers?: boolean
  /** When true, this event is bridged to the browser via SSE (DOM Event Bridge). Default: false */
  clientBroadcast?: boolean
  /** When true, this event is bridged between server processes without enabling browser delivery. Default: false */
  crossProcessBroadcast?: boolean
  /** When true, this event is bridged to the customer portal via SSE (Portal Event Bridge). Default: false */
  portalBroadcast?: boolean
  /**
   * When true, browser deliveries of this event coalesce: within
   * OM_BROADCAST_COALESCE_INTERVAL_MS only the newest payload per
   * (event, tenant, organization) reaches the SSE bridges, and a trailing flush
   * guarantees the last one is delivered. Subscribers, webhooks and the queue are
   * unaffected — the domain event still fires once per record.
   *
   * Declare it only on events whose browser consumers react to the fact that
   * something changed (a list refresh), never to each occurrence. Cannot be
   * combined with crossProcessBroadcast: delaying private coordination would let
   * another process serve stale data. Default: false
   */
  broadcastCoalescing?: boolean
}

// =============================================================================
// Event Payload Types
// =============================================================================

/**
 * Base payload for events - includes common scoping fields
 */
export interface EventPayload {
  /** Record ID if applicable */
  id?: string
  /** Tenant ID for scoping */
  tenantId?: string | null
  /** Organization ID for scoping */
  organizationId?: string | null
  /** Additional event-specific data */
  [key: string]: unknown
}

/**
 * Options for emitting events
 */
export interface EmitOptions {
  /** If true, the event will be persisted to a queue for async processing */
  persistent?: boolean
  /** Trusted tenant scope forwarded to subscribers separately from the payload */
  tenantId?: string | null
  /** Trusted organization scope forwarded to subscribers separately from the payload */
  organizationId?: string | null
  /**
   * Trusted multi-organization audience forwarded to subscribers separately
   * from the payload. Mirrors the documented SSE audience contract, where a
   * clientBroadcast event may target several organizations at once; carried in
   * trusted options so the receiver never falls back to payload scope.
   */
  organizationIds?: string[] | null
  /**
   * Module that emitted a private cross-process coordination event.
   *
   * This is stamped by `createModuleEvents`; application inputs must not set or
   * derive it from event payloads.
   * @internal
   */
  emitterModuleId?: string
}

// =============================================================================
// Module Configuration Types
// =============================================================================

/**
 * Type-safe event emitter function
 */
export type ModuleEventEmitter<TEventIds extends string> = (
  eventId: TEventIds,
  payload: EventPayload,
  options?: EmitOptions
) => Promise<void>

/**
 * Base module events configuration for registry use.
 * Uses a general string emitter to avoid contravariance issues when collecting configs.
 */
export interface EventModuleConfigBase {
  /** Module identifier */
  moduleId: string
  /** Declared events */
  events: EventDefinition[]
  /** Event emitter - accepts any string for registry compatibility */
  emit: (eventId: string, payload: EventPayload, options?: EmitOptions) => Promise<void>
}

/**
 * Module events configuration returned by events.ts
 */
export interface EventModuleConfig<TEventIds extends string = string> {
  /** Module identifier */
  moduleId: string
  /** Declared events */
  events: EventDefinition[]
  /** Type-safe event emitter - only accepts declared event IDs */
  emit: ModuleEventEmitter<TEventIds>
}

// =============================================================================
// Factory Input Types
// =============================================================================

/**
 * Options for creating module events configuration
 */
export interface CreateModuleEventsOptions<TEventIds extends string> {
  /** Module identifier (e.g., 'customers', 'sales') */
  moduleId: string
  /** Array of event definitions (supports readonly arrays from `as const`) */
  events: ReadonlyArray<Omit<EventDefinition, 'module'> & { id: TEventIds }>
  /** If true, throw on undeclared events. If false (default), log warning */
  strict?: boolean
}
