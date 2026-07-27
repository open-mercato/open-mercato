import * as Y from 'yjs'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { htmlToYDoc, yDocToContent } from './collabMaterializer'
import {
  firstSafeDocumentsDisplayLabel,
  sanitizeDocumentsDisplayLabel,
} from './displayLabels'
import { assertDocumentContentResourceLimits } from './resourceLimits'

export type MaterializedVersionContent = {
  yjsState: Buffer
  contentHtml: string
  contentText: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDocumentAttachmentSource(src: string, documentId: string): boolean {
  if (!UUID_PATTERN.test(documentId)) return false
  const match = /^\/api\/documents\/([^/]+)\/attachments\/([^/]+)$/.exec(src)
  if (!match || !UUID_PATTERN.test(match[1]!) || !UUID_PATTERN.test(match[2]!)) return false
  return match[1]!.toLowerCase() === documentId.toLowerCase()
}

export function normalizeDocumentEntityRefLabels(
  contentHtml: string,
  fallbackLabel: string,
): string {
  const readableFallback = sanitizeDocumentsDisplayLabel(fallbackLabel)
  if (!readableFallback) {
    throw new Error('[internal] document entity references require a readable fallback label')
  }
  const decodeCandidate = (value: string): string | null => {
    try {
      const decoded = value
        .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#([0-9]+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_match, entity: string) => ({
          amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
        })[entity.toLowerCase()] ?? '')
      return /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i.test(decoded) ? null : decoded
    } catch {
      return null
    }
  }
  const readAttribute = (attributes: string, name: string): string | null => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes)
    const raw = match?.[1] ?? match?.[2] ?? match?.[3]
    return raw === undefined ? null : decodeCandidate(raw)
  }
  const escapeText = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return contentHtml.replace(/<span\b([^>]*)>([\s\S]*?)(?:<\/span\s*>|$)/gi, (whole, attributes: string, innerHtml: string) => {
    if (!/(?:^|\s)data-entity-ref(?:\s|=|$)/i.test(attributes)) return whole
    const markedInvalid = /(?:^|\s)data-entity-label-invalid(?:\s|=|$)/i.test(attributes)
    const attributeLabel = readAttribute(attributes, 'data-label')
    const innerText = decodeCandidate(sanitizeRichTextHtml(innerHtml).replace(/<[^>]*>/g, ''))
    const label = markedInvalid
      ? readableFallback
      : firstSafeDocumentsDisplayLabel(attributeLabel, innerText, readableFallback)!
    return `<span>${escapeText(label)}</span>`
  })
}

/**
 * The shared sanitizer deliberately permits https images for other rich-text
 * surfaces. Documents previews are stricter: they must not make any network
 * request while rendering historical content, so only the current document's
 * relative attachment endpoint survives.
 */
export function sanitizeDocumentPreviewHtml(
  contentHtml: string,
  documentId: string,
  entityRefFallbackLabel = 'Record',
): string {
  assertDocumentContentResourceLimits(
    { contentHtml },
    { status: 422, error: 'documents.versions.snapshotTooLarge' },
  )
  const sanitized = sanitizeRichTextHtml(
    normalizeDocumentEntityRefLabels(contentHtml, entityRefFallbackLabel),
  )
  const withoutExternalImages = sanitized.replace(/<img\b[^>]*>/gi, (tag) => {
    const match = /\ssrc=(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    const src = match?.[1] ?? match?.[2] ?? ''
    return isDocumentAttachmentSource(src, documentId) ? tag : ''
  })
  try {
    const normalized = yDocToContent(htmlToYDoc(withoutExternalImages))
    if (!normalized) throw new Error('[internal] Unable to normalize document preview')
    return normalized.html
  } catch {
    throw new CrudHttpError(422, { error: 'documents.versions.previewInvalid' })
  }
}

export function materializeDocumentVersion(input: {
  yjsSnapshot: Buffer | Uint8Array
  contentHtml: string | null | undefined
}): MaterializedVersionContent {
  assertDocumentContentResourceLimits(
    { yjsState: input.yjsSnapshot, contentHtml: input.contentHtml },
    { status: 422, error: 'documents.versions.snapshotTooLarge' },
  )
  let ydoc: Y.Doc
  const snapshot = Buffer.from(input.yjsSnapshot)
  if (snapshot.length === 0) {
    try {
      ydoc = htmlToYDoc(input.contentHtml ?? '')
    } catch {
      throw new CrudHttpError(422, { error: 'documents.versions.previewInvalid' })
    }
  } else {
    ydoc = new Y.Doc()
    try {
      Y.applyUpdate(ydoc, new Uint8Array(snapshot))
    } catch {
      throw new CrudHttpError(422, { error: 'documents.versions.corruptSnapshot' })
    }
  }

  const materialized = yDocToContent(ydoc)
  if (!materialized) {
    throw new CrudHttpError(422, { error: 'documents.versions.corruptSnapshot' })
  }
  const result = {
    yjsState: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
    contentHtml: materialized.html,
    contentText: materialized.text,
  }
  assertDocumentContentResourceLimits(
    result,
    { status: 422, error: 'documents.versions.snapshotTooLarge' },
  )
  return result
}

export function materializeDocumentVersionPreview(input: {
  documentId: string
  yjsSnapshot: Buffer | Uint8Array
  contentHtml: string | null | undefined
  entityRefFallbackLabel?: string
}): string {
  if (Buffer.from(input.yjsSnapshot).length === 0) {
    // Legacy HTML must be sanitized before it ever enters the editor parser.
    return sanitizeDocumentPreviewHtml(
      input.contentHtml ?? '',
      input.documentId,
      input.entityRefFallbackLabel,
    )
  }
  const materialized = materializeDocumentVersion(input)
  return sanitizeDocumentPreviewHtml(
    materialized.contentHtml,
    input.documentId,
    input.entityRefFallbackLabel,
  )
}
