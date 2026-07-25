"use client"

import * as React from 'react'
import { Plus, Sparkles, Wand2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { InjectionSpot } from '../../injection/InjectionSpot'
import { getDashboardWidgets, loadDashboardWidgetModule } from '../widgetRegistry'
import { WidgetDataBatchProvider } from '../widgetData'
import type { DashboardGlobalDateRange, DashboardLayoutItem, DashboardWidgetModule, DashboardWidgetRenderContext, DashboardWidgetSize } from '@open-mercato/shared/modules/dashboard/widgets'
import { DashboardHeader } from './DashboardHeader'
import { GridLayout, sizeToSpanClass } from './GridLayout'
import { defaultGlobalRange, GLOBAL_RANGE_PRESETS, resolveGlobalDateRange, type DashboardDateRangeCompare, type DashboardDateRangePreset } from './dateRange'
import { WidgetCardV2, type DashboardWidgetCatalogItem } from './WidgetCardV2'

const logger = createLogger('ui').child({ component: 'DashboardScreenV2' })

type LayoutPreferences = { dateRange?: Partial<DashboardGlobalDateRange> | null }
export type DashboardPreset = { id: string; name: string; items: DashboardLayoutItem[]; preferences?: LayoutPreferences | null }
type LayoutEnvelope = { items?: DashboardLayoutItem[]; preferences?: LayoutPreferences | null; presets?: DashboardPreset[]; activePresetId?: string | null }
type LayoutResponse = { layout?: LayoutEnvelope | DashboardLayoutItem[]; preferences?: LayoutPreferences | null; widgets?: DashboardWidgetCatalogItem[]; allowedWidgetIds?: string[]; canConfigure?: boolean; context?: DashboardWidgetRenderContext | null }

export const MAX_DASHBOARD_PRESETS = 12
type ModuleState = { loading: boolean; module: DashboardWidgetModule<any> | null; error: string | null }

const DEFAULT_SIZE: DashboardWidgetSize = 'md'

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

function sortLayout(items: DashboardLayoutItem[]): DashboardLayoutItem[] {
  return [...items].sort((a, b) => (a.order ?? a.priority ?? 0) - (b.order ?? b.priority ?? 0)).map((item, index) => ({ ...item, order: index, priority: index }))
}

// Splice alone is not enough: updateLayout re-sorts by the order field, so the moved
// items MUST be reindexed to their new array positions or the sort reverts the move.
export function reorderLayoutItems(items: DashboardLayoutItem[], activeId: string, overId: string): DashboardLayoutItem[] {
  const next = [...items]
  const from = next.findIndex((item) => item.id === activeId)
  const to = next.findIndex((item) => item.id === overId)
  if (from === -1 || to === -1) return items
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next.map((item, index) => ({ ...item, order: index, priority: index }))
}

function normalizeDateRange(raw?: Partial<DashboardGlobalDateRange> | null): DashboardGlobalDateRange {
  const preset = GLOBAL_RANGE_PRESETS.includes(raw?.preset as DashboardDateRangePreset) ? raw?.preset as DashboardDateRangePreset : defaultGlobalRange().preset
  const compareValues: DashboardDateRangeCompare[] = ['previous_period', 'previous_year', 'none']
  const compare = compareValues.includes(raw?.compare as DashboardDateRangeCompare) ? raw?.compare as DashboardDateRangeCompare : defaultGlobalRange().compare
  try {
    const resolved = resolveGlobalDateRange(preset, raw?.from, raw?.to)
    return { preset, from: resolved.from, to: resolved.to, compare }
  } catch {
    return defaultGlobalRange()
  }
}

function normalizeLayout(data: LayoutResponse) {
  const envelope = Array.isArray(data.layout) ? { items: data.layout, preferences: data.preferences, presets: undefined, activePresetId: undefined } : data.layout
  const rawPresets = (envelope && !Array.isArray(envelope) ? envelope.presets : undefined) ?? []
  const presets: DashboardPreset[] = rawPresets.map((preset) => ({ id: preset.id, name: preset.name, items: sortLayout(preset.items ?? []), preferences: preset.preferences ?? null }))
  const rawActive = (envelope && !Array.isArray(envelope) ? envelope.activePresetId : undefined) ?? null
  const activePresetId = presets.some((preset) => preset.id === rawActive) ? rawActive : null
  return {
    items: sortLayout(envelope?.items ?? []),
    dateRange: normalizeDateRange(envelope?.preferences?.dateRange ?? data.preferences?.dateRange),
    presets,
    activePresetId,
  }
}

function serializeItems(items: DashboardLayoutItem[]) {
  return items.map((item, index) => ({ id: item.id, widgetId: item.widgetId, order: index, priority: index, size: item.size ?? DEFAULT_SIZE, ...(item.accent ? { accent: item.accent } : {}), settings: item.settings ?? null }))
}

function serializeDateRange(dateRange: DashboardGlobalDateRange) {
  return dateRange.preset === 'custom'
    ? { preset: dateRange.preset, from: dateRange.from, to: dateRange.to, compare: dateRange.compare }
    : { preset: dateRange.preset, compare: dateRange.compare }
}

function buildPayload(items: DashboardLayoutItem[], dateRange: DashboardGlobalDateRange, presets: DashboardPreset[] = [], activePresetId: string | null = null) {
  const preferences = { dateRange: serializeDateRange(dateRange) }
  const payload: Record<string, unknown> = { items: serializeItems(items), preferences }
  if (presets.length > 0) {
    // Mirror the live layout into the active preset so switching back is lossless.
    payload.presets = presets.map((preset) => preset.id === activePresetId
      ? { id: preset.id, name: preset.name, items: serializeItems(items), preferences }
      : { id: preset.id, name: preset.name, items: serializeItems(preset.items), ...(preset.preferences?.dateRange ? { preferences: { dateRange: preset.preferences.dateRange } } : {}) })
    if (activePresetId) payload.activePresetId = activePresetId
  }
  return payload
}

function registeredWidgetCount(): number {
  try { return getDashboardWidgets().length } catch { return 0 }
}

export function DashboardScreenV2() {
  const t = useT()
  const organizationScopeVersion = useOrganizationScopeVersion()
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: 'dashboard.v2.layout', blockedMessage: t('dashboard.v2.saveFailed') })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [layout, setLayout] = React.useState<DashboardLayoutItem[]>([])
  const [catalog, setCatalog] = React.useState<DashboardWidgetCatalogItem[]>([])
  const [allowedWidgetIds, setAllowedWidgetIds] = React.useState<string[]>([])
  const [canConfigure, setCanConfigure] = React.useState(false)
  const [context, setContext] = React.useState<DashboardWidgetRenderContext | null>(null)
  const [dateRange, setDateRange] = React.useState<DashboardGlobalDateRange>(() => defaultGlobalRange())
  const [editing, setEditing] = React.useState(false)
  const [settingsId, setSettingsId] = React.useState<string | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [wizard, setWizard] = React.useState<{ widgetId: string; itemId: string | null; initialSettings: unknown } | null>(null)
  const [pendingScrollId, setPendingScrollId] = React.useState<string | null>(null)
  const [modules, setModules] = React.useState<Record<string, ModuleState>>({})
  const [refreshToken, setRefreshToken] = React.useState(0)
  const [presets, setPresets] = React.useState<DashboardPreset[]>([])
  const [activePresetId, setActivePresetId] = React.useState<string | null>(null)
  const saveQueueRef = React.useRef(Promise.resolve())
  const layoutRef = React.useRef(layout)
  const dateRangeRef = React.useRef(dateRange)
  const presetsRef = React.useRef(presets)
  const activePresetIdRef = React.useRef(activePresetId)
  // load() re-runs on i18n identity and org-scope version changes; once the user picked
  // a range, a background reload must never clobber it with the server-stored one.
  const dateRangeTouchedRef = React.useRef(false)
  const editingRef = React.useRef(false)
  React.useEffect(() => { editingRef.current = editing }, [editing])

  React.useEffect(() => { layoutRef.current = layout }, [layout])
  React.useEffect(() => { dateRangeRef.current = dateRange }, [dateRange])
  React.useEffect(() => { presetsRef.current = presets }, [presets])
  React.useEffect(() => { activePresetIdRef.current = activePresetId }, [activePresetId])

  const queueLayoutSave = React.useCallback((items: DashboardLayoutItem[], range = dateRangeRef.current, presetList = presetsRef.current, activeId = activePresetIdRef.current) => {
    const payload = buildPayload(items, range, presetList, activeId)
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        await runMutation({
          operation: async () => {
            const call = await apiCall('/api/dashboards/layout', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
            if (!call.ok) throw new Error(`Failed with status ${call.status}`)
            return call
          },
          context: { entityId: 'dashboards.layout', operation: 'update', retryLastMutation },
          mutationPayload: payload,
        })
        setError(null)
      } catch (err) {
        logger.error('Failed to save dashboard layout', { err })
        setError(t('dashboard.v2.saveFailed'))
      }
    })
  }, [retryLastMutation, runMutation, t])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const call = await apiCall<LayoutResponse>('/api/dashboards/layout')
      if (!call.ok || !call.result) throw new Error(`Failed with status ${call.status}`)
      const normalized = normalizeLayout(call.result)
      // A background reload (i18n identity change, org-scope tick) must not clobber the
      // layout mid-customization — replacing the items recreates the sortable context and
      // cancels an in-flight drag. Outside editing, only swap state when content changed
      // so item identity stays stable.
      if (!editingRef.current && JSON.stringify(normalized.items) !== JSON.stringify(layoutRef.current)) {
        setLayout(normalized.items)
      }
      if (!dateRangeTouchedRef.current) setDateRange(normalized.dateRange)
      if (!editingRef.current) {
        setPresets(normalized.presets)
        presetsRef.current = normalized.presets
        setActivePresetId(normalized.activePresetId)
        activePresetIdRef.current = normalized.activePresetId
      }
      setCatalog(call.result.widgets ?? [])
      setAllowedWidgetIds(call.result.allowedWidgetIds ?? [])
      setCanConfigure(!!call.result.canConfigure)
      setContext(call.result.context ?? null)
      if (!call.result.canConfigure) {
        setEditing(false)
        setSettingsId(null)
      }
    } catch (err) {
      logger.error('Failed to load dashboard layout', { err })
      if (registeredWidgetCount() === 0) {
        setLayout([])
        setCatalog([])
        setCanConfigure(false)
        setContext(null)
        return
      }
      setError(t('dashboard.v2.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => { void load() }, [load, organizationScopeVersion])
  const metaById = React.useMemo(() => new Map(catalog.map((meta) => [meta.id, meta])), [catalog])

  const loadModule = React.useCallback((meta: DashboardWidgetCatalogItem, force = false) => {
    const current = modules[meta.loaderKey]
    if (!force && (current?.loading || current?.module)) return
    setModules((prev) => ({ ...prev, [meta.loaderKey]: { loading: true, module: null, error: null } }))
    void loadDashboardWidgetModule(meta.loaderKey)
      .then((module) => setModules((prev) => ({ ...prev, [meta.loaderKey]: module ? { loading: false, module, error: null } : { loading: false, module: null, error: t('dashboard.v2.widgetLoadFailed') } })))
      .catch((err) => {
        logger.error('Failed to load dashboard widget module', { err })
        setModules((prev) => ({ ...prev, [meta.loaderKey]: { loading: false, module: null, error: t('dashboard.v2.widgetLoadFailed') } }))
      })
  }, [modules, t])

  React.useEffect(() => {
    const ids = new Set(layout.map((item) => item.widgetId))
    for (const meta of catalog) if (ids.has(meta.id) || editing || addOpen) loadModule(meta)
  }, [addOpen, catalog, editing, layout, loadModule])

  const resolveWidgetTitle = React.useCallback((meta: DashboardWidgetCatalogItem): string => {
    const keys = [`${meta.id}.title`, `dashboard.widgets.${meta.id}.title`]
    if (meta.id.includes('.')) {
      const parts = meta.id.split('.')
      const last = parts.pop()
      keys.unshift(`${parts.join('.')}.widgets.${last}.title`)
    }
    for (const key of keys) {
      const translated = t(key)
      if (translated !== key) return translated
    }
    return meta.title
  }, [t])

  const updateLayout = React.useCallback((producer: (prev: DashboardLayoutItem[]) => DashboardLayoutItem[]) => {
    // Compute from the ref and queue the save OUTSIDE the state updater — React
    // StrictMode double-invokes updaters in dev, which would double the PUT.
    const prev = layoutRef.current
    const produced = producer(prev)
    if (produced === prev) return
    const next = sortLayout(produced)
    layoutRef.current = next
    queueLayoutSave(next)
    setLayout(next)
  }, [queueLayoutSave])

  const handleAddWidget = React.useCallback((meta: DashboardWidgetCatalogItem) => {
    const mod = modules[meta.loaderKey]?.module
    if (mod?.SetupWizard) {
      setAddOpen(false)
      const initial = mod.hydrateSettings ? mod.hydrateSettings(meta.defaultSettings ?? null) : (meta.defaultSettings ?? null)
      setWizard({ widgetId: meta.id, itemId: null, initialSettings: initial })
      return
    }
    const newId = generateId()
    updateLayout((prev) => [...prev, { id: newId, widgetId: meta.id, order: prev.length, priority: prev.length, size: meta.defaultSize ?? DEFAULT_SIZE, settings: meta.defaultSettings ?? null }])
    setPendingScrollId(newId)
    setAddOpen(false)
  }, [modules, updateLayout])

  const moduleForWidget = React.useCallback((widgetId: string) => {
    const meta = metaById.get(widgetId)
    return meta ? modules[meta.loaderKey]?.module ?? null : null
  }, [metaById, modules])

  const handleResize = React.useCallback((id: string, size: DashboardWidgetSize) => {
    updateLayout((prev) => prev.map((entry) => entry.id === id ? { ...entry, size } : entry))
  }, [updateLayout])

  const handleWizardComplete = React.useCallback((settings: unknown) => {
    if (!wizard) return
    const mod = moduleForWidget(wizard.widgetId)
    const raw = mod?.dehydrateSettings ? mod.dehydrateSettings(settings as never) : settings
    if (wizard.itemId == null) {
      const meta = metaById.get(wizard.widgetId)
      const newId = generateId()
      updateLayout((prev) => [...prev, { id: newId, widgetId: wizard.widgetId, order: prev.length, priority: prev.length, size: meta?.defaultSize ?? DEFAULT_SIZE, settings: raw }])
      setPendingScrollId(newId)
    } else {
      const itemId = wizard.itemId
      updateLayout((prev) => prev.map((entry) => entry.id === itemId ? { ...entry, settings: raw } : entry))
    }
    setWizard(null)
  }, [metaById, moduleForWidget, updateLayout, wizard])

  React.useEffect(() => {
    if (!pendingScrollId) return
    const handle = window.setTimeout(() => {
      const target = typeof document !== 'undefined' ? document.querySelector(`[data-dashboard-item-id="${pendingScrollId}"]`) : null
      if (target) (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
      setPendingScrollId(null)
    }, 80)
    return () => window.clearTimeout(handle)
  }, [pendingScrollId, layout])

  const handleDateRangeChange = React.useCallback((next: DashboardGlobalDateRange) => {
    dateRangeTouchedRef.current = true
    setDateRange(next)
    dateRangeRef.current = next
    setRefreshToken((value) => value + 1)
    queueLayoutSave(layoutRef.current, next)
  }, [queueLayoutSave])

  const handleResetLayout = React.useCallback(() => {
    if (!canConfigure) return
    const allowed = new Set(allowedWidgetIds)
    const next = catalog.filter((meta) => meta.defaultEnabled && (!allowed.size || allowed.has(meta.id))).map((meta, index) => ({ id: generateId(), widgetId: meta.id, order: index, priority: index, size: meta.defaultSize ?? DEFAULT_SIZE, settings: meta.defaultSettings ?? null }))
    setSettingsId(null)
    dateRangeTouchedRef.current = false
    const freshDefault = defaultGlobalRange()
    setDateRange(freshDefault)
    dateRangeRef.current = freshDefault
    setLayout(next)
    queueLayoutSave(next, freshDefault)
  }, [allowedWidgetIds, canConfigure, catalog, queueLayoutSave])

  const handleReorder = React.useCallback((activeId: string, overId: string) => {
    updateLayout((prev) => reorderLayoutItems(prev, activeId, overId))
  }, [updateLayout])

  // The live layout is the source of truth for the active preset; snapshot it back into
  // the preset list before any switch/save/delete so nothing edited in place is lost.
  const presetsWithLiveActive = React.useCallback((): DashboardPreset[] => {
    const activeId = activePresetIdRef.current
    if (!activeId) return presetsRef.current
    return presetsRef.current.map((preset) => preset.id === activeId
      ? { ...preset, items: layoutRef.current, preferences: { dateRange: dateRangeRef.current } }
      : preset)
  }, [])

  const applyPresetContent = React.useCallback((preset: DashboardPreset) => {
    const nextItems = sortLayout(preset.items)
    layoutRef.current = nextItems
    setLayout(nextItems)
    const nextRange = normalizeDateRange(preset.preferences?.dateRange ?? undefined)
    dateRangeTouchedRef.current = true
    dateRangeRef.current = nextRange
    setDateRange(nextRange)
    setSettingsId(null)
    setRefreshToken((value) => value + 1)
  }, [])

  const handleSelectPreset = React.useCallback((id: string) => {
    if (activePresetIdRef.current === id) return
    const synced = presetsWithLiveActive()
    const target = synced.find((preset) => preset.id === id)
    if (!target) return
    presetsRef.current = synced
    setPresets(synced)
    activePresetIdRef.current = id
    setActivePresetId(id)
    applyPresetContent(target)
    queueLayoutSave(layoutRef.current, dateRangeRef.current, synced, id)
  }, [applyPresetContent, presetsWithLiveActive, queueLayoutSave])

  const handleSavePreset = React.useCallback((rawName: string) => {
    if (!canConfigure) return
    const name = rawName.trim().slice(0, 80)
    if (!name || presetsRef.current.length >= MAX_DASHBOARD_PRESETS) return
    const id = generateId()
    const base = presetsWithLiveActive()
    const preset: DashboardPreset = { id, name, items: layoutRef.current, preferences: { dateRange: dateRangeRef.current } }
    const nextPresets = [...base, preset]
    presetsRef.current = nextPresets
    setPresets(nextPresets)
    activePresetIdRef.current = id
    setActivePresetId(id)
    queueLayoutSave(layoutRef.current, dateRangeRef.current, nextPresets, id)
  }, [canConfigure, presetsWithLiveActive, queueLayoutSave])

  const handleDeletePreset = React.useCallback((id: string) => {
    if (!canConfigure) return
    const nextPresets = presetsWithLiveActive().filter((preset) => preset.id !== id)
    presetsRef.current = nextPresets
    setPresets(nextPresets)
    let nextActive = activePresetIdRef.current
    if (activePresetIdRef.current === id) {
      const fallback = nextPresets[0] ?? null
      nextActive = fallback?.id ?? null
      activePresetIdRef.current = nextActive
      setActivePresetId(nextActive)
      if (fallback) applyPresetContent(fallback)
    }
    queueLayoutSave(layoutRef.current, dateRangeRef.current, nextPresets, nextActive)
  }, [applyPresetContent, canConfigure, presetsWithLiveActive, queueLayoutSave])

  const availableWidgets = React.useMemo(() => {
    const currentIds = new Set(layout.map((item) => item.widgetId))
    return catalog.filter((meta) => {
      const repeatable = meta.supportsMultipleInstances ?? modules[meta.loaderKey]?.module?.metadata.supportsMultipleInstances ?? false
      return repeatable || !currentIds.has(meta.id)
    })
  }, [catalog, layout, modules])

  const widgetContext = React.useMemo<DashboardWidgetRenderContext>(() => ({ userId: context?.userId ?? '', tenantId: context?.tenantId ?? null, organizationId: context?.organizationId ?? null, userName: context?.userName ?? null, userEmail: context?.userEmail ?? null, userLabel: context?.userLabel ?? null, dateRange }), [context, dateRange])
  const injectionContext = React.useMemo(() => ({ layout, widgetCatalog: catalog, allowedWidgetIds, canConfigure, editing, userContext: widgetContext, dateRange }), [allowedWidgetIds, canConfigure, catalog, dateRange, editing, layout, widgetContext])

  if (loading) return <SkeletonGrid />
  if (error && layout.length === 0) return <ErrorMessage label={error} action={<Button type="button" variant="outline" onClick={load}>{t('dashboard.v2.refreshAll')}</Button>} />

  return (
    <div className="space-y-6">
      <DashboardHeader context={context} dateRange={dateRange} canConfigure={canConfigure} editing={editing} presets={presets} activePresetId={activePresetId} maxPresets={MAX_DASHBOARD_PRESETS} onSelectPreset={handleSelectPreset} onSavePreset={handleSavePreset} onDeletePreset={handleDeletePreset} onDateRangeChange={handleDateRangeChange} onRefreshAll={() => setRefreshToken((value) => value + 1)} onResetLayout={handleResetLayout} onToggleCustomize={() => canConfigure && setEditing((value) => !value)} />
      {error ? <ErrorMessage label={error} /> : null}
      <InjectionSpot spotId="dashboard:before" context={injectionContext} />
      {editing && canConfigure ? <Button type="button" variant="outline" onClick={() => setAddOpen(true)}><Plus className="size-4" />{t('dashboard.v2.addWidget')}</Button> : null}
      {layout.length === 0 ? (
        <EmptyState title={t('dashboard.v2.emptyTitle')} actions={canConfigure ? <Button type="button" onClick={() => setAddOpen(true)}>{t('dashboard.v2.emptyCta')}</Button> : undefined} />
      ) : (
        <WidgetDataBatchProvider>
          <GridLayout items={layout} editing={editing && canConfigure} onReorder={handleReorder} onResize={handleResize} renderItem={(item, dragHandle, dragging) => {
            const meta = metaById.get(item.widgetId)
            if (!meta) return null
            const state = modules[meta.loaderKey] ?? { loading: true, module: null, error: null }
            const effectiveMeta = { ...meta, ...(state.module?.metadata ?? {}), loaderKey: meta.loaderKey }
            const hasWizard = !!state.module?.SetupWizard
            const wizardInitial = state.module?.hydrateSettings ? state.module.hydrateSettings(item.settings ?? meta.defaultSettings ?? null) : (item.settings ?? meta.defaultSettings ?? null)
            return (
              <WidgetCardV2 layout={item} meta={effectiveMeta} title={resolveWidgetTitle(effectiveMeta)} description={effectiveMeta.description ?? null} widgetModule={state.module} loading={state.loading} loadError={state.error} context={widgetContext} editing={editing && canConfigure} settingsOpen={settingsId === item.id} refreshToken={refreshToken} dragHandle={dragHandle} dragging={dragging} onRetry={() => loadModule(meta, true)} onRemove={() => updateLayout((prev) => prev.filter((entry) => entry.id !== item.id))} onSizeChange={(size) => updateLayout((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, size } : entry))} onAccentChange={(accent) => updateLayout((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, accent } : entry))} onSettingsChange={(settings) => updateLayout((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, settings } : entry))} onToggleSettings={() => setSettingsId((current) => current === item.id ? null : item.id)} onEditWizard={hasWizard ? () => setWizard({ widgetId: item.widgetId, itemId: item.id, initialSettings: wizardInitial }) : undefined} />
            )
          }} />
        </WidgetDataBatchProvider>
      )}
      <InjectionSpot spotId="dashboard:after" context={injectionContext} />
      <AddWidgetDialog open={addOpen} widgets={availableWidgets} titleFor={resolveWidgetTitle} onOpenChange={setAddOpen} onAdd={handleAddWidget} />
      {wizard ? (() => {
        const wizardModule = moduleForWidget(wizard.widgetId)
        const Wizard = wizardModule?.SetupWizard
        if (!Wizard) return null
        return (
          <React.Suspense fallback={null}>
            <Wizard open initialSettings={wizard.initialSettings} context={widgetContext} onComplete={handleWizardComplete} onCancel={() => setWizard(null)} />
          </React.Suspense>
        )
      })() : null}
    </div>
  )
}

