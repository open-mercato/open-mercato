"use client"

import type { ComponentType } from 'react'
import {
  RESERVED_AI_UI_PART_IDS,
  isReservedAiUiPartId,
  type ReservedAiUiPartId,
} from './ui-part-slots'
import { PendingPhase3Placeholder } from './ui-parts/pending-phase3-placeholder'
import { AI_MUTATION_APPROVAL_CARDS } from './parts/approval-cards-map'

export { RESERVED_AI_UI_PART_IDS, isReservedAiUiPartId }
export type { ReservedAiUiPartId }

export type AiUiPartComponentId = ReservedAiUiPartId | (string & {})

export type AiUiPartProps = {
  /** Stable component id emitted by the server-side UI-part producer. */
  componentId: AiUiPartComponentId
  /** Arbitrary payload the server attached to this UI part. */
  payload?: unknown
  /** Optional pending-action id for mutation-approval cards (Phase 3). */
  pendingActionId?: string
}

export type AiUiPartComponent<P = AiUiPartProps> = ComponentType<P>

export interface AiUiPartRegistryEntry {
  componentId: string
  reserved: boolean
}

/**
 * A UI-part registry instance. Consumers typically use
 * {@link defaultAiUiPartRegistry} for global registrations; tests and embedded
 * pages that need isolation can construct a dedicated registry via
 * {@link createAiUiPartRegistry} and pass it to `<AiChat registry={...} />`.
 */
export interface AiUiPartRegistry {
  register<P = AiUiPartProps>(
    componentId: AiUiPartComponentId,
    component: AiUiPartComponent<P>,
  ): void
  unregister(componentId: AiUiPartComponentId): void
  resolve<P = AiUiPartProps>(
    componentId: AiUiPartComponentId,
  ): AiUiPartComponent<P> | null
  has(componentId: AiUiPartComponentId): boolean
  list(): AiUiPartRegistryEntry[]
  clear(): void
}

type RegistryStore = Map<string, AiUiPartComponent<AiUiPartProps>>

export interface CreateAiUiPartRegistryOptions {
  /**
   * When true (default) the registry is pre-seeded with the shared
   * `PendingPhase3Placeholder` for every id in {@link RESERVED_AI_UI_PART_IDS}.
   * Pass `false` to get an empty registry — useful for tests that want to
   * assert the registry is genuinely empty.
   */
  seedReservedPlaceholders?: boolean
  /**
   * When true, the registry is pre-seeded with the live Phase 3 mutation
   * approval cards from `@open-mercato/ui/ai/parts` instead of the humane
   * pending placeholder. The app-wide {@link defaultAiUiPartRegistry}
   * opts in, so end users see the real cards without any bootstrap wiring;
   * scoped registries created via {@link createAiUiPartRegistry} keep the
   * placeholder by default so unit tests and embedded playground mounts
   * stay deterministic and isolated.
   */
  seedLiveApprovalCards?: boolean
}

function seedReservedSlots(
  store: RegistryStore,
  options: { seedLive: boolean } = { seedLive: false },
): void {
  for (const reservedId of RESERVED_AI_UI_PART_IDS) {
    if (store.has(reservedId)) continue
    if (options.seedLive && AI_MUTATION_APPROVAL_CARDS[reservedId]) {
      store.set(
        reservedId,
        AI_MUTATION_APPROVAL_CARDS[reservedId] as AiUiPartComponent<AiUiPartProps>,
      )
      continue
    }
    store.set(
      reservedId,
      PendingPhase3Placeholder as AiUiPartComponent<AiUiPartProps>,
    )
  }
}

/**
 * Create a fresh UI-part registry. By default the four Phase 3 reserved
 * slot ids are pre-seeded with {@link PendingPhase3Placeholder} so consumers
 * that forget to register the real cards see a humane "Phase 3 pending"
 * state instead of the neutral debug chip.
 */
