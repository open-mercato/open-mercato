"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { z } from 'zod'
import { Plus, Binary, Sparkles, OctagonX, TriangleAlert } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { CrudForm, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Slider } from '@open-mercato/ui/primitives/slider'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
// TYPE-ONLY import — erased at compile time, so the scorer registry (zod schemas,
// score bodies, PII regexes) never enters the client bundle. Descriptors arrive at
// runtime from GET /eval-scorers.
import type { ScorerDescriptor, ScorerField } from '../../lib/eval/types'

/** Namespaced so two scorers can expose a field of the same name. */
const CONFIG_FIELD_PREFIX = 'cfg__'
const configFieldId = (scorerKey: string, name: string) => `${CONFIG_FIELD_PREFIX}${scorerKey}__${name}`

/** Slider is handled separately as a custom field, so it is excluded here. */
const SCORER_FIELD_TYPE: Record<
  Exclude<ScorerField['kind'], 'slider'>,
  'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'tags'
> = {
  text: 'text',
  textarea: 'textarea',
  json: 'textarea',
  number: 'number',
  boolean: 'checkbox',
  select: 'select',
  'string-list': 'tags',
}

const ENTITY_ID = 'agent_orchestrator:agent_eval_assertion'

type AssertionRow = {
  id: string
  key: string
  scorerKey: string
  title: string
  description: string | null
  appliesTo: string
  type: 'deterministic' | 'llm_judge'
  severity: 'gate' | 'warn'
  config: Record<string, unknown>
  rubric: string
  enabled: boolean
  updatedAt: string | null
}

type FormValues = {
  id?: string
  key?: string
  scorerKey: string
  title: string
  description?: string
  appliesTo: string
  type: 'deterministic' | 'llm_judge'
  severity: 'gate' | 'warn'
  /** Generated config controls, namespaced `cfg__<scorerKey>__<name>`. */
  [configField: string]: unknown
  enabled: boolean
  updatedAt?: string | null
}

const severityVariant: StatusMap<'gate' | 'warn'> = { gate: 'error', warn: 'warning' }
const TYPE_ICON: Record<'deterministic' | 'llm_judge', React.ComponentType<{ className?: string }>> = {
  deterministic: Binary,
  llm_judge: Sparkles,
}
const SEVERITY_ICON: Record<'gate' | 'warn', React.ComponentType<{ className?: string }>> = {
  gate: OctagonX,
  warn: TriangleAlert,
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function mapRow(item: Record<string, unknown>): AssertionRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  const type = readString(item, 'type') === 'llm_judge' ? 'llm_judge' : 'deterministic'
  const severity = readString(item, 'severity') === 'gate' ? 'gate' : 'warn'
  const config = (item.config && typeof item.config === 'object') ? (item.config as Record<string, unknown>) : {}
  const rubric = typeof config.rubric === 'string' ? config.rubric : ''
  const descriptionRaw = item.description ?? null
  const enabledRaw = item.enabled
  const key = readString(item, 'key')
  return {
    id,
    key,
    // Legacy rows predate the column; `config.scorer` then `key` reproduces the
    // pre-column resolution rule, so an unmigrated row still displays correctly.
    scorerKey:
      readString(item, 'scorer_key', 'scorerKey') ||
      (typeof config.scorer === 'string' ? config.scorer : '') ||
      key,
    config,
    title: readString(item, 'title'),
    description: typeof descriptionRaw === 'string' ? descriptionRaw : null,
    appliesTo: readString(item, 'applies_to', 'appliesTo') || '*',
    type,
    severity,
    rubric,
    enabled: enabledRaw === undefined ? true : Boolean(enabledRaw),
    updatedAt: readString(item, 'updated_at', 'updatedAt') || null,
  }
}

/**
 * Slider + live readout for a bounded scorer value. The number is shown beside the
 * track because a threshold is a value an operator reasons about precisely
 * ("0.75"), not just drags towards.
 */
function ScorerSliderField({
  value,
  onChange,
  disabled,
  min,
  max,
  step,
  fallback,
}: {
  value: unknown
  onChange: (next: number) => void
  disabled?: boolean
  min: number
  max: number
  step: number
  fallback: number
}) {
  const current = typeof value === 'number' ? value : Number(value)
  const resolved = Number.isFinite(current) ? current : fallback
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0

  return (
    <div className="flex items-center gap-4">
      <Slider
        className="flex-1"
        value={[resolved]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next) => onChange(next[0] ?? fallback)}
      />
      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-foreground">
        {resolved.toFixed(decimals)}
      </span>
    </div>
  )
}

