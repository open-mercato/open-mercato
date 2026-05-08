import type { CompiledFormVersion, FieldDescriptor } from './form-version-compiler'

/**
 * Field-level diff produced by `FormVersionDiffer.diff`.
 *
 * - `added`   — field present in `newer` but absent from `older`.
 * - `removed` — field present in `older` but absent from `newer`.
 * - `modified`— field present in both, with a non-empty deep-path change list.
 *
 * The diff is computed against the compiled `fieldIndex` maps (order-independent)
 * so JSON key reordering does not produce false-positive entries.
 */
export type FieldDiff =
  | {
      kind: 'added'
      key: string
      field: FieldDescriptor
    }
  | {
      kind: 'removed'
      key: string
      field: FieldDescriptor
    }
  | {
      kind: 'modified'
      key: string
      changes: Array<{ path: string; before: unknown; after: unknown }>
    }

/**
 * Pure structural differ over two compiled form versions.
 *
 * Phase 1b uses this for the publish-screen preview pane and the version
 * history modal. Phase 2c re-uses it for the full side-by-side diff viewer.
 *
 * Sorting order:
 *   - `added` and `removed` are sorted by `(sectionKey, key)` so the diff
 *     is stable across calls.
 *   - `modified` follows the same `(sectionKey, key)` order.
 *
 * The function takes `CompiledFormVersion` directly so callers do not need
 * to recompile — the compiler's LRU cache already amortizes that work.
 */
export type FormVersionDifferContract = {
  diff(older: CompiledFormVersion, newer: CompiledFormVersion): FieldDiff[]
}

export class FormVersionDiffer implements FormVersionDifferContract {
  diff(older: CompiledFormVersion, newer: CompiledFormVersion): FieldDiff[] {
    const olderKeys = new Set(Object.keys(older.fieldIndex))
    const newerKeys = new Set(Object.keys(newer.fieldIndex))

    const removed: FieldDiff[] = []
    const added: FieldDiff[] = []
    const modified: FieldDiff[] = []

    for (const key of olderKeys) {
      if (!newerKeys.has(key)) {
        removed.push({ kind: 'removed', key, field: older.fieldIndex[key] })
      }
    }
    for (const key of newerKeys) {
      if (!olderKeys.has(key)) {
        added.push({ kind: 'added', key, field: newer.fieldIndex[key] })
      }
    }
    for (const key of olderKeys) {
      if (!newerKeys.has(key)) continue
      const before = older.fieldIndex[key]
      const after = newer.fieldIndex[key]
      const changes = listFieldChanges(before, after)
      if (changes.length > 0) {
        modified.push({ kind: 'modified', key, changes })
      }
    }

    const compare = (a: FieldDiff, b: FieldDiff) => {
      const aSection = pickSection(a) ?? ''
      const bSection = pickSection(b) ?? ''
      if (aSection !== bSection) return aSection < bSection ? -1 : 1
      if (a.key !== b.key) return a.key < b.key ? -1 : 1
      return 0
    }

    return [
      ...added.sort(compare),
      ...removed.sort(compare),
      ...modified.sort(compare),
    ]
  }
}

function pickSection(diff: FieldDiff): string | null {
  if (diff.kind === 'modified') return null
  return diff.field.sectionKey ?? null
}

const FIELD_DESCRIPTOR_KEYS: Array<keyof FieldDescriptor> = [
  'type',
  'sectionKey',
  'sensitive',
  'editableBy',
  'visibleTo',
  'required',
]

function listFieldChanges(
  before: FieldDescriptor,
  after: FieldDescriptor,
): Array<{ path: string; before: unknown; after: unknown }> {
  const out: Array<{ path: string; before: unknown; after: unknown }> = []
  for (const key of FIELD_DESCRIPTOR_KEYS) {
    const beforeValue = before[key]
    const afterValue = after[key]
    if (!deepEqual(beforeValue, afterValue)) {
      out.push({ path: key, before: beforeValue, after: afterValue })
    }
  }
  return out
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((value, index) => deepEqual(value, b[index]))
  }
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  )
}

export const defaultFormVersionDiffer = new FormVersionDiffer()
