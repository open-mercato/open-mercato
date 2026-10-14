/**
 * Client-safe utility functions for the checkout module.
 * MUST NOT import from data/entities or any server-only module.
 */

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/**
 * The pay page's logo URL. It is served by the checkout module itself, so an
 * anonymous visitor can load it: the attachments routes require a signed-in
 * user for tenant-scoped files.
 */
export function buildCheckoutPublicLogoUrl(slug: string, options?: { preview?: boolean }): string {
  const query = options?.preview ? '?preview=true' : ''
  return `/api/checkout/pay/${encodeURIComponent(slug)}/logo${query}`
}

export function buildCheckoutAttachmentPreviewUrl(attachmentId: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(attachmentId)
  if (!normalized) return null
  return `/api/attachments/image/${encodeURIComponent(normalized)}?width=640&height=240&cropType=contain`
}
