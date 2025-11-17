"use client"

import * as React from 'react'
import { Upload, Image as ImageIcon, Trash2, Star } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@/lib/i18n/context'
import { buildAttachmentImageUrl } from '@open-mercato/core/modules/attachments/lib/imageUrls'

export type ProductMediaItem = {
  id: string
  url: string
  fileName: string
  fileSize: number
  thumbnailUrl?: string | null
}

type Props = {
  entityId: string
  draftRecordId: string
  items: ProductMediaItem[]
  defaultMediaId: string | null
  onItemsChange: (items: ProductMediaItem[]) => void
  onDefaultChange: (attachmentId: string | null) => void
}

function humanFileSize(size: number): string {
  if (!Number.isFinite(size)) return `${size}`
  const units = ['B', 'KB', 'MB', 'GB']
  let idx = 0
  let value = size
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx++
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

export function ProductMediaManager({
  entityId,
  draftRecordId,
  items,
  defaultMediaId,
  onItemsChange,
  onDefaultChange,
}: Props) {
  const t = useT()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isUploading, setUploading] = React.useState(false)
  const [isDragOver, setDragOver] = React.useState(false)

  const acceptFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length || !draftRecordId) return
      setError(null)
      setUploading(true)
      let nextItems = items
      let defaultId = defaultMediaId
      try {
        for (const file of Array.from(files)) {
          if (!file.type.startsWith('image/')) {
            setError(t('catalog.products.media.errors.imagesOnly', 'Only image files are supported.'))
            continue
          }
          const fd = new FormData()
          fd.set('entityId', entityId)
          fd.set('recordId', draftRecordId)
          fd.set('file', file)
          const call = await apiCall<{ ok?: boolean; item?: ProductMediaItem; error?: string }>(
            '/api/attachments',
            { method: 'POST', body: fd },
            { fallback: null },
          )
          if (!call.ok || !call.result?.item) {
            const message = call.result?.error ?? t('catalog.products.media.errors.uploadFailed', 'Upload failed.')
            setError(message)
            break
          }
          const existingIds = new Set(nextItems.map((entry) => entry.id))
          if (existingIds.has(call.result.item.id)) continue
          const uploaded = {
            ...call.result.item,
            thumbnailUrl:
              call.result.item.thumbnailUrl ??
              buildAttachmentImageUrl(call.result.item.id, { width: 360, height: 360 }),
          }
          nextItems = [...nextItems, uploaded]
          if (!defaultId) {
            defaultId = uploaded.id
          }
        }
        if (nextItems !== items) {
          onItemsChange(nextItems)
        }
        if (!defaultMediaId && defaultId) {
          onDefaultChange(defaultId)
        }
      } finally {
        setUploading(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [defaultMediaId, draftRecordId, entityId, items, onDefaultChange, onItemsChange, t],
  )

  const handleRemove = React.useCallback(
    async (attachmentId: string) => {
      setError(null)
      const call = await apiCall<{ ok?: boolean; error?: string }>(
        `/api/attachments?id=${encodeURIComponent(attachmentId)}`,
        { method: 'DELETE' },
        { fallback: null },
      )
      if (!call.ok) {
        setError(call.result?.error ?? t('catalog.products.media.errors.deleteFailed', 'Failed to delete media.'))
        return
      }
      const next = items.filter((item) => item.id !== attachmentId)
      onItemsChange(next)
      if (defaultMediaId === attachmentId) {
        onDefaultChange(next[0]?.id ?? null)
      }
    },
    [defaultMediaId, items, onDefaultChange, onItemsChange, t],
  )

  const onDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setDragOver(false)
      void acceptFiles(event.dataTransfer?.files ?? null)
    },
    [acceptFiles],
  )

  const onDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(true)
  }, [])

  const onDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)
  }, [])

  const pickFiles = React.useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">{t('catalog.products.media.label', 'Media')}</label>
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition-colors',
          isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30',
        )}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        role="presentation"
      >
        <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          {t('catalog.products.media.dropHint', 'Drag and drop images here or click to upload.')}
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={pickFiles} disabled={isUploading}>
          {isUploading ? t('catalog.products.media.uploading', 'Uploading…') : t('catalog.products.media.choose', 'Choose files')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => void acceptFiles(event.target.files)}
        />
      </div>
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {items.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item) => {
            const isDefault = defaultMediaId === item.id
            const thumbnail = item.thumbnailUrl || buildAttachmentImageUrl(item.id, { width: 360, height: 360 })
            return (
              <div key={item.id} className="flex flex-col rounded-md border bg-card">
                <div className="relative aspect-square overflow-hidden rounded-t-md bg-muted">
                  {thumbnail ? (
                    <img src={thumbnail} alt={item.fileName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                  <div className="absolute right-1 top-1 flex gap-1">
                    <Button
                      type="button"
                      variant={isDefault ? 'default' : 'secondary'}
                      size="icon"
                      className={cn('h-7 w-7', isDefault ? '' : 'opacity-80')}
                      onClick={() => onDefaultChange(item.id)}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="secondary" size="icon" className="h-7 w-7" onClick={() => void handleRemove(item.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="p-2">
                  <p className="line-clamp-1 text-sm font-medium">{item.fileName}</p>
                  <p className="text-xs text-muted-foreground">{humanFileSize(item.fileSize)}</p>
                  {isDefault ? (
                    <p className="text-xs font-semibold text-primary">
                      {t('catalog.products.media.default', 'Default preview')}
                    </p>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.media.empty', 'No media uploaded yet.')}
        </p>
      )}
    </div>
  )
}
