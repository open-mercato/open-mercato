"use client"

/**
 * Per-tenant web-search policy: which adapters run, in what order, and under
 * what deadlines. Env supplies the deployment default; saving here writes a
 * tenant override, so a fresh tenant inherits until someone deliberately diverges.
 *
 * optimistic-lock-exempt — the target is a single ModuleConfigService value, not
 * a versioned entity: there is no `updatedAt` to send, and the surface is a
 * single-admin settings screen rather than a collaborative-edit record.
 */

import * as React from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { RotateCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AdapterRow, type AdapterHealth, type InstalledAdapter } from './AdapterRow'
import { WebSearchPreview } from './WebSearchPreview'

const SETTINGS_URL = '/api/agent_orchestrator/web-search/settings'
const HEALTH_URL = '/api/agent_orchestrator/web-search/health'

type AdapterEntry = { id: string; enabled: boolean; order: number; weight: number }

type Policy = {
  settleMode: 'race' | 'quorum' | 'exhaustive'
  concurrency: number
  minResults: number
  minConfidence: number
  softDeadlineMs: number
  hardDeadlineMs: number
  cacheTtlMs: number
  lastResort: string | null
  escalateToBrowser: boolean
  content: { enabledByDefault: boolean; maxPages: number; maxBytesPerPage: number }
  adapters: AdapterEntry[]
}

type SettingsResponse = {
  policy: Policy
  source: 'tenant' | 'instance'
  installed?: InstalledAdapter[]
}

type AdapterOptions = Record<string, Record<string, unknown>>

function isSettings(value: unknown): value is SettingsResponse {
  return typeof value === 'object' && value !== null && 'policy' in value
}

/** Installed adapters not yet in the policy appear immediately, disabled. */
function mergeAdapters(policy: Policy, installed: InstalledAdapter[]): AdapterEntry[] {
  const byId = new Map(policy.adapters.map((entry) => [entry.id, entry]))
  return installed
    .map(
      (adapter, index) =>
        byId.get(adapter.id) ?? {
          id: adapter.id,
          enabled: false,
          order: policy.adapters.length + index,
          weight: 1,
        },
    )
    .sort((left, right) => left.order - right.order)
}

/**
 * Whether web search is usable at all, which is what an operator wants to know at
 * a glance. A save receipt is transient noise; this stays meaningful.
 */
function HeaderStatus({
  activeCount,
  saveState,
  isRefreshing,
  onRefresh,
}: {
  activeCount: number
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  isRefreshing: boolean
  onRefresh: () => void
}) {
  const t = useT()
  const refresh = (
    <Button
      variant="outline"
      size="sm"
      aria-label={t('agent_orchestrator.settings.webSearch.recheck', 'Re-check adapters')}
      disabled={isRefreshing}
      onClick={onRefresh}
    >
      <RotateCw className={isRefreshing ? 'size-4 animate-spin' : 'size-4'} />
    </Button>
  )
  const badge =
    saveState === 'saving' ? (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        {t('agent_orchestrator.settings.webSearch.saving', 'Saving…')}
      </span>
    ) : saveState === 'error' ? (
      <StatusBadge variant="error" dot>
        {t('agent_orchestrator.settings.webSearch.saveFailed', 'Not saved')}
      </StatusBadge>
    ) : activeCount > 0 ? (
      <StatusBadge variant="success" dot>
        {t('agent_orchestrator.settings.webSearch.statusActive', 'Active - {count} adapter(s)', {
          count: String(activeCount),
        })}
      </StatusBadge>
    ) : (
      <StatusBadge variant="neutral" dot>
        {t('agent_orchestrator.settings.webSearch.statusInactive', 'Inactive - no adapter enabled')}
      </StatusBadge>
    )

  return (
    <div className="flex items-center gap-2">
      {badge}
      {refresh}
    </div>
  )
}

