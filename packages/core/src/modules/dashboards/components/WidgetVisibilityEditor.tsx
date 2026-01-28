"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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

export type WidgetVisibilityEditorHandle = {
  save: () => Promise<void>
}

const EMPTY: string[] = []

export const WidgetVisibilityEditor = React.forwardRef<WidgetVisibilityEditorHandle, WidgetVisibilityEditorProps>(function WidgetVisibilityEditor(props, ref) {
  const t = useT()
  const { kind, targetId, tenantId, organizationId } = props
  const [catalog, setCatalog] = React.useState<WidgetCatalogItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [selected, setSelected] = React.useState<string[]>(EMPTY)
  const [original, setOriginal] = React.useState<string[]>(EMPTY)
  const [mode, setMode] = React.useState<'inherit' | 'override'>('inherit')
  const [originalMode, setOriginalMode] = React.useState<'inherit' | 'override'>('inherit')
  const [effective, setEffective] = React.useState<string[]>(EMPTY)

  const dirty = React.useMemo(() => {
    if (kind === 'user') {
      if (mode !== originalMode) return true
      if (mode === 'override') return selected.join('|') !== original.join('|')
      return false
    }
    return selected.join('|') !== original.join('|')
  }, [kind, mode, original, originalMode, selected])

  const loadCatalog = React.useCallback(async () => {
    const data = await readApiResultOrThrow<{ items?: unknown[] }>(
      '/api/dashboards/widgets/catalog',
      undefined,
      { errorMessage: t('dashboards.widgets.error.load', 'Unable to load widget configuration.') },
    )
    const items = Array.isArray(data?.items) ? data.items : []
    const mapped = items
      .map((item: unknown): WidgetCatalogItem | null => {
        if (!item || typeof item !== 'object') return null
        const entry = item as Record<string, unknown>
        const id = typeof entry.id === 'string' ? entry.id : null
        if (!id || !id.length) return null
        const title =
          typeof entry.title === 'string' && entry.title.length ? entry.title : id
        const description =
          typeof entry.description === 'string' && entry.description.length ? entry.description : null
        return { id, title, description }
      })
      .filter((item: WidgetCatalogItem | null): item is WidgetCatalogItem => item !== null)
    setCatalog(mapped)
  }, [t])

  const loadRoleData = React.useCallback(async () => {
    const params = new URLSearchParams({ roleId: targetId })
    if (tenantId) params.set('tenantId', tenantId)
    if (organizationId) params.set('organizationId', organizationId)
    const data = await readApiResultOrThrow<RoleResponse>(
      `/api/dashboards/roles/widgets?${params.toString()}`,
      undefined,
      { errorMessage: t('dashboards.widgets.error.load', 'Unable to load widget configuration.') },
    )
    const ids = Array.isArray(data.widgetIds) ? data.widgetIds : []
    setSelected(ids)
    setOriginal(ids)
    setMode('override')
    setOriginalMode('override')
    setEffective(ids)
  }, [organizationId, targetId, tenantId, t])

  const loadUserData = React.useCallback(async () => {
    const params = new URLSearchParams({ userId: targetId })
    if (tenantId) params.set('tenantId', tenantId)
    if (organizationId) params.set('organizationId', organizationId)
    const data = await readApiResultOrThrow<UserResponse>(
      `/api/dashboards/users/widgets?${params.toString()}`,
      undefined,
      { errorMessage: t('dashboards.widgets.error.load', 'Unable to load widget configuration.') },
    )
    const ids = Array.isArray(data.widgetIds) ? data.widgetIds : []
    setSelected(ids)
    setOriginal(ids)
    setMode(data.mode || 'inherit')
    setOriginalMode(data.mode || 'inherit')
    setEffective(Array.isArray(data.effectiveWidgetIds) ? data.effectiveWidgetIds : [])
  }, [organizationId, targetId, tenantId, t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        await loadCatalog()
        if (kind === 'role') await loadRoleData()
        else await loadUserData()
      } catch (err) {
        console.error('Failed to load widget visibility data', err)
        if (!cancelled) {
          setError(t('dashboards.widgets.error.load', 'Unable to load widget configuration.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [kind, loadCatalog, loadRoleData, loadUserData, t])

  const toggle = React.useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  }, [])

  const resetSelections = React.useCallback(() => {
    setSelected(original)
    setMode(originalMode)
  }, [original, originalMode])

  const save = React.useCallback(async () => {
    if (loading) return
    if (error && catalog.length === 0) return
    if (!dirty) return
    setSaving(true)
    setError(null)
    try {
      const saveError = t('dashboards.widgets.error.save', 'Unable to save dashboard widget preferences.')
      if (kind === 'role') {
        const payload = {
          roleId: targetId,
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          widgetIds: selected,
        }
        await apiCallOrThrow('/api/dashboards/roles/widgets', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }, { errorMessage: saveError })
        setOriginal(selected)
        setOriginalMode('override')
        setEffective(selected)
      } else {
        const payload = {
          userId: targetId,
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          mode,
          widgetIds: selected,
        }
        await apiCallOrThrow('/api/dashboards/users/widgets', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }, { errorMessage: saveError })
        setOriginal(selected)
        if (mode === 'inherit') {
          const refreshed = await readApiResultOrThrow<UserResponse>(
            `/api/dashboards/users/widgets?userId=${encodeURIComponent(targetId)}`,
            undefined,
            { errorMessage: saveError },
          )
          setEffective(Array.isArray(refreshed.effectiveWidgetIds) ? refreshed.effectiveWidgetIds : [])
        } else {
          setEffective(selected)
        }
        setOriginal(selected)
        setOriginalMode(mode)
      }
      try { flash(t('dashboards.widgets.flash.saved', 'Dashboard widgets updated'), 'success') } catch {}
    } catch (err) {
      console.error('Failed to save widget visibility', err)
      setError(t('dashboards.widgets.error.save', 'Unable to save dashboard widget preferences.'))
    } finally {
      setSaving(false)
    }
  }, [catalog.length, dirty, error, kind, loading, mode, organizationId, selected, t, targetId, tenantId])

  React.useImperativeHandle(ref, () => ({ save }), [save])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" /> {t('dashboards.widgets.loading', 'Loading widget options…')}
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

      {kind === 'user' && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="widgetOverride"
              value="inherit"
              checked={mode === 'inherit'}
              onChange={() => setMode('inherit')}
            />
            {t('dashboards.widgets.mode.inherit', 'Inherit from roles')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="widgetOverride"
              value="override"
              checked={mode === 'override'}
              onChange={() => setMode('override')}
            />
            {t('dashboards.widgets.mode.override', 'Override for this user')}
          </label>
        </div>
      )}

      {kind === 'user' && mode === 'inherit' && (
        <div className="rounded-md border border-muted bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {t('dashboards.widgets.mode.hint', 'This user currently inherits widgets from their assigned roles. Switch to override to customize.')}
        </div>
      )}

      {(kind === 'role' || mode === 'override') && (
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

      {kind === 'user' && effective.length > 0 && (
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
})

WidgetVisibilityEditor.displayName = 'WidgetVisibilityEditor'
