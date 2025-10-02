"use client"
import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CUSTOM_FIELD_KINDS } from '@open-mercato/shared/modules/custom_fields/kinds'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { upsertCustomEntitySchema } from '@open-mercato/core/modules/custom_fields/data/validators'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { Plus, Trash2 } from 'lucide-react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type Def = { key: string; kind: string; configJson?: any; isActive?: boolean }

const KIND_OPTIONS = CUSTOM_FIELD_KINDS.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))

function FieldRow({ d, onChange, onRemove }: { d: Def; onChange: (d: Def) => void; onRemove: () => void }) {
  const [local, setLocal] = useState<Def>(d)
  // Sync local when upstream def changes identity (key) or receives external edits
  useEffect(() => setLocal(d), [d.key, d.kind, JSON.stringify(d.configJson), d.isActive])
  const updateLocal = (patch: Partial<Def>) => {
    setLocal((prev) => {
      const next = { ...prev, ...patch }
      // propagate immediately to parent to avoid stale microtask commits
      onChange(next)
      return next
    })
  }
  const commit = () => onChange(local)
  return (
    <>
      <tr className="align-top">
        <td className="py-2 pr-2" style={{ width: 220 }}>
          <input value={local.key} onChange={(e) => updateLocal({ key: e.target.value })} onBlur={commit} className="border rounded w-full px-2 py-1 font-mono" placeholder="snake_case" />
        </td>
        <td className="py-2 pr-2" style={{ width: 200 }}>
          <select value={local.kind} onChange={(e) => { updateLocal({ kind: e.target.value }) }} className="border rounded w-full px-2 py-1">
            {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </td>
        <td className="py-2 pr-2 text-sm">
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">Visibility:</span>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={local.configJson?.listVisible !== false} onChange={(e) => { updateLocal({ configJson: { ...(local.configJson||{}), listVisible: e.target.checked } }); queueMicrotask(commit) }} /> List</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!local.configJson?.filterable} onChange={(e) => { updateLocal({ configJson: { ...(local.configJson||{}), filterable: e.target.checked } }); queueMicrotask(commit) }} /> Filter</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={local.configJson?.formEditable !== false} onChange={(e) => { updateLocal({ configJson: { ...(local.configJson||{}), formEditable: e.target.checked } }); queueMicrotask(commit) }} /> Form</label>
            </div>
            <div className="text-muted-foreground">Config</div>
          </div>
        </td>
        <td className="py-2 pr-2" style={{ width: 140 }}>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={local.isActive !== false} onChange={(e) => { updateLocal({ isActive: e.target.checked }); queueMicrotask(commit) }} /> Active</label>
        </td>
        <td className="py-2 text-right" style={{ width: 80 }}>
          <button type="button" onClick={onRemove} className="px-2 py-1 border rounded hover:bg-gray-50" aria-label="Remove field">
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      </tr>
      <tr className="border-b">
        <td className="pt-0" colSpan={5}>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <label className="text-xs">Label</label>
              <input value={local.configJson?.label || ''} onChange={(e) => updateLocal({ configJson: { ...(local.configJson||{}), label: e.target.value } })} onBlur={commit} className="border rounded w-full px-2 py-1" />
            </div>
            <div>
              <label className="text-xs">Description</label>
              <input value={local.configJson?.description || ''} onChange={(e) => updateLocal({ configJson: { ...(local.configJson||{}), description: e.target.value } })} onBlur={commit} className="border rounded w-full px-2 py-1" />
            </div>
            {(local.kind === 'text' || local.kind === 'multiline') && (
              <div>
                <label className="text-xs">Editor</label>
                <select value={local.configJson?.editor || ''} onChange={(e) => { updateLocal({ configJson: { ...(local.configJson||{}), editor: e.target.value || undefined } }) }} className="border rounded w-full px-2 py-1">
                  <option value="">Default</option>
                  <option value="markdown">Markdown (UIW)</option>
                  <option value="simpleMarkdown">Simple Markdown</option>
                  <option value="htmlRichText">HTML Rich Text</option>
                </select>
              </div>
            )}
            {local.kind === 'select' && (
              <>
                <div>
                  <label className="text-xs">Options (comma-separated)</label>
                  <input value={Array.isArray(local.configJson?.options) ? local.configJson.options.join(',') : ''} onChange={(e) => updateLocal({ configJson: { ...(local.configJson||{}), options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} onBlur={commit} className="border rounded w-full px-2 py-1" />
                </div>
                <div>
                  <label className="text-xs">Options URL</label>
                  <input value={local.configJson?.optionsUrl || ''} onChange={(e) => updateLocal({ configJson: { ...(local.configJson||{}), optionsUrl: e.target.value } })} onBlur={commit} className="border rounded w-full px-2 py-1" placeholder="/api/..." />
                </div>
                <div className="col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={!!local.configJson?.multi} onChange={(e) => { updateLocal({ configJson: { ...(local.configJson||{}), multi: e.target.checked } }); queueMicrotask(commit) }} /> Multiple</label>
                </div>
              </>
            )}
            {local.kind === 'relation' && (
              <>
                <div>
                  <label className="text-xs">Related Entity ID</label>
                  <input value={local.configJson?.relatedEntityId || ''} onChange={(e) => {
                    const relatedEntityId = e.target.value
                    const defOptionsUrl = relatedEntityId ? `/api/custom_fields/relations/options?entityId=${encodeURIComponent(relatedEntityId)}` : ''
                    updateLocal({ configJson: { ...(local.configJson||{}), relatedEntityId, optionsUrl: local.configJson?.optionsUrl || defOptionsUrl } })
                  }} onBlur={commit} className="border rounded w-full px-2 py-1 font-mono" placeholder="module:entity" />
                </div>
                <div>
                  <label className="text-xs">Options URL</label>
                  <input value={local.configJson?.optionsUrl || ''} onChange={(e) => updateLocal({ configJson: { ...(local.configJson||{}), optionsUrl: e.target.value } })} onBlur={commit} className="border rounded w-full px-2 py-1" placeholder="/api/custom_fields/relations/options?..." />
                </div>
                {/* For now, multiple selection is only supported for 'select' kind */}
              </>
            )}
          </div>
        </td>
      </tr>
    </>
  )
}

export default function EditDefinitionsPage({ params }: { params?: { entityId?: string } }) {
  const router = useRouter()
  const entityId = useMemo(() => decodeURIComponent((params?.entityId as any) || ''), [params])
  const [label, setLabel] = useState('')
  const [entitySource, setEntitySource] = useState<'code'|'custom'>('custom')
  const [entityFormLoading, setEntityFormLoading] = useState(true)
  const [entityInitial, setEntityInitial] = useState<{ label?: string; description?: string; labelField?: string; defaultEditor?: string }>({})
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
          if (ent?.source === 'code' || ent?.source === 'custom') setEntitySource(ent.source)
          setEntityInitial({
            label: ent?.label || entityId,
            description: ent?.description || '',
            labelField: (ent as any)?.labelField || 'name',
            defaultEditor: (ent as any)?.defaultEditor || '',
          })
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

  if (!entityId) {
    return (
      <Page>
        <PageBody>
          <div className="p-6">
            <ErrorNotice title="Invalid entity" message="The requested entity ID is missing or invalid." />
          </div>
        </PageBody>
      </Page>
    )
  }
  // Unify loader via CrudForm isLoading; do not return early here

  // Schema for inline field-level validation in CrudForm
  const entityFormSchema = upsertCustomEntitySchema
    .pick({ label: true, description: true, defaultEditor: true as any })
    .extend({
      // Allow empty string in the UI select, treat as undefined later
      defaultEditor: z.union([z.enum(['markdown','simpleMarkdown','htmlRichText']).optional(), z.literal('')]).optional(),
    }) as unknown as z.ZodTypeAny

  const fields: CrudField[] = [
    { id: 'label', label: 'Label', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'defaultEditor',
      label: 'Default Editor (multiline)',
      type: 'select',
      options: [
        { value: '', label: 'Default (Markdown)' },
        { value: 'markdown', label: 'Markdown (UIW)' },
        { value: 'simpleMarkdown', label: 'Simple Markdown' },
        { value: 'htmlRichText', label: 'HTML Rich Text' },
      ],
    } as any,
  ]
  const groups: CrudFormGroup[] = [
    { id: 'settings', title: 'Entity Settings', column: 1, fields: ['label','description','defaultEditor'] },
    { id: 'definitions', title: 'Field Definitions', column: 1, component: () => (
      <div className="space-y-2">
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
                <FieldRow key={i} d={d} onChange={(nd) => setDefs((arr) => arr.map((x, idx) => (idx === i ? nd : x)))} onRemove={() => removeField(i)} />
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <button type="button" onClick={addField} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 inline-flex items-center gap-1">
            <Plus className="h-4 w-4" /> Add Field
          </button>
          <div className="text-xs text-gray-500 mt-2">Supported kinds: text, multiline, integer, float, boolean, select (with options/optionsUrl), relation (set relatedEntityId and optionsUrl).</div>
        </div>
      </div>
    ) },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm
          schema={entityFormSchema}
          title={`Edit Entity: ${entityId}`}
          backHref="/backend/definitions"
          fields={fields}
          groups={groups}
          initialValues={entityInitial as any}
          isLoading={entityFormLoading || loading}
          submitLabel="Save"
          cancelHref="/backend/definitions"
          successRedirect="/backend/definitions?flash=Definitions%20saved&type=success"
          onSubmit={async (vals) => {
          // Save entity settings
          const partial = upsertCustomEntitySchema.pick({ label: true, description: true, labelField: true as any, defaultEditor: true as any }) as unknown as z.ZodTypeAny
          const normalized = { ...(vals as any), defaultEditor: (vals as any)?.defaultEditor || undefined }
          const parsed = partial.safeParse(normalized)
          if (!parsed.success) throw new Error('Validation failed')
          const res1 = await apiFetch('/api/custom_fields/entities', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityId, ...parsed.data })
          })
          if (!res1.ok) {
            const j = await res1.json().catch(() => ({}))
            throw new Error(j?.error || 'Failed to save entity')
          }
          // Save definitions
          for (const d of defs) {
            if (!d.key) continue
            const payload = { entityId, key: d.key, kind: d.kind, configJson: d.configJson, isActive: d.isActive !== false }
            const res = await apiFetch('/api/custom_fields/definitions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
            if (!res.ok) {
              const j = await res.json().catch(() => ({}))
              throw new Error(j?.error || `Failed to save ${d.key}`)
            }
          }
          flash('Definitions saved', 'success')
        }}
        onDelete={entitySource === 'custom' ? async () => {
          if (!window.confirm('Delete this custom entity and its definitions?')) return
          const res = await apiFetch('/api/custom_fields/entities', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityId }) })
          if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            throw new Error(j?.error || 'Failed to delete entity')
          }
          flash('Entity deleted', 'success')
        } : undefined}
      />
      </PageBody>
    </Page>
  )
}
