import {
  collectNodes,
  type MockupDocument,
  type MockupLayoutNode,
  type MockupLeafNode,
  type MockupStatus,
} from './schema'

/**
 * Pure, immutable document mutations behind the Phase 2 studio (spec
 * 2026-07-05-ds-live-mockup-composer.md — palette · canvas · inspector). The
 * studio is a structured editor over the SAME JSON document, never a parallel
 * model: every operation clones the document, applies one tree edit, and
 * returns a new document that must still satisfy the zod schema (unit-tested).
 * No fs, no React — server, client, and tests share one implementation.
 */

export type MutationResult =
  | { ok: true; document: MockupDocument }
  | { ok: false; error: string }

function clone(document: MockupDocument): MockupDocument {
  return JSON.parse(JSON.stringify(document)) as MockupDocument
}

function findNode(document: MockupDocument, id: string): MockupLayoutNode | null {
  return collectNodes(document.root).find((node) => node.id === id) ?? null
}

function findParent(
  document: MockupDocument,
  id: string,
): { parent: { children: MockupLayoutNode[] }; index: number } | null {
  for (const node of collectNodes(document.root)) {
    if (node.type !== 'stack' && node.type !== 'columns') continue
    const index = node.children.findIndex((child) => child.id === id)
    if (index >= 0) return { parent: node, index }
  }
  return null
}

/** 'kpi-card' → 'kpi-card-2' — first free id for a new node. */
export function uniqueNodeId(document: MockupDocument, base: string): string {
  const taken = new Set(collectNodes(document.root).map((node) => node.id))
  if (!taken.has(base)) return base
  for (let counter = 2; ; counter += 1) {
    const candidate = `${base}-${counter}`
    if (!taken.has(candidate)) return candidate
  }
}

export type NewLeafInput =
  | { type: 'block'; entry: string; variant?: string; props?: Record<string, unknown> }
  | { type: 'placeholder'; label: string }

/**
 * Inserts a new leaf into the container `parentId` at `index` (clamped).
 * New blocks start `status: 'proposed'` — a palette insert is a proposal by
 * definition; flipping the status is a deliberate act.
 */
export function insertLeaf(
  document: MockupDocument,
  parentId: string,
  index: number,
  input: NewLeafInput,
): MutationResult {
  const next = clone(document)
  const parent = findNode(next, parentId)
  if (!parent || (parent.type !== 'stack' && parent.type !== 'columns')) {
    return { ok: false, error: `No container node "${parentId}"` }
  }
  const base = input.type === 'block' ? input.entry : 'placeholder'
  const leaf: MockupLeafNode =
    input.type === 'block'
      ? {
          type: 'block',
          id: uniqueNodeId(next, base),
          entry: input.entry,
          ...(input.variant !== undefined ? { variant: input.variant } : {}),
          ...(input.props !== undefined ? { props: input.props } : {}),
          status: 'proposed',
        }
      : { type: 'placeholder', id: uniqueNodeId(next, base), label: input.label, status: 'proposed' }
  const clamped = Math.min(Math.max(index, 0), parent.children.length)
  parent.children.splice(clamped, 0, leaf)
  return { ok: true, document: next }
}

/** Removes the node `id` (leaf or container — containers take their subtree). */
export function removeNode(document: MockupDocument, id: string): MutationResult {
  const next = clone(document)
  if (next.root.id === id) return { ok: false, error: 'Cannot remove the root node' }
  const located = findParent(next, id)
  if (!located) return { ok: false, error: `No node "${id}"` }
  located.parent.children.splice(located.index, 1)
  return { ok: true, document: next }
}

/** Moves the node one position up (-1) or down (+1) within its parent. */
export function reorderNode(document: MockupDocument, id: string, offset: -1 | 1): MutationResult {
  const next = clone(document)
  const located = findParent(next, id)
  if (!located) return { ok: false, error: `No node "${id}"` }
  const target = located.index + offset
  if (target < 0 || target >= located.parent.children.length) {
    return { ok: false, error: 'Already at the edge of its container' }
  }
  const [node] = located.parent.children.splice(located.index, 1)
  located.parent.children.splice(target, 0, node)
  return { ok: true, document: next }
}

