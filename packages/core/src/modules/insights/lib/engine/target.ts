import type {
  ExplainCollectionDescriptor,
  ExplainFieldDescriptor,
  ExplainResourceDescriptor,
} from '@open-mercato/shared/modules/insights/explain'
import { DEFAULT_CUSTOM_FIELD_CONTAINERS, customFieldChangeKeys } from './paths'
import type { EngineDependencyTarget, FieldTarget } from './types'

export const CUSTOM_FIELD_PREFIX = 'cf:'
export const CUSTOM_FIELD_LABEL_KEY = 'insights.explain.fields.customField'
const CUSTOM_FIELD_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/

export type FeatureGate = (requiredFeatures: readonly string[] | undefined) => boolean

export type TargetResolutionError = 'unknown_field' | 'item_required' | 'item_not_supported'

export type TargetResolution =
  | { ok: true; target: FieldTarget }
  | { ok: false; error: TargetResolutionError }

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0)))
}

function findReadableCollection(
  resource: ExplainResourceDescriptor,
  key: string,
  gate: FeatureGate,
): ExplainCollectionDescriptor | null {
  const collection = (resource.collections ?? []).find((candidate) => candidate.key === key)
  return collection && gate(collection.requiredFeatures) ? collection : null
}

function collectionItemResourceKinds(collection: ExplainCollectionDescriptor): string[] {
  return unique(collection.itemResourceKinds ?? [])
}

/**
 * Keeps only the dependency keys the viewer may read (a readable field or collection of
 * the same resource), so restricted field names never leak through `dependsOn` or hints.
 */
export function readableDependencyKeys(
  resource: ExplainResourceDescriptor,
  keys: readonly string[],
  gate: FeatureGate,
): string[] {
  return unique(keys).filter((key) => (
    findAuthorizedField(resource, key, gate) !== null || findReadableCollection(resource, key, gate) !== null
  ))
}

function buildScalarTarget(
  resource: ExplainResourceDescriptor,
  field: ExplainFieldDescriptor,
  gate: FeatureGate,
): FieldTarget {
  const snapshotPaths = unique(field.snapshotPaths)
  return {
    key: field.key,
    labelKey: field.labelKey,
    valueKind: field.valueKind,
    snapshotPaths,
    changeKeys: field.changeKeys ? unique(field.changeKeys) : unique([...snapshotPaths, field.key]),
    currentPath: field.currentPath ?? null,
    customFieldKey: null,
    customFieldContainers: [],
    collection: null,
    derived: field.derived ? { dependsOn: readableDependencyKeys(resource, field.derived.dependsOn, gate) } : null,
    provider: field.provider ?? null,
    referenceKind: field.referenceKind ?? null,
    unloggedWriters: field.unloggedWriters ?? [],
  }
}

function buildCollectionTarget(
  resource: ExplainResourceDescriptor,
  collection: ExplainCollectionDescriptor,
  field: ExplainFieldDescriptor,
  itemId: string,
  gate: FeatureGate,
): FieldTarget {
  const scalar = buildScalarTarget(resource, field, gate)
  return {
    ...scalar,
    key: `${collection.key}.${field.key}`,
    currentPath: field.currentPath ?? field.key,
    derived: null,
    collection: {
      key: collection.key,
      snapshotPath: collection.snapshotPath,
      itemIdPath: collection.itemIdPath,
      currentPath: collection.currentPath ?? null,
      itemId,
      itemResourceKinds: collectionItemResourceKinds(collection),
    },
  }
}

export function customFieldContainers(resource: ExplainResourceDescriptor): string[] {
  const declared = resource.customFields?.snapshotContainers ?? []
  return unique([...declared, ...DEFAULT_CUSTOM_FIELD_CONTAINERS])
}

function buildCustomFieldTarget(resource: ExplainResourceDescriptor, key: string): FieldTarget {
  const containers = customFieldContainers(resource)
  return {
    key: `${CUSTOM_FIELD_PREFIX}${key}`,
    labelKey: CUSTOM_FIELD_LABEL_KEY,
    valueKind: 'custom_field',
    snapshotPaths: [],
    changeKeys: customFieldChangeKeys(key, containers),
    currentPath: null,
    customFieldKey: key,
    customFieldContainers: containers,
    collection: null,
    derived: null,
    provider: null,
    referenceKind: null,
    unloggedWriters: [],
  }
}

export function isCustomFieldKeyAllowed(
  resource: ExplainResourceDescriptor,
  key: string,
  gate: FeatureGate,
): boolean {
  const customFields = resource.customFields
  if (!customFields) return false
  if (!CUSTOM_FIELD_KEY_PATTERN.test(key)) return false
  if (!gate(customFields.requiredFeatures)) return false
  if (Array.isArray(customFields.allowKeys) && !customFields.allowKeys.includes(key)) return false
  return true
}

