"use client"

/**
 * Per-tenant web-search policy: which adapters run, in what order, and under
 * what deadlines. Env supplies the deployment default; saving here writes a
 * tenant override, so a fresh tenant inherits until someone deliberately diverges.
 */

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WebSearchHealthCard } from '../../../components/WebSearchHealthCard'

const SETTINGS_URL = '/api/agent_orchestrator/web-search/settings'

type AdapterEntry = { id: string; enabled: boolean; order: number; weight: number }

type InstalledAdapter = { id: string; kind: string; packageName: string }

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

export default function WebSearchSettingsPage() {
  const t = useT()
  const [policy, setPolicy] = React.useState<Policy | null>(null)
  const [installed, setInstalled] = React.useState<InstalledAdapter[]>([])
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
      setInstalled(next.installed ?? [])
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
          const call = await apiCall(SETTINGS_URL, { method: 'PUT', body: JSON.stringify(policy) })
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
              return (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(event) => updateAdapter(entry.id, { enabled: event.target.checked })}
                    />
                    <span className="font-mono">{entry.id}</span>
                  </label>
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
                      onChange={(event) =>
                        updateAdapter(entry.id, { weight: Number(event.target.value) || 0 })
                      }
                    />
                  </label>
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
