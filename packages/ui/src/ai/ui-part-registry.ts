"use client"

import type { ComponentType } from 'react'

/**
 * Reserved UI-part component ids for Phase 3 approval cards.
 *
 * These ids match the server-emitted UI parts the mutation-approval runtime
 * will produce in Phase 3 Steps 5.6 and 5.10. They are listed here so the
 * registry contract can be validated at compile time and the default registry
 * ships with the same slot names the runtime will later emit.
 */
export const RESERVED_AI_UI_PART_IDS = [
  'mutation-preview-card',
  'field-diff-card',
  'confirmation-card',
  'mutation-result-card',
] as const

export type ReservedAiUiPartId = (typeof RESERVED_AI_UI_PART_IDS)[number]

export type AiUiPartComponentId = ReservedAiUiPartId | (string & {})

export type AiUiPartProps = {
  /** Stable component id emitted by the server-side UI-part producer. */
  componentId: AiUiPartComponentId
  /** Arbitrary payload the server attached to this UI part. */
  payload?: unknown
  /** Optional pending-action id for mutation-approval cards (Phase 3). */
  pendingActionId?: string
}

export type AiUiPartComponent = ComponentType<AiUiPartProps>

type RegistryStore = Map<AiUiPartComponentId, AiUiPartComponent>

const REGISTRY_GLOBAL_KEY = '__openMercatoAiUiPartRegistry'

function getRegistry(): RegistryStore {
  const store = globalThis as typeof globalThis & {
    [REGISTRY_GLOBAL_KEY]?: RegistryStore
  }
  if (!store[REGISTRY_GLOBAL_KEY]) {
    store[REGISTRY_GLOBAL_KEY] = new Map()
  }
  return store[REGISTRY_GLOBAL_KEY]
}

/**
 * Register a UI-part component for a given component id. Callable at app boot
 * time. Idempotent: re-registering overwrites the previous entry so hot reload
 * stays deterministic.
 */
export function registerAiUiPart(
  componentId: AiUiPartComponentId,
  component: AiUiPartComponent,
): void {
  if (!componentId) {
    throw new Error('registerAiUiPart requires a non-empty componentId')
  }
  getRegistry().set(componentId, component)
}

/**
 * Resolve a registered UI-part component for a given id. Returns `null` when no
 * component has been registered for the id yet — callers MUST handle the null
 * case gracefully (the canonical consumer, {@link import('./AiChat').AiChat},
 * renders a neutral placeholder chip + logs a `console.warn`).
 */
export function resolveAiUiPart(
  componentId: AiUiPartComponentId,
): AiUiPartComponent | null {
  return getRegistry().get(componentId) ?? null
}

/**
 * Remove a UI-part component registration. Primarily useful for tests to keep
 * a clean slate between runs.
 */
export function unregisterAiUiPart(componentId: AiUiPartComponentId): void {
  getRegistry().delete(componentId)
}

/**
 * Clear the entire UI-part registry. Test-only helper; production code must
 * never invoke this.
 */
export function resetAiUiPartRegistryForTests(): void {
  getRegistry().clear()
}
