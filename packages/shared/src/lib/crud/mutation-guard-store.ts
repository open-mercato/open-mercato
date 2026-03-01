/**
 * Mutation Guard Store
 *
 * Global registry for mutation guards using the same globalThis pattern
 * as interceptor-registry.ts for HMR-safe storage.
 */

import type { MutationGuard } from './mutation-guard-registry'

export interface MutationGuardRegistryEntry {
  moduleId: string
  guard: MutationGuard
}

const GLOBAL_KEY = '__openMercatoMutationGuards__'

let _guardEntries: MutationGuardRegistryEntry[] | null = null

function readGlobal(): MutationGuardRegistryEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_KEY]
    return Array.isArray(value) ? (value as MutationGuardRegistryEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobal(entries: MutationGuardRegistryEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

/**
 * Register mutation guards from all modules.
 * Called during bootstrap after generated guards are imported.
 */
export function registerMutationGuards(
  entries: Array<{ moduleId: string; guards: MutationGuard[] }>,
) {
  const flat: MutationGuardRegistryEntry[] = []
  for (const entry of entries) {
    for (const guard of entry.guards) {
      flat.push({ moduleId: entry.moduleId, guard })
    }
  }
  _guardEntries = flat
  writeGlobal(flat)
}

/**
 * Get all registered mutation guards.
 */
export function getAllMutationGuards(): MutationGuardRegistryEntry[] {
  const globalEntries = readGlobal()
  if (globalEntries) return globalEntries
  if (!_guardEntries) return []
  return _guardEntries
}

/**
 * Get all guard instances (unwrapped from registry entries).
 */
export function getAllMutationGuardInstances(): MutationGuard[] {
  return getAllMutationGuards().map((entry) => entry.guard)
}
