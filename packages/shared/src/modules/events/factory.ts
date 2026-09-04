/**
 * Event Module Factory
 *
 * Provides factory functions for creating type-safe event configurations.
 */

import { createLogger } from '../../lib/logger'
import type {
  EventDefinition,
  EventModuleConfig,
  EventPayload,
  EmitOptions,
  CreateModuleEventsOptions,
  ModuleEventEmitter,
} from './types'

const logger = createLogger('events').child({ component: 'factory' })

// =============================================================================
// Global Event Bus Reference
// =============================================================================

/**
 * Type for the global event bus interface
 */
interface GlobalEventBus {
  emit(event: string, payload: unknown, options?: EmitOptions): Promise<void>
}

const GLOBAL_EVENT_BUS_KEY = '__openMercatoGlobalEventBus__'

// Global event bus reference (set during bootstrap)
let globalEventBus: GlobalEventBus | null = null

/**
 * Set the global event bus instance.
 * Called during app bootstrap to wire up event emission.
 */
export function setGlobalEventBus(bus: GlobalEventBus): void {
  globalEventBus = bus
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_EVENT_BUS_KEY] = bus
  } catch {
    // ignore global assignment failures
  }
}

/**
 * Get the global event bus instance.
 * Returns null if not yet bootstrapped.
 */
export function getGlobalEventBus(): GlobalEventBus | null {
  try {
    const sharedBus = (globalThis as Record<string, unknown>)[GLOBAL_EVENT_BUS_KEY]
    if (sharedBus && typeof sharedBus === 'object' && typeof (sharedBus as GlobalEventBus).emit === 'function') {
      return sharedBus as GlobalEventBus
    }
  } catch {
    // ignore global read failures
  }
  return globalEventBus
}

// =============================================================================
// Event Registry for Validation
// =============================================================================

type EventRegistryState = {
  declaredEventIds: Set<string>
  declaredEvents: EventDefinition[]
  registeredEventConfigs: EventModuleConfig[] | null
}

const GLOBAL_EVENT_REGISTRY_KEY = '__openMercatoEventDefinitionRegistry__'

const fallbackEventRegistryState: EventRegistryState = {
  declaredEventIds: new Set<string>(),
  declaredEvents: [],
  registeredEventConfigs: null,
}

function isEventRegistryState(value: unknown): value is EventRegistryState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EventRegistryState>
  return candidate.declaredEventIds instanceof Set
    && Array.isArray(candidate.declaredEvents)
    && (candidate.registeredEventConfigs === null || Array.isArray(candidate.registeredEventConfigs))
}

function getEventRegistryState(): EventRegistryState {
  try {
    const globalScope = globalThis as Record<string, unknown>
    const existing = globalScope[GLOBAL_EVENT_REGISTRY_KEY]
    if (isEventRegistryState(existing)) return existing
    globalScope[GLOBAL_EVENT_REGISTRY_KEY] = fallbackEventRegistryState
    return fallbackEventRegistryState
  } catch {
    // Restricted runtimes may deny global access. Keep the previous
    // module-local behavior as a safe fallback.
    return fallbackEventRegistryState
  }
}

function addDeclaredEvent(event: EventDefinition): void {
  const state = getEventRegistryState()
  state.declaredEventIds.add(event.id)
  const existingIndex = state.declaredEvents.findIndex((candidate) => candidate.id === event.id)
  if (existingIndex < 0) {
    state.declaredEvents.push(event)
    return
  }
  // Refresh a module's own definition in place during HMR without allowing a
  // duplicate declaration from another module to take over the event id.
  if (state.declaredEvents[existingIndex]?.module === event.module) {
    state.declaredEvents[existingIndex] = event
  }
}

/**
 * Check if an event ID has been declared by any module.
 * Used for runtime validation to ensure only declared events are emitted.
 */
export function isEventDeclared(eventId: string): boolean {
  return getEventRegistryState().declaredEventIds.has(eventId)
}

/**
 * Get all declared event IDs.
 * Useful for debugging and introspection.
 */
export function getAllDeclaredEventIds(): string[] {
  return Array.from(getEventRegistryState().declaredEventIds)
}

/**
 * Get all declared events with their full definitions.
 * Used by the API to return available events for workflow triggers.
 */
export function getDeclaredEvents(): EventDefinition[] {
  return [...getEventRegistryState().declaredEvents]
}

/**
 * Check if an event has clientBroadcast enabled.
 * Used by the SSE endpoint to filter events for the DOM Event Bridge.
 */
export function isBroadcastEvent(eventId: string): boolean {
  const event = getEventRegistryState().declaredEvents.find(e => e.id === eventId)
  return event?.clientBroadcast === true
}

/**
 * Check if an event should be published over the server-to-server event bridge.
 * Browser-broadcast events remain eligible for backward compatibility, while
 * crossProcessBroadcast supports private process coordination without SSE.
 */
export function isCrossProcessBroadcastEvent(eventId: string): boolean {
  const event = getEventRegistryState().declaredEvents.find(e => e.id === eventId)
  return event?.clientBroadcast === true || event?.crossProcessBroadcast === true
}

/**
 * Check whether an event is reserved for private server-to-server
 * coordination. Workflow-authored EMIT_EVENT activities must not emit these
 * events because their payload and event id are tenant-managed input.
 */
