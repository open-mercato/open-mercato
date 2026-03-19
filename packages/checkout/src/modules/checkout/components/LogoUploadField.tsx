"use client"

import * as React from 'react'
import { ImagePlus, Link2, Loader2, Paperclip, Trash2 } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { buildCheckoutAttachmentPreviewUrl } from '../lib/utils'

type UploadResponse = {
  item?: {
    id?: string
    url?: string
    thumbnailUrl?: string
  }
  error?: string
}

type Props = {
  entityId: string
  recordId: string
  attachmentId: string | null | undefined
  logoUrl: string | null | undefined
  onChange: (next: { logoAttachmentId: string | null; logoUrl: string | null }) => void
}

function resolvePreviewUrl(attachmentId: string | null | undefined, logoUrl: string | null | undefined): string | null {
  return buildCheckoutAttachmentPreviewUrl(attachmentId) ?? (typeof logoUrl === 'string' && logoUrl.trim().length > 0 ? logoUrl.trim() : null)
}

export function LogoUploadField({ entityId, recordId, attachmentId, logoUrl, onChange }: Props) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(() => resolvePreviewUrl(attachmentId, logoUrl))

  React.useEffect(() => {
    setPreviewUrl(resolvePreviewUrl(attachmentId, logoUrl))
  }, [attachmentId, logoUrl])

  const deleteAttachment = React.useCallback(async (targetId: string | null | undefined) => {
    if (!targetId) return
    await apiCall(`/api/attachments?id=${encodeURIComponent(targetId)}`, { method: 'DELETE' })
  }, [])

  const handleUpload = React.useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      setUploading(true)
      setError(null)
      try {
        const previousAttachmentId = attachmentId
        const formData = new FormData()
        formData.set('entityId', entityId)
        formData.set('recordId', recordId)
        formData.set('file', file)
        const call = await apiCall<UploadResponse>('/api/attachments', {
          method: 'POST',
          body: formData,
        })
        if (!call.ok || !call.result?.item?.id) {
          const message = call.result?.error || 'Failed to upload logo.'
          throw new Error(message)
        }
        const nextAttachmentId = call.result.item.id
        setPreviewUrl(call.result.item.thumbnailUrl ?? buildCheckoutAttachmentPreviewUrl(nextAttachmentId) ?? call.result.item.url ?? null)
        onChange({
          logoAttachmentId: nextAttachmentId,
          logoUrl: logoUrl ?? null,
        })
        if (previousAttachmentId && previousAttachmentId !== nextAttachmentId) {
          await deleteAttachment(previousAttachmentId)
        }
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload logo.')
      } finally {
        setUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [attachmentId, deleteAttachment, entityId, logoUrl, onChange, recordId],
  )

  const handleRemoveUpload = React.useCallback(async () => {
    setError(null)
    try {
      if (attachmentId) {
        await deleteAttachment(attachmentId)
      }
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Failed to remove the uploaded logo.')
    }
    setPreviewUrl(resolvePreviewUrl(null, logoUrl))
    onChange({ logoAttachmentId: null, logoUrl: logoUrl ?? null })
  }, [attachmentId, deleteAttachment, logoUrl, onChange])

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ImagePlus className="h-4 w-4 text-muted-foreground" />
            Logo
          </div>
          <p className="text-xs text-muted-foreground">
            Upload a logo to attachments or keep using an external URL.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Paperclip className="mr-2 h-4 w-4" />}
            {uploading ? 'Uploading…' : 'Attach logo'}
          </Button>
          {attachmentId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRemoveUpload()}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove upload
            </Button>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleUpload(event.target.files)}
      />

      <div className="rounded-lg border border-dashed border-border/70 bg-background px-4 py-6">
        {previewUrl ? (
          <img src={previewUrl} alt="Checkout logo preview" className="max-h-24 w-auto object-contain" />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImagePlus className="h-4 w-4" />
            No logo selected yet.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          External logo URL
        </Label>
        <Input
          value={logoUrl ?? ''}
          onChange={(event) => {
            setError(null)
            onChange({
              logoAttachmentId: attachmentId ?? null,
              logoUrl: event.target.value || null,
            })
          }}
          placeholder="https://example.com/logo.png"
        />
      </div>

      {attachmentId ? (
        <Notice compact>
          The uploaded attachment is used first. Remove it if you want to fall back to the external URL.
        </Notice>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

export default LogoUploadField
