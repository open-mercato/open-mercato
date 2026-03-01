/**
 * Command Interceptor Store
 *
 * Global registry for command interceptors using the same globalThis pattern
 * as interceptor-registry.ts for HMR-safe storage.
 */

import type { CommandInterceptor } from './command-interceptor'

export interface CommandInterceptorRegistryEntry {
  moduleId: string
  interceptor: CommandInterceptor
}

const GLOBAL_KEY = '__openMercatoCommandInterceptors__'

let _entries: CommandInterceptorRegistryEntry[] | null = null

function readGlobal(): CommandInterceptorRegistryEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_KEY]
    return Array.isArray(value) ? (value as CommandInterceptorRegistryEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobal(entries: CommandInterceptorRegistryEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

/**
 * Register command interceptors from all modules.
 * Called during bootstrap after generated interceptors are imported.
 */
export function registerCommandInterceptors(
  entries: Array<{ moduleId: string; interceptors: CommandInterceptor[] }>,
) {
  const flat: CommandInterceptorRegistryEntry[] = []
  for (const entry of entries) {
    for (const interceptor of entry.interceptors) {
      flat.push({ moduleId: entry.moduleId, interceptor })
    }
  }
  _entries = flat
  writeGlobal(flat)
}

/**
 * Get all registered command interceptors.
 */
export function getAllCommandInterceptors(): CommandInterceptorRegistryEntry[] {
  const globalEntries = readGlobal()
  if (globalEntries) return globalEntries
  if (!_entries) return []
  return _entries
}

/**
 * Get all command interceptor instances (unwrapped from registry entries).
 */
export function getAllCommandInterceptorInstances(): CommandInterceptor[] {
  return getAllCommandInterceptors().map((entry) => entry.interceptor)
}