export function isPrivateCrossProcessBroadcastEvent(eventId: string): boolean {
  const event = getEventRegistryState().declaredEvents.find(e => e.id === eventId)
  return event?.crossProcessBroadcast === true && event?.clientBroadcast !== true
}

/**
 * Verify provenance for a private cross-process event. The module id is
 * stamped by a declared module emitter or another trusted server-side seam;
 * tenant-managed event payloads never participate in this decision.
 */
export function isPrivateCrossProcessEventEmitter(
  eventId: string,
  emitterModuleId: string | undefined,
): boolean {
  const event = getEventRegistryState().declaredEvents.find(e => e.id === eventId)
  if (event?.crossProcessBroadcast !== true) return true
  return typeof event.module === 'string'
    && event.module.length > 0
    && event.module === emitterModuleId
}

/**
 * Check whether an event opted into coalesced browser delivery.
 * Read by the event bus before it hands a browser dispatch to the coalescer.
 */
export function isCoalescedBroadcastEvent(eventId: string): boolean {
  const event = getEventRegistryState().declaredEvents.find(e => e.id === eventId)
  if (event?.broadcastCoalescing !== true) return false
  // Private cross-process coordination must never be delayed, and an event with
  // no browser sink has nothing to coalesce. Both are rejected at declaration
  // time, so this is defence in depth for events registered by other paths.
  if (event.crossProcessBroadcast === true) return false
  return event.clientBroadcast === true || event.portalBroadcast === true
}

/**
 * Check if an event has portalBroadcast enabled.
 * Used by the portal SSE endpoint to filter events for the Portal Event Bridge.
 */
export function isPortalBroadcastEvent(eventId: string): boolean {
  const event = getEventRegistryState().declaredEvents.find(e => e.id === eventId)
  return event?.portalBroadcast === true
}

// =============================================================================
// Bootstrap Registration (similar to searchModuleConfigs pattern)
// =============================================================================

/**
 * Register event module configurations globally.
 * Called during app bootstrap with configs from events.generated.ts.
 */
export function registerEventModuleConfigs(configs: EventModuleConfig[]): void {
  const state = getEventRegistryState()
  if (state.registeredEventConfigs !== null && process.env.NODE_ENV === 'development') {
    logger.debug('Event module configs re-registered (this may occur during HMR)')
  }
  state.registeredEventConfigs = configs
  for (const config of configs) {
    for (const event of config.events) {
      addDeclaredEvent(event)
    }
  }
}

/**
 * Get registered event module configurations.
 * Returns empty array if not registered.
 */
export function getEventModuleConfigs(): EventModuleConfig[] {
  return getEventRegistryState().registeredEventConfigs ?? []
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

  for (const event of fullEvents) {
    if (event.broadcastCoalescing !== true) continue
    if (event.crossProcessBroadcast === true) {
      throw new Error(
        `[internal] Event "${event.id}" declared by module "${moduleId}" combines crossProcessBroadcast with ` +
        'broadcastCoalescing. Private cross-process coordination must be delivered immediately — delaying it ' +
        'would let another process serve stale data. Drop one of the two flags.',
      )
    }
    if (event.clientBroadcast !== true && event.portalBroadcast !== true) {
      throw new Error(
        `[internal] Event "${event.id}" declared by module "${moduleId}" sets broadcastCoalescing without ` +
        'clientBroadcast or portalBroadcast. There is no browser delivery to coalesce.',
      )
    }
  }

  // Register all event IDs and definitions in the global registry.
  for (const event of fullEvents) {
    addDeclaredEvent(event)
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
        logger.error('Module tried to emit undeclared event — add it to the module events.ts first', { moduleId, eventId })
        // In non-strict mode, still emit but with warning
      }
    }

    // Get event bus from global reference
    const eventBus = getGlobalEventBus()
    if (!eventBus) {
      logger.warn('Event bus not available, cannot emit event', { eventId })
      return
    }

    const eventDefinition = fullEvents.find((event) => event.id === eventId)
    const isClientBroadcast = eventDefinition?.clientBroadcast === true
    const trustedOptions = eventDefinition?.crossProcessBroadcast === true || isClientBroadcast
      ? {
          ...emitOptions,
          // Browser-broadcast module emitters historically accepted scope in
          // their typed payload. Preserve that contract at the trusted module
          // boundary while the event bus itself relies only on options.
          ...(isClientBroadcast && emitOptions?.tenantId === undefined
            ? { tenantId: payload.tenantId ?? null }
            : {}),
          ...(isClientBroadcast && emitOptions?.organizationId === undefined
            ? { organizationId: payload.organizationId ?? null }
            : {}),
          ...(isClientBroadcast && emitOptions?.organizationIds === undefined && Array.isArray(payload.organizationIds)
            ? { organizationIds: payload.organizationIds.filter((value): value is string => typeof value === 'string') }
            : {}),
          emitterModuleId: moduleId,
        }
      : emitOptions
    await eventBus.emit(eventId, payload, trustedOptions)
  }

  return {
    moduleId,
    events: fullEvents,
    emit: emit as unknown as ModuleEventEmitter<TEventIds>,
  }
}
