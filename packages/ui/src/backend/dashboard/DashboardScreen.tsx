"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { loadDashboardWidgetModule } from './widgetRegistry'
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { cn } from '@/lib/utils'
import { GripVertical, Plus, Settings2, Trash2, X, Loader2 } from 'lucide-react'

type DashboardWidgetSize = 'sm' | 'md' | 'lg'

type LayoutItem = {
  id: string
  widgetId: string
  order: number
  priority?: number
  size?: DashboardWidgetSize
  settings?: unknown
}

type WidgetMeta = {
  id: string
  title: string
  description: string | null
  defaultSize: DashboardWidgetSize
  defaultEnabled: boolean
  defaultSettings: unknown
  features: string[]
  moduleId: string
  icon: string | null
  loaderKey: string
}

type LayoutContext = {
  userId: string
  tenantId: string | null
  organizationId: string | null
  userName: string | null
  userEmail: string | null
  userLabel: string | null
}

type LayoutResponse = {
  layout: { items: LayoutItem[] }
  widgets: WidgetMeta[]
  allowedWidgetIds: string[]
  canConfigure: boolean
  context: LayoutContext
}

type WidgetModule = DashboardWidgetModule<any>

function sizeClass(size: DashboardWidgetSize | undefined) {
  switch (size) {
    case 'lg':
      return 'md:col-span-2'
    case 'md':
      return 'md:col-span-1'
    case 'sm':
    default:
      return 'md:col-span-1'
  }
}

function sortLayout(items: LayoutItem[]): LayoutItem[] {
  return [...items]
    .sort((a, b) => {
      const aOrder = a.order ?? a.priority ?? 0
      const bOrder = b.order ?? b.priority ?? 0
      return aOrder - bOrder
    })
    .map((item, index) => ({ ...item, order: index, priority: index }))
}

