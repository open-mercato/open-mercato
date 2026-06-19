import { readJsonFromLocalStorage, writeJsonToLocalStorage, removeLocalStorageKey } from './safeLocalStorage'

type VersionedEnvelope<T> = { v: number; data: T }

export function readVersionedPreference<T>(
  key: string,
  version: number,
  isValid: (value: unknown) => value is T,
  fallback: T,
  options?: { legacyIsValid?: (value: unknown) => value is T },
): T {
  const raw = readJsonFromLocalStorage<unknown>(key, null)
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'v' in raw && 'data' in raw) {
    const envelope = raw as { v?: unknown; data?: unknown }
    return envelope.v === version && isValid(envelope.data) ? envelope.data : fallback
  }
  if (options?.legacyIsValid && options.legacyIsValid(raw)) return raw
  return fallback
}

export function writeVersionedPreference<T>(key: string, version: number, data: T): void {
  writeJsonToLocalStorage(key, { v: version, data } satisfies VersionedEnvelope<T>)
}

export function clearVersionedPreference(key: string): void {
  removeLocalStorageKey(key)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Convenience pair for the common "set of ids" preference shape, with legacy bare-array migration. */
export function readVersionedIdSet(key: string, version: number): Set<string> {
  return new Set(readVersionedPreference<string[]>(key, version, isStringArray, [], { legacyIsValid: isStringArray }))
}

export function writeVersionedIdSet(key: string, version: number, ids: Set<string>): void {
  writeVersionedPreference(key, version, Array.from(ids))
}
