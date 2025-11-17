export type ImageSizeOptions = {
  width?: number
  height?: number
}

export function buildAttachmentImageUrl(attachmentId: string, options?: ImageSizeOptions): string {
  if (!attachmentId) return ''
  const params = new URLSearchParams()
  if (options?.width && Number.isFinite(options.width)) {
    params.set('width', String(Math.max(1, Math.floor(options.width))))
  }
  if (options?.height && Number.isFinite(options.height)) {
    params.set('height', String(Math.max(1, Math.floor(options.height))))
  }
  const query = params.toString()
  return `/api/attachments/image/${encodeURIComponent(attachmentId)}${query ? `?${query}` : ''}`
}
