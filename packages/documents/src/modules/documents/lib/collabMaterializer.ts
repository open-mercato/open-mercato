import type { JSONContent } from '@tiptap/core'
import { TiptapTransformer } from '@hocuspocus/transformer'
import { generateHTML, generateJSON } from '@tiptap/html'
import * as Y from 'yjs'
import { deriveContentTextFromHtml } from './contentService'
import { COLLAB_FRAGMENT_FIELD, getDocumentEditorExtensions } from './editorConfig'

function hasRenderableContent(node: JSONContent): boolean {
  if (node.type === 'text') return Boolean(node.text)
  if (Array.isArray(node.content) && node.content.some(hasRenderableContent)) return true
  return Boolean(node.type && node.type !== 'doc' && node.type !== 'paragraph' && node.type !== 'text')
}

export function yDocToContent(ydoc: Y.Doc): { html: string; text: string } {
  try {
    if (ydoc.getXmlFragment(COLLAB_FRAGMENT_FIELD).length === 0) {
      return { html: '', text: '' }
    }

    const json = TiptapTransformer.fromYdoc(ydoc, COLLAB_FRAGMENT_FIELD) as JSONContent | null
    if (!json || !hasRenderableContent(json)) {
      return { html: '', text: '' }
    }

    const html = generateHTML(json, getDocumentEditorExtensions())
    const text = deriveContentTextFromHtml(html)
    return { html, text }
  } catch {
    return { html: '', text: '' }
  }
}

export function htmlToYDoc(html: string): Y.Doc {
  if (!html.trim()) return new Y.Doc()

  const extensions = getDocumentEditorExtensions()
  const json = generateJSON(html, extensions) as JSONContent
  return TiptapTransformer.toYdoc(json, COLLAB_FRAGMENT_FIELD, extensions)
}
