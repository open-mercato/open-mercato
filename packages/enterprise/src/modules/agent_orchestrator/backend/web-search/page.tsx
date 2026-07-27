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
import { ChevronDown, ChevronRight, ArrowDown, ArrowUp } from 'lucide-react'
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
import { WebSearchHealthCard } from '../../components/WebSearchHealthCard'

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


/** Renders one option from an adapter's own schema, using the shared primitives. */
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
    return <Switch checked={value === true} onCheckedChange={onChange} />
  }
  if (field.kind === 'enum') {
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(next) => onChange(next === '' ? undefined : next)}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(field.choices ?? []).map((choice) => (
            <SelectItem key={choice} value={choice}>
              {choice}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (field.kind === 'number') {
    return (
      <Input
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    )
  }
  if (field.kind === 'stringList') {
    return (
      <Input
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
      value={typeof value === 'string' ? value : ''}
      placeholder={field.format === 'url' ? 'https://...' : undefined}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  )
}

/** One labelled control in the tuning grid. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
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

  return (
    <Page>
      <PageHeader
        title={t('agent_orchestrator.settings.webSearch.title', 'Web search')}
        description={t(
          'agent_orchestrator.settings.webSearch.description',
          'Choose which search sources agents may use, in which order, and how long they may take.',
        )}
        actions={
          <Button onClick={() => void save()} disabled={isSaving}>
            {isSaving ? <Spinner className="size-4" /> : null}
            {t('agent_orchestrator.settings.webSearch.save', 'Save')}
          </Button>
        }
      />

      <PageBody>
        <WebSearchHealthCard />

        <Card>
          <CardHeader>
            <CardTitle>{t('agent_orchestrator.settings.webSearch.adapters', 'Adapters')}</CardTitle>
            <CardDescription>
              {t(
                'agent_orchestrator.settings.webSearch.adaptersHint',
                'Enabled adapters run in order, up to the concurrency limit. Disabled adapters stay installed and can still act as the last resort.',
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
              <ul className="divide-y divide-border rounded-lg border border-border">
                {policy.adapters.map((entry, index) => {
                  const meta = installed.find((adapter) => adapter.id === entry.id)
                  const fields = meta?.fields ?? []
                  const isOpen = expanded.has(entry.id)
                  return (
                    <li key={entry.id} className="p-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <Switch
                          checked={entry.enabled}
                          onCheckedChange={(checked) => updateAdapter(entry.id, { enabled: checked })}
                        />
                        <span className="font-medium">{entry.id}</span>
                        {meta && !meta.configured ? (
                          <StatusBadge variant="warning">
                            {t('agent_orchestrator.settings.webSearch.needsConfig', 'Configuration required')}
                          </StatusBadge>
                        ) : null}
                        {meta ? (
                          <span className="text-xs text-muted-foreground">{meta.packageName}</span>
                        ) : null}

                        <div className="ml-auto flex items-center gap-2">
                          <Label className="text-xs text-muted-foreground">weight</Label>
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
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Move up"
                            disabled={index === 0}
                            onClick={() => move(entry.id, -1)}
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Move down"
                            disabled={index === policy.adapters.length - 1}
                            onClick={() => move(entry.id, 1)}
                          >
                            <ArrowDown className="size-4" />
                          </Button>
                          {fields.length > 0 ? (
                            <Button variant="outline" size="sm" onClick={() => toggleExpanded(entry.id)}>
                              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                              {isOpen
                                ? t('agent_orchestrator.settings.webSearch.hideConfig', 'Hide config')
                                : t('agent_orchestrator.settings.webSearch.showConfig', 'Configure')}
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {meta && !meta.configured && meta.configurationHint ? (
                        <p className="mt-2 text-xs text-status-warning-text">{meta.configurationHint}</p>
                      ) : null}

                      {isOpen && fields.length > 0 ? (
                        <div className="mt-3 grid grid-cols-1 gap-4 border-t border-border pt-3 sm:grid-cols-2">
                          {fields.map((field) => (
                            <Field
                              key={field.name}
                              label={field.required ? `${field.name} *` : field.name}
                            >
                              <OptionInput
                                field={field}
                                value={adapterOptions[entry.id]?.[field.name]}
                                onChange={(next) => updateOption(entry.id, field.name, next)}
                              />
                            </Field>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
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
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('agent_orchestrator.settings.webSearch.settleMode', 'Settle mode')}>
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
            </Field>

            <Field
              label={t('agent_orchestrator.settings.webSearch.lastResort', 'Last-resort adapter')}
              hint={t(
                'agent_orchestrator.settings.webSearch.lastResortHint',
                'Runs when every other adapter came up short, even if it is disabled above.',
              )}
            >
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
            </Field>

            {(
              [
                ['concurrency', 'Concurrent adapters'],
                ['minResults', 'Minimum results'],
                ['softDeadlineMs', 'Soft deadline (ms)'],
                ['hardDeadlineMs', 'Hard deadline (ms)'],
                ['cacheTtlMs', 'Cache TTL (ms)'],
              ] as const
            ).map(([key, fallback]) => (
              <Field key={key} label={t(`agent_orchestrator.settings.webSearch.${key}`, fallback)}>
                <Input
                  type="number"
                  min={0}
                  value={policy[key]}
                  onChange={(event) => update({ [key]: Number(event.target.value) || 0 } as Partial<Policy>)}
                />
              </Field>
            ))}

            <Field label={t('agent_orchestrator.settings.webSearch.minConfidence', 'Confidence threshold')}>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={policy.minConfidence}
                onChange={(event) => update({ minConfidence: Number(event.target.value) || 0 })}
              />
            </Field>

            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                checked={policy.escalateToBrowser}
                onCheckedChange={(checked) => update({ escalateToBrowser: checked })}
              />
              <Label>
                {t(
                  'agent_orchestrator.settings.webSearch.escalateToBrowser',
                  'Escalate blocked sources to a browser',
                )}
              </Label>
            </div>

            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                checked={policy.content.enabledByDefault}
                onCheckedChange={(checked) =>
                  update({ content: { ...policy.content, enabledByDefault: checked } })
                }
              />
              <Label>
                {t(
                  'agent_orchestrator.settings.webSearch.includeContentDefault',
                  'Read page content by default',
                )}
              </Label>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </Page>
  )
}
