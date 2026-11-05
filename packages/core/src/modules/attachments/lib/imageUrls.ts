export type ImageCropType = 'cover' | 'contain'

export type ImageSizeOptions = {
  width?: number
  height?: number
  slug?: string | null
  cropType?: ImageCropType
}

export function slugifyAttachmentFileName(fileName: string | null | undefined, fallback = 'asset'): string {
  if (!fileName || !fileName.trim()) return fallback
  const normalized = fileName.trim()
  const lastDot = normalized.lastIndexOf('.')
  const ext = lastDot > 0 ? normalized.slice(lastDot + 1).toLowerCase() : ''
  const baseSource = (lastDot > 0 ? normalized.slice(0, lastDot) : normalized).toLowerCase()
  let base = ''
  let lastWasDash = false
  for (let i = 0; i < baseSource.length; i += 1) {
    const code = baseSource.charCodeAt(i)
    const isDigit = code >= 48 && code <= 57
    const isLower = code >= 97 && code <= 122
    if (isDigit || isLower) {
      base += baseSource[i]
      lastWasDash = false
      continue
    }
    if (!lastWasDash && base.length > 0) {
      base += '-'
      lastWasDash = true
    }
  }
  while (base.endsWith('-')) base = base.slice(0, -1)
  const slug = base || fallback
  return ext ? `${slug}.${ext}` : slug
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
  if (options?.cropType === 'cover' || options?.cropType === 'contain') {
    params.set('cropType', options.cropType)
  }
  const query = params.toString()
  const slugSegment = options?.slug ? `/${encodeURIComponent(options.slug)}` : ''
  return `/api/attachments/image/${encodeURIComponent(attachmentId)}${slugSegment}${query ? `?${query}` : ''}`
}

export function buildAttachmentFileUrl(attachmentId: string, options?: { download?: boolean }): string {
  if (!attachmentId) return ''
  const params = new URLSearchParams()
  if (options?.download) params.set('download', '1')
  const query = params.toString()
  return `/api/attachments/file/${encodeURIComponent(attachmentId)}${query ? `?${query}` : ''}`
}
