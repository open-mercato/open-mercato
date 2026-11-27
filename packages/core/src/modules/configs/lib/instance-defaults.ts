import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import {
  SEARCH_AUTO_INDEX_CONFIG_KEY,
  SEARCH_AUTO_INDEX_CONFIG_MODULE,
} from '@open-mercato/shared/lib/search/auto-indexing'
import { moduleConfigKeySchema } from '../data/validators'

export type ResolvedInstanceConfigDefault = {
  ownerModuleId: string
  moduleId: string
  name: string
  value: unknown
}

const RESERVED_LEGACY_NAMESPACE_OWNER = 'search'
const RESERVED_LEGACY_NAMESPACE = SEARCH_AUTO_INDEX_CONFIG_MODULE
const RESERVED_LEGACY_KEY = SEARCH_AUTO_INDEX_CONFIG_KEY

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Validates that a default value is a finite JSON value (no NaN, +/-Infinity,
 * BigInt, functions, symbols, circular references, non-plain class instances,
 * top-level undefined, or array undefined elements) and returns a detached clone.
 * Error messages intentionally omit the raw value.
 */
export function validateAndCloneFiniteJsonValue(
  value: unknown,
  ownerLabel: string,
  keyLabel: string,
  ancestors: Set<object> = new Set(),
): unknown {
  if (value === undefined) {
    throw new Error(
      `[configs] Invalid instance config default "${keyLabel}" from "${ownerLabel}": value must be a finite JSON value (undefined is not allowed).`,
    )
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `[configs] Invalid instance config default "${keyLabel}" from "${ownerLabel}": numeric value must be finite.`,
      )
    }
    return value
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(
      `[configs] Invalid instance config default "${keyLabel}" from "${ownerLabel}": unsupported JSON value type "${typeof value}".`,
    )
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new Error(
        `[configs] Invalid instance config default "${keyLabel}" from "${ownerLabel}": circular reference detected.`,
      )
    }
    ancestors.add(value)
    try {
      const cloned: unknown[] = new Array(value.length)
      for (let i = 0; i < value.length; i += 1) {
        if (!(i in value)) {
          throw new Error(
            `[configs] Invalid instance config default "${keyLabel}" from "${ownerLabel}": sparse arrays are not valid JSON.`,
          )
        }
        cloned[i] = validateAndCloneFiniteJsonValue(value[i], ownerLabel, keyLabel, ancestors)
      }
      return cloned
    } finally {
      ancestors.delete(value)
    }
  }
  if (!isPlainObject(value)) {
    throw new Error(
      `[configs] Invalid instance config default "${keyLabel}" from "${ownerLabel}": value must be a plain JSON object.`,
    )
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(
      `[configs] Invalid instance config default "${keyLabel}" from "${ownerLabel}": symbol keys are not allowed in JSON defaults.`,
    )
  }
  if (ancestors.has(value)) {
    throw new Error(
      `[configs] Invalid instance config default "${keyLabel}" from "${ownerLabel}": circular reference detected.`,
    )
  }
  ancestors.add(value)
  try {
    const entries: Array<[string, unknown]> = []
    for (const [propKey, propValue] of Object.entries(value)) {
      if (propValue === undefined) {
        continue
      }
      entries.push([propKey, validateAndCloneFiniteJsonValue(propValue, ownerLabel, keyLabel, ancestors)])
    }
    return Object.fromEntries(entries)
  } finally {
    ancestors.delete(value)
  }
}

export function compareConfigKeys(
  left: { moduleId: string; name: string },
  right: { moduleId: string; name: string },
): number {
  if (left.moduleId !== right.moduleId) {
    return left.moduleId < right.moduleId ? -1 : 1
  }
  if (left.name !== right.name) {
    return left.name < right.name ? -1 : 1
  }
  return 0
}

function isAllowedLegacyStorageNamespace(
  ownerModuleId: string,
  storageNamespace: string,
  name: string,
): boolean {
  return (
    ownerModuleId === RESERVED_LEGACY_NAMESPACE_OWNER &&
    storageNamespace === RESERVED_LEGACY_NAMESPACE &&
    name === RESERVED_LEGACY_KEY
  )
}

/**
 * Collects, validates, and deterministically orders instance configuration defaults
 * contributed by enabled modules' `setup.instanceConfigDefaults` providers.
 *
 * Fails before any persistence occurs if the module registry is uninitialized,
 * a provider is non-synchronous or returns malformed descriptors, an unauthorized
 * cross-namespace write is attempted, or normalized final keys collide.
 */
