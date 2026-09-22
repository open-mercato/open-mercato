import { createRequire } from 'node:module'
import type { JSONContent } from '@tiptap/core'
import { TiptapTransformer } from '@hocuspocus/transformer'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import * as Y from 'yjs'
import { deriveContentTextFromHtml } from './contentService'
import { COLLAB_FRAGMENT_FIELD, getDocumentEditorExtensions } from './editorConfig'
import { assertDocumentContentResourceLimits } from './resourceLimits'

type TiptapHtmlServer = typeof import('@tiptap/html/server')

const requireFromHere = createRequire(import.meta.url)
let tiptapHtmlServer: TiptapHtmlServer | null = null

function getTiptapHtmlServer(): TiptapHtmlServer {
  if (!tiptapHtmlServer) {
    tiptapHtmlServer = requireFromHere('@tiptap/html/server') as TiptapHtmlServer
  }
  return tiptapHtmlServer
}

function hasRenderableContent(node: JSONContent): boolean {
  if (node.type === 'text') return Boolean(node.text)
  if (Array.isArray(node.content) && node.content.some(hasRenderableContent)) return true
  return Boolean(node.type && node.type !== 'doc' && node.type !== 'paragraph' && node.type !== 'text')
}

export function yDocToContent(ydoc: Y.Doc): { html: string; text: string } | null {
  try {
    if (ydoc.getXmlFragment(COLLAB_FRAGMENT_FIELD).length === 0) {
      return { html: '', text: '' }
    }

    const json = TiptapTransformer.fromYdoc(ydoc, COLLAB_FRAGMENT_FIELD) as JSONContent | null
    if (!json || !hasRenderableContent(json)) {
      return { html: '', text: '' }
    }

    const { generateHTML } = getTiptapHtmlServer()
    const html = generateHTML(json, getDocumentEditorExtensions())
    const text = deriveContentTextFromHtml(html)
    assertDocumentContentResourceLimits({ contentHtml: html, contentText: text })
    return { html, text }
  } catch (error) {
    if (isCrudHttpError(error) && error.status === 413) throw error
    return null
  }
}

export function htmlToYDoc(html: string): Y.Doc {
  assertDocumentContentResourceLimits({ contentHtml: html })
  if (!html.trim()) return new Y.Doc()

  const extensions = getDocumentEditorExtensions()
  const { generateJSON } = getTiptapHtmlServer()
  const json = generateJSON(html, extensions) as JSONContent
  return TiptapTransformer.toYdoc(json, COLLAB_FRAGMENT_FIELD, extensions)
}

export type MaterializedDocumentHtml = {
  yjsState: Buffer
  html: string
  text: string
}

/**
 * Convert authored HTML through the same editor/Yjs pipeline used by persisted
 * document content. Callers that preview content before writing it must use the
 * returned HTML too, otherwise the preview can differ from the canonical markup
 * users receive after the document is created.
 */
export function materializeDocumentHtml(html: string): MaterializedDocumentHtml | null {
  try {
    const ydoc = htmlToYDoc(html)
    const content = yDocToContent(ydoc)
    if (!content) return null
    const result = {
      yjsState: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
      html: content.html,
      text: content.text,
    }
    assertDocumentContentResourceLimits({
      yjsState: result.yjsState,
      contentHtml: result.html,
      contentText: result.text,
    })
    return result
  } catch (error) {
    if (isCrudHttpError(error) && error.status === 413) throw error
    return null
  }
}

/**
 * Replace REST-authored content as a Yjs update derived from the current CRDT
 * epoch. Keeping the old structs as deleted tombstones means a retained client
 * can merge the replacement without resurrecting or duplicating stale text.
 */
export function materializeDocumentContentReplacement(
  existingState: Buffer | Uint8Array | null | undefined,
  html: string,
): MaterializedDocumentHtml | null {
  try {
    assertDocumentContentResourceLimits({ yjsState: existingState, contentHtml: html })
    const replacement = htmlToYDoc(html)
    const ydoc = new Y.Doc()
    if (existingState && existingState.length > 0) {
      Y.applyUpdate(ydoc, new Uint8Array(existingState))
    }

    const target = ydoc.getXmlFragment(COLLAB_FRAGMENT_FIELD)
    const replacementNodes = replacement
      .getXmlFragment(COLLAB_FRAGMENT_FIELD)
      .toArray()
      .filter((node): node is Y.XmlElement | Y.XmlText => (
        node instanceof Y.XmlElement || node instanceof Y.XmlText
      ))
      .map((node) => node.clone())
    ydoc.transact(() => {
      if (target.length > 0) target.delete(0, target.length)
      if (replacementNodes.length > 0) target.insert(0, replacementNodes)
    })
    const content = yDocToContent(ydoc)
    if (!content) return null
    const result = {
      yjsState: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
      html: content.html,
      text: content.text,
    }
    assertDocumentContentResourceLimits({
      yjsState: result.yjsState,
      contentHtml: result.html,
      contentText: result.text,
    })
    return result
  } catch (error) {
    if (isCrudHttpError(error) && error.status === 413) throw error
    return null
  }
}
