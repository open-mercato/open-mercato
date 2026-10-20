import type { EngineHistoryEntry, FieldTarget, ResolvedValue } from './types'

export const DEFAULT_CUSTOM_FIELD_CONTAINERS = ['custom', 'customFields', 'customValues', 'cf'] as const

export const UNKNOWN_VALUE: ResolvedValue = { known: false, value: null, source: 'none' }

const ARRAY_INDEX_PATTERN = /^\d+$/

export type PathLookup = {
  found: boolean
  value: unknown
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

export function readPath(source: unknown, path: string): PathLookup {
  if (!path) return { found: false, value: undefined }
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (Array.isArray(current) && ARRAY_INDEX_PATTERN.test(segment)) {
      const index = Number(segment)
      if (index >= current.length) return { found: false, value: undefined }
      current = current[index]
      continue
    }
    if (!isPlainRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false, value: undefined }
    }
    current = current[segment]
  }
  return { found: true, value: current === undefined ? null : current }
}

export function readFirstPath(source: unknown, paths: readonly string[]): PathLookup {
  for (const path of paths) {
    const lookup = readPath(source, path)
    if (lookup.found) return lookup
  }
  return { found: false, value: undefined }
}

export function customFieldKeyVariants(key: string): string[] {
  return [key, `cf_${key}`, `cf:${key}`]
}

export function customFieldChangeKeys(key: string, containers: readonly string[]): string[] {
  return Array.from(new Set([`cf_${key}`, `cf:${key}`, ...containers.map((container) => `${container}.${key}`)]))
}

function readCustomFieldValue(source: unknown, key: string, containers: readonly string[]): ResolvedValue {
  if (!isPlainRecord(source)) return UNKNOWN_VALUE
  let containerSeen = false
  for (const container of containers) {
    const lookup = readPath(source, container)
    if (!lookup.found || !isPlainRecord(lookup.value)) continue
    containerSeen = true
    for (const variant of customFieldKeyVariants(key)) {
      if (Object.prototype.hasOwnProperty.call(lookup.value, variant)) {
        const value = lookup.value[variant]
        return { known: true, value: value === undefined ? null : value, source: 'snapshot' }
      }
    }
  }
  for (const variant of [`cf_${key}`, `cf:${key}`]) {
    if (Object.prototype.hasOwnProperty.call(source, variant)) {
      const value = source[variant]
      return { known: true, value: value === undefined ? null : value, source: 'snapshot' }
    }
  }
  if (containerSeen) return { known: true, value: null, source: 'implicit' }
  return UNKNOWN_VALUE
}

function findCollectionItem(list: unknown[], itemIdPath: string, itemId: string): Record<string, unknown> | null {
  for (const candidate of list) {
    if (!isPlainRecord(candidate)) continue
    const lookup = readPath(candidate, itemIdPath)
    if (lookup.found && lookup.value !== null && String(lookup.value) === itemId) return candidate
  }
  return null
}

function resolveDeclaredPaths(source: unknown, target: FieldTarget): ResolvedValue {
  if (target.customFieldKey) return readCustomFieldValue(source, target.customFieldKey, target.customFieldContainers)
  const lookup = readFirstPath(source, target.snapshotPaths)
  return lookup.found ? { known: true, value: lookup.value, source: 'snapshot' } : UNKNOWN_VALUE
}

export function isChildEntry(entry: EngineHistoryEntry, parentResourceKinds: readonly string[]): boolean {
  return entry.resourceKind !== null && !parentResourceKinds.includes(entry.resourceKind)
}

function resolveSnapshotValue(
  snapshot: unknown,
  target: FieldTarget,
  entry: EngineHistoryEntry,
  parentResourceKinds: readonly string[],
): ResolvedValue {
  const collection = target.collection
  if (!collection) return resolveDeclaredPaths(snapshot, target)
  if (isChildEntry(entry, parentResourceKinds)) return resolveDeclaredPaths(snapshot, target)
  const list = readPath(snapshot, collection.snapshotPath)
  if (!list.found || !Array.isArray(list.value)) return UNKNOWN_VALUE
  const item = findCollectionItem(list.value, collection.itemIdPath, collection.itemId)
  if (!item) return { known: true, value: null, source: 'implicit' }
  return resolveDeclaredPaths(item, target)
}

function isRecordLifecycleEntry(entry: EngineHistoryEntry): boolean {
  return entry.actionType === 'create' || entry.actionType === 'delete'
}

