/**
 * Read-only structural diff between the model's raw output and the output the
 * run returned after integrity repair (trace inspector, "Model output vs
 * returned output"). Paths use the integrity dot-path dialect (`a.b[2].c`).
 * Arrays of equal length are compared index by index (a repaired item reads as
 * `changed`); arrays whose length differs are aligned on deep-equal items first,
 * so a dropped item reads as `removed` instead of shifting every later index.
 */
export type StructuralChangeKind = 'added' | 'removed' | 'changed'

export type StructuralChange = {
  path: string
  change: StructuralChangeKind
  before?: unknown
  after?: unknown
}

export const STRUCTURAL_DIFF_MAX_CHANGES = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => key in right && deepEqual(left[key], right[key]))
  }
  return false
}

function childPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key
}

function indexPath(parent: string, index: number): string {
  return `${parent}[${index}]`
}

function alignArrays(before: unknown[], after: unknown[]): Array<[number | null, number | null]> {
  const pairs: Array<[number | null, number | null]> = []
  let afterCursor = 0
  for (let beforeIndex = 0; beforeIndex < before.length; beforeIndex += 1) {
    let match = -1
    for (let candidate = afterCursor; candidate < after.length; candidate += 1) {
      if (deepEqual(before[beforeIndex], after[candidate])) {
        match = candidate
        break
      }
    }
    if (match === -1) {
      pairs.push([beforeIndex, null])
      continue
    }
    for (let skipped = afterCursor; skipped < match; skipped += 1) pairs.push([null, skipped])
    pairs.push([beforeIndex, match])
    afterCursor = match + 1
  }
  for (let rest = afterCursor; rest < after.length; rest += 1) pairs.push([null, rest])
  return pairs
}

function collect(before: unknown, after: unknown, path: string, changes: StructuralChange[]): void {
  if (changes.length >= STRUCTURAL_DIFF_MAX_CHANGES || deepEqual(before, after)) return
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length === after.length) {
      before.forEach((item, index) => collect(item, after[index], indexPath(path, index), changes))
      return
    }
    for (const [beforeIndex, afterIndex] of alignArrays(before, after)) {
      if (changes.length >= STRUCTURAL_DIFF_MAX_CHANGES) return
      if (beforeIndex !== null && afterIndex === null) {
        changes.push({ path: indexPath(path, beforeIndex), change: 'removed', before: before[beforeIndex] })
      } else if (beforeIndex === null && afterIndex !== null) {
        changes.push({ path: indexPath(path, afterIndex), change: 'added', after: after[afterIndex] })
      }
    }
    return
  }
  if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before)) {
      if (key in after) collect(before[key], after[key], childPath(path, key), changes)
      else if (changes.length < STRUCTURAL_DIFF_MAX_CHANGES) {
        changes.push({ path: childPath(path, key), change: 'removed', before: before[key] })
      }
    }
    for (const key of Object.keys(after)) {
      if (!(key in before) && changes.length < STRUCTURAL_DIFF_MAX_CHANGES) {
        changes.push({ path: childPath(path, key), change: 'added', after: after[key] })
      }
    }
    return
  }
  changes.push({ path, change: 'changed', before, after })
}

/** Leaf-level changes turning `before` into `after`, capped at {@link STRUCTURAL_DIFF_MAX_CHANGES}. */
export function diffStructures(before: unknown, after: unknown): StructuralChange[] {
  const changes: StructuralChange[] = []
  collect(before, after, '', changes)
  return changes
}