/** A labelled subsection inside a card, so a long knob grid reads in chunks. */
function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function NumberField({
  label,
  hint,
  value,
  step,
  max,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  step?: number
  max?: number
  onChange: (next: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        autoComplete="off"
        {...(max === undefined ? {} : { max })}
        {...(step === undefined ? {} : { step })}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <Switch checked={checked} onCheckedChange={onChange} />
      <div className="min-w-0">
        <Label>{label}</Label>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  )
}

export default function WebSearchSettingsPage() {
  const t = useT()
  const [policy, setPolicy] = React.useState<Policy | null>(null)
  const [installed, setInstalled] = React.useState<InstalledAdapter[]>([])
  const [health, setHealth] = React.useState<AdapterHealth[]>([])
  const [adapterOptions, setAdapterOptions] = React.useState<AdapterOptions>({})
  const [source, setSource] = React.useState<'tenant' | 'instance'>('instance')
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const { runMutation } = useGuardedMutation({ contextId: 'agent_orchestrator.web_search.settings' })
  // Nothing is persisted until the first load has populated state, otherwise the
  // mount would immediately write the instance defaults back as a tenant override.
  const hydrated = React.useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const load = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const call = await apiCall<unknown>(SETTINGS_URL)
      if (!call.ok || !isSettings(call.result)) {
        setLoadError(t('agent_orchestrator.settings.webSearch.loadError', 'Could not load web search settings.'))
        return
      }
      const next = call.result
      const adapters = next.installed ?? []
      setInstalled(adapters)
      setAdapterOptions(Object.fromEntries(adapters.map((adapter) => [adapter.id, { ...adapter.options }])))
      setSource(next.source)
      setPolicy({ ...next.policy, adapters: mergeAdapters(next.policy, adapters) })
      setLoadError(null)
      hydrated.current = true
    } catch {
      setLoadError(t('agent_orchestrator.settings.webSearch.loadError', 'Could not load web search settings.'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  const [isRefreshing, setIsRefreshing] = React.useState(false)

  const loadHealth = React.useCallback(async () => {
    setIsRefreshing(true)
    try {
      const call = await apiCall<{ adapters?: AdapterHealth[] }>(HEALTH_URL)
      if (call.ok && Array.isArray(call.result?.adapters)) setHealth(call.result.adapters)
    } catch {
      // Health is advisory; a failed probe must not break the settings screen.
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
    void loadHealth()
  }, [load, loadHealth])

  const update = (patch: Partial<Policy>) => {
    setPolicy((current) => (current ? { ...current, ...patch } : current))
  }

  const updateAdapter = (id: string, patch: Partial<AdapterEntry>) => {
    setPolicy((current) =>
      current
        ? {
            ...current,
            adapters: current.adapters.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
          }
        : current,
    )
  }

  const updateOption = (adapterId: string, field: string, value: unknown) => {
    setAdapterOptions((current) => {
      const next = { ...(current[adapterId] ?? {}) }
      if (value === undefined) delete next[field]
      else next[field] = value
      return { ...current, [adapterId]: next }
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setPolicy((current) => {
      if (!current) return current
      const from = current.adapters.findIndex((entry) => entry.id === active.id)
      const to = current.adapters.findIndex((entry) => entry.id === over.id)
      if (from === -1 || to === -1) return current
      const adapters = [...current.adapters]
      const [moved] = adapters.splice(from, 1)
      adapters.splice(to, 0, moved)
      // Order is re-derived from position, so the saved policy always matches
      // what the list shows.
      return { ...current, adapters: adapters.map((entry, index) => ({ ...entry, order: index })) }
    })
  }

  const persist = React.useCallback(
    async (nextPolicy: Policy, nextOptions: AdapterOptions) => {
      setSaveState('saving')
      await runMutation({
        context: { contextId: 'agent_orchestrator.web_search.settings' },
        operation: async () => {
          const call = await apiCall(SETTINGS_URL, {
            method: 'PUT',
            body: JSON.stringify({ ...nextPolicy, adapterOptions: nextOptions }),
          })
          if (!call.ok) {
            setSaveState('error')
            flash(
              t('agent_orchestrator.settings.webSearch.saveError', 'Could not save web search settings.'),
              'error',
            )
            return
          }
          setSource('tenant')
          setSaveState('saved')
          // Enabling or reordering changes what is actually live, so re-probe
          // rather than leaving stale badges on the rows.
          void loadHealth()
        },
      })
    },
    [runMutation, t, loadHealth],
  )

  // Autosave: these are independent knobs, not a form with cross-field validation,
  // so an explicit Save button only adds a step you can forget. Debounced so a
  // typed number or key is written once, when you stop, rather than per keystroke.
  React.useEffect(() => {
    if (!hydrated.current || !policy) return
    const timer = setTimeout(() => {
      void persist(policy, adapterOptions)
    }, 700)
    return () => clearTimeout(timer)
  }, [policy, adapterOptions, persist])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex justify-center py-16">
            <Spinner className="size-5" />
          </div>
        </PageBody>
      </Page>
    )
  }
  if (loadError) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={loadError} />
        </PageBody>
      </Page>
    )
  }
  if (!policy) return null

  const enabledCount = policy.adapters.filter((entry) => entry.enabled).length

  return (
    <Page>
      <PageHeader
        title={t('agent_orchestrator.settings.webSearch.title', 'Web search')}
        description={t(
          'agent_orchestrator.settings.webSearch.description',
          'Choose which search sources agents may use, in which order, and how long they may take.',
        )}
        actions={
          <HeaderStatus
            activeCount={enabledCount}
            saveState={saveState}
            isRefreshing={isRefreshing}
            onRefresh={() => void loadHealth()}
          />
        }
      />

      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>{t('agent_orchestrator.settings.webSearch.adapters', 'Adapters')}</CardTitle>
            <CardDescription>
              {t(
                'agent_orchestrator.settings.webSearch.adaptersDragHint',
                'Drag to set the order they are tried in. {count} of {total} enabled.',
                { count: String(enabledCount), total: String(policy.adapters.length) },
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {policy.adapters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  'agent_orchestrator.settings.webSearch.none',
                  'No adapter packages are installed. Add one with yarn add, then run yarn generate.',
                )}
              </p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={policy.adapters.map((entry) => entry.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {policy.adapters.map((entry) => (
                      <AdapterRow
                        key={entry.id}
                        id={entry.id}
                        enabled={entry.enabled}
                        weight={entry.weight}
                        meta={installed.find((adapter) => adapter.id === entry.id)}
                        health={health.find((report) => report.id === entry.id)}
                        options={adapterOptions[entry.id] ?? {}}
                        onToggle={(enabled) => updateAdapter(entry.id, { enabled })}
                        onWeight={(weight) => updateAdapter(entry.id, { weight })}
                        onOption={(field, value) => updateOption(entry.id, field, value)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('agent_orchestrator.settings.webSearch.tuning', 'Tuning')}</CardTitle>
            <CardDescription>
              {source === 'tenant'
                ? t('agent_orchestrator.settings.webSearch.sourceTenant', "Using this tenant's override.")
                : t(
                    'agent_orchestrator.settings.webSearch.sourceInstance',
                    'Using the deployment default. Saving creates a tenant override.',
                  )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FieldGroup title={t('agent_orchestrator.settings.webSearch.groupResolution', 'Resolution')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>{t('agent_orchestrator.settings.webSearch.settleMode', 'Settle mode')}</Label>
                  <Select
                    value={policy.settleMode}
                    onValueChange={(next) => update({ settleMode: next as Policy['settleMode'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="race">race</SelectItem>
                      <SelectItem value="quorum">quorum</SelectItem>
                      <SelectItem value="exhaustive">exhaustive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <NumberField
                  label={t('agent_orchestrator.settings.webSearch.concurrency', 'Concurrent adapters')}
                  value={policy.concurrency}
                  onChange={(next) => update({ concurrency: next })}
                />
                <NumberField
                  label={t('agent_orchestrator.settings.webSearch.minResults', 'Minimum results')}
                  value={policy.minResults}
                  onChange={(next) => update({ minResults: next })}
                />
                <NumberField
                  label={t('agent_orchestrator.settings.webSearch.minConfidence', 'Confidence threshold')}
                  value={policy.minConfidence}
                  max={1}
                  step={0.05}
                  onChange={(next) => update({ minConfidence: next })}
                />

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t('agent_orchestrator.settings.webSearch.lastResort', 'Last-resort adapter')}</Label>
                  <Select
                    value={policy.lastResort ?? '__none__'}
                    onValueChange={(next) => update({ lastResort: next === '__none__' ? null : next })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {installed.map((adapter) => (
                        <SelectItem key={adapter.id} value={adapter.id}>
                          {adapter.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'agent_orchestrator.settings.webSearch.lastResortHint',
                      'Runs when every other adapter came up short, even if it is disabled above.',
                    )}
                  </p>
                </div>
              </div>
            </FieldGroup>

            <FieldGroup title={t('agent_orchestrator.settings.webSearch.groupTiming', 'Timing and caching')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <NumberField
                  label={t('agent_orchestrator.settings.webSearch.softDeadlineMs', 'Soft deadline (ms)')}
                  hint={t(
                    'agent_orchestrator.settings.webSearch.softDeadlineHint',
                    'Stop waiting for stragglers once results are in hand.',
                  )}
                  value={policy.softDeadlineMs}
                  onChange={(next) => update({ softDeadlineMs: next })}
                />
                <NumberField
                  label={t('agent_orchestrator.settings.webSearch.hardDeadlineMs', 'Hard deadline (ms)')}
                  hint={t(
                    'agent_orchestrator.settings.webSearch.hardDeadlineHint',
                    'Absolute ceiling, even with nothing found yet.',
                  )}
                  value={policy.hardDeadlineMs}
                  onChange={(next) => update({ hardDeadlineMs: next })}
                />
                <NumberField
                  label={t('agent_orchestrator.settings.webSearch.cacheTtlMs', 'Cache TTL (ms)')}
                  hint={t(
                    'agent_orchestrator.settings.webSearch.cacheTtlHint',
                    'How long an identical query reuses its previous answer.',
                  )}
                  value={policy.cacheTtlMs}
                  onChange={(next) => update({ cacheTtlMs: next })}
                />
              </div>
            </FieldGroup>

            <FieldGroup title={t('agent_orchestrator.settings.webSearch.groupBehaviour', 'Behaviour')}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ToggleRow
                  label={t(
                    'agent_orchestrator.settings.webSearch.escalateToBrowser',
                    'Escalate blocked sources to a browser',
                  )}
                  hint={t(
                    'agent_orchestrator.settings.webSearch.escalateHint',
                    'Retry in a real browser when a source returns a challenge page.',
                  )}
                  checked={policy.escalateToBrowser}
                  onChange={(checked) => update({ escalateToBrowser: checked })}
                />
                <ToggleRow
                  label={t(
                    'agent_orchestrator.settings.webSearch.includeContentDefault',
                    'Read page content by default',
                  )}
                  hint={t(
                    'agent_orchestrator.settings.webSearch.includeContentHint',
                    'Return page text with results, sparing a fetch per link.',
                  )}
                  checked={policy.content.enabledByDefault}
                  onChange={(checked) => update({ content: { ...policy.content, enabledByDefault: checked } })}
                />
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <div className="mt-4">
          <WebSearchPreview />
        </div>
      </PageBody>
    </Page>
  )
}
