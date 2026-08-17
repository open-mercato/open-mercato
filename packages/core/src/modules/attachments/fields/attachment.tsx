"use client"
import * as React from 'react'
import { FieldRegistry } from '@open-mercato/ui/backend/fields/registry'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RefreshCw, Trash2, Upload } from 'lucide-react'

function humanSize(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const units = ['B','KB','MB','GB']
  let i = 0
  let x = n
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++ }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

type AttachmentsResponse = {
  items?: Array<{ id: string; url: string; fileName: string; fileSize: number }>
  error?: string
}

type AttachmentItem = NonNullable<AttachmentsResponse['items']>[number]

type AttachmentFieldDef = CustomFieldDefDto & {
  configJson?: {
    maxAttachmentSizeMb?: number
    acceptExtensions?: string[]
    partitionCode?: string
  }
}

type AttachmentDefEditorPatch = {
  maxAttachmentSizeMb?: number
  acceptExtensions?: string[]
  partitionCode?: string
}

function buildAcceptAttribute(def?: AttachmentFieldDef): string | undefined {
  if (!Array.isArray(def?.acceptExtensions) || def.acceptExtensions.length === 0) return undefined
  const values = def.acceptExtensions
    .map((entry) => String(entry ?? '').trim().replace(/^\./, ''))
    .filter((entry) => entry.length > 0)
  if (values.length === 0) return undefined
  return values.map((entry) => `.${entry}`).join(',')
}

