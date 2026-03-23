"use client"

import * as React from 'react'
import { ImagePlus, Link2, Loader2, Paperclip, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { buildCheckoutAttachmentPreviewUrl } from '../lib/client-utils'

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
  error?: string
  onChange: (next: { logoAttachmentId: string | null; logoUrl: string | null }) => void
}

function resolvePreviewUrl(attachmentId: string | null | undefined, logoUrl: string | null | undefined): string | null {
  return buildCheckoutAttachmentPreviewUrl(attachmentId) ?? (typeof logoUrl === 'string' && logoUrl.trim().length > 0 ? logoUrl.trim() : null)
}

export function LogoUploadField({ entityId, recordId, attachmentId, logoUrl, error: externalError, onChange }: Props) {
  const t = useT()
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
          const message = call.result?.error || t('checkout.logoUpload.errors.upload')
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
        setError(uploadError instanceof Error ? uploadError.message : t('checkout.logoUpload.errors.upload'))
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
      setError(removeError instanceof Error ? removeError.message : t('checkout.logoUpload.errors.remove'))
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
            {t('checkout.logoUpload.title')}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('checkout.logoUpload.description')}
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
            {uploading ? t('checkout.logoUpload.actions.uploading') : t('checkout.logoUpload.actions.attach')}
          </Button>
          {attachmentId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRemoveUpload()}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('checkout.logoUpload.actions.removeUpload')}
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
          <img src={previewUrl} alt={t('checkout.logoUpload.previewAlt')} className="max-h-24 w-auto object-contain" />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImagePlus className="h-4 w-4" />
            {t('checkout.logoUpload.empty')}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          {t('checkout.logoUpload.externalUrl')}
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
          placeholder={t('checkout.logoUpload.externalUrlPlaceholder')}
        />
      </div>

      {attachmentId ? (
        <Notice compact>
          {t('checkout.logoUpload.notices.attachmentWins')}
        </Notice>
      ) : null}
      {externalError ? <p className="text-xs text-destructive">{externalError}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

export default LogoUploadField
