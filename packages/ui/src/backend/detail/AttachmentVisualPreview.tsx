"use client"

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

const EXTENSION_ICON_MAP: Record<string, LucideIcon> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  md: FileText,
  rtf: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  ods: FileSpreadsheet,
  ppt: FileText,
  pptx: FileText,
  zip: FileArchive,
  gz: FileArchive,
  rar: FileArchive,
  tgz: FileArchive,
  '7z': FileArchive,
  tar: FileArchive,
  json: FileCode,
  js: FileCode,
  ts: FileCode,
  jsx: FileCode,
  tsx: FileCode,
  html: FileCode,
  css: FileCode,
  xml: FileCode,
  yaml: FileCode,
  yml: FileCode,
  mp3: FileAudio,
  wav: FileAudio,
  flac: FileAudio,
  ogg: FileAudio,
  mp4: FileVideo,
  mov: FileVideo,
  avi: FileVideo,
  webm: FileVideo,
}

const MIME_FALLBACK_ICONS: Record<string, LucideIcon> = {
  audio: FileAudio,
  video: FileVideo,
  text: FileText,
  application: FileText,
}

function resolveFileExtension(fileName?: string | null): string {
  if (!fileName) return ''
  const normalized = fileName.trim()
  if (!normalized) return ''
  const lastDot = normalized.lastIndexOf('.')
  if (lastDot === -1 || lastDot === normalized.length - 1) return ''
  return normalized.slice(lastDot + 1).toLowerCase()
}

function resolveAttachmentPlaceholder(
  mimeType?: string | null,
  fileName?: string | null,
): { icon: LucideIcon; label: string } {
  const extension = resolveFileExtension(fileName)
  const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : ''
  if (extension && EXTENSION_ICON_MAP[extension]) {
    return { icon: EXTENSION_ICON_MAP[extension], label: extension.toUpperCase() }
  }
  if (!extension && normalizedMime.includes('pdf')) {
    return { icon: FileText, label: 'PDF' }
  }
  if (!extension && normalizedMime.includes('zip')) {
    return { icon: FileArchive, label: 'ZIP' }
  }
  if (!extension && normalizedMime.includes('json')) {
    return { icon: FileCode, label: 'JSON' }
  }
  const mimeRoot = normalizedMime.split('/')[0] || ''
  if (mimeRoot && MIME_FALLBACK_ICONS[mimeRoot]) {
    return { icon: MIME_FALLBACK_ICONS[mimeRoot], label: mimeRoot.toUpperCase() }
  }
  const fallbackSource = extension || mimeRoot || 'file'
  const fallbackLabel = fallbackSource.slice(0, 6).toUpperCase()
  return { icon: File, label: fallbackLabel }
}

export function formatAttachmentFileSize(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let idx = 0
  let current = value
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024
    idx += 1
  }
  return `${current.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

type AttachmentVisualPreviewProps = {
  mimeType?: string | null
  fileName?: string | null
  thumbnailUrl?: string | null
  alt?: string
  className?: string
  imageClassName?: string
  iconClassName?: string
  labelClassName?: string
  overlay?: React.ReactNode
}

export function AttachmentVisualPreview(props: AttachmentVisualPreviewProps) {
  const [imageLoadFailed, setImageLoadFailed] = React.useState(false)
  const placeholder = React.useMemo(
    () => resolveAttachmentPlaceholder(props.mimeType, props.fileName),
    [props.fileName, props.mimeType],
  )

  React.useEffect(() => {
    setImageLoadFailed(false)
  }, [props.thumbnailUrl])

  const PlaceholderIcon = placeholder.icon
  const showThumbnail = Boolean(props.thumbnailUrl) && !imageLoadFailed

  return (
    <div className={cn('relative bg-muted', props.className)}>
      {showThumbnail ? (
        <img
          src={props.thumbnailUrl ?? undefined}
          alt={props.alt ?? props.fileName ?? 'Attachment preview'}
          className={cn('h-full w-full object-cover', props.imageClassName)}
          onError={() => setImageLoadFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center text-xs font-semibold uppercase text-muted-foreground">
          <PlaceholderIcon className={cn('mb-2 h-6 w-6', props.iconClassName)} aria-hidden />
          <span className={props.labelClassName}>{placeholder.label}</span>
        </div>
      )}
      {props.overlay}
    </div>
  )
}