export const AttachmentInput = ({
  entityId,
  recordId,
  def,
  disabled,
  allowDelete = false,
  allowReplace = false,
  onCountChange,
  onUploaded,
}: {
  entityId?: string
  recordId?: string
  def?: AttachmentFieldDef
  disabled?: boolean
  allowDelete?: boolean
  allowReplace?: boolean
  // Optional: notified with the current attachment count after each load so a host page can keep
  // a derived badge (e.g. a tab count) in sync without a full reload. Additive/backward-compatible.
  onCountChange?: (count: number) => void
  onUploaded?: () => void
}) => {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `attachment-input:${entityId ?? 'unknown'}:${recordId ?? 'pending'}`,
    blockedMessage: t('attachments.library.errors.saveBlocked', 'Attachment change blocked by validation.'),
  })
  const [items, setItems] = React.useState<AttachmentItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [mutatingId, setMutatingId] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const replacementInputRef = React.useRef<HTMLInputElement | null>(null)
  const replacementTargetRef = React.useRef<AttachmentItem | null>(null)
  const onCountChangeRef = React.useRef(onCountChange)
  const accept = React.useMemo(() => buildAcceptAttribute(def), [def])

  React.useEffect(() => {
    onCountChangeRef.current = onCountChange
  }, [onCountChange])

  const load = React.useCallback(async () => {
    if (!entityId || !recordId) return
    try {
      setLoading(true)
      const call = await apiCall<AttachmentsResponse>(
        `/api/attachments?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`,
        undefined,
        { fallback: { items: [] } },
      )
      if (!call.ok) {
        const message = call.result?.error || t('attachments.library.errors.load', 'Failed to load attachments.')
        throw new Error(message)
      }
      const j = call.result ?? { items: [] }
      const nextItems = Array.isArray(j.items) ? j.items : []
      setItems(nextItems)
      onCountChangeRef.current?.(nextItems.length)
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t('attachments.library.errors.load', 'Failed to load attachments.'))
    } finally {
      setLoading(false)
    }
  }, [entityId, recordId, t])

  React.useEffect(() => { load() }, [load])

  const mutationContext = React.useCallback((operation: string, resourceId: string) => ({
    moduleId: 'attachments',
    entityId: 'attachments.attachment',
    operation,
    formId: `attachment-input:${entityId ?? 'unknown'}:${recordId ?? 'pending'}`,
    resourceKind: 'attachments.attachment',
    resourceId,
    retryLastMutation,
  }), [entityId, recordId, retryLastMutation])

  const uploadFile = React.useCallback(async (file: File): Promise<void> => {
    if (!entityId || !recordId) return
    const fd = new FormData()
    fd.set('entityId', entityId)
    fd.set('recordId', recordId)
    if (def?.key) fd.set('fieldKey', String(def.key))
    fd.set('file', file)
    const call = await apiCall<{ error?: string }>(
      '/api/attachments',
      { method: 'POST', body: fd },
      { fallback: null },
    )
    if (!call.ok) {
      throw new Error(call.result?.error || t('attachments.library.upload.failed', 'Upload failed.'))
    }
  }, [def?.key, entityId, recordId, t])

  const deleteFile = React.useCallback(async (attachment: AttachmentItem): Promise<void> => {
    const call = await apiCall<{ error?: string }>(
      `/api/attachments?id=${encodeURIComponent(attachment.id)}`,
      { method: 'DELETE' },
      { fallback: null },
    )
    if (!call.ok) {
      throw new Error(call.result?.error || t('attachments.library.errors.delete', 'Failed to delete attachment.'))
    }
  }, [t])

  const onUpload = async (files: FileList | null, replacementTarget?: AttachmentItem) => {
    if (!files || !entityId || !recordId) return
    setError(null)
    setUploading(true)
    if (replacementTarget) setMutatingId(replacementTarget.id)
    let uploadedCount = 0
    try {
      for (const file of Array.from(files).slice(0, replacementTarget ? 1 : undefined)) {
        const ext = (file.name || '').split('.').pop()?.toLowerCase() || ''
        const acceptExtensions = Array.isArray(def?.acceptExtensions) ? def.acceptExtensions : []
        if (acceptExtensions.length > 0) {
          const allowed = new Set(acceptExtensions.map((entry) => String(entry).toLowerCase().replace(/^\./, '')))
          if (!allowed.has(ext)) { setError('File type not allowed'); continue }
        }
        const maxAttachmentSizeMb = typeof def?.maxAttachmentSizeMb === 'number' ? def.maxAttachmentSizeMb : undefined
        if (typeof maxAttachmentSizeMb === 'number' && maxAttachmentSizeMb > 0) {
          const maxBytes = Math.floor(maxAttachmentSizeMb * 1024 * 1024)
          if (file.size > maxBytes) { setError(`File exceeds ${maxAttachmentSizeMb} MB limit`); continue }
        }
        try {
          await runMutation({
            operation: async () => {
              await uploadFile(file)
              if (replacementTarget) await deleteFile(replacementTarget)
            },
            context: mutationContext(
              replacementTarget ? 'replace_attachment' : 'upload_attachment',
              replacementTarget?.id ?? recordId,
            ),
            mutationPayload: {
              entityId,
              recordId,
              attachmentId: replacementTarget?.id,
              fileName: file.name,
              fileSize: file.size,
            },
          })
        } catch (uploadError) {
          setError(uploadError instanceof Error
            ? uploadError.message
            : t('attachments.library.upload.failed', 'Upload failed.'))
          break
        }
        uploadedCount += 1
      }
      await load()
      if (uploadedCount > 0) {
        onUploaded?.()
        if (replacementTarget) {
          flash(t('attachments.library.messages.replaced', 'Attachment replaced.'), 'success')
        }
      }
    } finally {
      setUploading(false)
      setMutatingId(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      if (replacementInputRef.current) {
        replacementInputRef.current.value = ''
      }
    }
  }

  const requestDelete = React.useCallback(async (attachment: AttachmentItem) => {
    if (disabled || mutatingId) return
    const confirmed = await confirm({
      title: t('attachments.library.delete', 'Delete attachment'),
      text: t('attachments.library.confirm.delete', 'Delete attachment "{name}"? This action cannot be undone.', {
        name: attachment.fileName,
      }),
      confirmText: t('attachments.library.actions.delete', 'Delete'),
      cancelText: t('attachments.library.upload.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setError(null)
    setMutatingId(attachment.id)
    try {
      await runMutation({
        operation: () => deleteFile(attachment),
        context: mutationContext('delete_attachment', attachment.id),
        mutationPayload: { entityId, recordId, attachmentId: attachment.id },
      })
      flash(t('attachments.library.messages.deleted', 'Attachment removed.'), 'success')
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error
        ? deleteError.message
        : t('attachments.library.errors.delete', 'Failed to delete attachment.'))
    } finally {
      setMutatingId(null)
    }
  }, [confirm, deleteFile, disabled, entityId, load, mutatingId, mutationContext, recordId, runMutation, t])

  const requestReplace = React.useCallback((attachment: AttachmentItem) => {
    if (disabled || uploading || mutatingId) return
    replacementTargetRef.current = attachment
    replacementInputRef.current?.click()
  }, [disabled, mutatingId, uploading])

  return (
    <div className="space-y-3">
      {!entityId || !recordId ? (
        <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
          {t('attachments.library.upload.saveFirst', 'Save the record before uploading files.')}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/70 bg-muted/30 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading}
            >
              <Upload className="h-4 w-4" />
              {uploading
                ? t('attachments.library.upload.submitting', 'Uploading…')
                : t('attachments.library.upload.choose', 'Choose files')}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept={accept}
            disabled={disabled || uploading}
            onChange={(event) => { void onUpload(event.target.files) }}
          />
          <input
            ref={replacementInputRef}
            type="file"
            className="hidden"
            accept={accept}
            disabled={disabled || uploading}
            aria-label={t('attachments.library.actions.chooseReplacement', 'Choose replacement file')}
            onChange={(event) => {
              const target = replacementTargetRef.current
              replacementTargetRef.current = null
              if (target) void onUpload(event.target.files, target)
            }}
          />
        </div>
      )}
      {error ? <div className="text-xs text-status-error-text">{error}</div> : null}
      <div className="space-y-1">
        {loading ? <div className="text-xs text-muted-foreground">{t('attachments.library.loading', 'Loading attachments…')}</div> : null}
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <a className="block truncate underline" href={item.url} target="_blank" rel="noreferrer">{item.fileName}</a>
              <span className="text-xs text-muted-foreground">{humanSize(item.fileSize)}</span>
            </div>
            {allowReplace ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => requestReplace(item)}
                disabled={disabled || uploading || mutatingId !== null}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                {t('attachments.library.actions.replace', 'Replace')}
              </Button>
            ) : null}
            {allowDelete ? (
              <IconButton
                type="button"
                variant="ghost"
                aria-label={t('attachments.library.actions.deleteNamed', 'Delete {name}', { name: item.fileName })}
                onClick={() => { void requestDelete(item) }}
                disabled={disabled || uploading || mutatingId !== null}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        ))}
        {!loading && items.length === 0 ? <div className="text-xs text-muted-foreground">{t('attachments.library.table.empty', 'No attachments found.')}</div> : null}
      </div>
      {ConfirmDialogElement}
    </div>
  )
}