function SkeletonGrid() {
  const placeholders: DashboardWidgetSize[] = ['sm', 'sm', 'sm', 'md', 'md']
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
      {placeholders.map((size, index) => (
        <div key={`${size}-${index}`} className={`min-h-40 rounded-xl border border-border bg-card p-4 shadow-sm ${sizeToSpanClass(size)}`}>
          <div className="space-y-3" aria-hidden="true"><div className="h-5 w-24 animate-pulse rounded-md bg-muted" /><div className="h-16 animate-pulse rounded-md bg-muted" /><div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" /></div>
        </div>
      ))}
    </div>
  )
}

const FEATURED_WIDGET_IDS = new Set(['dashboards.analytics.customMetric', 'dashboards.analytics.aiInsights'])
const FEATURED_WIDGET_ICON: Record<string, typeof Sparkles> = {
  'dashboards.analytics.customMetric': Wand2,
  'dashboards.analytics.aiInsights': Sparkles,
}

function AddWidgetDialog({ open, widgets, titleFor, onOpenChange, onAdd }: { open: boolean; widgets: DashboardWidgetCatalogItem[]; titleFor: (meta: DashboardWidgetCatalogItem) => string; onOpenChange: (open: boolean) => void; onAdd: (meta: DashboardWidgetCatalogItem) => void }) {
  const t = useT()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  React.useEffect(() => { if (open) setSelectedId(widgets[0]?.id ?? null) }, [open, widgets])
  const featured = widgets.filter((widget) => FEATURED_WIDGET_IDS.has(widget.id))
  const rest = widgets.filter((widget) => !FEATURED_WIDGET_IDS.has(widget.id))
  const selected = widgets.find((widget) => widget.id === selectedId) ?? null
  const apply = React.useCallback(() => { if (selected) onAdd(selected) }, [onAdd, selected])
  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      apply()
    }
    if (event.key === 'Escape') onOpenChange(false)
  }, [apply, onOpenChange])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onKeyDown={handleKeyDown}>
        <DialogHeader><DialogTitle>{t('dashboard.v2.addWidget')}</DialogTitle></DialogHeader>
        {featured.length > 0 ? (
          <div className="space-y-2">
            <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">{t('dashboard.v2.featuredWidgets')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {featured.map((widget) => {
                const Icon = FEATURED_WIDGET_ICON[widget.id] ?? Sparkles
                const active = widget.id === selectedId
                return (
                  <Button
                    key={widget.id}
                    type="button"
                    variant="outline"
                    className={`h-auto flex-col items-start gap-2 whitespace-normal p-3 text-left ${active ? 'border-brand-violet ring-1 ring-brand-violet/40' : 'hover:border-brand-violet/50'}`}
                    onClick={() => setSelectedId(widget.id)}
                    onDoubleClick={() => onAdd(widget)}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <span className="flex size-8 items-center justify-center rounded-md bg-brand-violet/10 text-brand-violet"><Icon className="size-4" /></span>
                      {titleFor(widget)}
                    </span>
                    {widget.description ? <span className="text-sm font-normal text-muted-foreground">{widget.description}</span> : null}
                  </Button>
                )
              })}
            </div>
          </div>
        ) : null}
        {rest.length > 0 ? (
          <div className="space-y-2">
            {featured.length > 0 ? <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">{t('dashboard.v2.allWidgets')}</p> : null}
            <div className="grid gap-2">{rest.map((widget) => <Button key={widget.id} type="button" variant={widget.id === selectedId ? 'secondary' : 'outline'} className="justify-start" onClick={() => setSelectedId(widget.id)}>{titleFor(widget)}</Button>)}</div>
          </div>
        ) : null}
        {widgets.length === 0 ? <p className="text-sm text-muted-foreground">{t('dashboard.v2.noWidgetsToAdd')}</p> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('dashboard.v2.dateRange.cancel')}</Button><Button type="button" disabled={!selected} onClick={apply}>{t('dashboard.v2.addWidget')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
