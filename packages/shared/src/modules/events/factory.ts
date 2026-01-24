/**
 * Event Module Factory
 *
 * Provides factory functions for creating type-safe event configurations.
 */

import type {
  EventDefinition,
  EventModuleConfig,
  EventPayload,
  EmitOptions,
  CreateModuleEventsOptions,
  ModuleEventEmitter,
} from './types'

// =============================================================================
// Global Event Bus Reference
// =============================================================================

/**
 * Type for the global event bus interface
 */
interface GlobalEventBus {
  emit(event: string, payload: unknown, options?: EmitOptions): Promise<void>
}

// Global event bus reference (set during bootstrap)
let globalEventBus: GlobalEventBus | null = null

/**
 * Set the global event bus instance.
 * Called during app bootstrap to wire up event emission.
 */
export function setGlobalEventBus(bus: GlobalEventBus): void {
  globalEventBus = bus
}

/**
 * Get the global event bus instance.
 * Returns null if not yet bootstrapped.
 */
export function getGlobalEventBus(): GlobalEventBus | null {
  return globalEventBus
}

// =============================================================================
// Event Registry for Validation
// =============================================================================

// Global set of all declared event IDs for runtime validation
const allDeclaredEventIds = new Set<string>()

// Global registry of all declared events with their full definitions
const allDeclaredEvents: EventDefinition[] = []

/**
 * Check if an event ID has been declared by any module.
 * Used for runtime validation to ensure only declared events are emitted.
 */
export function isEventDeclared(eventId: string): boolean {
  return allDeclaredEventIds.has(eventId)
}

/**
 * Get all declared event IDs.
 * Useful for debugging and introspection.
 */
export function getAllDeclaredEventIds(): string[] {
  return Array.from(allDeclaredEventIds)
}

/**
 * Get all declared events with their full definitions.
 * Used by the API to return available events for workflow triggers.
 */
export function getDeclaredEvents(): EventDefinition[] {
  return [...allDeclaredEvents]
}

// =============================================================================
// Bootstrap Registration (similar to searchModuleConfigs pattern)
// =============================================================================

let _registeredEventConfigs: EventModuleConfig[] | null = null

/**
 * Register event module configurations globally.
 * Called during app bootstrap with configs from events.generated.ts.
 */
export function registerEventModuleConfigs(configs: EventModuleConfig[]): void {
  if (_registeredEventConfigs !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Event module configs re-registered (this may occur during HMR)')
  }
  _registeredEventConfigs = configs
}

/**
 * Get registered event module configurations.
 * Returns empty array if not registered.
 */
export function getEventModuleConfigs(): EventModuleConfig[] {
  return _registeredEventConfigs ?? []
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a type-safe event configuration for a module.
 *
 * Usage in module events.ts:
 * ```typescript
 * import { createModuleEvents } from '@open-mercato/shared/modules/events'
 *
 * const events = [
 *   { id: 'customers.people.created', label: 'Person Created', category: 'crud' },
 *   { id: 'customers.people.updated', label: 'Person Updated', category: 'crud' },
 * ] as const
 *
 * export const eventsConfig = createModuleEvents({
 *   moduleId: 'customers',
 *   events,
 * })
 *
 * // Export the typed emit function for use in commands
 * export const emitCustomersEvent = eventsConfig.emit
 *
 * // Export event IDs as a type for external use
 * export type CustomersEventId = typeof events[number]['id']
 *
 * export default eventsConfig
 * ```
 *
 * TypeScript will enforce that only declared event IDs can be emitted:
 * ```typescript
 * // ✅ This compiles - event is declared
 * emitCustomersEvent('customers.people.created', { id: '123', tenantId: 'abc' })
 *
 * // ❌ TypeScript error - event not declared
 * emitCustomersEvent('customers.people.exploded', { id: '123' })
 * ```
 */
export function createModuleEvents<
  const TEvents extends readonly { id: string }[],
  TEventIds extends TEvents[number]['id'] = TEvents[number]['id']
>(options: CreateModuleEventsOptions<TEventIds>): EventModuleConfig<TEventIds> {
  const { moduleId, events, strict = false } = options

  // Build set of valid event IDs for runtime validation
  const validEventIds = new Set(events.map(e => e.id))

  // Build full event definitions with module added
  const fullEvents: EventDefinition[] = events.map(e => ({
    ...e,
    module: moduleId,
  }))

  // Register all event IDs and definitions in the global registry
  for (const eventId of validEventIds) {
    allDeclaredEventIds.add(eventId)
  }
  for (const event of fullEvents) {
    // Avoid duplicates if createModuleEvents is called multiple times (e.g., HMR)
    if (!allDeclaredEvents.find(e => e.id === event.id)) {
      allDeclaredEvents.push(event)
    }
  }

  /**
   * The emit function - validates events and delegates to the global event bus
   */
  const emit = async (
    eventId: TEventIds,
    payload: EventPayload,
    emitOptions?: EmitOptions
  ): Promise<void> => {
    // Runtime validation - event must be declared
    if (!validEventIds.has(eventId)) {
      const message =
        `[events] Module "${moduleId}" tried to emit undeclared event "${eventId}". ` +
        `Add it to the module's events.ts file first.`

      if (strict) {
        throw new Error(message)
      } else {
        console.error(message)
        // In non-strict mode, still emit but with warning
      }
    }

    // Get event bus from global reference
    const eventBus = getGlobalEventBus()
    if (!eventBus) {
      console.warn(`[events] Event bus not available, cannot emit "${eventId}"`)
      return
    }

    await eventBus.emit(eventId, payload, emitOptions)
  }

  return {
    moduleId,
    events: fullEvents,
    emit: emit as unknown as ModuleEventEmitter<TEventIds>,
  }
}