export function resolveEntrySide(
  entry: EngineHistoryEntry,
  side: 'before' | 'after',
  target: FieldTarget,
  parentResourceKinds: readonly string[],
): ResolvedValue {
  const snapshot = side === 'before' ? entry.snapshotBefore : entry.snapshotAfter
  const opposite = side === 'before' ? entry.snapshotAfter : entry.snapshotBefore
  if (snapshot === null || snapshot === undefined) {
    if (isRecordLifecycleEntry(entry) && isPlainRecord(opposite)) {
      return { known: true, value: null, source: 'implicit' }
    }
    return UNKNOWN_VALUE
  }
  return resolveSnapshotValue(snapshot, target, entry, parentResourceKinds)
}

export type ChangeLookup = {
  mentioned: boolean
  from: ResolvedValue
  to: ResolvedValue
}

function readChangePair(value: unknown): { from: ResolvedValue; to: ResolvedValue } {
  if (isPlainRecord(value) && ('from' in value || 'to' in value || 'old' in value || 'new' in value)) {
    const hasFrom = 'from' in value || 'old' in value
    const hasTo = 'to' in value || 'new' in value
    const fromValue = 'from' in value ? value.from : value.old
    const toValue = 'to' in value ? value.to : value.new
    return {
      from: hasFrom ? { known: true, value: fromValue ?? null, source: 'changes' } : UNKNOWN_VALUE,
      to: hasTo ? { known: true, value: toValue ?? null, source: 'changes' } : UNKNOWN_VALUE,
    }
  }
  return { from: UNKNOWN_VALUE, to: { known: true, value: value ?? null, source: 'changes' } }
}

export function lookupChanges(entry: EngineHistoryEntry, changeKeys: readonly string[]): ChangeLookup {
  const changes = isPlainRecord(entry.changes) ? entry.changes : null
  if (changes) {
    for (const key of changeKeys) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        return { mentioned: true, ...readChangePair(changes[key]) }
      }
    }
  }
  const changedFields = Array.isArray(entry.changedFields) ? entry.changedFields : []
  const mentioned = changedFields.some((field) => changeKeys.includes(field))
  return { mentioned, from: UNKNOWN_VALUE, to: UNKNOWN_VALUE }
}

export function readCurrentValue(current: Record<string, unknown>, target: FieldTarget): ResolvedValue {
  if (target.collection) {
    const collection = target.collection
    const list = readPath(current, collection.currentPath ?? collection.snapshotPath)
    if (!list.found || !Array.isArray(list.value)) return UNKNOWN_VALUE
    const item = findCollectionItem(list.value, collection.itemIdPath, collection.itemId)
    if (!item) return UNKNOWN_VALUE
    return readScalarCurrent(item, target)
  }
  if (target.customFieldKey) {
    const resolved = readCustomFieldValue(current, target.customFieldKey, target.customFieldContainers)
    return resolved.known ? resolved : { known: true, value: null, source: 'implicit' }
  }
  return readScalarCurrent(current, target)
}

function readScalarCurrent(source: Record<string, unknown>, target: FieldTarget): ResolvedValue {
  const lookup = readPath(source, target.currentPath ?? target.key)
  return lookup.found ? { known: true, value: lookup.value, source: 'snapshot' } : UNKNOWN_VALUE
}

export function hasCollectionItem(current: Record<string, unknown>, target: FieldTarget): boolean {
  if (!target.collection) return true
  const collection = target.collection
  const list = readPath(current, collection.currentPath ?? collection.snapshotPath)
  if (!list.found || !Array.isArray(list.value)) return false
  return findCollectionItem(list.value, collection.itemIdPath, collection.itemId) !== null
}

export function readRecordUpdatedAt(source: unknown): string | null {
  if (!isPlainRecord(source)) return null
  for (const key of ['updatedAt', 'updated_at']) {
    const value = source[key]
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
    if (typeof value === 'string') {
      const parsed = Date.parse(value)
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
    }
  }
  return null
}

export function readCustomFieldKeys(current: Record<string, unknown>, containers: readonly string[]): string[] {
  const keys = new Set<string>()
  const addKey = (raw: string) => {
    const key = raw.startsWith('cf_') ? raw.slice(3) : raw.startsWith('cf:') ? raw.slice(3) : raw
    if (key) keys.add(key)
  }
  for (const container of containers) {
    const lookup = readPath(current, container)
    if (!lookup.found || !isPlainRecord(lookup.value)) continue
    for (const key of Object.keys(lookup.value)) addKey(key)
  }
  for (const key of Object.keys(current)) {
    if (key.startsWith('cf_') || key.startsWith('cf:')) addKey(key)
  }
  return Array.from(keys).sort((left, right) => left.localeCompare(right))
}
