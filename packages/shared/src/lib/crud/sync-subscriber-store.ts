/**
 * Sync Subscriber Store
 *
 * Global registry for synchronous event subscribers using the same
 * globalThis pattern as interceptor-registry.ts for HMR-safe storage.
 */

import type { SyncCrudEventPayload, SyncCrudEventResult } from './sync-event-types'

export interface SyncSubscriberMetadata {
  event: string
  sync: true
  priority?: number
  id?: string
}

export interface SyncSubscriberEntry {
  metadata: SyncSubscriberMetadata
  handler: (
    payload: SyncCrudEventPayload,
    ctx: { resolve: <T = unknown>(name: string) => T },
  ) => Promise<SyncCrudEventResult | void>
}

const GLOBAL_KEY = '__openMercatoSyncSubscribers__'

let _syncEntries: SyncSubscriberEntry[] | null = null

function readGlobal(): SyncSubscriberEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_KEY]
    return Array.isArray(value) ? (value as SyncSubscriberEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobal(entries: SyncSubscriberEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

/**
 * Register synchronous event subscribers.
 * Called during bootstrap, separating sync subscribers from async ones.
 */
export function registerSyncSubscribers(entries: SyncSubscriberEntry[]) {
  _syncEntries = entries
  writeGlobal(entries)
}

/**
 * Get all registered sync subscribers.
 */
export function getAllSyncSubscribers(): SyncSubscriberEntry[] {
  const globalEntries = readGlobal()
  if (globalEntries) return globalEntries
  if (!_syncEntries) return []
  return _syncEntries
}
