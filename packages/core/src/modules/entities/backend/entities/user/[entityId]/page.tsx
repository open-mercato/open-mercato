"use client"
import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { CUSTOM_FIELD_KINDS } from '@open-mercato/shared/modules/entities/kinds'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { invalidateCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { upsertCustomEntitySchema, upsertCustomFieldDefSchema } from '@open-mercato/core/modules/entities/data/validators'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldRegistry, loadGeneratedFieldRegistrations } from '@open-mercato/ui/backend/fields/registry'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { createCrudFormError, raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'

type Def = { key: string; kind: string; configJson?: any; isActive?: boolean }
type EntitiesListResponse = { items?: Array<Record<string, unknown>> }
type DefinitionsManageResponse = { items?: any[]; deletedKeys?: string[] }

const KIND_OPTIONS = CUSTOM_FIELD_KINDS.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))

// A memoized card for a single field definition.
// Uses local buffered inputs and commits on blur/toggle to avoid form-wide re-renders and focus loss.
type DefErrors = { key?: string; kind?: string }

const FieldCard = React.memo(function FieldCard({ d, error, onChange, onRemove }: { d: Def; error?: DefErrors; onChange: (d: Def) => void; onRemove: () => void }) {
  const [local, setLocal] = useState<Def>(d)
  // Keep local state in sync when identity (key) changes to avoid stale UI after deletes/reorders
  React.useEffect(() => { setLocal(d) }, [d.key])

  const sanitizeDef = (def: Def): Def => {
    if (!def.configJson || !Array.isArray(def.configJson.options)) return def
    const normalizedOptions = def.configJson.options
      .map((option: unknown) => (typeof option === 'string' ? option.trim() : ''))
      .filter((option: string) => option.length > 0)
    if (
      normalizedOptions.length === def.configJson.options.length &&
      normalizedOptions.every((option: string, idx: number) => option === def.configJson.options[idx])
    ) {
      return def
    }
    return {
      ...def,
      configJson: {
        ...def.configJson,
        options: normalizedOptions,
      },
    }
  }

  const apply = (patch: Partial<Def> | ((current: Def) => Partial<Def>), propagateNow = false) => {
    setLocal((prev) => {
      const resolvedPatch = typeof patch === 'function' ? patch(prev) : patch
      const next = { ...prev, ...resolvedPatch }
      if (!propagateNow) return next
      const sanitized = sanitizeDef(next)
      onChange(sanitized)
      return sanitized
    })
  }
  const commit = () => {
    setLocal((prev) => {
      const sanitized = sanitizeDef(prev)
      onChange(sanitized)
      return sanitized
    })
  }

  return (
    <div className="rounded border p-3 bg-white transition-colors hover:border-muted-foreground/60">
      {/* Top bar: drag handle on the left, Active + delete on the right */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted cursor-grab active:cursor-grabbing">
            <GripVertical className="h-4 w-4 opacity-70" />
          </span>
          Drag to reorder
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={local.isActive !== false} onChange={(e) => { apply({ isActive: e.target.checked }, true) }} /> Active
          </label>
          <button type="button" onClick={onRemove} className="px-2 py-1 border rounded hover:bg-gray-50" aria-label="Remove field">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main grid: key + kind */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        <div className="md:col-span-6">
          <label className="text-xs">Key</label>
          <input
            className={`rounded w-full px-2 py-1 text-sm font-mono ${error?.key ? 'border-red-500 border' : 'border'}`}
            placeholder="snake_case"
            value={local.key}
            onChange={(e) => apply({ key: e.target.value })}
            onBlur={commit}
          />
          {error?.key && <div className="text-xs text-red-600 mt-1">{error.key}</div>}
        </div>
        <div className="md:col-span-6">
          <label className="text-xs">Kind</label>
          <select
            className={`rounded w-full px-2 py-1 text-sm ${error?.kind ? 'border-red-500 border' : 'border'}`}
            value={local.kind}
            onChange={(e) => { apply({ kind: e.target.value }, true) }}
          >
            {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {error?.kind && <div className="text-xs text-red-600 mt-1">{error.kind}</div>}
        </div>
      </div>

      {/* Details grid: responsive two columns */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs">Label</label>
          <input
            className="border rounded w-full px-2 py-1 text-sm"
            value={local.configJson?.label || ''}
            onChange={(e) => apply({ configJson: { ...(local.configJson||{}), label: e.target.value } })}
            onBlur={commit}
          />
        </div>
        <div>
          <label className="text-xs">Description</label>
          <input
            className="border rounded w-full px-2 py-1 text-sm"
            value={local.configJson?.description || ''}
            onChange={(e) => apply({ configJson: { ...(local.configJson||{}), description: e.target.value } })}
            onBlur={commit}
          />
        </div>

        {(local.kind === 'text' || local.kind === 'multiline') && (
          <>
            <div>
              <label className="text-xs">Editor</label>
              <select
                className="border rounded w-full px-2 py-1 text-sm"
                value={local.configJson?.editor || ''}
                onChange={(e) => { apply({ configJson: { ...(local.configJson||{}), editor: e.target.value || undefined } }, true) }}
              >
                <option value="">Default</option>
                <option value="markdown">Markdown (UIW)</option>
                <option value="simpleMarkdown">Simple Markdown</option>
                <option value="htmlRichText">HTML Rich Text</option>
              </select>
            </div>
            {local.kind === 'text' && (
              <>
                <div className="md:col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={!!local.configJson?.multi} onChange={(e) => { apply({ configJson: { ...(local.configJson||{}), multi: e.target.checked } }, true) }} /> Multiple
                  </label>
                </div>
                {!!local.configJson?.multi && (
                  <>
                    <div>
                      <label className="text-xs">Options (comma-separated)</label>
                      <input
                        className="border rounded w-full px-2 py-1 text-sm"
                        value={Array.isArray(local.configJson?.options) ? local.configJson.options.join(',') : ''}
                        onChange={(e) => apply({ configJson: { ...(local.configJson||{}), options: e.target.value.split(',').map(s => s.trim()) } })}
                        onBlur={commit}
                      />
                    </div>
                    <div>
                      <label className="text-xs">Options URL</label>
                      <input
                        className="border rounded w-full px-2 py-1 text-sm"
                        placeholder="/api/..."
                        value={local.configJson?.optionsUrl || ''}
                        onChange={(e) => apply({ configJson: { ...(local.configJson||{}), optionsUrl: e.target.value } })}
                        onBlur={commit}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {local.kind === 'select' && (
          <>
            <div>
              <label className="text-xs">Options (comma-separated)</label>
              <input
                className="border rounded w-full px-2 py-1 text-sm"
                value={Array.isArray(local.configJson?.options) ? local.configJson.options.join(',') : ''}
                onChange={(e) => apply({ configJson: { ...(local.configJson||{}), options: e.target.value.split(',').map(s => s.trim()) } })}
                onBlur={commit}
              />
            </div>
            <div>
              <label className="text-xs">Options URL</label>
              <input
                className="border rounded w-full px-2 py-1 text-sm"
                placeholder="/api/..."
                value={local.configJson?.optionsUrl || ''}
                onChange={(e) => apply({ configJson: { ...(local.configJson||{}), optionsUrl: e.target.value } })}
                onBlur={commit}
              />
            </div>
            <div className="md:col-span-2">
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!!local.configJson?.multi}
                  onChange={(e) => {
                    const multi = e.target.checked
                    const nextConfig = { ...(local.configJson || {}), multi }
                    if (!multi && nextConfig.input === 'listbox') {
                      delete nextConfig.input
                    }
                    apply({ configJson: nextConfig }, true)
                  }}
                /> Multiple
              </label>
            </div>
            {!!local.configJson?.multi && (
              <div className="md:col-span-2">
                <label className="text-xs">Multi-select input style</label>
                <select
                  className="border rounded w-full px-2 py-1 text-sm"
                  value={local.configJson?.input === 'listbox' ? 'listbox' : 'default'}
                  onChange={(e) => {
                    const { value } = e.target
                    const nextConfig = { ...(local.configJson || {}) }
                    if (value === 'listbox') {
                      nextConfig.input = 'listbox'
                    } else {
                      delete nextConfig.input
                    }
                    apply({ configJson: nextConfig }, true)
                  }}
                >
                  <option value="default">Default</option>
                  <option value="listbox">Listbox (searchable)</option>
                </select>
              </div>
            )}
          </>
        )}

        {local.kind === 'relation' && (
          <>
            <div>
              <label className="text-xs">Related Entity ID</label>
              <input
                className="border rounded w-full px-2 py-1 text-sm font-mono"
                placeholder="module:entity"
                value={local.configJson?.relatedEntityId || ''}
                onChange={(e) => {
                  const relatedEntityId = e.target.value
                  const defOptionsUrl = relatedEntityId ? `/api/entities/relations/options?entityId=${encodeURIComponent(relatedEntityId)}` : ''
                  apply({ configJson: { ...(local.configJson||{}), relatedEntityId, optionsUrl: local.configJson?.optionsUrl || defOptionsUrl } })
                }}
                onBlur={commit}
              />
            </div>
            <div>
              <label className="text-xs">Options URL</label>
              <input
                className="border rounded w-full px-2 py-1 text-sm"
                placeholder="/api/entities/relations/options?..."
                value={local.configJson?.optionsUrl || ''}
                onChange={(e) => apply({ configJson: { ...(local.configJson||{}), optionsUrl: e.target.value } })}
                onBlur={commit}
              />
            </div>
          </>
        )}
      </div>

      {/* Validation rules */}
      <div className="mt-3 pt-3 border-t">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Validation rules</label>
          <button
            type="button"
            className="text-xs px-2 py-1 border rounded hover:bg-gray-50 inline-flex items-center gap-1"
            onClick={() => {
              apply((current) => {
                const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                list.push({ rule: 'required', message: 'This field is required' } as any)
                return { configJson: { ...(current.configJson || {}), validation: list } }
              }, true)
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add rule
          </button>
        </div>
        <div className="space-y-2">
          {(Array.isArray(local.configJson?.validation) ? local.configJson!.validation : []).map((r: any, i: number) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <div className="md:col-span-3">
                <select
                  className="border rounded w-full px-2 py-1 text-sm"
                  value={r?.rule || 'required'}
                  onChange={(e) => {
                    const nextRule = e.target.value
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      const existing = (list[i] as any) || {}
                      list[i] = { ...existing, rule: nextRule, message: existing.message || r?.message || '' }
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    }, true)
                  }}
                >
                  <option value="required">required</option>
                  <option value="date">date</option>
                  <option value="integer">integer</option>
                  <option value="float">float</option>
                  <option value="lt">lt</option>
                  <option value="lte">lte</option>
                  <option value="gt">gt</option>
                  <option value="gte">gte</option>
                  <option value="eq">eq</option>
                  <option value="ne">ne</option>
                  <option value="regex">regex</option>
                </select>
              </div>
              <div className="md:col-span-4">
                <input
                  className="border rounded w-full px-2 py-1 text-sm"
                  placeholder={r?.rule === 'regex' ? 'Pattern (e.g. ^[a-z]+$)' : (['lt','lte','gt','gte'].includes(r?.rule) ? 'Number' : '—')}
                  value={r?.param ?? ''}
                  onChange={(e) => {
                    const v = ['lt','lte','gt','gte'].includes(r?.rule) ? Number(e.target.value) : e.target.value
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      const existing = (list[i] as any) || {}
                      list[i] = { ...existing, ...r, param: v }
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    })
                  }}
                  onBlur={commit}
                  disabled={r?.rule === 'required' || r?.rule === 'date' || r?.rule === 'integer' || r?.rule === 'float'}
                />
              </div>
              <div className="md:col-span-4">
                <input
                  className="border rounded w-full px-2 py-1 text-sm"
                  placeholder="Error message"
                  value={r?.message || ''}
                  onChange={(e) => {
                    const message = e.target.value
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      const existing = (list[i] as any) || {}
                      list[i] = { ...existing, ...r, message }
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    })
                  }}
                  onBlur={commit}
                />
              </div>
              <div className="md:col-span-1 flex justify-end">
                <button
                  type="button"
                  className="px-2 py-1 border rounded hover:bg-gray-50"
                  aria-label="Remove rule"
                  onClick={() => {
                    apply((current) => {
                      const list = Array.isArray(current.configJson?.validation) ? [...current.configJson.validation] : []
                      list.splice(i, 1)
                      return { configJson: { ...(current.configJson || {}), validation: list } }
                    }, true)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {(!Array.isArray(local.configJson?.validation) || local.configJson!.validation.length === 0) && (
            <div className="text-xs text-muted-foreground">No validation rules defined.</div>
          )}
        </div>
      </div>

      {/* Kind-specific config editor via registry */}
      <div className="mt-3">
        {(() => {
          const Editor = FieldRegistry.getDefEditor(local.kind)
          if (!Editor) return null
          return (
            <Editor
              def={{ key: local.key, kind: local.kind, configJson: local.configJson }}
              onChange={(patch) => apply({ configJson: { ...(local.configJson || {}), ...(patch || {}) } }, true)}
            />
          )
        })()}
      </div>

      {/* Bottom row: visibility toggles to keep top clean */}
      <div className="mt-3 pt-2 border-t flex flex-wrap items-center gap-4">
        <span className="text-xs text-muted-foreground">Visibility:</span>
        <label className="inline-flex items-center gap-2 text-xs">
          <input type="checkbox" checked={local.configJson?.listVisible !== false}
            onChange={(e) => { apply({ configJson: { ...(local.configJson||{}), listVisible: e.target.checked } }, true) }} /> List
        </label>
        <label className="inline-flex items-center gap-2 text-xs">
          <input type="checkbox" checked={!!local.configJson?.filterable}
            onChange={(e) => { apply({ configJson: { ...(local.configJson||{}), filterable: e.target.checked } }, true) }} /> Filter
        </label>
        <label className="inline-flex items-center gap-2 text-xs">
          <input type="checkbox" checked={local.configJson?.formEditable !== false}
            onChange={(e) => { apply({ configJson: { ...(local.configJson||{}), formEditable: e.target.checked } }, true) }} /> Form
        </label>
      </div>
    </div>
  )
})

export default function EditDefinitionsPage({ params }: { params?: { entityId?: string } }) {
  React.useEffect(() => { loadGeneratedFieldRegistrations().catch(() => {}) }, [])
  const router = useRouter()
  const queryClient = useQueryClient()
  const entityId = useMemo(() => decodeURIComponent((params?.entityId as any) || ''), [params])
  const [label, setLabel] = useState('')
  const [entitySource, setEntitySource] = useState<'code'|'custom'>('custom')
  const [entityFormLoading, setEntityFormLoading] = useState(true)
  const [entityInitial, setEntityInitial] = useState<{ label?: string; description?: string; labelField?: string; defaultEditor?: string; showInSidebar?: boolean }>({})
  const [defs, setDefs] = useState<Def[]>([])
  const dragIndex = React.useRef<number | null>(null)
  const [orderDirty, setOrderDirty] = useState(false)
  const [orderSaving, setOrderSaving] = useState(false)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletedKeys, setDeletedKeys] = useState<string[]>([])
  const [defErrors, setDefErrors] = useState<Record<number, DefErrors>>({})

  const validateDef = React.useCallback((d: Def): DefErrors => {
    const parsed = upsertCustomFieldDefSchema.safeParse({ entityId, key: d.key, kind: d.kind, configJson: d.configJson, isActive: d.isActive })
    if (parsed.success) return {}
    const errs: DefErrors = {}
    for (const issue of parsed.error.issues) {
      if ((issue.path || []).includes('key')) errs.key = issue.message
      if ((issue.path || []).includes('kind')) errs.kind = issue.message
    }
    return errs
  }, [entityId])

  const validateAndSetErrorAt = (index: number, d: Def) => {
    const errs = validateDef(d)
    setDefErrors((prev) => ({ ...prev, [index]: errs }))
    return !errs.key && !errs.kind
  }

  const validateAll = () => {
    const nextErrors: Record<number, DefErrors> = {}
    defs.forEach((d, i) => {
      nextErrors[i] = validateDef(d)
    })
    setDefErrors(nextErrors)
    return Object.values(nextErrors).every(e => !e.key && !e.kind)
  }

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const entJson = await readApiResultOrThrow<EntitiesListResponse>(
          '/api/entities/entities',
          undefined,
          { errorMessage: 'Failed to load entity metadata', fallback: { items: [] } },
        )
        const ent = (entJson.items || []).find((x: any) => x.entityId === entityId)
        if (mounted) {
          setLabel(ent?.label || entityId)
          if (ent?.source === 'code' || ent?.source === 'custom') setEntitySource(ent.source)
          setEntityInitial({
            label: ent?.label || entityId,
            description: ent?.description || '',
            labelField: (ent as any)?.labelField || 'name',
            defaultEditor: (ent as any)?.defaultEditor || '',
            showInSidebar: (ent as any)?.showInSidebar || false,
          })
          setEntityFormLoading(false)
        }
        const json = await readApiResultOrThrow<DefinitionsManageResponse>(
          `/api/entities/definitions.manage?entityId=${encodeURIComponent(entityId)}`,
          undefined,
          { errorMessage: 'Failed to load entity definitions', fallback: { items: [], deletedKeys: [] } },
        )
        if (mounted) {
          const loaded: Def[] = (json.items || []).map((d: any) => ({ key: d.key, kind: d.kind, configJson: d.configJson || {}, isActive: d.isActive !== false }))
          loaded.sort((a, b) => (a.configJson?.priority ?? 0) - (b.configJson?.priority ?? 0))
          setDefs(loaded)
          setDefErrors({})
          setDeletedKeys(Array.isArray(json.deletedKeys) ? json.deletedKeys : [])
        }
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

  async function restoreField(key: string) {
    try {
      const call = await apiCall('/api/entities/definitions.restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId, key }),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, 'Failed to restore field')
      }
      // Reload definitions & deleted keys
      const j2 = await readApiResultOrThrow<DefinitionsManageResponse>(
        `/api/entities/definitions.manage?entityId=${encodeURIComponent(entityId)}`,
        undefined,
        { errorMessage: 'Failed to reload field definitions', fallback: { items: [], deletedKeys: [] } },
      )
      const loaded: Def[] = (j2.items || []).map((d: any) => ({ key: d.key, kind: d.kind, configJson: d.configJson || {}, isActive: d.isActive !== false }))
      loaded.sort((a, b) => (a.configJson?.priority ?? 0) - (b.configJson?.priority ?? 0))
      setDefs(loaded)
      setDeletedKeys(Array.isArray(j2.deletedKeys) ? j2.deletedKeys : [])
      flash(`Restored ${key}`, 'success')
      await invalidateCustomFieldDefs(queryClient, entityId)
    } catch (e: any) {
      flash(e?.message || 'Failed to restore field', 'error')
    }
  }

  async function saveAll() {
    setSaving(true)
    setError(null)
    try {
      if (!validateAll()) {
        flash('Please fix validation errors in field definitions', 'error')
        throw new Error('Validation failed')
      }
      const payload = {
        entityId,
        definitions: defs.filter(d => !!d.key).map((d) => ({
          key: d.key,
          kind: d.kind,
          configJson: d.configJson,
          isActive: d.isActive !== false,
        })),
      }
      const call = await apiCall('/api/entities/definitions.batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, 'Failed to save definitions')
      }
      await invalidateCustomFieldDefs(queryClient, entityId)
      router.push(`/backend/entities/user?flash=Definitions%20saved&type=success`)
    } catch (e: any) {
      setError(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function removeField(idx: number) {
    const def = defs[idx]
    if (!def) return
    if (def.key) {
      try {
        const call = await apiCall('/api/entities/definitions', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityId, key: def.key }),
        })
        if (!call.ok) {
          await raiseCrudError(call.response, 'Failed to delete field')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete field'
        flash(message, 'error')
        return
      }
    }
    setDefs((arr) => arr.filter((_, i) => i !== idx))
    setOrderDirty(true)
    if (def.key) {
      await invalidateCustomFieldDefs(queryClient, entityId)
    }
  }

  async function saveOrderIfDirty() {
    if (!orderDirty) return
    setOrderSaving(true)
    try {
      // Do not save order when there are invalid keys/kinds
      if (!validateAll()) throw new Error('Validation failed')
      const payload = {
        entityId,
        definitions: defs.filter(d => !!d.key).map((d) => ({
          key: d.key,
          kind: d.kind,
          configJson: d.configJson,
          isActive: d.isActive !== false,
        })),
      }
      const call = await apiCall('/api/entities/definitions.batch', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      })
      if (!call.ok) {
        await raiseCrudError(call.response, 'Failed to save order')
      }
      setOrderDirty(false)
      flash('Order saved', 'success')
      await invalidateCustomFieldDefs(queryClient, entityId)
    } catch (e: any) {
      flash(e?.message || 'Failed to save order', 'error')
    } finally {
      setOrderSaving(false)
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
      // Include showInSidebar so CrudForm doesn't strip it on submit
      showInSidebar: z.boolean().optional(),
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
    ...(entitySource === 'custom' ? [{ id: 'showInSidebar', label: 'Show in sidebar', type: 'checkbox' }] : []),
  ]
  const groups: CrudFormGroup[] = [
    { id: 'settings', title: 'Entity Settings', column: 1, fields: entitySource === 'custom' ? ['label','description','defaultEditor','showInSidebar'] : ['label','description','defaultEditor'] },
    { id: 'definitions', title: 'Field Definitions', column: 1, component: () => (
      <div ref={listRef} className="space-y-3" tabIndex={-1} onBlur={(e) => {
        const cur = listRef.current
        const next = e.relatedTarget as Node | null
        if (!cur) return
        // Only trigger when focus leaves the whole list container
        if (!next || !cur.contains(next)) {
          saveOrderIfDirty()
        }
      }}>
        {orderDirty && (
          <div className="sticky top-0 z-10 -mt-1 -mb-1">
            <div className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border bg-amber-50 text-amber-800 shadow-sm">
              {orderSaving ? 'Saving order…' : 'Reordered — will auto-save on blur'}
            </div>
          </div>
        )}
        {defs.map((d, i) => (
          <div
            key={d.key || `new-${i}`}
            className="group"
            draggable
            onDragStart={() => { dragIndex.current = i }}
            onDragOver={(e) => { e.preventDefault() }}
            onDrop={() => {
              const from = dragIndex.current
              if (from == null || from === i) return
              setDefs((arr) => {
                const next = [...arr]
                const [m] = next.splice(from, 1)
                next.splice(i, 0, m)
                return next
              })
              dragIndex.current = null
              setOrderDirty(true)
            }}
            onDragEnd={() => { dragIndex.current = null; setOrderDirty(true) }}
            tabIndex={0}
            onKeyDown={(e) => {
              if (!e.altKey) return
              if (e.key === 'ArrowUp' || e.key === 'Up') {
                e.preventDefault()
                setDefs((arr) => {
                  if (i <= 0) return arr
                  const next = [...arr]
                  const [m] = next.splice(i, 1)
                  next.splice(i - 1, 0, m)
                  return next
                })
                setOrderDirty(true)
              }
              if (e.key === 'ArrowDown' || e.key === 'Down') {
                e.preventDefault()
                setDefs((arr) => {
                  if (i >= arr.length - 1) return arr
                  const next = [...arr]
                  const [m] = next.splice(i, 1)
                  next.splice(i + 1, 0, m)
                  return next
                })
                setOrderDirty(true)
              }
            }}
          >
            <FieldCard d={d} error={defErrors[i]} onChange={(nd) => {
              setDefs((arr) => arr.map((x, idx) => (idx === i ? nd : x)))
              // Validate after change to provide instant feedback on blur/commit
              validateAndSetErrorAt(i, nd)
            }} onRemove={() => removeField(i)} />
          </div>
        ))}
        <div>
          <button type="button" onClick={addField} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 inline-flex items-center gap-1">
            <Plus className="h-4 w-4" /> Add Field
          </button>
          <div className="text-xs text-gray-500 mt-2">Supported kinds: text, multiline, integer, float, boolean, select (with options/optionsUrl), relation (set relatedEntityId and optionsUrl).</div>
          {deletedKeys.length > 0 && (
            <div className="text-xs text-gray-500 mt-2">
              Restore deleted fields: {' '}
              {deletedKeys.map((k, i) => (
                <span key={k}>
                  <button type="button" className="underline hover:no-underline text-blue-600 disabled:opacity-50" onClick={() => restoreField(k)}>{k}</button>
                  {i < deletedKeys.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
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
          backHref={entitySource === 'code' ? "/backend/entities/system" : "/backend/entities/user"}
          fields={fields}
          groups={groups}
          initialValues={entityInitial as any}
          isLoading={entityFormLoading || loading}
          submitLabel="Save"
          deleteVisible={entitySource === 'custom'}
          extraActions={entitySource === 'custom' ? (
            <Button variant="outline" asChild>
              <Link href={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}>
                Show Records
              </Link>
            </Button>
          ) : null}
          cancelHref={entitySource === 'code' ? "/backend/entities/system" : "/backend/entities/user"}
          successRedirect={entitySource === 'code' ? "/backend/entities/system?flash=Definitions%20saved&type=success" : "/backend/entities/user?flash=Definitions%20saved&type=success"}
          onSubmit={async (vals) => {
            // Validate fields client-side before hitting the API
            if (!validateAll()) {
              flash('Please fix validation errors in field definitions', 'error')
              throw createCrudFormError('Please fix validation errors in field definitions')
            }
            // Save entity settings only for custom entities
            if (entitySource === 'custom') {
              // Treat showInSidebar as optional to avoid defaulting to false when omitted
              const partial = upsertCustomEntitySchema
                .pick({ label: true, description: true, labelField: true as any, defaultEditor: true as any })
                .extend({ showInSidebar: z.boolean().optional() }) as unknown as z.ZodTypeAny
              const normalized = { 
                ...(vals as any), 
                defaultEditor: (vals as any)?.defaultEditor || undefined,
              }
              const parsed = partial.safeParse(normalized)
              if (!parsed.success) throw createCrudFormError('Validation failed')
              const callEntity = await apiCall('/api/entities/entities', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityId, ...(parsed.data as any) })
              })
              if (!callEntity.ok) {
                await raiseCrudError(callEntity.response, 'Failed to save entity')
              }
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
            }
            // Save definitions in a single batch (transactional)
            const defsPayload = {
              entityId,
              definitions: defs.filter(d => !!d.key).map((d) => ({
                key: d.key,
                kind: d.kind,
                configJson: d.configJson,
                isActive: d.isActive !== false,
              })),
            }
            const callDefs = await apiCall('/api/entities/definitions.batch', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(defsPayload)
            })
            if (!callDefs.ok) {
              await raiseCrudError(callDefs.response, 'Failed to save definitions')
            }
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
            // Invalidate all custom field definition caches so DataTables refresh with new labels
            await invalidateCustomFieldDefs(queryClient, entityId)
            flash('Definitions saved', 'success')
          }}
        onDelete={entitySource === 'custom' ? async () => {
          const callDelete = await apiCall('/api/entities/entities', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityId }) })
          if (!callDelete.ok) {
            await raiseCrudError(callDelete.response, 'Failed to delete entity')
          }
          flash('Entity deleted', 'success')
          try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
        } : undefined}
      />
      </PageBody>
    </Page>
  )
}
