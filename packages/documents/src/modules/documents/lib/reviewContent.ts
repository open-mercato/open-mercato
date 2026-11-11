import { getSchema } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { absolutePositionToRelativePosition, initProseMirrorDoc } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { COLLAB_FRAGMENT_FIELD, getDocumentEditorExtensions } from './editorConfig'

export type ReviewBlockKind = 'heading' | 'paragraph' | 'listItem' | 'tableCell'

export type ReviewBlock = {
  index: number
  kind: ReviewBlockKind
  level?: number
  sectionLabel: string
  text: string
}

export type ReviewTextSegment = {
  text: string
  position: number
}

export type PositionedReviewBlock = ReviewBlock & {
  from: number
  to: number
  segments: ReviewTextSegment[]
}

export type ReviewDocumentMapping = Parameters<typeof absolutePositionToRelativePosition>[2]

export type ParsedReviewDocument = {
  ydoc: Y.Doc
  fragment: Y.XmlFragment
  doc: ProseMirrorNode
  mapping: ReviewDocumentMapping
}

const LIST_ITEM_NODE_TYPES = new Set(['listItem', 'taskItem'])
const LIST_NODE_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])
const TABLE_CELL_NODE_TYPES = new Set(['tableCell', 'tableHeader'])

let cachedSchema: Schema | null = null

function resolveReviewSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(getDocumentEditorExtensions())
  return cachedSchema
}

export function parseReviewDocument(
  yjsState: Buffer | Uint8Array | null | undefined,
): ParsedReviewDocument | null {
  if (!yjsState || yjsState.byteLength === 0) return null
  const ydoc = new Y.Doc()
  try {
    Y.applyUpdate(ydoc, new Uint8Array(yjsState))
    const fragment = ydoc.getXmlFragment(COLLAB_FRAGMENT_FIELD)
    if (fragment.length === 0) {
      ydoc.destroy()
      return null
    }
    const { doc, mapping } = initProseMirrorDoc(fragment, resolveReviewSchema())
    return { ydoc, fragment, doc, mapping: mapping as ReviewDocumentMapping }
  } catch {
    ydoc.destroy()
    return null
  }
}

function collectSegments(node: ProseMirrorNode, nodePosition: number): ReviewTextSegment[] {
  const segments: ReviewTextSegment[] = []
  node.descendants((child, offset) => {
    if (child.isText && child.text) {
      segments.push({ text: child.text, position: nodePosition + 1 + offset })
      return false
    }
    if (child.isBlock && segments.length > 0) segments.push({ text: ' ', position: -1 })
    return true
  })
  return segments
}

function hasNestedList(node: ProseMirrorNode): boolean {
  let nested = false
  node.forEach((child) => {
    if (LIST_NODE_TYPES.has(child.type.name)) nested = true
  })
  return nested
}

function segmentsText(segments: ReviewTextSegment[]): string {
  return segments.map((segment) => segment.text).join('').replace(/\s+/g, ' ').trim()
}

export function extractPositionedReviewBlocks(doc: ProseMirrorNode): PositionedReviewBlock[] {
  const blocks: PositionedReviewBlock[] = []
  const handledPositions = new Set<number>()
  let sectionLabel = ''
  const pushBlock = (
    node: ProseMirrorNode,
    position: number,
    kind: ReviewBlockKind,
    level?: number,
  ) => {
    const segments = collectSegments(node, position)
    const text = segmentsText(segments)
    if (kind === 'heading') sectionLabel = text
    if (!text) return
    blocks.push({
      index: blocks.length,
      kind,
      ...(level !== undefined ? { level } : {}),
      sectionLabel,
      text,
      from: position,
      to: position + node.nodeSize,
      segments,
    })
  }
  doc.descendants((node, position) => {
    const typeName = node.type.name
    if (typeName === 'heading') {
      const level = typeof node.attrs.level === 'number' ? node.attrs.level : 1
      pushBlock(node, position, 'heading', level)
      return false
    }
    if (LIST_ITEM_NODE_TYPES.has(typeName)) {
      if (!hasNestedList(node)) {
        pushBlock(node, position, 'listItem')
        return false
      }
      node.forEach((child, offset) => {
        if (!child.isTextblock) return
        const childPosition = position + 1 + offset
        pushBlock(child, childPosition, 'listItem')
        handledPositions.add(childPosition)
      })
      return true
    }
    if (TABLE_CELL_NODE_TYPES.has(typeName)) {
      pushBlock(node, position, 'tableCell')
      return false
    }
    if (node.isTextblock) {
      if (handledPositions.has(position)) return false
      pushBlock(node, position, 'paragraph')
      return false
    }
    return true
  })
  return blocks
}

export function toReviewBlocks(blocks: PositionedReviewBlock[]): ReviewBlock[] {
  return blocks.map(({ index, kind, level, sectionLabel, text }) => ({
    index,
    kind,
    ...(level !== undefined ? { level } : {}),
    sectionLabel,
    text,
  }))
}

export function extractReviewBlocksFromYjsState(
  yjsState: Buffer | Uint8Array | null | undefined,
): ReviewBlock[] {
  const parsed = parseReviewDocument(yjsState)
  if (!parsed) return []
  try {
    return toReviewBlocks(extractPositionedReviewBlocks(parsed.doc))
  } finally {
    parsed.ydoc.destroy()
  }
}
