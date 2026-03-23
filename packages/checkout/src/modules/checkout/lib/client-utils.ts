/**
 * Client-safe utility functions for the checkout module.
 * MUST NOT import from data/entities or any server-only module.
 */

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function buildCheckoutAttachmentPreviewUrl(attachmentId: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(attachmentId)
  if (!normalized) return null
  return `/api/attachments/image/${encodeURIComponent(normalized)}?width=640&height=240&cropType=contain`
}
