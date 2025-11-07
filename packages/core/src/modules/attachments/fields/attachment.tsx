"use client"
import * as React from 'react'
import { FieldRegistry } from '@open-mercato/ui/backend/fields/registry'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

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

const AttachmentInput = ({ entityId, recordId, def }: { entityId?: string; recordId?: string; def?: any }) => {
  const [items, setItems] = React.useState<Array<{ id: string; url: string; fileName: string; fileSize: number }>>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

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
        const message = call.result?.error || 'Failed to load attachments'
        throw new Error(message)
      }
      const j = call.result ?? { items: [] }
      setItems(Array.isArray(j.items) ? j.items : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [entityId, recordId])

  React.useEffect(() => { load() }, [load])

  const onUpload = async (files: FileList | null) => {
    if (!files || !entityId || !recordId) return
    setError(null)
    for (const file of Array.from(files)) {
      // Client-side constraints from definition
      const cfg = def || {}
      const ext = (file.name || '').split('.').pop()?.toLowerCase() || ''
      if (Array.isArray(cfg.acceptExtensions) && cfg.acceptExtensions.length) {
        const allowed = new Set((cfg.acceptExtensions as any[]).map((x: any) => String(x).toLowerCase().replace(/^\./, '')))
        if (!allowed.has(ext)) { setError('File type not allowed'); continue }
      }
      if (typeof cfg.maxAttachmentSizeMb === 'number' && cfg.maxAttachmentSizeMb > 0) {
        const maxBytes = Math.floor(cfg.maxAttachmentSizeMb * 1024 * 1024)
        if (file.size > maxBytes) { setError(`File exceeds ${cfg.maxAttachmentSizeMb} MB limit`); continue }
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
        setError(call.result?.error || 'Upload failed')
        break
      }
    }
    await load()
  }

  return (
    <div className="space-y-2">
      {!entityId || !recordId ? (
        <div className="text-xs text-muted-foreground">Save the record first to attach files.</div>
      ) : (
        <input type="file" multiple onChange={(e) => onUpload(e.target.files)} />
      )}
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
      <div className="space-y-1">
        {loading ? <div className="text-xs text-muted-foreground">Loading attachments...</div> : null}
        {items.map(it => (
          <div key={it.id} className="text-sm">
            <a className="underline" href={it.url} target="_blank" rel="noreferrer">{it.fileName}</a>
            <span className="text-xs text-muted-foreground"> • {humanSize(it.fileSize)}</span>
          </div>
        ))}
        {!loading && items.length === 0 ? <div className="text-xs text-muted-foreground">No attachments yet.</div> : null}
      </div>
    </div>
  )
}

// Register with field registry under kind 'attachment'
function AttachmentDefEditor({ def, onChange }: { def: any; onChange: (patch: any) => void }) {
  const cfg = def?.configJson || {}
  const [maxMb, setMaxMb] = React.useState<number | ''>(typeof cfg.maxAttachmentSizeMb === 'number' ? cfg.maxAttachmentSizeMb : '')
  const [exts, setExts] = React.useState<string>((Array.isArray(cfg.acceptExtensions) ? cfg.acceptExtensions : []).join(', '))
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className="text-xs">Max file size (MB)</label>
        <input
          className="border rounded w-full px-2 py-1 text-sm"
          type="number"
          min={0}
          placeholder="e.g., 10"
          value={maxMb}
          onChange={(e) => setMaxMb(e.target.value === '' ? '' : Number(e.target.value))}
          onBlur={() => onChange({ maxAttachmentSizeMb: (maxMb === '' ? undefined : Number(maxMb)) })}
        />
      </div>
      <div>
        <label className="text-xs">Accepted extensions</label>
        <input
          className="border rounded w-full px-2 py-1 text-sm"
          placeholder="e.g., pdf, jpg, png"
          value={exts}
          onChange={(e) => setExts(e.target.value)}
          onBlur={() => onChange({ acceptExtensions: exts.split(',').map(s => s.trim()).filter(Boolean) })}
        />
        <div className="text-xs text-muted-foreground mt-1">Leave blank to allow any.</div>
      </div>
    </div>
  )
}

FieldRegistry.register('attachment', {
  input: (props) => <AttachmentInput entityId={props.entityId} recordId={props.recordId} def={props.def} />,
  defEditor: (p) => <AttachmentDefEditor {...p} />,
})

export {}
