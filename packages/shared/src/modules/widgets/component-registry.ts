/**
 * Component Registry
 *
 * Allows modules to register components as replaceable, and other modules
 * to replace, wrap, or transform props of registered components.
 *
 * Three override modes:
 * - Replace: Complete swap (MUST maintain props contract, propsSchema required)
 * - Wrapper: Decorating wrapper around original (lowest risk)
 * - PropsTransform: Modify props before they reach original
 *
 * Wrapper composition order: lowest priority (innermost) to highest (outermost).
 * Higher-priority wrappers see combined output of lower-priority wrappers.
 */

import type { ComponentType, LazyExoticComponent } from 'react'
import type { z } from 'zod'

export type ComponentRegistryEntry<TProps = unknown> = {
  id: string
  component: ComponentType<TProps>
  metadata: {
    module: string
    description: string
    propsSchema?: z.ZodType<TProps>
  }
}

export type ReplaceOverride = {
  target: { componentId: string }
  priority: number
  features?: string[]
  replacement: LazyExoticComponent<ComponentType<Record<string, unknown>>>
  propsSchema: z.ZodType
}

export type WrapperOverride = {
  target: { componentId: string }
  priority: number
  features?: string[]
  wrapper: (Original: ComponentType<Record<string, unknown>>) => ComponentType<Record<string, unknown>>
}

export type PropsTransformOverride = {
  target: { componentId: string }
  priority: number
  features?: string[]
  propsTransform: (props: Record<string, unknown>) => Record<string, unknown>
}

export type ComponentOverride = ReplaceOverride | WrapperOverride | PropsTransformOverride

export type ComponentOverrideRegistryEntry = {
  moduleId: string
  override: ComponentOverride
}

export function isReplaceOverride(override: ComponentOverride): override is ReplaceOverride {
  return 'replacement' in override
}

export function isWrapperOverride(override: ComponentOverride): override is WrapperOverride {
  return 'wrapper' in override
}

export function isPropsTransformOverride(override: ComponentOverride): override is PropsTransformOverride {
  return 'propsTransform' in override
}

// Use the same globalThis HMR pattern as enricher-registry and injection-loader
const GLOBAL_COMPONENTS_KEY = '__openMercatoComponentRegistry__'
const GLOBAL_OVERRIDES_KEY = '__openMercatoComponentOverrides__'

let _componentEntries: ComponentRegistryEntry[] | null = null
let _overrideEntries: ComponentOverrideRegistryEntry[] | null = null

function readGlobalComponents(): ComponentRegistryEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_COMPONENTS_KEY]
    return Array.isArray(value) ? (value as ComponentRegistryEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobalComponents(entries: ComponentRegistryEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_COMPONENTS_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

function readGlobalOverrides(): ComponentOverrideRegistryEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_OVERRIDES_KEY]
    return Array.isArray(value) ? (value as ComponentOverrideRegistryEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobalOverrides(entries: ComponentOverrideRegistryEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_OVERRIDES_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

/**
 * Register a replaceable component.
 * Called by modules to declare their components as overridable.
 */
export function registerComponent(entry: ComponentRegistryEntry) {
  const entries = getAllRegisteredComponents()
  const existing = entries.findIndex((e) => e.id === entry.id)
  if (existing >= 0) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[ComponentRegistry] Component "${entry.id}" re-registered (this may occur during HMR)`)
    }
    entries[existing] = entry
  } else {
    entries.push(entry)
  }
  _componentEntries = entries
  writeGlobalComponents(entries)
}

/**
 * Register component overrides from all modules.
 * Called during bootstrap after generated override declarations are imported.
 */
export function registerComponentOverrides(
  entries: Array<{ moduleId: string; overrides: ComponentOverride[] }>,
) {
  const flat: ComponentOverrideRegistryEntry[] = []
  for (const entry of entries) {
    for (const override of entry.overrides) {
      flat.push({ moduleId: entry.moduleId, override })
    }
  }
  flat.sort((a, b) => a.override.priority - b.override.priority)

  // Warn about priority collisions on the same target component
  if (process.env.NODE_ENV === 'development') {
    const priorityMap = new Map<string, string[]>()
    for (const entry of flat) {
      const key = `${entry.override.target.componentId}:${entry.override.priority}`
      const existing = priorityMap.get(key)
      if (existing) {
        existing.push(entry.moduleId)
        if (existing.length === 2) {
          console.warn(
            `[UMES] Component overrides with same priority (${entry.override.priority}) ` +
            `targeting "${entry.override.target.componentId}": modules ${existing.join(', ')}. ` +
            `Execution order is non-deterministic.`,
          )
        }
      } else {
        priorityMap.set(key, [entry.moduleId])
      }
    }
  }

  _overrideEntries = flat
  writeGlobalOverrides(flat)
}

/**
 * Get a registered component by id.
 */
export function getRegisteredComponent(componentId: string): ComponentRegistryEntry | null {
  const entries = getAllRegisteredComponents()
  return entries.find((e) => e.id === componentId) ?? null
}

/**
 * Get all overrides targeting a specific component, sorted by priority (ascending).
 * Lower priority = applied first (innermost wrapper, first propsTransform).
 */
export function getOverridesForComponent(componentId: string): ComponentOverrideRegistryEntry[] {
  const allOverrides = getAllOverrides()
  return allOverrides.filter((entry) => entry.override.target.componentId === componentId)
}

/**
 * Get all registered components.
 */
export function getAllRegisteredComponents(): ComponentRegistryEntry[] {
  const globalEntries = readGlobalComponents()
  if (globalEntries) return globalEntries
  if (!_componentEntries) {
    return []
  }
  return _componentEntries
}

/**
 * Get all registered overrides.
 */
export function getAllOverrides(): ComponentOverrideRegistryEntry[] {
  const globalEntries = readGlobalOverrides()
  if (globalEntries) return globalEntries
  if (!_overrideEntries) {
    return []
  }
  return _overrideEntries
}
