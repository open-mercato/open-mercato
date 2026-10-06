export const VECTOR_IMAGE_MIME_TYPE = 'image/svg+xml'
export const VECTOR_IMAGE_SANITIZER = 'dompurify'
export const VECTOR_IMAGE_POLICY_VERSION = 1
export const VECTOR_IMAGE_METADATA_KEY = 'vectorImage'

const TRUSTED_POLICY_VERSIONS = new Set([VECTOR_IMAGE_POLICY_VERSION])

export type VectorImageRecord = {
  sanitizer: string
  sanitizerVersion: string
  policyVersion: number
  sha256: string
  sanitizedAt: string
}

export type VectorImageRecordHolder = {
  mimeType?: string | null
  storageMetadata?: unknown
}

export function readVectorImageRecord(storageMetadata: unknown): VectorImageRecord | null {
  if (!storageMetadata || typeof storageMetadata !== 'object' || Array.isArray(storageMetadata)) return null
  const record = (storageMetadata as Record<string, unknown>)[VECTOR_IMAGE_METADATA_KEY]
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const candidate = record as Record<string, unknown>
  if (candidate.sanitizer !== VECTOR_IMAGE_SANITIZER) return null
  if (typeof candidate.policyVersion !== 'number' || !TRUSTED_POLICY_VERSIONS.has(candidate.policyVersion)) return null
  if (typeof candidate.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.sha256)) return null
  return {
    sanitizer: candidate.sanitizer,
    sanitizerVersion: typeof candidate.sanitizerVersion === 'string' ? candidate.sanitizerVersion : '',
    policyVersion: candidate.policyVersion,
    sha256: candidate.sha256,
    sanitizedAt: typeof candidate.sanitizedAt === 'string' ? candidate.sanitizedAt : '',
  }
}

/**
 * True when a row claims to be a sanitised vector image: SVG MIME type and a
 * well-formed record of a known sanitiser and policy. Cheap and free of
 * server-only imports, so list views can use it to pick a preview URL;
 * serving still verifies the digest against the stored bytes.
 */
export function hasVectorImageRecord(attachment: VectorImageRecordHolder): boolean {
  if (String(attachment.mimeType ?? '').trim().toLowerCase() !== VECTOR_IMAGE_MIME_TYPE) return false
  return readVectorImageRecord(attachment.storageMetadata) !== null
}