/** Moves the node into another container at `index` — reorder across regions. */
export function moveNode(
  document: MockupDocument,
  id: string,
  targetParentId: string,
  index: number,
): MutationResult {
  const next = clone(document)
  const located = findParent(next, id)
  if (!located) return { ok: false, error: `No node "${id}"` }
  const target = findNode(next, targetParentId)
  if (!target || (target.type !== 'stack' && target.type !== 'columns')) {
    return { ok: false, error: `No container node "${targetParentId}"` }
  }
  const moving = located.parent.children[located.index]
  if (moving.type === 'stack' || moving.type === 'columns') {
    // A container cannot move into its own subtree.
    if (collectNodes(moving).some((node) => node.id === targetParentId)) {
      return { ok: false, error: 'Cannot move a container into its own subtree' }
    }
  }
  located.parent.children.splice(located.index, 1)
  const clamped = Math.min(Math.max(index, 0), target.children.length)
  target.children.splice(clamped, 0, moving)
  return { ok: true, document: next }
}

export type BlockPatch = {
  entry?: string
  /** `null` clears the variant (fall back to the entry default). */
  variant?: string | null
  /** `null` clears props entirely. */
  props?: Record<string, unknown> | null
}

/** Entry/variant/props swap for a `block` leaf (inspector palette pick + prop form). */
export function updateBlock(document: MockupDocument, id: string, patch: BlockPatch): MutationResult {
  const next = clone(document)
  const node = findNode(next, id)
  if (!node || node.type !== 'block') return { ok: false, error: `No block "${id}"` }
  if (patch.entry !== undefined && patch.entry !== node.entry) {
    node.entry = patch.entry
    // A different entry invalidates the old variant and props.
    delete node.variant
    delete node.props
  }
  if (patch.variant !== undefined) {
    if (patch.variant === null) delete node.variant
    else node.variant = patch.variant
  }
  if (patch.props !== undefined) {
    if (patch.props === null) delete node.props
    else node.props = patch.props
  }
  return { ok: true, document: next }
}

export type AnnotationPatch = {
  status?: MockupStatus
  /** `null` clears the field. */
  userStory?: string | null
  note?: string | null
}

/** Annotation flip for any leaf (status / user story / note) — findings untouched. */
export function updateAnnotation(
  document: MockupDocument,
  id: string,
  patch: AnnotationPatch,
): MutationResult {
  const next = clone(document)
  const node = findNode(next, id)
  if (!node || (node.type !== 'block' && node.type !== 'placeholder')) {
    return { ok: false, error: `No leaf "${id}"` }
  }
  if (patch.status !== undefined) node.status = patch.status
  if (patch.userStory !== undefined) {
    if (patch.userStory === null || patch.userStory === '') delete node.userStory
    else node.userStory = patch.userStory
  }
  if (patch.note !== undefined) {
    if (patch.note === null || patch.note === '') delete node.note
    else node.note = patch.note
  }
  return { ok: true, document: next }
}

/** Placeholder label edit. */
export function updatePlaceholderLabel(
  document: MockupDocument,
  id: string,
  label: string,
): MutationResult {
  const next = clone(document)
  const node = findNode(next, id)
  if (!node || node.type !== 'placeholder') return { ok: false, error: `No placeholder "${id}"` }
  node.label = label
  return { ok: true, document: next }
}

/** Containers reachable as insert targets, in tree order (root first). */
export function listContainers(
  document: MockupDocument,
): Array<{ id: string; type: 'stack' | 'columns'; childCount: number }> {
  return collectNodes(document.root)
    .filter((node): node is Extract<MockupLayoutNode, { children: MockupLayoutNode[] }> =>
      node.type === 'stack' || node.type === 'columns',
    )
    .map((node) => ({ id: node.id, type: node.type, childCount: node.children.length }))
}
