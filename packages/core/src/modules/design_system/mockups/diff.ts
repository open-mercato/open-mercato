import {
  collectNodes,
  type MockupDocument,
  type MockupLayoutNode,
  type MockupLeafNode,
} from './schema'

/**
 * Block-level version delta by node id (spec 2026-07-05-ds-live-mockup-composer.md,
 * Phase 2 — Version snapshots and diff). Pure data walk over two documents:
 *
 * - `added`   — leaf ids present in `to` only
 * - `removed` — leaf ids present in `from` only
 * - `changed` — leaves whose content differs (entry, variant, props, label, or
 *   annotation), with the changed field names; a changed leaf that also moved
 *   lists `position` among its fields
 * - `moved`   — moved-ONLY leaves: same content, different position (parent or
 *   index)
 *
 * Findings are deliberately not part of the delta — they are critique metadata
 * about a version, not screen content (`stableContentString` strips them for
 * the same reason).
 */

export type MockupDiff = {
  slug: string
  from: string // 'current' or a snapshot label
  to: string
  added: string[]
  removed: string[]
  changed: Array<{ id: string; fields: string[] }>
  moved: string[]
}

type LeafPosition = { parentId: string | null; index: number }

function indexLeaves(document: MockupDocument): Map<string, { leaf: MockupLeafNode; position: LeafPosition }> {
  const map = new Map<string, { leaf: MockupLeafNode; position: LeafPosition }>()
  const visit = (node: MockupLayoutNode, position: LeafPosition): void => {
    if (node.type === 'block' || node.type === 'placeholder') {
      map.set(node.id, { leaf: node, position })
      return
    }
    node.children.forEach((child, index) => visit(child, { parentId: node.id, index }))
  }
  visit(document.root, { parentId: null, index: 0 })
  return map
}

function stableValue(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort)
    if (input && typeof input === 'object') {
      const source = input as Record<string, unknown>
      const result: Record<string, unknown> = {}
      for (const key of Object.keys(source).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) result[key] = sort(source[key])
      return result
    }
    return input
  }
  return JSON.stringify(sort(value))
}

/** Content fields compared per leaf — findings excluded by design. */
const COMPARED_FIELDS = ['entry', 'variant', 'props', 'label', 'status', 'userStory', 'note'] as const

function changedFields(from: MockupLeafNode, to: MockupLeafNode): string[] {
  const fields: string[] = []
  if (from.type !== to.type) return ['type']
  for (const field of COMPARED_FIELDS) {
    const before = (from as unknown as Record<string, unknown>)[field]
    const after = (to as unknown as Record<string, unknown>)[field]
    if (stableValue(before) !== stableValue(after)) fields.push(field)
  }
  return fields
}

export function computeMockupDiff(
  fromDocument: MockupDocument,
  toDocument: MockupDocument,
  labels: { slug: string; from: string; to: string },
): MockupDiff {
  const fromLeaves = indexLeaves(fromDocument)
  const toLeaves = indexLeaves(toDocument)

  const added: string[] = []
  const removed: string[] = []
  const changed: Array<{ id: string; fields: string[] }> = []
  const moved: string[] = []

  // Order lists by the `to` document tree so the ledger reads top-to-bottom.
  for (const node of collectNodes(toDocument.root)) {
    if (node.type !== 'block' && node.type !== 'placeholder') continue
    const before = fromLeaves.get(node.id)
    if (!before) {
      added.push(node.id)
      continue
    }
    const after = toLeaves.get(node.id)!
    const fields = changedFields(before.leaf, after.leaf)
    const positionChanged =
      before.position.parentId !== after.position.parentId ||
      before.position.index !== after.position.index
    if (fields.length > 0) {
      changed.push({ id: node.id, fields: positionChanged ? [...fields, 'position'] : fields })
    } else if (positionChanged) {
      moved.push(node.id)
    }
  }
  for (const node of collectNodes(fromDocument.root)) {
    if (node.type !== 'block' && node.type !== 'placeholder') continue
    if (!toLeaves.has(node.id)) removed.push(node.id)
  }

  return { slug: labels.slug, from: labels.from, to: labels.to, added, removed, changed, moved }
}

export type MockupDiffTone = 'added' | 'removed' | 'changed' | 'moved'

/** Per-block diff tone for rail overrides; `removed` applies on the FROM stage. */
export function diffToneByBlock(diff: MockupDiff): Record<string, MockupDiffTone> {
  const tones: Record<string, MockupDiffTone> = {}
  for (const id of diff.moved) tones[id] = 'moved'
  for (const entry of diff.changed) tones[entry.id] = 'changed'
  for (const id of diff.removed) tones[id] = 'removed'
  for (const id of diff.added) tones[id] = 'added'
  return tones
}
