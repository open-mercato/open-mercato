const DEFAULT_ATTACHMENT_MAX_UPLOAD_MB = 25
const DEFAULT_ATTACHMENT_TENANT_QUOTA_MB = 512
const MULTIPART_CONTENT_LENGTH_OVERHEAD_BYTES = 1024 * 1024

function parseMegabytesEnv(name: string, fallbackMb: number): number {
  const raw = process.env[name]
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return fallbackMb
}

export function resolveDefaultAttachmentMaxUploadBytes(): number {
  return Math.floor(parseMegabytesEnv('OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB', DEFAULT_ATTACHMENT_MAX_UPLOAD_MB) * 1024 * 1024)
}

export function resolveAttachmentTenantQuotaBytes(): number {
  return Math.floor(parseMegabytesEnv('OPENMERCATO_ATTACHMENT_TENANT_QUOTA_MB', DEFAULT_ATTACHMENT_TENANT_QUOTA_MB) * 1024 * 1024)
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

export function willExceedAttachmentTenantQuota(currentUsageBytes: number, incomingFileBytes: number): boolean {
  return (currentUsageBytes + incomingFileBytes) > resolveAttachmentTenantQuotaBytes()
}
