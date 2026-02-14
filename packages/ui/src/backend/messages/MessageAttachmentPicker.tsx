"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Loader2, Paperclip, Upload } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { apiCall } from '../utils/apiCall'

export type MessageAttachmentPickerItem = {
  id: string
  fileName: string
  fileSize: number
  mimeType?: string | null
  url: string
}

type MessageAttachmentPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityId: string
  recordId: string
  selectedAttachments: MessageAttachmentPickerItem[]
  onConfirm: (items: MessageAttachmentPickerItem[]) => void
  triggerRef?: React.RefObject<HTMLElement | null>
  maxAttachments?: number
}

type AttachmentListResponse = {
  items?: MessageAttachmentPickerItem[]
}

function toErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = toErrorMessage(item)
      if (nested) return nested
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      toErrorMessage(record.error)
      ?? toErrorMessage(record.message)
      ?? toErrorMessage(record.detail)
      ?? toErrorMessage(record.details)
      ?? null
    )
  }
  return null
}

export function MessageAttachmentPicker({
  open,
  onOpenChange,
  entityId,
  recordId,
  selectedAttachments,
  onConfirm,
  triggerRef,
  maxAttachments = 100,
}: MessageAttachmentPickerProps) {
  const t = useT()
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const wasOpenRef = React.useRef(false)

  const attachmentsQuery = useQuery({
    queryKey: ['messages', 'attachment-picker', entityId, recordId],
    enabled: open && Boolean(entityId) && Boolean(recordId),
    staleTime: 10 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('entityId', entityId)
      params.set('recordId', recordId)
      const call = await apiCall<AttachmentListResponse>(`/api/attachments?${params.toString()}`)
      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.loadAttachmentOptionsFailed', 'Failed to load attachments.'),
        )
      }
      return Array.isArray(call.result?.items) ? call.result?.items ?? [] : []
    },
  })

  const items = attachmentsQuery.data ?? []
  const itemMap = React.useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  React.useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        window.setTimeout(() => {
          triggerRef?.current?.focus()
        }, 0)
      }
      wasOpenRef.current = false
      return
    }

    wasOpenRef.current = true
    setSelectedIds(selectedAttachments.map((item) => item.id))
    setUploadError(null)
  }, [open, selectedAttachments, triggerRef])

  const toggleSelected = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((entry) => entry !== id)
      if (prev.length >= maxAttachments) return prev
      return [...prev, id]
    })
  }, [maxAttachments])

  const handleUpload = React.useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)

    const uploadedIds: string[] = []

    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.set('entityId', entityId)
        formData.set('recordId', recordId)
        formData.set('file', file)

        const call = await apiCall<{ item?: MessageAttachmentPickerItem }>(
          '/api/attachments',
          {
            method: 'POST',
            body: formData,
          },
        )

        if (!call.ok || !call.result?.item?.id) {
          const message = toErrorMessage(call.result)
            ?? t('messages.errors.uploadAttachmentFailed', 'Failed to upload attachment.')
          throw new Error(message)
        }

        uploadedIds.push(call.result.item.id)
      }

      await attachmentsQuery.refetch()
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const id of uploadedIds) next.add(id)
        return Array.from(next).slice(0, maxAttachments)
      })
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : t('messages.errors.uploadAttachmentFailed', 'Failed to upload attachment.'),
      )
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [attachmentsQuery, entityId, maxAttachments, recordId, t])

  const handleCancel = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleConfirm = React.useCallback(() => {
    const existingMap = new Map(selectedAttachments.map((item) => [item.id, item]))
    const next = selectedIds
      .map((id) => itemMap.get(id) ?? existingMap.get(id))
      .filter((item): item is MessageAttachmentPickerItem => Boolean(item))

    onConfirm(next)
    onOpenChange(false)
  }, [itemMap, onConfirm, onOpenChange, selectedAttachments, selectedIds])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleConfirm()
    }
  }, [handleCancel, handleConfirm])

  const selectedLimitReached = selectedIds.length >= maxAttachments

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('messages.composer.attachmentPicker.title', 'Attach files')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void handleUpload(event.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || selectedLimitReached}
            >
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {t('messages.composer.attachmentPicker.upload', 'Upload files')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t('messages.composer.attachmentPicker.limit', 'You can attach up to {count} files.', { count: maxAttachments })}
            </p>
          </div>

          {selectedLimitReached ? (
            <p className="text-xs text-amber-700">
              {t('messages.composer.attachmentPicker.maxWarning', 'Attachment limit reached.')}
            </p>
          ) : null}

          {uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : null}

          {attachmentsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">
              {t('messages.composer.attachmentPicker.loading', 'Loading attachments...')}
            </p>
          ) : null}

          {attachmentsQuery.error ? (
            <div className="space-y-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <p>
                {attachmentsQuery.error instanceof Error
                  ? attachmentsQuery.error.message
                  : t('messages.errors.loadAttachmentOptionsFailed', 'Failed to load attachments.')}
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => void attachmentsQuery.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            </div>
          ) : null}

          {!attachmentsQuery.isLoading && !attachmentsQuery.error && items.length === 0 ? (
            <p className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {t('messages.composer.attachmentPicker.empty', 'No files uploaded yet.')}
            </p>
          ) : null}

          {items.length > 0 ? (
            <div className="space-y-2 rounded border p-2">
              {items.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 hover:bg-muted/60"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {Math.max(1, Math.round(item.fileSize / 1024))} KB
                      {item.mimeType ? ` • ${item.mimeType}` : ''}
                    </p>
                  </div>
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancel}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleConfirm}>
            {t('messages.composer.attachmentPicker.confirm', 'Attach selected')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
