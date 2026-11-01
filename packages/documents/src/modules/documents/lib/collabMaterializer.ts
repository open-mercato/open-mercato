import { createRequire } from 'node:module'
import { TiptapTransformer } from '@hocuspocus/transformer'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getSchema, type Extensions, type JSONContent } from '@tiptap/core'
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  Node as ProseMirrorNode,
  type ParseOptions,
} from '@tiptap/pm/model'
import * as Y from 'yjs'
import { deriveContentTextFromHtml } from './contentService'
import { COLLAB_FRAGMENT_FIELD, getDocumentEditorExtensions } from './editorConfig'
import { assertDocumentContentResourceLimits } from './resourceLimits'

type HappyDomModule = typeof import('happy-dom')
type HappyDomWindow = InstanceType<HappyDomModule['Window']>

const requireFromHere = createRequire(import.meta.url)
let happyDomModule: HappyDomModule | null = null

function createHtmlWindow(): HappyDomWindow {
  if (!happyDomModule) {
    happyDomModule = requireFromHere('happy-dom') as HappyDomModule
  }

  return new happyDomModule.Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      disableComputedStyleRendering: true,
    },
  })
}

function generateHtml(doc: JSONContent, extensions: Extensions): string {
  const schema = getSchema(extensions)
  const documentNode = ProseMirrorNode.fromJSON(schema, doc)
  const localWindow = createHtmlWindow()

  try {
    const wrapper = localWindow.document.createElement('div')
    DOMSerializer.fromSchema(schema).serializeFragment(
      documentNode.content,
      { document: localWindow.document as unknown as Document },
      wrapper as unknown as HTMLElement,
    )
    return wrapper.innerHTML
  } finally {
    localWindow.happyDOM.abort()
    localWindow.happyDOM.close()
  }
}

function generateJson(html: string, extensions: Extensions, options?: ParseOptions): JSONContent {
  const localWindow = createHtmlWindow()

  try {
    const parsedDocument = new localWindow.DOMParser().parseFromString(
      `<!DOCTYPE html><html><body>${html}</body></html>`,
      'text/html',
    )
    const schema = getSchema(extensions)
    return ProseMirrorDOMParser.fromSchema(schema)
      .parse(parsedDocument.body as unknown as Node, options)
      .toJSON()
  } finally {
    localWindow.happyDOM.abort()
    localWindow.happyDOM.close()
  }
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

    const html = generateHtml(json, getDocumentEditorExtensions())
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
  const json = generateJson(html, extensions)
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
