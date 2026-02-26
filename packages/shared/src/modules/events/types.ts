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
