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
 * Type vocabulary for declared event payload fields. Mirrors the flat
 * path/type contract consumed by editor surfaces (path pickers, typed value
 * controls, the workflows context ledger), so declarations flow into those
 * consumers without translation.
 */
export type EventPayloadFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'date'
  | 'object'
  | 'unknown'

/**
 * One declared payload field: a flat dot-path into the emitted payload plus
 * its type. `optional` marks fields whose key may be absent or whose value may
 * be null on some emits.
 */
export interface EventPayloadSchemaField {
  path: string
  type: EventPayloadFieldType
  label?: string
  optional?: boolean
}

/**
 * Optional payload typing for an event declaration. A flat field list (not a
 * nested JSON Schema): nested payload shapes are declared as dot-paths
 * (`customer.id`) or a single `object`-typed entry. Declare only fields the
 * emitter verifiably sends.
 */
export interface EventPayloadSchema {
  fields: ReadonlyArray<EventPayloadSchemaField>
}

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
  /** When true, this event is bridged to the customer portal via SSE (Portal Event Bridge). Default: false */
  portalBroadcast?: boolean
  /**
   * Optional declared payload typing. Platform-emitted CRUD events
   * (`*.created`/`*.updated`/`*.deleted` with category `crud`) receive a
   * generated default at registration time; other events carry it only when
   * the declaring module opts in.
   */
  payloadSchema?: EventPayloadSchema
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
