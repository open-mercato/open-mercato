/**
 * Sticky notes and named groups (spec section 4.5).
 *
 * Annotations are DOCUMENTATION and never execution semantics. They live in
 * `metadata.editor.annotations` only — `graphToDefinition` filters their nodes
 * out of `steps` and `transitions` entirely, so a definition carrying a hundred
 * notes serializes byte-identically to one carrying none and the engine can
 * never see them.
 *
 * They are still React Flow NODES while the editor is open, which is what makes
 * dragging, selection, the undo stack and the arrangement autosave work for a
 * note exactly as they do for a step: the page owns one node array and the
 * annotations are derived back out of it on save.
 *
 * PURE: plain data in, plain data out — React Flow is a type-only import.
 */

import type { Node } from '@xyflow/react'

export const ANNOTATION_NOTE_NODE_TYPE = 'annotationNote'
export const ANNOTATION_GROUP_NODE_TYPE = 'annotationGroup'

export const DEFAULT_NOTE_SIZE = { width: 220, height: 140 }
export const DEFAULT_GROUP_SIZE = { width: 360, height: 260 }

/** Groups render behind the steps they frame; notes sit in the normal plane. */
const GROUP_Z_INDEX = -1

export interface AnnotationPoint {
  x: number
  y: number
}

export interface AnnotationSize {
  width: number
  height: number
}

export interface AnnotationRect extends AnnotationPoint, AnnotationSize {}

export interface WorkflowEditorNote {
  id: string
  markdown: string
  position: AnnotationPoint
  size: AnnotationSize
}

/**
 * A group is stored as a RECT rather than a member-id list. A region needs no
 * maintenance when a step it happens to overlap is deleted, pasted or converted,
 * and "which steps are in this group" is already answered by the canvas — an id
 * list would be a second source of truth the engine must never read anyway.
 */
export interface WorkflowEditorGroup {
  id: string
  name: string
  rect: AnnotationRect
  collapsed?: boolean
}

export interface WorkflowEditorAnnotations {
  notes: WorkflowEditorNote[]
  groups: WorkflowEditorGroup[]
}

export interface WorkflowNoteNodeData extends Record<string, unknown> {
  markdown: string
}

export interface WorkflowGroupNodeData extends Record<string, unknown> {
  name: string
  collapsed: boolean
}

export function createEmptyAnnotations(): WorkflowEditorAnnotations {
  return { notes: [], groups: [] }
}

export function isAnnotationNodeType(nodeType: string | undefined | null): boolean {
  return nodeType === ANNOTATION_NOTE_NODE_TYPE || nodeType === ANNOTATION_GROUP_NODE_TYPE
}

export function isAnnotationNode(node: { type?: string | null }): boolean {
  return isAnnotationNodeType(node.type)
}

export function hasAnnotations(annotations: WorkflowEditorAnnotations | null | undefined): boolean {
  if (!annotations) return false
  return annotations.notes.length > 0 || annotations.groups.length > 0
}

export function generateAnnotationId(prefix: 'note' | 'group'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
}

function readPoint(value: unknown, fallback: AnnotationPoint): AnnotationPoint {
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as Record<string, unknown>
  const x = typeof candidate.x === 'number' && Number.isFinite(candidate.x) ? candidate.x : fallback.x
  const y = typeof candidate.y === 'number' && Number.isFinite(candidate.y) ? candidate.y : fallback.y
  return { x, y }
}

function readSize(value: unknown, fallback: AnnotationSize): AnnotationSize {
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as Record<string, unknown>
  const width = typeof candidate.width === 'number' && candidate.width > 0 ? candidate.width : fallback.width
  const height = typeof candidate.height === 'number' && candidate.height > 0 ? candidate.height : fallback.height
  return { width, height }
}

function readNote(value: unknown): WorkflowEditorNote | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null
  return {
    id: candidate.id,
    markdown: typeof candidate.markdown === 'string' ? candidate.markdown : '',
    position: readPoint(candidate.position, { x: 0, y: 0 }),
    size: readSize(candidate.size, DEFAULT_NOTE_SIZE),
  }
}

function readGroup(value: unknown): WorkflowEditorGroup | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null
  const point = readPoint(candidate.rect, { x: 0, y: 0 })
  const size = readSize(candidate.rect, DEFAULT_GROUP_SIZE)
  const group: WorkflowEditorGroup = {
    id: candidate.id,
    name: typeof candidate.name === 'string' ? candidate.name : '',
    rect: { x: point.x, y: point.y, width: size.width, height: size.height },
  }
  if (candidate.collapsed === true) group.collapsed = true
  return group
}

/**
 * Read the annotations carried by a definition's metadata bag, tolerating every
 * shape a hand-edited or older document can hold. Anything unreadable is simply
 * dropped rather than throwing: annotations are documentation, and a malformed
 * note must never stop a workflow from opening.
 */
export function readEditorAnnotations(
  metadata: Record<string, unknown> | null | undefined,
): WorkflowEditorAnnotations {
  const editorValue = metadata?.editor
  if (!editorValue || typeof editorValue !== 'object' || Array.isArray(editorValue)) return createEmptyAnnotations()
  const annotationsValue = (editorValue as Record<string, unknown>).annotations
  if (!annotationsValue || typeof annotationsValue !== 'object' || Array.isArray(annotationsValue)) {
    return createEmptyAnnotations()
  }
  const candidate = annotationsValue as Record<string, unknown>
  const notes = Array.isArray(candidate.notes)
    ? candidate.notes.map(readNote).filter((note): note is WorkflowEditorNote => note !== null)
    : []
  const groups = Array.isArray(candidate.groups)
    ? candidate.groups.map(readGroup).filter((group): group is WorkflowEditorGroup => group !== null)
    : []
  return { notes, groups }
}

