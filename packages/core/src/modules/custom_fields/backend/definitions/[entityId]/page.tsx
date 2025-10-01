"use client"
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CUSTOM_FIELD_KINDS } from '@open-mercato/shared/modules/custom_fields/kinds'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { upsertCustomEntitySchema } from '@open-mercato/core/modules/custom_fields/data/validators'
import { z } from 'zod'

type Def = { key: string; kind: string; configJson?: any; isActive?: boolean }

const KIND_OPTIONS = CUSTOM_FIELD_KINDS.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))

function FieldRow({ d, onChange, onRemove }: { d: Def; onChange: (d: Def) => void; onRemove: () => void }) {
  const [local, setLocal] = useState<Def>(d)
  useEffect(() => setLocal(d), [d.key])
  useEffect(() => onChange(local), [local])
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-2" style={{ width: 180 }}>
        <input value={local.key} onChange={(e) => setLocal({ ...local, key: e.target.value })} className="border rounded w-full px-2 py-1 font-mono" placeholder="snake_case" />
      </td>
      <td className="py-2 pr-2" style={{ width: 160 }}>
        <select value={local.kind} onChange={(e) => setLocal({ ...local, kind: e.target.value })} className="border rounded w-full px-2 py-1">
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td className="py-2 pr-2">
        <div className="space-y-2">
          <div>
            <label className="text-xs">Label</label>
            <input value={local.configJson?.label || ''} onChange={(e) => setLocal({ ...local, configJson: { ...(local.configJson||{}), label: e.target.value } })} className="border rounded w-full px-2 py-1" />
          </div>
          <div>
            <label className="text-xs">Description</label>
            <input value={local.configJson?.description || ''} onChange={(e) => setLocal({ ...local, configJson: { ...(local.configJson||{}), description: e.target.value } })} className="border rounded w-full px-2 py-1" />
          </div>
          {local.kind === 'select' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs">Options (comma-separated)</label>
                <input value={Array.isArray(local.configJson?.options) ? local.configJson.options.join(',') : ''} onChange={(e) => setLocal({ ...local, configJson: { ...(local.configJson||{}), options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} className="border rounded w-full px-2 py-1" />
              </div>
              <div>
                <label className="text-xs">Options URL</label>
                <input value={local.configJson?.optionsUrl || ''} onChange={(e) => setLocal({ ...local, configJson: { ...(local.configJson||{}), optionsUrl: e.target.value } })} className="border rounded w-full px-2 py-1" placeholder="/api/..." />
              </div>
              <div className="col-span-2">
                <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={!!local.configJson?.multi} onChange={(e) => setLocal({ ...local, configJson: { ...(local.configJson||{}), multi: e.target.checked } })} /> Multiple</label>
              </div>
            </div>
          )}
          {local.kind === 'relation' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs">Related Entity ID</label>
                <input value={local.configJson?.relatedEntityId || ''} onChange={(e) => {
                  const relatedEntityId = e.target.value
                  const defOptionsUrl = relatedEntityId ? `/api/custom_fields/relations/options?entityId=${encodeURIComponent(relatedEntityId)}` : ''
                  setLocal({ ...local, configJson: { ...(local.configJson||{}), relatedEntityId, optionsUrl: local.configJson?.optionsUrl || defOptionsUrl } })
                }} className="border rounded w-full px-2 py-1 font-mono" placeholder="module:entity" />
              </div>
              <div>
                <label className="text-xs">Options URL</label>
                <input value={local.configJson?.optionsUrl || ''} onChange={(e) => setLocal({ ...local, configJson: { ...(local.configJson||{}), optionsUrl: e.target.value } })} className="border rounded w-full px-2 py-1" placeholder="/api/custom_fields/relations/options?..." />
              </div>
              <div className="col-span-2">
                <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={!!local.configJson?.multi} onChange={(e) => setLocal({ ...local, configJson: { ...(local.configJson||{}), multi: e.target.checked } })} /> Multiple</label>
              </div>
            </div>
          )}
        </div>
      </td>
      <td className="py-2 pr-2" style={{ width: 120 }}>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={local.isActive !== false} onChange={(e) => setLocal({ ...local, isActive: e.target.checked })} /> Active</label>
      </td>
      <td className="py-2 text-right" style={{ width: 80 }}>
        <button type="button" onClick={onRemove} className="px-2 py-1 border rounded hover:bg-gray-50">Remove</button>
      </td>
    </tr>
  )
}

