import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const MEBIBYTE = 1024 * 1024

/** Authoritative UTF-8 bounds for every stored representation of a document body. */
export const DOCUMENTS_MAX_CONTENT_HTML_BYTES = 2 * MEBIBYTE
export const DOCUMENTS_MAX_CONTENT_TEXT_BYTES = 2 * MEBIBYTE
export const DOCUMENTS_MAX_YJS_STATE_BYTES = 8 * MEBIBYTE

/** Bound cross-module verification and reverse-widget work per document. */
export const DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT = 100

/** WebSocket messages include a small Hocuspocus/Yjs protocol envelope. */
export const DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES = DOCUMENTS_MAX_YJS_STATE_BYTES + 64 * 1024

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function isUtf8WithinLimit(value: string, maxBytes: number): boolean {
  return utf8ByteLength(value) <= maxBytes
}

export function maxBase64EncodedLength(maxDecodedBytes: number): number {
  return Math.ceil(maxDecodedBytes / 3) * 4
}

/** Validate encoded size before Buffer allocates the decoded payload. */
export function decodeBoundedCanonicalBase64(
  value: string,
  maxDecodedBytes: number,
  options: { status?: number; error?: string } = {},
): Buffer {
  const fail = () => {
    throw new CrudHttpError(options.status ?? 413, {
      error: options.error ?? 'documents.content.tooLarge',
    })
  }
  if (
    value.length > maxBase64EncodedLength(maxDecodedBytes)
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return fail()
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.byteLength > maxDecodedBytes || bytes.toString('base64') !== value) return fail()
  return bytes
}

export type DocumentContentResourceInput = {
  yjsState?: Buffer | Uint8Array | null
  contentHtml?: string | null
  contentText?: string | null
}

export function assertDocumentYjsStateByteLength(
  byteLength: number,
  options: { status?: number; error?: string } = {},
): void {
  if (byteLength <= DOCUMENTS_MAX_YJS_STATE_BYTES) return
  throw new CrudHttpError(options.status ?? 413, {
    error: options.error ?? 'documents.content.tooLarge',
  })
}

/**
 * Enforce the same bound at API, command, collaboration, and version
 * boundaries. Keeping this check beside persistence prevents an internal or
 * legacy call site from bypassing request validation and creating a snapshot
 * that later exhausts the editor or export worker.
 */
export function assertDocumentContentResourceLimits(
  input: DocumentContentResourceInput,
  options: { status?: number; error?: string } = {},
): void {
  if (input.yjsState) assertDocumentYjsStateByteLength(input.yjsState.byteLength, options)
  if (
    typeof input.contentHtml === 'string'
    && !isUtf8WithinLimit(input.contentHtml, DOCUMENTS_MAX_CONTENT_HTML_BYTES)
  ) {
    throw new CrudHttpError(options.status ?? 413, {
      error: options.error ?? 'documents.content.tooLarge',
    })
  }
  if (
    typeof input.contentText === 'string'
    && !isUtf8WithinLimit(input.contentText, DOCUMENTS_MAX_CONTENT_TEXT_BYTES)
  ) {
    throw new CrudHttpError(options.status ?? 413, {
      error: options.error ?? 'documents.content.tooLarge',
    })
  }
}
