const DEFAULT_ATTACHMENT_MAX_UPLOAD_MB = 25
const DEFAULT_ATTACHMENT_TENANT_QUOTA_MB = 512
const MULTIPART_CONTENT_LENGTH_OVERHEAD_BYTES = 1024 * 1024
const ATTACHMENT_MAX_UPLOAD_MB_ENV_KEYS = [
  'OM_ATTACHMENT_MAX_UPLOAD_MB',
  'OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB',
] as const
const ATTACHMENT_TENANT_QUOTA_MB_ENV_KEYS = [
  'OM_ATTACHMENT_TENANT_QUOTA_MB',
  'OPENMERCATO_ATTACHMENT_TENANT_QUOTA_MB',
] as const

function readEnvValue(names: readonly string[]): string | undefined {
  return names.map((name) => process.env[name]).find((value) => typeof value === 'string')
}

function parseMegabytesEnv(names: readonly string[], fallbackMb: number): number {
  const raw = readEnvValue(names)
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return fallbackMb
}

export function resolveDefaultAttachmentMaxUploadBytes(): number {
  return Math.floor(parseMegabytesEnv(ATTACHMENT_MAX_UPLOAD_MB_ENV_KEYS, DEFAULT_ATTACHMENT_MAX_UPLOAD_MB) * 1024 * 1024)
}

export function resolveAttachmentTenantQuotaBytes(): number {
  return Math.floor(parseMegabytesEnv(ATTACHMENT_TENANT_QUOTA_MB_ENV_KEYS, DEFAULT_ATTACHMENT_TENANT_QUOTA_MB) * 1024 * 1024)
}

export function resolveAttachmentMaxBytes(fieldMaxAttachmentSizeMb?: number | null): number {
  const defaultMaxBytes = resolveDefaultAttachmentMaxUploadBytes()
  if (typeof fieldMaxAttachmentSizeMb !== 'number' || fieldMaxAttachmentSizeMb <= 0) {
    return defaultMaxBytes
  }
  return Math.min(defaultMaxBytes, Math.floor(fieldMaxAttachmentSizeMb * 1024 * 1024))
}

export function isMultipartRequestWithinUploadLimit(contentLengthHeader: string | null): boolean {
  if (!contentLengthHeader) return true
  const contentLength = Number(contentLengthHeader)
  if (!Number.isFinite(contentLength) || contentLength <= 0) return true
  return contentLength <= (resolveDefaultAttachmentMaxUploadBytes() + MULTIPART_CONTENT_LENGTH_OVERHEAD_BYTES)
}

export class MultipartUploadLimitError extends Error {
  constructor() {
    super('Multipart request exceeds the maximum upload size.')
    this.name = 'MultipartUploadLimitError'
  }
}

export function isMultipartUploadLimitError(error: unknown): error is MultipartUploadLimitError {
  return error instanceof MultipartUploadLimitError
}

export async function parseMultipartFormDataWithinUploadLimit(request: Request): Promise<FormData> {
  if (!isMultipartRequestWithinUploadLimit(request.headers.get('content-length'))) {
    throw new MultipartUploadLimitError()
  }

  if (!request.body) return request.formData()

  const maxBytes = resolveDefaultAttachmentMaxUploadBytes() + MULTIPART_CONTENT_LENGTH_OVERHEAD_BYTES
  let consumedBytes = 0
  const boundedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      consumedBytes += chunk.byteLength
      if (consumedBytes > maxBytes) {
        controller.error(new MultipartUploadLimitError())
        return
      }
      controller.enqueue(chunk)
    },
  }))
  const contentType = request.headers.get('content-type')
  const headers = contentType ? { 'content-type': contentType } : undefined
  return new Response(boundedBody, { headers }).formData()
}

export function willExceedAttachmentTenantQuota(currentUsageBytes: number, incomingFileBytes: number): boolean {
  return (currentUsageBytes + incomingFileBytes) > resolveAttachmentTenantQuotaBytes()
}