export default function EditDefinitionsPage({ params }: { params?: { entityId?: string } }) {
  const router = useRouter()
  const entityId = useMemo(() => decodeURIComponent((params?.entityId as any) || ''), [params])
  const [label, setLabel] = useState('')
  const [entityFormLoading, setEntityFormLoading] = useState(true)
  const [entityInitial, setEntityInitial] = useState<{ label?: string; description?: string; labelField?: string }>({})
  const [defs, setDefs] = useState<Def[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const entRes = await apiFetch('/api/custom_fields/entities')
        const entJson = await entRes.json().catch(() => ({ items: [] }))
        const ent = (entJson.items || []).find((x: any) => x.entityId === entityId)
        if (mounted) {
          setLabel(ent?.label || entityId)
          setEntityInitial({ label: ent?.label || '', description: ent?.description || '', labelField: (ent as any)?.labelField || 'name' })
          setEntityFormLoading(false)
        }
        const res = await apiFetch(`/api/custom_fields/definitions.manage?entityId=${encodeURIComponent(entityId)}`)
        const json = await res.json().catch(() => ({ items: [] }))
        if (mounted) setDefs((json.items || []).map((d: any) => ({ key: d.key, kind: d.kind, configJson: d.configJson || {}, isActive: d.isActive !== false })))
      } catch (e: any) {
        if (mounted) setError(e.message || 'Failed to load')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    if (entityId) load()
    return () => { mounted = false }
  }, [entityId])

  function addField() {
    setDefs((arr) => [...arr, { key: '', kind: 'text', configJson: {}, isActive: true }])
  }

  async function saveAll() {
    setSaving(true)
    setError(null)
    try {
      for (const d of defs) {
        if (!d.key) continue
        const payload = { entityId, key: d.key, kind: d.kind, configJson: d.configJson, isActive: d.isActive !== false }
        const res = await apiFetch('/api/custom_fields/definitions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error || `Failed to save ${d.key}`)
        }
      }
      router.push(`/backend/definitions?flash=Definitions%20saved&type=success`)
    } catch (e: any) {
      setError(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function removeField(idx: number) {
    const d = defs[idx]
    setDefs((arr) => arr.filter((_, i) => i !== idx))
    if (d?.key) {
      await apiFetch('/api/custom_fields/definitions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityId, key: d.key }) })
    }
  }

  if (!entityId) return <div className="p-6">Invalid entity</div>
  if (loading) return <div className="p-6">Loading…</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit Fields: <span className="font-mono text-base align-middle">{entityId}</span></h1>
        <div className="text-sm text-gray-600">{label}</div>
      </div>
      {/* Entity config form (label, description, labelField) */}
      <div className="border rounded p-4">
        <CrudForm
          title="Entity Settings"
          fields={[
            { id: 'label', label: 'Label', type: 'text' },
            { id: 'description', label: 'Description', type: 'textarea' },
            { id: 'labelField', label: 'Default Label Field', type: 'text' },
          ] as CrudField[]}
          initialValues={entityInitial as any}
          isLoading={entityFormLoading}
          submitLabel="Save Settings"
          onSubmit={async (vals) => {
            const partial = upsertCustomEntitySchema.pick({ label: true, description: true, labelField: true as any }) as unknown as z.ZodTypeAny
            const parsed = partial.safeParse(vals)
            if (!parsed.success) throw new Error('Validation failed')
            const res = await apiFetch('/api/custom_fields/entities', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ entityId, ...parsed.data }),
            })
            if (!res.ok) {
              const j = await res.json().catch(() => ({}))
              throw new Error(j?.error || 'Failed to save settings')
            }
            setLabel(vals.label || entityId)
            flash('Settings saved', 'success')
          }}
          onDelete={async () => {
            if (!window.confirm('Delete this custom entity and its definitions?')) return
            const res = await apiFetch('/api/custom_fields/entities', {
              method: 'DELETE',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ entityId }),
            })
            if (!res.ok) {
              const j = await res.json().catch(() => ({}))
              throw new Error(j?.error || 'Failed to delete entity')
            }
            flash('Entity deleted', 'success')
            router.push('/backend/definitions')
          }}
        />
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-2">Key</th>
              <th className="py-2 pr-2">Kind</th>
              <th className="py-2 pr-2">Config</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2"></th>
            </tr>
          </thead>
          <tbody>
            {defs.map((d, i) => (
              <FieldRow key={`${i}-${d.key}`} d={d} onChange={(nd) => setDefs((arr) => arr.map((x, idx) => idx === i ? nd : x))} onRemove={() => removeField(i)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={addField} className="px-3 py-1.5 border rounded hover:bg-gray-50">Add Field</button>
        <button type="button" onClick={saveAll} disabled={saving} className="px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <div className="text-xs text-gray-500">Supported kinds: text, multiline, integer, float, boolean, select (with options/optionsUrl), relation (set relatedEntityId and optionsUrl).</div>
    </div>
  )
}
