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
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WebSearchHealthCard } from '../../../components/WebSearchHealthCard'

const SETTINGS_URL = '/api/agent_orchestrator/web-search/settings'

type AdapterEntry = { id: string; enabled: boolean; order: number; weight: number }

type OptionField = {
  name: string
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'stringList'
  required: boolean
  secret: boolean
  choices?: string[]
  format?: string
}

type InstalledAdapter = {
  id: string
  kind: string
  packageName: string
  fields: OptionField[]
  options: Record<string, unknown>
  configured: boolean
  configurationHint: string | null
}

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

/**
 * Merges the installed catalogue into the stored policy so an adapter package
 * that was just installed shows up immediately, defaulting to disabled.
 */
function mergeAdapters(policy: Policy, installed: InstalledAdapter[]): AdapterEntry[] {
  const byId = new Map(policy.adapters.map((entry) => [entry.id, entry]))
  const merged = installed.map(
    (adapter, index) =>
      byId.get(adapter.id) ?? { id: adapter.id, enabled: false, order: policy.adapters.length + index, weight: 1 },
  )
  return [...merged].sort((left, right) => left.order - right.order)
}


/** Renders one option from an adapter's own schema. */
function OptionInput({
  field,
  value,
  onChange,
}: {
  field: OptionField
  value: unknown
  onChange: (next: unknown) => void
}) {
  if (field.kind === 'boolean') {
    return (
      <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
    )
  }
  if (field.kind === 'enum') {
    return (
      <select
        className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      >
        <option value="">—</option>
        {(field.choices ?? []).map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    )
  }
  if (field.kind === 'number') {
    return (
      <Input
        type="number"
        className="mt-1"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    )
  }
  if (field.kind === 'stringList') {
    return (
      <Input
        className="mt-1"
        value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
        placeholder="a, b, c"
        onChange={(event) => {
          const parts = event.target.value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
          onChange(parts.length > 0 ? parts : undefined)
        }}
      />
    )
  }
  return (
    <Input
      // Secrets arrive masked and are only sent back when actually retyped.
      type={field.secret ? 'password' : 'text'}
      className="mt-1"
      value={typeof value === 'string' ? value : ''}
      placeholder={field.format === 'url' ? 'https://…' : undefined}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  )
}

export default function WebSearchSettingsPage() {
  const t = useT()
  const [policy, setPolicy] = React.useState<Policy | null>(null)
  const [installed, setInstalled] = React.useState<InstalledAdapter[]>([])
  const [adapterOptions, setAdapterOptions] = React.useState<AdapterOptions>({})
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [source, setSource] = React.useState<'tenant' | 'instance'>('instance')
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const { runMutation } = useGuardedMutation({ contextId: 'agent_orchestrator.web_search.settings' })

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
      setAdapterOptions(Object.fromEntries(adapters.map((a) => [a.id, { ...a.options }])))
      // An adapter that still needs a key is opened for the operator rather than
      // hidden behind a disclosure they have no reason to click.
      setExpanded(new Set(adapters.filter((a) => !a.configured && a.fields.length > 0).map((a) => a.id)))
      setSource(next.source)
      setPolicy({ ...next.policy, adapters: mergeAdapters(next.policy, next.installed ?? []) })
      setLoadError(null)
    } catch {
      setLoadError(t('agent_orchestrator.settings.webSearch.loadError', 'Could not load web search settings.'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const update = (patch: Partial<Policy>) => {
    setPolicy((current) => (current ? { ...current, ...patch } : current))
  }

  const updateAdapter = (id: string, patch: Partial<AdapterEntry>) => {
    setPolicy((current) =>
      current
        ? { ...current, adapters: current.adapters.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) }
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

  const toggleExpanded = (adapterId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(adapterId)) next.delete(adapterId)
      else next.add(adapterId)
      return next
    })
  }

  const move = (id: string, direction: -1 | 1) => {
    setPolicy((current) => {
      if (!current) return current
      const index = current.adapters.findIndex((entry) => entry.id === id)
      const target = index + direction
      if (index === -1 || target < 0 || target >= current.adapters.length) return current
      const adapters = [...current.adapters]
      const [moved] = adapters.splice(index, 1)
      adapters.splice(target, 0, moved)
      return { ...current, adapters: adapters.map((entry, position) => ({ ...entry, order: position })) }
    })
  }

  const save = async () => {
    if (!policy) return
    setIsSaving(true)
    try {
      await runMutation({
        context: { contextId: 'agent_orchestrator.web_search.settings' },
        operation: async () => {
          const call = await apiCall(SETTINGS_URL, {
            method: 'PUT',
            body: JSON.stringify({ ...policy, adapterOptions }),
          })
          if (!call.ok) {
            flash(
              t('agent_orchestrator.settings.webSearch.saveError', 'Could not save web search settings.'),
              'error',
            )
            return
          }
          setSource('tenant')
          flash(t('agent_orchestrator.settings.webSearch.saved', 'Web search settings saved.'), 'success')
        },
      })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    )
  }
  if (loadError) return <ErrorMessage label={loadError} />
  if (!policy) return null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{t('agent_orchestrator.settings.webSearch.title', 'Web search')}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'agent_orchestrator.settings.webSearch.description',
            'Choose which search sources agents may use, in which order, and how long they may take.',
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {source === 'tenant'
            ? t('agent_orchestrator.settings.webSearch.sourceTenant', "Using this tenant's override.")
            : t(
                'agent_orchestrator.settings.webSearch.sourceInstance',
                'Using the deployment default. Saving creates a tenant override.',
              )}
        </p>
      </div>

      <WebSearchHealthCard />

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-semibold">{t('agent_orchestrator.settings.webSearch.adapters', 'Adapters')}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            'agent_orchestrator.settings.webSearch.adaptersHint',
            'Enabled adapters run in order, up to the concurrency limit. Disabled adapters stay installed and can still act as the last resort.',
          )}
        </p>

        {policy.adapters.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t(
              'agent_orchestrator.settings.webSearch.none',
              'No adapter packages are installed. Add one with yarn add, then run yarn generate.',
            )}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {policy.adapters.map((entry, index) => {
              const meta = installed.find((adapter) => adapter.id === entry.id)
              const fields = meta?.fields ?? []
              const isOpen = expanded.has(entry.id)
              return (
                <li key={entry.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={(event) => updateAdapter(entry.id, { enabled: event.target.checked })}
                      />
                      <span className="font-mono">{entry.id}</span>
                    </label>
                    {meta && !meta.configured ? (
                      <StatusBadge variant="warning">
                        {t('agent_orchestrator.settings.webSearch.needsConfig', 'Configuration required')}
                      </StatusBadge>
                    ) : null}
                    {meta ? <span className="text-xs text-muted-foreground">{meta.packageName}</span> : null}
                    <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      weight
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={entry.weight}
                        className="w-20"
                        onChange={(event) => updateAdapter(entry.id, { weight: Number(event.target.value) || 0 })}
                      />
                    </label>
                    {fields.length > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => toggleExpanded(entry.id)}>
                        {isOpen
                          ? t('agent_orchestrator.settings.webSearch.hideConfig', 'Hide config')
                          : t('agent_orchestrator.settings.webSearch.showConfig', 'Configure')}
                      </Button>
                    ) : null}
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" disabled={index === 0} onClick={() => move(entry.id, -1)}>
                        ↑
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={index === policy.adapters.length - 1}
                        onClick={() => move(entry.id, 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  </div>

                  {meta && !meta.configured && meta.configurationHint ? (
                    <p className="mt-2 text-xs text-status-warning-text">{meta.configurationHint}</p>
                  ) : null}

                  {isOpen && fields.length > 0 ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
                      {fields.map((field) => (
                        <label key={field.name} className="text-sm">
                          <span className="flex items-center gap-1">
                            {field.name}
                            {field.required ? <span className="text-status-error-text">*</span> : null}
                          </span>
                          <OptionInput
                            field={field}
                            value={adapterOptions[entry.id]?.[field.name]}
                            onChange={(next) => updateOption(entry.id, field.name, next)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <label className="text-sm">
          {t('agent_orchestrator.settings.webSearch.settleMode', 'Settle mode')}
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={policy.settleMode}
            onChange={(event) => update({ settleMode: event.target.value as Policy['settleMode'] })}
          >
            <option value="race">race</option>
            <option value="quorum">quorum</option>
            <option value="exhaustive">exhaustive</option>
          </select>
        </label>

        <label className="text-sm">
          {t('agent_orchestrator.settings.webSearch.lastResort', 'Last-resort adapter')}
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={policy.lastResort ?? ''}
            onChange={(event) => update({ lastResort: event.target.value === '' ? null : event.target.value })}
          >
            <option value="">—</option>
            {installed.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>
                {adapter.id}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            {t(
              'agent_orchestrator.settings.webSearch.lastResortHint',
              'Runs when every other adapter came up short, even if it is disabled above.',
            )}
          </span>
        </label>

        {(
          [
            ['concurrency', 'Concurrent adapters'],
            ['minResults', 'Minimum results'],
            ['softDeadlineMs', 'Soft deadline (ms)'],
            ['hardDeadlineMs', 'Hard deadline (ms)'],
            ['cacheTtlMs', 'Cache TTL (ms)'],
          ] as const
        ).map(([key, fallback]) => (
          <label key={key} className="text-sm">
            {t(`agent_orchestrator.settings.webSearch.${key}`, fallback)}
            <Input
              type="number"
              min={0}
              value={policy[key]}
              className="mt-1"
              onChange={(event) => update({ [key]: Number(event.target.value) || 0 } as Partial<Policy>)}
            />
          </label>
        ))}

        <label className="text-sm">
          {t('agent_orchestrator.settings.webSearch.minConfidence', 'Confidence threshold')}
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={policy.minConfidence}
            className="mt-1"
            onChange={(event) => update({ minConfidence: Number(event.target.value) || 0 })}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={policy.escalateToBrowser}
            onChange={(event) => update({ escalateToBrowser: event.target.checked })}
          />
          {t('agent_orchestrator.settings.webSearch.escalateToBrowser', 'Escalate blocked sources to a browser')}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={policy.content.enabledByDefault}
            onChange={(event) =>
              update({ content: { ...policy.content, enabledByDefault: event.target.checked } })
            }
          />
          {t('agent_orchestrator.settings.webSearch.includeContentDefault', 'Read page content by default')}
        </label>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={isSaving}>
          {isSaving ? <Spinner className="size-4" /> : null}
          {t('agent_orchestrator.settings.webSearch.save', 'Save')}
        </Button>
      </div>
    </div>
  )
}