/**
 * Write annotations back into a metadata bag. An empty set REMOVES the key (and
 * the `editor` bag when nothing else lives there), so a workflow that never used
 * an annotation keeps saving exactly the metadata it always did.
 */
export function writeEditorAnnotations(
  metadata: Record<string, unknown> | null,
  annotations: WorkflowEditorAnnotations | null | undefined,
): Record<string, unknown> | null {
  const base: Record<string, unknown> = { ...(metadata ?? {}) }
  const editorValue = base.editor
  const editor: Record<string, unknown> =
    editorValue && typeof editorValue === 'object' && !Array.isArray(editorValue)
      ? { ...(editorValue as Record<string, unknown>) }
      : {}

  if (hasAnnotations(annotations)) {
    const payload: Record<string, unknown> = {}
    if (annotations!.notes.length > 0) payload.notes = annotations!.notes
    if (annotations!.groups.length > 0) payload.groups = annotations!.groups
    editor.annotations = payload
  } else {
    delete editor.annotations
  }

  if (Object.keys(editor).length > 0) base.editor = editor
  else delete base.editor
  return Object.keys(base).length > 0 ? base : null
}

export function annotationsToNodes(annotations: WorkflowEditorAnnotations | null | undefined): Node[] {
  if (!annotations) return []
  const groupNodes: Node[] = annotations.groups.map((group) => ({
    id: group.id,
    type: ANNOTATION_GROUP_NODE_TYPE,
    position: { x: group.rect.x, y: group.rect.y },
    width: group.rect.width,
    height: group.rect.height,
    style: { width: group.rect.width, height: group.rect.height },
    zIndex: GROUP_Z_INDEX,
    data: { name: group.name, collapsed: group.collapsed === true } satisfies WorkflowGroupNodeData,
  }))
  const noteNodes: Node[] = annotations.notes.map((note) => ({
    id: note.id,
    type: ANNOTATION_NOTE_NODE_TYPE,
    position: { x: note.position.x, y: note.position.y },
    width: note.size.width,
    height: note.size.height,
    style: { width: note.size.width, height: note.size.height },
    data: { markdown: note.markdown } satisfies WorkflowNoteNodeData,
  }))
  return [...groupNodes, ...noteNodes]
}

function nodeSize(node: Node, fallback: AnnotationSize): AnnotationSize {
  const width = typeof node.width === 'number' && node.width > 0
    ? node.width
    : typeof node.measured?.width === 'number' && node.measured.width > 0
      ? node.measured.width
      : fallback.width
  const height = typeof node.height === 'number' && node.height > 0
    ? node.height
    : typeof node.measured?.height === 'number' && node.measured.height > 0
      ? node.measured.height
      : fallback.height
  return { width, height }
}

/** Derive the persisted annotations back out of the live node array. */
export function annotationsFromNodes(nodes: Node[]): WorkflowEditorAnnotations {
  const notes: WorkflowEditorNote[] = []
  const groups: WorkflowEditorGroup[] = []
  for (const node of nodes) {
    if (node.type === ANNOTATION_NOTE_NODE_TYPE) {
      const data = node.data as Partial<WorkflowNoteNodeData> | undefined
      notes.push({
        id: node.id,
        markdown: typeof data?.markdown === 'string' ? data.markdown : '',
        position: { x: node.position.x, y: node.position.y },
        size: nodeSize(node, DEFAULT_NOTE_SIZE),
      })
      continue
    }
    if (node.type === ANNOTATION_GROUP_NODE_TYPE) {
      const data = node.data as Partial<WorkflowGroupNodeData> | undefined
      const size = nodeSize(node, DEFAULT_GROUP_SIZE)
      const group: WorkflowEditorGroup = {
        id: node.id,
        name: typeof data?.name === 'string' ? data.name : '',
        rect: { x: node.position.x, y: node.position.y, width: size.width, height: size.height },
      }
      if (data?.collapsed === true) group.collapsed = true
      groups.push(group)
    }
  }
  return { notes, groups }
}

export function createNoteNode(position: AnnotationPoint, markdown: string): Node {
  return {
    id: generateAnnotationId('note'),
    type: ANNOTATION_NOTE_NODE_TYPE,
    position: { x: position.x, y: position.y },
    width: DEFAULT_NOTE_SIZE.width,
    height: DEFAULT_NOTE_SIZE.height,
    style: { width: DEFAULT_NOTE_SIZE.width, height: DEFAULT_NOTE_SIZE.height },
    data: { markdown } satisfies WorkflowNoteNodeData,
  }
}

export function createGroupNode(position: AnnotationPoint, name: string): Node {
  return {
    id: generateAnnotationId('group'),
    type: ANNOTATION_GROUP_NODE_TYPE,
    position: { x: position.x, y: position.y },
    width: DEFAULT_GROUP_SIZE.width,
    height: DEFAULT_GROUP_SIZE.height,
    style: { width: DEFAULT_GROUP_SIZE.width, height: DEFAULT_GROUP_SIZE.height },
    zIndex: GROUP_Z_INDEX,
    data: { name, collapsed: false } satisfies WorkflowGroupNodeData,
  }
}

export function updateAnnotationNode(
  nodes: Node[],
  nodeId: string,
  updates: Partial<WorkflowNoteNodeData & WorkflowGroupNodeData>,
): Node[] {
  return nodes.map((node) =>
    node.id === nodeId && isAnnotationNode(node)
      ? { ...node, data: { ...node.data, ...updates } }
      : node,
  )
}

export function removeAnnotationNode(nodes: Node[], nodeId: string): Node[] {
  return nodes.filter((node) => !(node.id === nodeId && isAnnotationNode(node)))
}