export function collectInstanceConfigDefaults(
  modules?: readonly Module[],
): ResolvedInstanceConfigDefault[] {
  const enabledModules = modules ?? tryGetModules()
  if (!enabledModules) {
    throw new Error(
      '[configs] Cannot resolve instance config defaults: enabled module registry is not initialized.',
    )
  }

  const resolved: ResolvedInstanceConfigDefault[] = []
  const seenKeys = new Map<string, string>()

  for (const mod of enabledModules) {
    const ownerModuleId = typeof mod?.id === 'string' ? mod.id.trim() : ''
    const provider = mod?.setup?.instanceConfigDefaults
    if (provider === undefined) continue

    if (!ownerModuleId) {
      throw new Error(
        '[configs] Invalid instanceConfigDefaults contribution: owning module has an empty id.',
      )
    }
    if (typeof provider !== 'function') {
      throw new Error(
        `[configs] Invalid instanceConfigDefaults provider on module "${ownerModuleId}": expected a synchronous function.`,
      )
    }

    const rawEntries = provider()
    if (
      rawEntries !== null &&
      typeof rawEntries === 'object' &&
      typeof (rawEntries as { then?: unknown }).then === 'function'
    ) {
      // Prevent unhandled rejection noise when an accidentally async provider rejects.
      ;(rawEntries as unknown as PromiseLike<unknown>).then(undefined, () => {})
      throw new Error(
        `[configs] Invalid instanceConfigDefaults provider on module "${ownerModuleId}": provider must be synchronous and cannot return a Promise.`,
      )
    }
    if (!Array.isArray(rawEntries)) {
      throw new Error(
        `[configs] Invalid instanceConfigDefaults provider on module "${ownerModuleId}": expected an array of default entries.`,
      )
    }

    for (let index = 0; index < rawEntries.length; index += 1) {
      const entry = rawEntries[index]
      if (!isPlainObject(entry)) {
        throw new Error(
          `[configs] Invalid instance config default entry #${index} from module "${ownerModuleId}": expected a plain object.`,
        )
      }
      if (typeof entry.name !== 'string') {
        throw new Error(
          `[configs] Invalid instance config default entry #${index} from module "${ownerModuleId}": "name" must be a string.`,
        )
      }
      if (
        entry.legacyStorageNamespace !== undefined &&
        typeof entry.legacyStorageNamespace !== 'string'
      ) {
        throw new Error(
          `[configs] Invalid instance config default "${entry.name}" from module "${ownerModuleId}": "legacyStorageNamespace" must be a string when provided.`,
        )
      }

      const rawNamespace = entry.legacyStorageNamespace ?? ownerModuleId
      const parsedKey = moduleConfigKeySchema.safeParse({
        moduleId: rawNamespace,
        name: entry.name,
      })
      if (!parsedKey.success) {
        throw new Error(
          `[configs] Invalid instance config default key from module "${ownerModuleId}" (entry #${index}): ${parsedKey.error.issues[0]?.message ?? 'invalid key'}.`,
        )
      }

      const { moduleId, name } = parsedKey.data

      if (entry.legacyStorageNamespace !== undefined) {
        if (!isAllowedLegacyStorageNamespace(ownerModuleId, moduleId, name)) {
          throw new Error(
            `[configs] Unauthorized cross-namespace instance config default "${moduleId}.${name}" declared by module "${ownerModuleId}".`,
          )
        }
      }

      const keyLabel = `${moduleId}.${name}`
      const sanitizedValue = validateAndCloneFiniteJsonValue(
        entry.value,
        ownerModuleId,
        keyLabel,
      )

      const dedupeKey = JSON.stringify([moduleId, name])
      const previousOwner = seenKeys.get(dedupeKey)
      if (previousOwner !== undefined) {
        throw new Error(
          `[configs] Duplicate instance config default key "${keyLabel}" declared by module "${ownerModuleId}" (already declared by "${previousOwner}").`,
        )
      }
      seenKeys.set(dedupeKey, ownerModuleId)

      resolved.push({
        ownerModuleId,
        moduleId,
        name,
        value: sanitizedValue,
      })
    }
  }

  resolved.sort(compareConfigKeys)
  return resolved
}