// Register with field registry under kind 'attachment'
function AttachmentDefEditor({ def, onChange }: { def: AttachmentFieldDef; onChange: (patch: AttachmentDefEditorPatch) => void }) {
  const cfg = def?.configJson || {}
  const [maxMb, setMaxMb] = React.useState<number | ''>(typeof cfg.maxAttachmentSizeMb === 'number' ? cfg.maxAttachmentSizeMb : '')
  const [exts, setExts] = React.useState<string>((Array.isArray(cfg.acceptExtensions) ? cfg.acceptExtensions : []).join(', '))
  const [partition, setPartition] = React.useState<string>(typeof cfg.partitionCode === 'string' ? cfg.partitionCode : '')
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="space-y-2">
        <label className="text-xs font-medium">Max file size (MB)</label>
        <Input
          type="number"
          min={0}
          placeholder="e.g., 10"
          value={maxMb}
          onChange={(e) => setMaxMb(e.target.value === '' ? '' : Number(e.target.value))}
          onBlur={() => onChange({ maxAttachmentSizeMb: maxMb === '' ? undefined : Number(maxMb) })}
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium">Accepted extensions</label>
        <Input
          placeholder="e.g., pdf, jpg, png"
          value={exts}
          onChange={(e) => setExts(e.target.value)}
          onBlur={() => onChange({ acceptExtensions: exts.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
        <div className="text-xs text-muted-foreground">Leave blank to allow any.</div>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium">Partition code</label>
        <Input
          placeholder="e.g., productsMedia"
          value={partition}
          onChange={(e) => setPartition(e.target.value)}
          onBlur={() => onChange({ partitionCode: partition.trim() || undefined })}
        />
        <div className="text-xs text-muted-foreground">
          Configure partitions under Settings → Attachments. Leave blank for default.
        </div>
      </div>
    </div>
  )
}

FieldRegistry.register('attachment', {
  input: (props) => <AttachmentInput entityId={props.entityId} recordId={props.recordId} def={props.def} disabled={props.disabled} />,
  defEditor: (p) => <AttachmentDefEditor {...p} />,
})

export {}
