import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  DOCUMENTS_MAX_CONTENT_HTML_BYTES,
  DOCUMENTS_MAX_CONTENT_TEXT_BYTES,
} from './resourceLimits'

const KIBIBYTE = 1024
const MEBIBYTE = 1024 * KIBIBYTE
const JSON_ESCAPE_EXPANSION = 6
const STREAM_INITIAL_CAPACITY = 64 * KIBIBYTE

export const DOCUMENTS_REQUEST_BODY_TOO_LARGE = 'documents.errors.requestBodyTooLarge'

/**
 * Request-level limits are intentionally larger than the decoded field limits.
 * JSON may encode one input byte as a six-byte `\uXXXX` escape, so content
 * routes retain every payload accepted by their existing schemas while still
 * bounding buffering before JSON.parse runs.
 */
export const DOCUMENTS_JSON_BODY_LIMITS = {
  standard: 128 * KIBIBYTE,
  template: 4 * MEBIBYTE,
  templateRender: 4 * MEBIBYTE,
  content: (
    JSON_ESCAPE_EXPANSION
    * (DOCUMENTS_MAX_CONTENT_HTML_BYTES + DOCUMENTS_MAX_CONTENT_TEXT_BYTES)
  ) + (256 * KIBIBYTE),
  exportSnapshot: (JSON_ESCAPE_EXPANSION * DOCUMENTS_MAX_CONTENT_HTML_BYTES) + (64 * KIBIBYTE),
} as const

function payloadTooLarge(): CrudHttpError {
  return new CrudHttpError(413, { error: DOCUMENTS_REQUEST_BODY_TOO_LARGE })
}

function declaredContentLength(request: Request): number | null {
  const value = request.headers.get('content-length')?.trim()
  if (!value || !/^\d+$/.test(value)) return null
  const declaredBytes = Number(value)
  return Number.isSafeInteger(declaredBytes) ? declaredBytes : Number.POSITIVE_INFINITY
}

function growBuffer(current: Uint8Array, requiredBytes: number, maxBytes: number): Uint8Array {
  let capacity = Math.max(1, current.byteLength)
  while (capacity < requiredBytes) capacity = Math.min(maxBytes, capacity * 2)
  const next = new Uint8Array(capacity)
  next.set(current)
  return next
}

export async function readBoundedJsonBody<T>(
  request: Request,
  maxBytes: number,
  fallback: T | null = null,
): Promise<T | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive safe integer')
  }
  const contentLength = declaredContentLength(request)
  if (contentLength !== null && contentLength > maxBytes) {
    await request.body?.cancel().catch(() => undefined)
    throw payloadTooLarge()
  }
  if (!request.body) return fallback

  const reader = request.body.getReader()
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(
    Math.min(maxBytes, STREAM_INITIAL_CAPACITY),
  )
  let byteLength = 0

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      const nextByteLength = byteLength + chunk.value.byteLength
      if (nextByteLength > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw payloadTooLarge()
      }
      if (nextByteLength > buffer.byteLength) {
        buffer = growBuffer(buffer, nextByteLength, maxBytes)
      }
      buffer.set(chunk.value, byteLength)
      byteLength = nextByteLength
    }
  } finally {
    reader.releaseLock()
  }

  if (byteLength === 0) return fallback
  const raw = new TextDecoder().decode(buffer.subarray(0, byteLength))
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
