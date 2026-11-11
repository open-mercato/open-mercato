/**
 * Pure upload-gate helpers — W4 (SEC-4).
 *
 * No I/O, no DI. Used by the attachment service / API routes to enforce the
 * MIME allowlist and size ceilings BEFORE any bytes are persisted. The server
 * is always authoritative; the renderer mirrors these checks only for UX.
 */

/** Default server-side hard ceiling (10 MiB) when `FORMS_MAX_UPLOAD_BYTES` is unset/invalid. */
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export type UploadGateInput = {
  contentType: string
  sizeBytes: number
  /** Field-configured MIME allowlist (`x-om-accept`). Empty ⇒ any type allowed. */
  accept?: string[] | null
  /** Field-configured max size (`x-om-max-size-bytes`). */
  fieldMaxSizeBytes?: number | null
  /** Server-side hard ceiling (env `FORMS_MAX_UPLOAD_BYTES`). */
  hardCeilingBytes: number
}

export type UploadGateResult =
  | { ok: true }
  | { ok: false; code: 'EMPTY' | 'TOO_LARGE'; status: 413; message: string }
  | { ok: false; code: 'DISALLOWED_TYPE'; status: 422; message: string }

/**
 * Resolves the server-side hard upload ceiling from the environment. Falls
 * back to {@link DEFAULT_MAX_UPLOAD_BYTES} when unset, non-numeric, or <= 0.
 */
export function resolveMaxUploadBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FORMS_MAX_UPLOAD_BYTES
  if (typeof raw !== 'string' || raw.trim().length === 0) return DEFAULT_MAX_UPLOAD_BYTES
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_UPLOAD_BYTES
  return parsed
}

/**
 * Matches a concrete content-type against an allowlist entry. Supports exact
 * matches and wildcard subtypes (`image/*`).
 */
function matchesAcceptEntry(contentType: string, entry: string): boolean {
  const normalizedType = contentType.trim().toLowerCase()
  const normalizedEntry = entry.trim().toLowerCase()
  if (normalizedEntry.length === 0) return false
  if (normalizedEntry === '*/*') return true
  if (normalizedEntry.endsWith('/*')) {
    const prefix = normalizedEntry.slice(0, normalizedEntry.length - 1) // keep trailing slash
    return normalizedType.startsWith(prefix)
  }
  return normalizedType === normalizedEntry
}

export function isContentTypeAllowed(contentType: string, accept?: string[] | null): boolean {
  if (!accept || accept.length === 0) return true
  return accept.some((entry) => matchesAcceptEntry(contentType, entry))
}

/**
 * Enforces empty / size / MIME rules. The effective size cap is the smaller of
 * the field-configured cap and the server hard ceiling; the server ceiling
 * always wins even if the field config is larger or absent.
 */
export function evaluateUploadGate(input: UploadGateInput): UploadGateResult {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, code: 'EMPTY', status: 413, message: 'Uploaded file is empty.' }
  }
  const fieldCap =
    typeof input.fieldMaxSizeBytes === 'number'
      && Number.isFinite(input.fieldMaxSizeBytes)
      && input.fieldMaxSizeBytes > 0
      ? input.fieldMaxSizeBytes
      : null
  const effectiveCap = fieldCap === null ? input.hardCeilingBytes : Math.min(fieldCap, input.hardCeilingBytes)
  if (input.sizeBytes > effectiveCap) {
    return {
      ok: false,
      code: 'TOO_LARGE',
      status: 413,
      message: `File exceeds the maximum allowed size of ${effectiveCap} bytes.`,
    }
  }
  if (!isContentTypeAllowed(input.contentType, input.accept)) {
    return {
      ok: false,
      code: 'DISALLOWED_TYPE',
      status: 422,
      message: `Content type "${input.contentType}" is not allowed for this field.`,
    }
  }
  return { ok: true }
}