export function createAiUiPartRegistry(
  options?: CreateAiUiPartRegistryOptions,
): AiUiPartRegistry {
  const seedReserved = options?.seedReservedPlaceholders !== false
  const seedLive = options?.seedLiveApprovalCards === true
  const store: RegistryStore = new Map()
  if (seedReserved) {
    seedReservedSlots(store, { seedLive })
  }

  const registry: AiUiPartRegistry = {
    register(componentId, component) {
      if (!componentId) {
        throw new Error('registerAiUiPart requires a non-empty componentId')
      }
      store.set(componentId, component as AiUiPartComponent<AiUiPartProps>)
    },
    unregister(componentId) {
      store.delete(componentId)
    },
    resolve<P = AiUiPartProps>(componentId: AiUiPartComponentId) {
      const found = store.get(componentId)
      if (!found) return null
      return found as unknown as AiUiPartComponent<P>
    },
    has(componentId) {
      return store.has(componentId)
    },
    list() {
      const entries: AiUiPartRegistryEntry[] = []
      for (const componentId of store.keys()) {
        entries.push({
          componentId,
          reserved: isReservedAiUiPartId(componentId),
        })
      }
      return entries
    },
    clear() {
      store.clear()
      if (seedReserved) {
        seedReservedSlots(store, { seedLive })
      }
    },
  }
  return registry
}

const REGISTRY_GLOBAL_KEY = '__openMercatoAiUiPartRegistry'

function getDefaultRegistry(): AiUiPartRegistry {
  const scope = globalThis as typeof globalThis & {
    [REGISTRY_GLOBAL_KEY]?: AiUiPartRegistry
  }
  if (!scope[REGISTRY_GLOBAL_KEY]) {
    // Default registry seeds the LIVE mutation-approval cards (Step 5.10).
    // Scoped registries created via `createAiUiPartRegistry()` still default
    // to the humane placeholder so playground embeds + unit tests stay
    // deterministic and isolated.
    scope[REGISTRY_GLOBAL_KEY] = createAiUiPartRegistry({ seedLiveApprovalCards: true })
  }
  return scope[REGISTRY_GLOBAL_KEY]
}

/**
 * The app-wide default UI-part registry. Seeded with Phase 3 placeholders on
 * first access. Tests that need a clean registry should instantiate their own
 * via {@link createAiUiPartRegistry} and pass it to `<AiChat registry={...}>`.
 */
export const defaultAiUiPartRegistry: AiUiPartRegistry = new Proxy(
  {} as AiUiPartRegistry,
  {
    get(_target, prop: keyof AiUiPartRegistry) {
      const impl = getDefaultRegistry()
      const value = impl[prop]
      return typeof value === 'function' ? value.bind(impl) : value
    },
  },
)

/**
 * Register a UI-part component on the module-global default registry. Legacy
 * Step 4.1 API — preserved verbatim so existing callers keep working. Prefer
 * {@link defaultAiUiPartRegistry} directly (or a scoped registry) in new code.
 *
 * Idempotent: re-registering overwrites the previous entry so hot reload and
 * Phase 3 card replacement (which overwrites the seeded placeholder) stay
 * deterministic.
 */
export function registerAiUiPart<P = AiUiPartProps>(
  componentId: AiUiPartComponentId,
  component: AiUiPartComponent<P>,
): void {
  defaultAiUiPartRegistry.register(componentId, component)
}

/**
 * Resolve a registered UI-part component on the module-global default
 * registry. Returns `null` when no component has been registered — callers
 * MUST handle the null case gracefully (the canonical consumer, `<AiChat>`,
 * renders a neutral placeholder chip + logs a `console.warn`).
 */
export function resolveAiUiPart<P = AiUiPartProps>(
  componentId: AiUiPartComponentId,
): AiUiPartComponent<P> | null {
  return defaultAiUiPartRegistry.resolve<P>(componentId)
}

/**
 * Remove a UI-part component registration from the module-global default
 * registry. Primarily useful for tests to keep a clean slate between runs.
 */
export function unregisterAiUiPart(componentId: AiUiPartComponentId): void {
  defaultAiUiPartRegistry.unregister(componentId)
}

/**
 * Clear every registration on the module-global default registry and re-seed
 * the Phase 3 reserved placeholders. Test-only helper; production code must
 * never invoke this.
 */
export function resetAiUiPartRegistryForTests(): void {
  defaultAiUiPartRegistry.clear()
}

/**
 * Snapshot every registration on the module-global default registry. Used by
 * debugging UIs (Step 4.6) to enumerate what's registered without mutating
 * state.
 */
export function listAiUiParts(): AiUiPartRegistryEntry[] {
  return defaultAiUiPartRegistry.list()
}
