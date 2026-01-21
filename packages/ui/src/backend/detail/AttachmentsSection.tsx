"use client"

import * as React from 'react'
import { Upload, Trash2, File, FileText, FileSpreadsheet, FileArchive, FileAudio, FileVideo, FileCode } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { AttachmentDeleteDialog } from './AttachmentDeleteDialog'
import { AttachmentMetadataDialog, type AttachmentItem, type AttachmentMetadataSavePayload } from './AttachmentMetadataDialog'

type AttachmentsResponse = {
  items?: AttachmentItem[]
  error?: string
}

type Props = {
  entityId: string
  recordId: string | null
  title?: string
  description?: string
  className?: string
  onChanged?: () => void
}

const EXTENSION_ICON_MAP: Record<string, typeof File> = {
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

const MIME_FALLBACK_ICONS: Record<string, typeof File> = {
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

function resolveAttachmentPlaceholder(mimeType?: string | null, fileName?: string | null): { icon: typeof File; label: string } {
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

function formatFileSize(value: number): string {
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

export function AttachmentsSection({
  entityId,
  recordId,
  title,
  description,
  className,
  onChanged,
}: Props) {
  const t = useT()
  const [items, setItems] = React.useState<AttachmentItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [metadataOpen, setMetadataOpen] = React.useState(false)
  const [selectedItem, setSelectedItem] = React.useState<AttachmentItem | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<AttachmentItem | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const load = React.useCallback(async () => {
    if (!recordId) return
    setLoading(true)
    setError(null)
    try {
      const call = await apiCall<AttachmentsResponse>(
        `/api/attachments?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`,
        undefined,
        { fallback: { items: [] } },
      )
      if (!call.ok) {
        const message = call.result?.error || t('attachments.library.errors.load', 'Failed to load attachments.')
        throw new Error(message)
      }
      const payload = call.result ?? { items: [] }
      setItems(Array.isArray(payload.items) ? payload.items : [])
    } catch (err: any) {
      setError(err?.message || t('attachments.library.errors.load', 'Failed to load attachments.'))
    } finally {
      setLoading(false)
    }
  }, [entityId, recordId, t])

  React.useEffect(() => {
    if (recordId) {
      void load()
    } else {
      setItems([])
      setError(null)
    }
  }, [load, recordId])

  const acceptFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length || !recordId) return
      setError(null)
      setIsUploading(true)
      try {
        for (const file of Array.from(files)) {
          const fd = new FormData()
          fd.set('entityId', entityId)
          fd.set('recordId', recordId)
          fd.set('file', file)
          const call = await apiCall<{ ok?: boolean; item?: AttachmentItem; error?: string }>(
            '/api/attachments',
            { method: 'POST', body: fd },
            { fallback: null },
          )
          if (!call.ok) {
            const message = call.result?.error || t('attachments.library.upload.failed', 'Upload failed.')
            throw new Error(message)
          }
        }
        await load()
        onChanged?.()
      } catch (err: any) {
        setError(err?.message || t('attachments.library.upload.failed', 'Upload failed.'))
      } finally {
        setIsUploading(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [entityId, load, onChanged, recordId, t],
  )

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragOver(false)
      void acceptFiles(event.dataTransfer?.files ?? null)
    },
    [acceptFiles],
  )

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
  }, [])

  const openMetadataDialog = React.useCallback((item: AttachmentItem) => {
    setSelectedItem(item)
    setMetadataOpen(true)
  }, [])

  const openDeleteDialog = React.useCallback((item: AttachmentItem) => {
    setDeleteTarget(item)
    setDeleteOpen(true)
  }, [])

  const handleDelete = React.useCallback(async () => {
    if (!deleteTarget) return
    try {
      const call = await apiCall<{ error?: string }>(
        `/api/attachments?id=${encodeURIComponent(deleteTarget.id)}`,
        { method: 'DELETE' },
      )
      if (!call.ok) {
        const message = call.result?.error || t('attachments.library.errors.delete', 'Failed to delete attachment.')
        throw new Error(message)
      }
      setDeleteOpen(false)
      setDeleteTarget(null)
      await load()
      onChanged?.()
    } catch (err: any) {
      setError(err?.message || t('attachments.library.errors.delete', 'Failed to delete attachment.'))
    }
  }, [deleteTarget, load, onChanged, t])

  const handleMetadataSave = React.useCallback(
    async (id: string, payload: AttachmentMetadataSavePayload) => {
      const body: Record<string, unknown> = {
        tags: payload.tags,
        assignments: payload.assignments,
      }
      if (payload.customFields && Object.keys(payload.customFields).length) {
        body.customFields = payload.customFields
      }
      const call = await apiCall<{ error?: string }>(`/api/attachments/library/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!call.ok) {
        const message = call.result?.error || t('attachments.library.metadata.error', 'Failed to update metadata.')
        throw new Error(message)
      }
      setMetadataOpen(false)
      await load()
      onChanged?.()
    },
    [load, onChanged, t],
  )

  const sectionTitle = title ?? t('attachments.library.title', 'Attachments')
  const sectionDescription =
    description ?? t('attachments.library.description', 'Browse, tag, and manage every file stored in this workspace.')

  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-1">
        <div className="text-base font-medium">{sectionTitle}</div>
        <div className="text-sm text-muted-foreground">{sectionDescription}</div>
      </div>

      {!recordId ? (
        <div className="rounded-md border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
          {t('attachments.library.upload.saveFirst', 'Save the record before uploading files.')}
        </div>
      ) : (
        <div
          className={cn(
            'flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition-colors',
            isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30',
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          role="presentation"
        >
          <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            {t('attachments.library.upload.dropHint', 'Drag and drop files here or click to upload.')}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            {isUploading ? t('attachments.library.upload.submitting', 'Uploading…') : t('attachments.library.upload.choose', 'Choose files')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void acceptFiles(event.target.files)}
          />
        </div>
      )}

      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('attachments.library.loading', 'Loading attachments…')}</div>
      ) : items.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const placeholder = resolveAttachmentPlaceholder(item.mimeType ?? null, item.fileName)
            const PlaceholderIcon = placeholder.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openMetadataDialog(item)}
                className="group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-shadow hover:shadow-sm"
              >
                <div className="relative aspect-[4/3] bg-muted">
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt={item.fileName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center text-xs font-semibold uppercase text-muted-foreground">
                      <PlaceholderIcon className="mb-2 h-6 w-6" aria-hidden />
                      {placeholder.label}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation()
                      openDeleteDialog(item)
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className="space-y-1 p-3">
                  <div className="truncate text-sm font-medium" title={item.fileName}>
                    {item.fileName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatFileSize(item.fileSize)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          {t('attachments.library.table.empty', 'No attachments found.')}
        </div>
      )}

      <AttachmentMetadataDialog
        open={metadataOpen}
        onOpenChange={setMetadataOpen}
        item={selectedItem}
        availableTags={[]}
        onSave={handleMetadataSave}
      />
      <AttachmentDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        fileName={deleteTarget?.fileName}
        onConfirm={handleDelete}
        isDeleting={false}
      />
    </div>
  )
}