export function findAuthorizedField(
  resource: ExplainResourceDescriptor,
  key: string,
  gate: FeatureGate,
): ExplainFieldDescriptor | null {
  const field = resource.fields.find((candidate) => candidate.key === key)
  if (!field || !gate(field.requiredFeatures)) return null
  return field
}

function findAuthorizedCollectionField(
  resource: ExplainResourceDescriptor,
  key: string,
  gate: FeatureGate,
): { collection: ExplainCollectionDescriptor; field: ExplainFieldDescriptor } | null {
  const separator = key.indexOf('.')
  if (separator <= 0) return null
  const collectionKey = key.slice(0, separator)
  const fieldKey = key.slice(separator + 1)
  const collection = (resource.collections ?? []).find((candidate) => candidate.key === collectionKey)
  if (!collection || !gate(collection.requiredFeatures)) return null
  const field = collection.fields.find((candidate) => candidate.key === fieldKey)
  if (!field || !gate(field.requiredFeatures)) return null
  return { collection, field }
}

export function resolveFieldTarget(
  resource: ExplainResourceDescriptor,
  fieldKey: string,
  itemId: string | null,
  gate: FeatureGate,
): TargetResolution {
  if (fieldKey.startsWith(CUSTOM_FIELD_PREFIX)) {
    const key = fieldKey.slice(CUSTOM_FIELD_PREFIX.length)
    if (!isCustomFieldKeyAllowed(resource, key, gate)) return { ok: false, error: 'unknown_field' }
    if (itemId) return { ok: false, error: 'item_not_supported' }
    return { ok: true, target: buildCustomFieldTarget(resource, key) }
  }
  const scalar = findAuthorizedField(resource, fieldKey, gate)
  if (scalar) {
    if (itemId) return { ok: false, error: 'item_not_supported' }
    return { ok: true, target: buildScalarTarget(resource, scalar, gate) }
  }
  const collectionField = findAuthorizedCollectionField(resource, fieldKey, gate)
  if (!collectionField) return { ok: false, error: 'unknown_field' }
  if (!itemId) return { ok: false, error: 'item_required' }
  return {
    ok: true,
    target: buildCollectionTarget(resource, collectionField.collection, collectionField.field, itemId, gate),
  }
}

export function buildDependencyResolver(
  resource: ExplainResourceDescriptor,
  gate: FeatureGate,
): (key: string) => EngineDependencyTarget | null {
  return (key: string) => {
    const field = findAuthorizedField(resource, key, gate)
    if (field) return { kind: 'field', target: buildScalarTarget(resource, field, gate) }
    const collection = findReadableCollection(resource, key, gate)
    if (!collection) return null
    return {
      kind: 'collection',
      key: collection.key,
      labelKey: collection.labelKey,
      snapshotPath: collection.snapshotPath,
      itemResourceKinds: collectionItemResourceKinds(collection),
    }
  }
}

export function listOverviewTargets(
  resource: ExplainResourceDescriptor,
  current: Record<string, unknown>,
  gate: FeatureGate,
  readCustomFieldKeys: (current: Record<string, unknown>, containers: string[]) => string[],
): FieldTarget[] {
  const targets: FieldTarget[] = []
  for (const field of resource.fields) {
    if (!gate(field.requiredFeatures)) continue
    targets.push(buildScalarTarget(resource, field, gate))
  }
  const customFields = resource.customFields
  if (customFields && gate(customFields.requiredFeatures)) {
    const keys = Array.isArray(customFields.allowKeys)
      ? customFields.allowKeys
      : readCustomFieldKeys(current, customFieldContainers(resource))
    for (const key of unique(keys)) {
      if (!isCustomFieldKeyAllowed(resource, key, gate)) continue
      targets.push(buildCustomFieldTarget(resource, key))
    }
  }
  return targets
}

/**
 * Child rows (`parent_resource_kind` = this resource) are scanned only for collections
 * that declare `itemResourceKinds`; other children (payments, notes, …) never enter the
 * scan budget.
 */
export function needsChildHistory(resource: ExplainResourceDescriptor, target: FieldTarget): boolean {
  if (target.collection) return target.collection.itemResourceKinds.length > 0
  if (!target.derived) return false
  const collectionsWithItemRows = new Set((resource.collections ?? [])
    .filter((collection) => collectionItemResourceKinds(collection).length > 0)
    .map((collection) => collection.key))
  return target.derived.dependsOn.some((key) => collectionsWithItemRows.has(key))
}