const DEFAULT_SIZE: DashboardWidgetSize = 'md'

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: timestamp + random for better uniqueness
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export function DashboardScreen() {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [layout, setLayout] = React.useState<LayoutItem[]>([])
  const [widgetCatalog, setWidgetCatalog] = React.useState<WidgetMeta[]>([])
  const [allowedWidgetIds, setAllowedWidgetIds] = React.useState<string[]>([])
  const [canConfigure, setCanConfigure] = React.useState(false)
  const [context, setContext] = React.useState<LayoutContext | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [settingsId, setSettingsId] = React.useState<string | null>(null)
  const pendingOpsRef = React.useRef(0)
  const saveQueueRef = React.useRef(Promise.resolve())
  const draggingIdRef = React.useRef<string | null>(null)

  const adjustSaving = React.useCallback((delta: number) => {
    pendingOpsRef.current = Math.max(0, pendingOpsRef.current + delta)
    setSaving(pendingOpsRef.current > 0)
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/dashboards/layout')
      if (!res.ok) {
        throw new Error(`Failed with status ${res.status}`)
      }
      const data: LayoutResponse = await res.json()
      const normalizedLayout = sortLayout(data.layout?.items ?? [])
      setLayout(normalizedLayout)
      setWidgetCatalog(data.widgets ?? [])
      setAllowedWidgetIds(data.allowedWidgetIds ?? [])
      setCanConfigure(!!data.canConfigure)
      if (data.context) {
        setContext({
          userId: data.context.userId,
          tenantId: data.context.tenantId ?? null,
          organizationId: data.context.organizationId ?? null,
          userName: data.context.userName ?? null,
          userEmail: data.context.userEmail ?? null,
          userLabel: data.context.userLabel ?? null,
        })
      } else {
        setContext(null)
      }
      if (!data.canConfigure) {
        setEditing(false)
        setSettingsId(null)
      }
    } catch (err) {
      console.error('Failed to load dashboard layout', err)
      setError('Unable to load dashboard data. Please try again later.')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const metaById = React.useMemo(() => {
    const map = new Map<string, WidgetMeta>()
    for (const meta of widgetCatalog) map.set(meta.id, meta)
    return map
  }, [widgetCatalog])

  const availableWidgets = React.useMemo(() => {
    const currentIds = new Set(layout.map((item) => item.widgetId))
    return widgetCatalog.filter((meta) => !currentIds.has(meta.id))
  }, [layout, widgetCatalog])

  const queueLayoutSave = React.useCallback((items: LayoutItem[]) => {
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      adjustSaving(1)
      try {
        const payload = {
          items: items.map((item, index) => ({
            id: item.id,
            widgetId: item.widgetId,
            order: index,
            priority: index,
            size: item.size ?? DEFAULT_SIZE,
            settings: item.settings ?? null,
          })),
        }
        const res = await apiFetch('/api/dashboards/layout', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error(`Failed with status ${res.status}`)
        setError(null)
      } catch (err) {
        console.error('Failed to save layout', err)
        setError('Unable to save dashboard layout changes.')
      } finally {
        adjustSaving(-1)
      }
    })
  }, [adjustSaving])

  const patchWidgetSettings = React.useCallback(async (itemId: string, nextSettings: unknown) => {
    adjustSaving(1)
    try {
      const res = await apiFetch(`/api/dashboards/layout/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: nextSettings }),
      })
      if (!res.ok) throw new Error(`Failed with status ${res.status}`)
      setError(null)
    } catch (err) {
      console.error('Failed to update widget settings', err)
      setError('Unable to update widget settings.')
    } finally {
      adjustSaving(-1)
    }
  }, [adjustSaving])

  const handleAddWidget = React.useCallback((widgetId: string) => {
    const meta = metaById.get(widgetId)
    if (!meta) return
    setLayout((prev) => {
      const next: LayoutItem[] = sortLayout([
        ...prev,
        {
          id: generateId(),
          widgetId: meta.id,
          order: prev.length,
          priority: prev.length,
          size: meta.defaultSize ?? DEFAULT_SIZE,
          settings: meta.defaultSettings ?? null,
        },
      ])
      queueLayoutSave(next)
      return next
    })
    setSettingsId(null)
  }, [metaById, queueLayoutSave])

  const handleRemoveWidget = React.useCallback((itemId: string) => {
    setLayout((prev) => {
      const next = sortLayout(prev.filter((item) => item.id !== itemId))
      queueLayoutSave(next)
      return next
    })
    if (settingsId === itemId) setSettingsId(null)
  }, [queueLayoutSave, settingsId])

  const handleReorder = React.useCallback((dragId: string | null, targetId: string) => {
    if (!dragId || dragId === targetId) return
    setLayout((prev) => {
      const items = [...prev]
      const from = items.findIndex((item) => item.id === dragId)
      const to = items.findIndex((item) => item.id === targetId)
      if (from === -1 || to === -1) return prev
      const [moved] = items.splice(from, 1)
      items.splice(to, 0, moved)
      const next = items.map((item, index) => ({
        ...item,
        order: index,
        priority: index,
      }))
      queueLayoutSave(next)
      return next
    })
  }, [queueLayoutSave])

  const handleSettingsChange = React.useCallback((itemId: string, nextSettings: unknown) => {
    setLayout((prev) => prev.map((item) => (item.id === itemId ? { ...item, settings: nextSettings } : item)))
    void patchWidgetSettings(itemId, nextSettings)
  }, [patchWidgetSettings])

  const toggleEditing = React.useCallback(() => {
    if (!canConfigure) return
    setEditing((prev) => {
      const next = !prev
      if (!next) setSettingsId(null)
      return next
    })
  }, [canConfigure])

  const handleRefresh = React.useCallback(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error && layout.length === 0) {
    return (
      <ErrorNotice
        title="Dashboard unavailable"
        message={error}
        action={<Button variant="outline" onClick={handleRefresh}>Retry</Button>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Arrange and personalize the widgets you see on your admin start page.</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Saving…</span>
            </div>
          )}
          {canConfigure && (
            <Button variant={editing ? 'secondary' : 'outline'} onClick={toggleEditing}>
              <Settings2 className="h-4 w-4" />
              <span>{editing ? 'Done' : 'Customize'}</span>
            </Button>
          )}
        </div>
      </div>

      {error && layout.length > 0 && (
        <ErrorNotice
          title="Some changes were not saved"
          message={error}
          action={<Button variant="ghost" onClick={handleRefresh}>Reload data</Button>}
        />
      )}

      {editing && availableWidgets.length > 0 && (
        <div className="rounded-lg border border-dashed bg-muted/40 p-4">
          <div className="mb-2 text-sm font-medium text-muted-foreground">Add a widget</div>
          <div className="flex flex-wrap gap-2">
            {availableWidgets.map((meta) => (
              <Button
                key={meta.id}
                variant="outline"
                size="sm"
                onClick={() => handleAddWidget(meta.id)}
              >
                <Plus className="h-4 w-4" />
                {meta.title}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className={cn(
        'grid gap-4',
        'grid-cols-1',
        'md:grid-cols-2',
        'xl:grid-cols-3'
      )}
      onDragOver={(event) => {
        if (!editing || !canConfigure) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        if (!editing || !canConfigure) return
        event.preventDefault()
        const dragId = event.dataTransfer.getData('text/plain') || draggingIdRef.current
        if (!dragId) return
        setLayout((prev) => {
          const items = [...prev]
          const from = items.findIndex((entry) => entry.id === dragId)
          if (from === -1) return prev
          const [moved] = items.splice(from, 1)
          items.push(moved)
          const next = items.map((item, index) => ({
            ...item,
            order: index,
            priority: index,
          }))
          queueLayoutSave(next)
          return next
        })
        draggingIdRef.current = null
      }}>
        {layout.map((item) => {
          const meta = metaById.get(item.widgetId)
          if (!meta) return null
          return (
            <DashboardWidgetCard
              key={item.id}
              item={item}
              meta={meta}
              context={context}
              editing={editing && canConfigure}
              activeSettings={settingsId === item.id}
              onToggleSettings={() => setSettingsId((current) => (current === item.id ? null : item.id))}
              onRemove={() => handleRemoveWidget(item.id)}
              onSettingsChange={(settings) => handleSettingsChange(item.id, settings)}
              onDragStart={() => { draggingIdRef.current = item.id }}
              onDragEnd={() => { draggingIdRef.current = null }}
              onDrop={(event) => {
                const dragId = event.dataTransfer.getData('text/plain') || draggingIdRef.current
                handleReorder(dragId, item.id)
                draggingIdRef.current = null
              }}
              onDragEnter={() => {}}
              onDragLeave={() => {}}
              sizeClass={sizeClass(item.size)}
            />
          )
        })}
      </div>

      {layout.length === 0 && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          {canConfigure ? 'No widgets selected yet. Use “Add a widget” to start building your dashboard.' : 'No widgets are available for your account yet.'}
        </div>
      )}
    </div>
  )
}

type DashboardWidgetCardProps = {
  item: LayoutItem
  meta: WidgetMeta
  context: LayoutContext | null
  editing: boolean
  activeSettings: boolean
  onToggleSettings: () => void
  onRemove: () => void
  onSettingsChange: (next: unknown) => void
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnter: () => void
  onDragLeave: () => void
  sizeClass: string
}

function DashboardWidgetCard({
  item,
  meta,
  context,
  editing,
  activeSettings,
  onToggleSettings,
  onRemove,
  onSettingsChange,
  onDragStart,
  onDragEnd,
  onDrop,
  onDragEnter,
  onDragLeave,
  sizeClass,
}: DashboardWidgetCardProps) {
  const [module, setModule] = React.useState<WidgetModule | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    loadDashboardWidgetModule(meta.loaderKey)
      .then((loaded) => {
        if (cancelled) return
        setModule(loaded)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load widget module', err)
        setLoadError('Unable to load widget')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [meta.loaderKey])

  const hydratedSettings = React.useMemo(() => {
    const raw = item.settings ?? meta.defaultSettings ?? null
    if (module?.hydrateSettings) {
      try {
        return module.hydrateSettings(raw)
      } catch (err) {
        console.warn('Failed to hydrate widget settings', err)
        return raw
      }
    }
    return raw
  }, [item.settings, meta.defaultSettings, module])

  const handleSettingsChange = React.useCallback((next: unknown) => {
    let raw = next
    if (module?.dehydrateSettings) {
      try {
        raw = module.dehydrateSettings(next as never)
      } catch (err) {
        console.warn('Failed to dehydrate widget settings', err)
      }
    }
    onSettingsChange(raw)
  }, [module, onSettingsChange])

  const WidgetComponent = module?.Widget
  const mode = activeSettings ? 'settings' : 'view'

  return (
    <div
      className={cn(
        'group relative flex h-full flex-col rounded-lg border bg-background shadow-sm transition',
        isDragOver ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/40',
        editing ? 'cursor-grab' : 'cursor-default',
        sizeClass
      )}
      draggable={editing}
      onDragStart={(event) => {
        if (!editing) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', item.id)
        onDragStart()
      }}
      onDragEnd={() => {
        if (!editing) return
        onDragEnd()
      }}
      onDragOver={(event) => {
        if (!editing) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        if (!isDragOver) {
          setIsDragOver(true)
          onDragEnter()
        }
      }}
      onDrop={(event) => {
        if (!editing) return
        event.preventDefault()
        event.stopPropagation()
        onDrop(event)
        setIsDragOver(false)
        onDragLeave()
      }}
      onDragLeave={(event) => {
        if (!editing) return
        event.stopPropagation()
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setIsDragOver(false)
        onDragLeave()
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          {editing && <GripVertical className="h-4 w-4 text-muted-foreground" />}
          <div>
            <div className="text-sm font-medium leading-none">{meta.title}</div>
            {meta.description ? <div className="text-xs text-muted-foreground">{meta.description}</div> : null}
          </div>
        </div>
        {editing && (
          <div className="flex items-center gap-1">
            <Button
              variant={activeSettings ? 'secondary' : 'ghost'}
              size="icon"
              onClick={onToggleSettings}
              aria-label={activeSettings ? 'Close settings' : 'Edit settings'}
            >
              {activeSettings ? <X className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label="Remove widget"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <div className="flex-1 p-4">
        {loading && (
          <div className="flex h-full min-h-[120px] items-center justify-center">
            <Spinner />
          </div>
        )}
        {loadError && !loading && (
          <div className="text-sm text-muted-foreground">{loadError}</div>
        )}
        {!loading && !loadError && WidgetComponent && (
          <WidgetComponent
            mode={mode as 'view' | 'settings'}
            layout={item}
            context={context ?? { userId: '', tenantId: null, organizationId: null, userName: null, userEmail: null, userLabel: null }}
            settings={hydratedSettings}
            onSettingsChange={handleSettingsChange}
          />
        )}
      </div>
    </div>
  )
}
