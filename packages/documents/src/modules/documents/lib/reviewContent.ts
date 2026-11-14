import { getSchema } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { absolutePositionToRelativePosition, initProseMirrorDoc } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { COLLAB_FRAGMENT_FIELD, getDocumentEditorExtensions } from './editorConfig'
import { extractPositionedReviewBlocks, toReviewBlocks, type ReviewBlock } from './reviewBlocks'

export {
  extractPositionedReviewBlocks,
  toReviewBlocks,
  type PositionedReviewBlock,
  type ReviewBlock,
  type ReviewBlockKind,
  type ReviewTextSegment,
} from './reviewBlocks'

export type ReviewDocumentMapping = Parameters<typeof absolutePositionToRelativePosition>[2]

export type ParsedReviewDocument = {
  ydoc: Y.Doc
  fragment: Y.XmlFragment
  doc: ProseMirrorNode
  mapping: ReviewDocumentMapping
}

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
