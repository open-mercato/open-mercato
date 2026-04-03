"use client"
import * as React from 'react'
import { FieldRegistry } from '@open-mercato/ui/backend/fields/registry'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Upload } from 'lucide-react'

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
}: {
  entityId?: string
  recordId?: string
  def?: AttachmentFieldDef
  disabled?: boolean
}) => {
  const t = useT()
  const [items, setItems] = React.useState<Array<{ id: string; url: string; fileName: string; fileSize: number }>>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const accept = React.useMemo(() => buildAcceptAttribute(def), [def])

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
      setItems(Array.isArray(j.items) ? j.items : [])
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t('attachments.library.errors.load', 'Failed to load attachments.'))
    } finally {
      setLoading(false)
    }
  }, [entityId, recordId, t])

  React.useEffect(() => { load() }, [load])

  const onUpload = async (files: FileList | null) => {
    if (!files || !entityId || !recordId) return
    setError(null)
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
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
          setError(call.result?.error || t('attachments.library.upload.failed', 'Upload failed.'))
          break
        }
      }
      await load()
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="space-y-3">
      {!entityId || !recordId ? (
        <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
          {t('attachments.library.upload.saveFirst', 'Save the record before uploading files.')}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-4 py-4">
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
        </div>
      )}
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
      <div className="space-y-1">
        {loading ? <div className="text-xs text-muted-foreground">{t('attachments.library.loading', 'Loading attachments…')}</div> : null}
        {items.map(it => (
          <div key={it.id} className="text-sm">
            <a className="underline" href={it.url} target="_blank" rel="noreferrer">{it.fileName}</a>
            <span className="text-xs text-muted-foreground"> • {humanSize(it.fileSize)}</span>
          </div>
        ))}
        {!loading && items.length === 0 ? <div className="text-xs text-muted-foreground">{t('attachments.library.table.empty', 'No attachments found.')}</div> : null}
      </div>
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
        <input
          className="w-full rounded border px-2 py-1 text-sm"
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
        <input
          className="w-full rounded border px-2 py-1 text-sm"
          placeholder="e.g., pdf, jpg, png"
          value={exts}
          onChange={(e) => setExts(e.target.value)}
          onBlur={() => onChange({ acceptExtensions: exts.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
        <div className="text-xs text-muted-foreground">Leave blank to allow any.</div>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium">Partition code</label>
        <input
          className="w-full rounded border px-2 py-1 text-sm"
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
