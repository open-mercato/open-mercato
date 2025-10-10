"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type WidgetCatalogItem = {
  id: string
  title: string
  description: string | null
}

type RoleResponse = {
  widgetIds: string[]
  hasCustom: boolean
  scope: { tenantId: string | null; organizationId: string | null }
}

type UserResponse = {
  mode: 'inherit' | 'override'
  widgetIds: string[]
  hasCustom: boolean
  effectiveWidgetIds: string[]
  scope: { tenantId: string | null; organizationId: string | null }
}

type BaseProps = {
  tenantId?: string | null
  organizationId?: string | null
}

type RoleProps = BaseProps & {
  kind: 'role'
  targetId: string
}

type UserProps = BaseProps & {
  kind: 'user'
  targetId: string
}

type WidgetVisibilityEditorProps = RoleProps | UserProps

const EMPTY: string[] = []

export function WidgetVisibilityEditor(props: WidgetVisibilityEditorProps) {
  const [catalog, setCatalog] = React.useState<WidgetCatalogItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [selected, setSelected] = React.useState<string[]>(EMPTY)
  const [original, setOriginal] = React.useState<string[]>(EMPTY)
  const [mode, setMode] = React.useState<'inherit' | 'override'>('inherit')
  const [originalMode, setOriginalMode] = React.useState<'inherit' | 'override'>('inherit')
  const [effective, setEffective] = React.useState<string[]>(EMPTY)

  const loadCatalog = React.useCallback(async () => {
    const res = await apiFetch('/api/dashboards/widgets/catalog')
    if (!res.ok) throw new Error(`Failed with status ${res.status}`)
    const data = await res.json()
    const items = Array.isArray(data.items) ? data.items : []
    setCatalog(items.map((item) => ({ id: item.id, title: item.title, description: item.description ?? null })))
  }, [])

  const loadRoleData = React.useCallback(async () => {
    const params = new URLSearchParams({ roleId: props.targetId })
    if (props.tenantId) params.set('tenantId', props.tenantId)
    if (props.organizationId) params.set('organizationId', props.organizationId)
    const res = await apiFetch(`/api/dashboards/roles/widgets?${params.toString()}`)
    if (!res.ok) throw new Error(`Failed with status ${res.status}`)
    const data: RoleResponse = await res.json()
    const ids = Array.isArray(data.widgetIds) ? data.widgetIds : []
    setSelected(ids)
    setOriginal(ids)
    setMode('override')
    setOriginalMode('override')
    setEffective(ids)
  }, [props])

  const loadUserData = React.useCallback(async () => {
    const params = new URLSearchParams({ userId: props.targetId })
    if (props.tenantId) params.set('tenantId', props.tenantId)
    if (props.organizationId) params.set('organizationId', props.organizationId)
    const res = await apiFetch(`/api/dashboards/users/widgets?${params.toString()}`)
    if (!res.ok) throw new Error(`Failed with status ${res.status}`)
    const data: UserResponse = await res.json()
    const ids = Array.isArray(data.widgetIds) ? data.widgetIds : []
    setSelected(ids)
    setOriginal(ids)
    setMode(data.mode || 'inherit')
    setOriginalMode(data.mode || 'inherit')
    setEffective(Array.isArray(data.effectiveWidgetIds) ? data.effectiveWidgetIds : [])
  }, [props])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        await loadCatalog()
        if (props.kind === 'role') await loadRoleData()
        else await loadUserData()
      } catch (err) {
        console.error('Failed to load widget visibility data', err)
        if (!cancelled) setError('Unable to load widget configuration.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [loadCatalog, loadRoleData, loadUserData, props.kind])

  const toggle = React.useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  }, [])

  const resetSelections = React.useCallback(() => {
    setSelected(original)
    setMode(originalMode)
  }, [original, originalMode])

  const save = React.useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      if (props.kind === 'role') {
        const payload = {
          roleId: props.targetId,
          tenantId: props.tenantId ?? null,
          organizationId: props.organizationId ?? null,
          widgetIds: selected,
        }
        const res = await apiFetch('/api/dashboards/roles/widgets', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error(`Failed with status ${res.status}`)
        setOriginal(selected)
        setOriginalMode('override')
        setEffective(selected)
      } else {
        const payload = {
          userId: props.targetId,
          tenantId: props.tenantId ?? null,
          organizationId: props.organizationId ?? null,
          mode,
          widgetIds: selected,
        }
        const res = await apiFetch('/api/dashboards/users/widgets', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error(`Failed with status ${res.status}`)
        setOriginal(selected)
        if (mode === 'inherit') {
          const refreshed = await apiFetch(`/api/dashboards/users/widgets?userId=${encodeURIComponent(props.targetId)}`)
          if (refreshed.ok) {
            const data: UserResponse = await refreshed.json()
            setEffective(Array.isArray(data.effectiveWidgetIds) ? data.effectiveWidgetIds : [])
          }
        } else {
          setEffective(selected)
        }
        setOriginal(selected)
        setOriginalMode(mode)
      }
      try { flash('Dashboard widgets updated', 'success') } catch {}
    } catch (err) {
      console.error('Failed to save widget visibility', err)
      setError('Unable to save dashboard widget preferences.')
    } finally {
      setSaving(false)
    }
  }, [mode, props, selected])

  const dirty = React.useMemo(() => {
    if (props.kind === 'user') {
      if (mode !== originalMode) return true
      if (mode === 'override') return selected.join('|') !== original.join('|')
      return false
    }
    return selected.join('|') !== original.join('|')
  }, [mode, original, originalMode, props.kind, selected])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" /> Loading widget options…
      </div>
    )
  }

  if (error && catalog.length === 0) {
    return <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {props.kind === 'user' && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="widgetOverride"
              value="inherit"
              checked={mode === 'inherit'}
              onChange={() => setMode('inherit')}
            />
            Inherit from roles
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="widgetOverride"
              value="override"
              checked={mode === 'override'}
              onChange={() => setMode('override')}
            />
            Override for this user
          </label>
        </div>
      )}

      {props.kind === 'user' && mode === 'inherit' && (
        <div className="rounded-md border border-muted bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          This user currently inherits widgets from their assigned roles. Switch to override to customize.
        </div>
      )}

      {(props.kind === 'role' || mode === 'override') && (
        <div className="space-y-3">
          {catalog.map((widget) => (
            <label key={widget.id} className="flex items-start gap-3 rounded-md border px-3 py-2 hover:border-primary/40">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={selected.includes(widget.id)}
                onChange={() => toggle(widget.id)}
              />
              <div>
                <div className="text-sm font-medium leading-none">{widget.title}</div>
                {widget.description ? <div className="mt-1 text-xs text-muted-foreground">{widget.description}</div> : null}
              </div>
            </label>
          ))}
        </div>
      )}

      {props.kind === 'user' && effective.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Effective widgets: {effective.map((id) => catalog.find((meta) => meta.id === id)?.title || id).join(', ')}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save widgets'}
        </Button>
        <Button type="button" variant="ghost" onClick={resetSelections} disabled={!dirty}>
          Reset
        </Button>
      </div>
    </div>
  )
}