export default function EvalAssertionsPage() {
  const t = useT()
  const [rows, setRows] = React.useState<AssertionRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<AssertionRow | null>(null)
  const [mode, setMode] = React.useState<'list' | 'create' | 'edit'>('list')
  const [agents, setAgents] = React.useState<CrudFieldOption[]>([])
  const [descriptors, setDescriptors] = React.useState<ScorerDescriptor[]>([])
  // Registered tool names, offered as datalist suggestions on tool-name fields.
  // Free text stays allowed: a tool from an agent that is not currently loaded is
  // still a legitimate value.
  const [toolNames, setToolNames] = React.useState<string[]>([])
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoading(true)
    setError(null)
    const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/eval-assertions?pageSize=100',
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) {
      setError(t('agent_orchestrator.evalAssertions.list.error'))
      if (!opts?.silent) setIsLoading(false)
      return
    }
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    setRows(items.map(mapRow).filter((row): row is AssertionRow => !!row))
    if (!opts?.silent) setIsLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const toggleEnabled = React.useCallback(async (row: AssertionRow, next: boolean) => {
    setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: next } : item)))
    try {
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        // Round-trip the stored config unchanged: this toggle must not rewrite it,
        // and the route re-validates whatever it receives.
        () => updateCrud('agent_orchestrator/eval-assertions', {
          id: row.id,
          key: row.key,
          scorerKey: row.scorerKey,
          title: row.title,
          description: row.description ?? undefined,
          appliesTo: row.appliesTo,
          type: row.type,
          severity: row.severity,
          enabled: next,
          config: Object.keys(row.config).length ? row.config : undefined,
        }),
      )
      await load({ silent: true })
    } catch (err) {
      setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: row.enabled } : item)))
      if (surfaceRecordConflict(err, t)) return
      flash(t('agent_orchestrator.evalAssertions.flash.toggleError', 'Could not update the assertion'), 'error')
    }
  }, [load, t])

  const formSchema = React.useMemo(
    () =>
      z
        .object({
          key: z.string().optional(),
          scorerKey: z.string().min(1, 'agent_orchestrator.evalAssertions.form.errors.scorerKeyRequired'),
          title: z.string().min(1, 'agent_orchestrator.evalAssertions.form.errors.titleRequired'),
          description: z.string().optional(),
          appliesTo: z.string().min(1),
          type: z.enum(['deterministic', 'llm_judge']),
          severity: z.enum(['gate', 'warn']),
          enabled: z.boolean(),
        })
        // Generated config fields are namespaced `cfg__<scorerKey>__<name>` and
        // validated server-side against the scorer's own schema (422), so they
        // pass through untyped here rather than being duplicated client-side.
        .passthrough(),
    [],
  )

  React.useEffect(() => {
    let cancelled = false
    // Gated on `ai_assistant.view`, which an eval author may not hold — a failure
    // simply means no suggestions, never a broken form.
    void apiCall<{ tools?: Array<{ name?: unknown }> }>(
      '/api/ai_assistant/tools',
      undefined,
      { fallback: { tools: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      const names = (Array.isArray(call.result?.tools) ? call.result.tools : [])
        .map((tool) => (typeof tool?.name === 'string' ? tool.name : ''))
        .filter(Boolean)
      setToolNames(Array.from(new Set(names)).sort())
    })
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ scorers?: ScorerDescriptor[] }>(
      '/api/agent_orchestrator/eval-scorers',
      undefined,
      { fallback: { scorers: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      setDescriptors(Array.isArray(call.result?.scorers) ? call.result.scorers : [])
    })
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/agents',
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setAgents(
        items
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : typeof item.agent_id === 'string' ? item.agent_id : ''
            const label = typeof item.label === 'string' && item.label ? item.label : id
            return { value: id, label }
          })
          .filter((option) => option.value !== ''),
      )
    })
    return () => { cancelled = true }
  }, [])

  const appliesToOptions = React.useMemo<CrudFieldOption[]>(
    () => [{ value: '*', label: t('agent_orchestrator.evalAssertions.form.allAgents', 'All agents') }, ...agents],
    [agents, t],
  )

  // `scorerKey` selects WHICH scorer runs; `key` is this assertion's own slug, so
  // several assertions can share one scorer (two `contains` checks, say). Options
  // come from the API rather than a direct registry import — see the note there.
  const scorerOptions = React.useMemo<CrudFieldOption[]>(
    () =>
      // Deprecated aliases are kept in the list: the migration writes them into
      // `scorer_key` for existing rows, so filtering them out would render a
      // required select with no matching option when editing such a row.
      descriptors.map((descriptor) => ({
        value: descriptor.scorerKey,
        // Label only. The scorer key is an internal identifier the operator never
        // types; showing it made every option read like a debug dump.
        label: descriptor.deprecated
          ? `${t(descriptor.labelKey, descriptor.scorerKey)} (${t('agent_orchestrator.evalAssertions.form.deprecated')})`
          : t(descriptor.labelKey, descriptor.scorerKey),
      })),
    [descriptors, t],
  )

  /**
   * Config fields for EVERY scorer are declared up front, each gated on its own
   * `scorerKey`, so switching scorer swaps the visible controls without a refetch
   * and without bespoke per-scorer form code.
   */
  const configFields = React.useMemo<CrudField[]>(
    () =>
      descriptors.flatMap((descriptor) =>
        descriptor.fields.map((field): CrudField => {
          const id = configFieldId(descriptor.scorerKey, field.name)
          const base = {
            id,
            label: t(field.labelKey, field.name),
            description: field.hintKey ? t(field.hintKey, '') || undefined : undefined,
            required: 'required' in field ? field.required : undefined,
            visibleWhen: { field: 'scorerKey', equals: descriptor.scorerKey } as const,
          }

          // A bounded 0..1 value renders as a slider: the range is the point, and a
          // bare number input gives no clue that 0.5 is mid-scale.
          if (field.kind === 'slider') {
            return {
              ...base,
              type: 'custom',
              component: ({ value, setValue, disabled }) => (
                <ScorerSliderField
                  value={value}
                  onChange={setValue}
                  disabled={disabled}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  fallback={field.default ?? field.min}
                />
              ),
            }
          }

          return {
            ...base,
            type: SCORER_FIELD_TYPE[field.kind],
            placeholder:
              'placeholderKey' in field && field.placeholderKey
                ? t(field.placeholderKey, '') || undefined
                : undefined,
            suggestions: 'suggest' in field && field.suggest === 'tool' ? toolNames : undefined,
            options:
              field.kind === 'select'
                ? field.options.map((option) => ({ value: option.value, label: t(option.labelKey, option.value) }))
                : undefined,
          }
        }),
      ),
    [descriptors, t, toolNames],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'title', label: t('agent_orchestrator.evalAssertions.form.title'), type: 'text', required: true },
      {
        id: 'scorerKey',
        label: t('agent_orchestrator.evalAssertions.form.scorerKey'),
        type: 'select',
        options: scorerOptions,
        description: t('agent_orchestrator.evalAssertions.form.scorerKeyHint'),
        required: true,
      },
      {
        id: 'key',
        label: t('agent_orchestrator.evalAssertions.form.key'),
        type: 'text',
        description: t('agent_orchestrator.evalAssertions.form.keyHint'),
      },
      ...configFields,
      { id: 'description', label: t('agent_orchestrator.evalAssertions.form.description'), type: 'textarea' },
      { id: 'appliesTo', label: t('agent_orchestrator.evalAssertions.form.appliesTo'), type: 'combobox', options: appliesToOptions, seedOptions: appliesToOptions, allowCustomValues: true, required: true },
      // `type` is no longer an input: the registry's `kind` is the authoritative
      // answer to deterministic-vs-judge, so offering a control that `buildBody`
      // then overrides would just let the two disagree on screen.
      {
        id: 'severity',
        label: t('agent_orchestrator.evalAssertions.form.severity'),
        type: 'select',
        description: t('agent_orchestrator.evalAssertions.form.severityHint'),
        options: [
          { value: 'gate', label: t('agent_orchestrator.evalAssertions.severity.gate') },
          { value: 'warn', label: t('agent_orchestrator.evalAssertions.severity.warn') },
        ],
      },
      { id: 'enabled', label: t('agent_orchestrator.evalAssertions.form.enabled'), type: 'checkbox' },
    ],
    [t, appliesToOptions, scorerOptions, configFields],
  )

  const columns = React.useMemo<ColumnDef<AssertionRow>[]>(
    () => [
      {
        accessorKey: 'title',
        header: t('agent_orchestrator.evalAssertions.list.col.title'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{row.original.title}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{row.original.key}</div>
          </div>
        ),
      },
      {
        accessorKey: 'appliesTo',
        header: t('agent_orchestrator.evalAssertions.list.col.appliesTo'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.appliesTo}</span>,
      },
      {
        accessorKey: 'type',
        header: t('agent_orchestrator.evalAssertions.list.col.type'),
        cell: ({ row }) => {
          const Icon = TYPE_ICON[row.original.type]
          return (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              {t(`agent_orchestrator.evalAssertions.type.${row.original.type}`)}
            </span>
          )
        },
      },
      {
        accessorKey: 'severity',
        header: t('agent_orchestrator.evalAssertions.list.col.severity'),
        cell: ({ row }) => {
          const Icon = SEVERITY_ICON[row.original.severity]
          return (
            <StatusBadge variant={severityVariant[row.original.severity]} className="gap-1.5">
              <Icon className="size-3.5 shrink-0" />
              {t(`agent_orchestrator.evalAssertions.severity.${row.original.severity}`)}
            </StatusBadge>
          )
        },
      },
      {
        accessorKey: 'enabled',
        header: t('agent_orchestrator.evalAssertions.list.col.enabled'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center" onClick={(event) => event.stopPropagation()}>
            <Switch
              checked={row.original.enabled}
              onCheckedChange={(next) => { void toggleEnabled(row.original, next) }}
              aria-label={t('agent_orchestrator.evalAssertions.list.col.enabled')}
            />
          </div>
        ),
      },
    ],
    [t, toggleEnabled],
  )

  /**
   * The slug defaults to the scorer key, which reproduces the old one-per-scorer
   * naming for a user who does not care. Supplying a slug is what unlocks several
   * assertions sharing one scorer.
   */
  function effectiveKey(values: FormValues): string {
    const explicit = typeof values.key === 'string' ? values.key.trim() : ''
    return explicit || values.scorerKey?.trim() || ''
  }

  /** Collects the generated `cfg__<scorerKey>__*` controls back into a config object. */
  function collectConfig(values: FormValues): Record<string, unknown> | undefined {
    const descriptor = descriptors.find((entry) => entry.scorerKey === values.scorerKey)
    if (!descriptor) return undefined
    // Seed from the stored config so keys the form does not render — `negate`, and
    // anything a newer server version added — survive an edit instead of being
    // silently dropped. `negate` in particular inverts the assertion's meaning.
    const rendered = new Set(descriptor.fields.map((field) => field.name))
    const config: Record<string, unknown> = Object.fromEntries(
      Object.entries(editing?.scorerKey === values.scorerKey ? editing.config : {})
        .filter(([name]) => name !== 'scorer' && !rendered.has(name)),
    )
    for (const field of descriptor.fields) {
      const raw = values[configFieldId(descriptor.scorerKey, field.name)]
      if (raw === undefined || raw === null || raw === '') continue
      config[field.name] = field.kind === 'number' ? Number(raw) : raw
    }
    return Object.keys(config).length ? config : undefined
  }

  function buildBody(values: FormValues) {
    const descriptor = descriptors.find((entry) => entry.scorerKey === values.scorerKey)
    // `kind` is the registry's own answer to deterministic-vs-judge, so the two
    // can never drift; the explicit `type` control is only a fallback for a
    // descriptor that has not loaded yet.
    const type = descriptor?.kind ?? values.type
    // No longer coerced. The route stopped forcing judges to `warn` when GatePolicy
    // landed: a judge assertion MAY be declared `gate`, and whether that gates is
    // decided per plane at evaluation time (manual workbench yes, CI and online
    // ingest no). Coercing here would silently discard the operator's choice and
    // make the manual policy unreachable from the UI that configures it.
    const severity = values.severity
    const body: Record<string, unknown> = {
      key: effectiveKey(values),
      scorerKey: values.scorerKey,
      title: values.title,
      description: values.description?.trim() ? values.description.trim() : undefined,
      appliesTo: values.appliesTo,
      type,
      severity,
      enabled: values.enabled,
      config: collectConfig(values),
    }
    return body
  }

  if (mode !== 'list') {
    const isEdit = mode === 'edit' && editing
    const initialValues: Partial<FormValues> = isEdit
      ? {
          id: editing!.id,
          key: editing!.key,
          scorerKey: editing!.scorerKey,
          title: editing!.title,
          description: editing!.description ?? undefined,
          appliesTo: editing!.appliesTo,
          type: editing!.type,
          severity: editing!.severity,
          enabled: editing!.enabled,
          updatedAt: editing!.updatedAt,
          // Explode the stored config back into the generated controls.
          ...Object.fromEntries(
            Object.entries(editing!.config)
              .filter(([name]) => name !== 'scorer')
              .map(([name, value]) => [configFieldId(editing!.scorerKey, name), value]),
          ),
        }
      : { appliesTo: '*', type: 'deterministic', severity: 'warn', enabled: false }

    return (
      <Page>
        <PageBody>
          <div className="max-w-2xl">
          <CrudForm<FormValues>
            title={
              isEdit
                ? t('agent_orchestrator.evalAssertions.form.editTitle')
                : t('agent_orchestrator.evalAssertions.form.createTitle')
            }
            fields={fields}
            initialValues={initialValues}
            entityIds={[ENTITY_ID]}
            schema={formSchema}
            submitLabel={t('agent_orchestrator.evalAssertions.form.submit')}
            cancelHref="/backend/eval-assertions"
            disableOptimisticLock
            onSubmit={async (values) => {
              if (!effectiveKey(values)) {
                const message = t('agent_orchestrator.evalAssertions.form.errors.keyRequired')
                throw createCrudFormError(message, { key: message })
              }
              const body = buildBody(values)
              try {
                if (isEdit) {
                  await withScopedApiRequestHeaders(
                    buildOptimisticLockHeader(editing!.updatedAt),
                    () => updateCrud('agent_orchestrator/eval-assertions', { id: editing!.id, ...body }),
                  )
                } else {
                  await createCrud('agent_orchestrator/eval-assertions', body)
                }
              } catch (err) {
                if (surfaceRecordConflict(err, t)) return
                throw err
              }
              flash(t('agent_orchestrator.evalAssertions.flash.saved'), 'success')
              setMode('list')
              setEditing(null)
              await load()
            }}
          />
          </div>
        </PageBody>
      </Page>
    )
  }

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('agent_orchestrator.evalAssertions.list.title')} />
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t('agent_orchestrator.evalAssertions.list.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.evalAssertions.list.subtitle')}</p>
          </div>
          <Button size="sm" onClick={() => { setEditing(null); setMode('create') }}>
            <Plus className="mr-2 size-4" />
            {t('agent_orchestrator.evalAssertions.actions.new')}
          </Button>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.evalAssertions.list.empty')}
            description={t('agent_orchestrator.evalAssertions.list.emptyDescription')}
          />
        ) : (
          <DataTable<AssertionRow>
            columns={columns}
            data={rows}
            sortable
            onRowClick={(row) => { setEditing(row); setMode('edit') }}
            rowActions={(row) => (
              <RowActions
                items={[
                  {
                    id: 'edit',
                    label: t('agent_orchestrator.evalAssertions.list.actions.edit'),
                    onSelect: () => { setEditing(row); setMode('edit') },
                  },
                  {
                    id: 'delete',
                    label: t('agent_orchestrator.evalAssertions.list.actions.delete'),
                    destructive: true,
                    onSelect: async () => {
                      const confirmed = await confirm({
                        text: t('agent_orchestrator.evalAssertions.confirmDelete.text'),
                        variant: 'destructive',
                      })
                      if (!confirmed) return
                      try {
                        await withScopedApiRequestHeaders(
                          buildOptimisticLockHeader(row.updatedAt),
                          () => deleteCrud('agent_orchestrator/eval-assertions', row.id),
                        )
                        flash(t('agent_orchestrator.evalAssertions.flash.deleted'), 'success')
                        await load()
                      } catch (err) {
                        if (surfaceRecordConflict(err, t)) return
                        flash(t('agent_orchestrator.evalAssertions.flash.error'), 'error')
                      }
                    },
                  },
                ]}
              />
            )}
          />
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
