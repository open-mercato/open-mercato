"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { z } from 'zod'
import { Plus, Bot, Workflow as WorkflowIcon, CalendarClock, X, TriangleAlert } from 'lucide-react'
// Deep import, NOT the package root: `@open-mercato/scheduler`'s index also
// exports `SchedulerService`, which reaches `shared/lib/i18n/server` and its
// `require('server-only')`. Pulling that into a "use client" module breaks the
// build with 'server-only' cannot be imported from a Client Component module.
// `lib/cronParser` depends on `cron-parser` alone and is safe in the browser.
import { validateCronExpression } from '@open-mercato/scheduler/modules/scheduler/lib/cronParser'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudCustomFieldRenderProps,
} from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeAge, formatDateTime } from '../../../components/types'
import { useCoalescedReload } from '../../../components/useCoalescedReload'
import { isValidIanaTimeZone } from '../../../data/validators'
import {
  listTimeZones,
  parseGrantedFeaturesText,
  resolveFeaturePrefill,
  unknownFeatureIds,
} from './formHelpers'

const ENTITY_ID = 'agent_orchestrator:agent_process_definition'

type ProcessRunStatus = 'running' | 'completed' | 'failed'

type ProcessLastRun = { status: ProcessRunStatus; finishedAt: string | null }

const lastRunVariant: StatusMap<ProcessRunStatus> = {
  running: 'info',
  completed: 'success',
  failed: 'error',
}

function mapLastRun(raw: unknown): ProcessLastRun | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const status = record.status
  if (status !== 'running' && status !== 'completed' && status !== 'failed') return null
  const finished = record.finished_at ?? record.finishedAt
  return { status, finishedAt: typeof finished === 'string' ? finished : null }
}

type ProcessDefinitionRow = {
  id: string
  name: string
  description: string | null
  targetType: 'agent' | 'workflow'
  targetAgentId: string | null
  targetWorkflowId: string | null
  inputDefaults: unknown
  inputSchema: unknown
  grantedFeatures: string[]
  scheduleCron: string | null
  scheduleTimezone: string | null
  scheduleEnabled: boolean
  enabled: boolean
  lastRun: ProcessLastRun | null
  updatedAt: string | null
}

type FormValues = {
  id?: string
  name: string
  description?: string
  targetType: 'agent' | 'workflow'
  targetAgentId?: string
  targetWorkflowId?: string
  inputDefaultsJson?: string
  inputSchemaJson?: string
  grantedFeaturesText?: string
  scheduleCron?: string
  scheduleTimezone?: string
  scheduleEnabled: boolean
  enabled: boolean
  updatedAt?: string | null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function mapRow(item: Record<string, unknown>): ProcessDefinitionRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  const grantedRaw = item.granted_features ?? item.grantedFeatures
  return {
    id,
    name: readString(item, 'name'),
    description: typeof item.description === 'string' ? item.description : null,
    targetType: readString(item, 'target_type', 'targetType') === 'workflow' ? 'workflow' : 'agent',
    targetAgentId: readString(item, 'target_agent_id', 'targetAgentId') || null,
    targetWorkflowId: readString(item, 'target_workflow_id', 'targetWorkflowId') || null,
    inputDefaults: item.input_defaults ?? item.inputDefaults ?? null,
    inputSchema: item.input_schema ?? item.inputSchema ?? null,
    grantedFeatures: Array.isArray(grantedRaw)
      ? grantedRaw.filter((value): value is string => typeof value === 'string')
      : [],
    scheduleCron: readString(item, 'schedule_cron', 'scheduleCron') || null,
    scheduleTimezone: readString(item, 'schedule_timezone', 'scheduleTimezone') || null,
    scheduleEnabled: (item.schedule_enabled ?? item.scheduleEnabled) !== false,
    enabled: (item.enabled ?? true) !== false,
    lastRun: mapLastRun(item.last_run ?? item.lastRun),
    updatedAt: readString(item, 'updated_at', 'updatedAt') || null,
  }
}

function parseJsonField(raw: string | undefined, fieldId: string, message: string): unknown {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    throw createCrudFormError(message, { [fieldId]: message })
  }
}

type FeatureCatalogItem = { id: string; title: string }

const FEATURES_DATALIST_ID = 'om-agent-process-definition-features'

/**
 * Chips + datalist picker over the declared feature catalog. The form value
 * stays the newline-joined string (`grantedFeaturesText`) so submit/edit
 * plumbing is unchanged; this component is the safety layer: catalog
 * suggestions while typing, warning chips for unknown ids, a least-privilege
 * prefill when switching a fresh task to a workflow target, and a non-blocking
 * empty-grants warning for workflow-target tasks.
 */
function FeaturesPickerField({
  fieldProps,
  catalog,
  isEdit,
  t,
}: {
  fieldProps: CrudCustomFieldRenderProps
  catalog: FeatureCatalogItem[]
  isEdit: boolean
  t: ReturnType<typeof useT>
}) {
  const { value, values, setValue } = fieldProps
  const [draft, setDraft] = React.useState('')
  const prefilledRef = React.useRef(false)
  const features = React.useMemo(
    () => parseGrantedFeaturesText(typeof value === 'string' ? value : ''),
    [value],
  )
  const targetType = values?.targetType === 'workflow' ? ('workflow' as const) : ('agent' as const)

  React.useEffect(() => {
    if (isEdit || prefilledRef.current) return
    const prefill = resolveFeaturePrefill(targetType, features)
    if (prefill) {
      prefilledRef.current = true
      setValue(prefill.join('\n'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType])

  const unknown = React.useMemo(
    () => new Set(unknownFeatureIds(features, catalog.map((item) => item.id))),
    [features, catalog],
  )

  const addDraft = React.useCallback(() => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (!features.includes(trimmed)) setValue([...features, trimmed].join('\n'))
    setDraft('')
  }, [draft, features, setValue])

  const removeFeature = React.useCallback(
    (id: string) => {
      setValue(features.filter((feature) => feature !== id).join('\n'))
    },
    [features, setValue],
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          id={fieldProps.id}
          list={FEATURES_DATALIST_ID}
          value={draft}
          placeholder={t('agent_orchestrator.processDefinitions.form.featuresAdd')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addDraft()
            }
          }}
        />
        <Button type="button" variant="outline" onClick={addDraft} disabled={!draft.trim()}>
          {t('agent_orchestrator.processDefinitions.form.featuresAddAction')}
        </Button>
        <datalist id={FEATURES_DATALIST_ID}>
          {catalog.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </datalist>
      </div>
      {features.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {features.map((feature) => {
            const isUnknown = unknown.has(feature)
            return (
              <span
                key={feature}
                title={isUnknown ? t('agent_orchestrator.processDefinitions.form.featuresUnknown') : undefined}
                className={
                  isUnknown
                    ? 'inline-flex items-center gap-1 rounded-md border border-status-warning-border bg-status-warning-bg px-2 py-0.5 font-mono text-xs text-status-warning-text'
                    : 'inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground'
                }
              >
                {isUnknown ? <TriangleAlert className="size-3 shrink-0" /> : null}
                {feature}
                <IconButton
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t('agent_orchestrator.processDefinitions.form.featuresRemove', undefined, { id: feature })}
                  onClick={() => removeFeature(feature)}
                >
                  <X className="size-3" />
                </IconButton>
              </span>
            )
          })}
        </div>
      ) : null}
      {targetType === 'workflow' && features.length === 0 ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning-text"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('agent_orchestrator.processDefinitions.form.workflowGrantsWarning')}</span>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Display-only "Next runs" preview under the schedule fields — the live
 * semantic feedback that makes a typo'd cron visible before save. Uses the
 * same scheduler parser the server-side validator runs.
 */
function CronPreviewField({
  values,
  locale,
  t,
}: {
  values: Record<string, unknown> | undefined
  locale: string
  t: ReturnType<typeof useT>
}) {
  const cron = typeof values?.scheduleCron === 'string' ? values.scheduleCron.trim() : ''
  const timezoneRaw = typeof values?.scheduleTimezone === 'string' ? values.scheduleTimezone.trim() : ''
  const timezone = timezoneRaw && isValidIanaTimeZone(timezoneRaw) ? timezoneRaw : 'UTC'
  if (!cron) return null
  const result = validateCronExpression(cron, { timezone, count: 3 })
  if (!result.ok) {
    return (
      <p className="text-xs text-status-error-text">
        {t('agent_orchestrator.processDefinitions.form.nextRunsInvalid', undefined, { error: result.error ?? '' })}
      </p>
    )
  }
  return (
    <div className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{t('agent_orchestrator.processDefinitions.form.nextRuns')}:</span>{' '}
      {(result.nextRuns ?? []).map((run) => formatDateTime(run.toISOString(), locale)).join(' · ')}
    </div>
  )
}

export default function ProcessDefinitionsPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<ProcessDefinitionRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<ProcessDefinitionRow | null>(null)
  const [mode, setMode] = React.useState<'list' | 'create' | 'edit'>('list')
  const [agents, setAgents] = React.useState<CrudFieldOption[]>([])
  const [workflows, setWorkflows] = React.useState<CrudFieldOption[]>([])
  const [featureCatalog, setFeatureCatalog] = React.useState<FeatureCatalogItem[]>([])
  const locale = useLocale()
  const timeZoneOptions = React.useMemo<CrudFieldOption[]>(
    () => listTimeZones().map((zone) => ({ value: zone, label: zone })),
    [],
  )
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoading(true)
    setError(null)
    const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/process-definitions?pageSize=100',
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) {
      setError(t('agent_orchestrator.processDefinitions.list.error'))
      if (!opts?.silent) setIsLoading(false)
      return
    }
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    setRows(items.map(mapRow).filter((row): row is ProcessDefinitionRow => !!row))
    if (!opts?.silent) setIsLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  // Live refresh: task runs starting/finishing update the Last-run column
  // without a manual reload (silent — no loading flash), coalesced so an
  // event burst triggers at most one refetch per interval.
  const coalescedReload = useCoalescedReload(
    React.useCallback(() => { void load({ silent: true }) }, [load]),
  )
  useAppEvent('agent_orchestrator.process_run.*', () => {
    coalescedReload()
  })

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
            const id = typeof item.id === 'string' ? item.id : ''
            const label = typeof item.label === 'string' && item.label ? item.label : id
            return { value: id, label }
          })
          .filter((option) => option.value !== ''),
      )
    })
    void apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/workflows/definitions?pageSize=100',
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setWorkflows(
        items
          .map((item) => {
            const id = typeof item.workflowId === 'string' ? item.workflowId : ''
            const label = typeof item.name === 'string' && item.name ? `${item.name} (${id})` : id
            return { value: id, label }
          })
          .filter((option) => option.value !== ''),
      )
    })
    void apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/features',
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setFeatureCatalog(
        items
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id : '',
            title: typeof item.title === 'string' ? item.title : '',
          }))
          .filter((item) => item.id !== ''),
      )
    })
    return () => { cancelled = true }
  }, [])

  const toggleEnabled = React.useCallback(async (row: ProcessDefinitionRow, next: boolean) => {
    setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: next } : item)))
    try {
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => updateCrud('agent_orchestrator/process-definitions', {
          id: row.id,
          name: row.name,
          targetType: row.targetType,
          targetAgentId: row.targetAgentId ?? undefined,
          targetWorkflowId: row.targetWorkflowId ?? undefined,
          enabled: next,
        }),
      )
      await load({ silent: true })
    } catch (err) {
      setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: row.enabled } : item)))
      if (surfaceRecordConflict(err, t)) return
      flash(t('agent_orchestrator.processDefinitions.flash.toggleError'), 'error')
    }
  }, [load, t])

  const formSchema = React.useMemo(
    () =>
      z
        .object({
          name: z.string().min(1, 'agent_orchestrator.processDefinitions.form.errors.nameRequired'),
          description: z.string().optional(),
          targetType: z.enum(['agent', 'workflow']),
          targetAgentId: z.string().optional(),
          targetWorkflowId: z.string().optional(),
          inputDefaultsJson: z.string().optional(),
          inputSchemaJson: z.string().optional(),
          grantedFeaturesText: z.string().optional(),
          scheduleCron: z.string().optional(),
          scheduleTimezone: z.string().optional(),
          scheduleEnabled: z.boolean(),
          enabled: z.boolean(),
        })
        .superRefine((data, ctx) => {
          const cron = data.scheduleCron?.trim()
          if (cron && !validateCronExpression(cron, { count: 1 }).ok) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['scheduleCron'],
              message: 'agent_orchestrator.processDefinitions.form.errors.cronInvalid',
            })
          }
          const timezone = data.scheduleTimezone?.trim()
          if (timezone && !isValidIanaTimeZone(timezone)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['scheduleTimezone'],
              message: 'agent_orchestrator.processDefinitions.form.errors.timezoneInvalid',
            })
          }
        }),
    [],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'name', label: t('agent_orchestrator.processDefinitions.form.name'), type: 'text', required: true },
      { id: 'description', label: t('agent_orchestrator.processDefinitions.form.description'), type: 'textarea' },
      {
        id: 'targetType',
        label: t('agent_orchestrator.processDefinitions.form.targetType'),
        type: 'select',
        options: [
          { value: 'agent', label: t('agent_orchestrator.processDefinitions.target.agent') },
          { value: 'workflow', label: t('agent_orchestrator.processDefinitions.target.workflow') },
        ],
      },
      {
        id: 'targetAgentId',
        label: t('agent_orchestrator.processDefinitions.form.targetAgent'),
        type: 'combobox',
        options: agents,
        seedOptions: agents,
        allowCustomValues: true,
        visibleWhen: { field: 'targetType', equals: 'agent' },
      },
      {
        id: 'targetWorkflowId',
        label: t('agent_orchestrator.processDefinitions.form.targetWorkflow'),
        type: 'combobox',
        options: workflows,
        seedOptions: workflows,
        allowCustomValues: true,
        visibleWhen: { field: 'targetType', equals: 'workflow' },
      },
      {
        id: 'inputDefaultsJson',
        label: t('agent_orchestrator.processDefinitions.form.inputDefaults'),
        type: 'textarea',
        description: t('agent_orchestrator.processDefinitions.form.inputDefaultsHint'),
      },
      {
        id: 'inputSchemaJson',
        label: t('agent_orchestrator.processDefinitions.form.inputSchema'),
        type: 'textarea',
        description: t('agent_orchestrator.processDefinitions.form.inputSchemaHint'),
      },
      {
        id: 'grantedFeaturesText',
        label: t('agent_orchestrator.processDefinitions.form.grantedFeatures'),
        type: 'custom',
        description: t('agent_orchestrator.processDefinitions.form.grantedFeaturesHint'),
        component: (fieldProps) => (
          <FeaturesPickerField fieldProps={fieldProps} catalog={featureCatalog} isEdit={mode === 'edit'} t={t} />
        ),
      },
      {
        id: 'scheduleCron',
        label: t('agent_orchestrator.processDefinitions.form.scheduleCron'),
        type: 'text',
        description: t('agent_orchestrator.processDefinitions.form.scheduleCronHint'),
      },
      {
        id: 'scheduleTimezone',
        label: t('agent_orchestrator.processDefinitions.form.scheduleTimezone'),
        type: 'combobox',
        options: timeZoneOptions,
        seedOptions: timeZoneOptions,
        allowCustomValues: true,
      },
      {
        id: 'schedulePreview',
        label: '',
        type: 'custom',
        component: ({ values }) => <CronPreviewField values={values} locale={locale} t={t} />,
      },
      { id: 'scheduleEnabled', label: t('agent_orchestrator.processDefinitions.form.scheduleEnabled'), type: 'checkbox' },
      { id: 'enabled', label: t('agent_orchestrator.processDefinitions.form.enabled'), type: 'checkbox' },
    ],
    [t, agents, workflows, featureCatalog, timeZoneOptions, locale, mode],
  )

  const columns = React.useMemo<ColumnDef<ProcessDefinitionRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('agent_orchestrator.processDefinitions.list.col.name'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{row.original.name}</div>
            {row.original.description ? (
              <div className="truncate text-xs text-muted-foreground">{row.original.description}</div>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'targetType',
        header: t('agent_orchestrator.processDefinitions.list.col.target'),
        cell: ({ row }) => {
          const isAgent = row.original.targetType === 'agent'
          const Icon = isAgent ? Bot : WorkflowIcon
          const target = isAgent ? row.original.targetAgentId : row.original.targetWorkflowId
          return (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{target ?? '—'}</span>
            </span>
          )
        },
      },
      {
        accessorKey: 'scheduleCron',
        header: t('agent_orchestrator.processDefinitions.list.col.schedule'),
        cell: ({ row }) =>
          row.original.scheduleCron ? (
            <span className="inline-flex items-center gap-1 font-mono text-xs text-foreground">
              <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
              {row.original.scheduleCron}
              {!row.original.scheduleEnabled ? (
                <span className="text-muted-foreground">({t('agent_orchestrator.processDefinitions.list.schedulePaused')})</span>
              ) : null}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'lastRun',
        header: t('agent_orchestrator.processDefinitions.list.col.lastRun'),
        enableSorting: false,
        cell: ({ row }) => {
          const lastRun = row.original.lastRun
          if (!lastRun) {
            return <span className="text-xs text-muted-foreground">{t('agent_orchestrator.processDefinitions.list.lastRunNever')}</span>
          }
          const age = formatRelativeAge(lastRun.finishedAt)
          return (
            <span className="inline-flex items-center gap-1.5">
              <StatusBadge variant={lastRunVariant[lastRun.status]}>
                {t(`agent_orchestrator.processDefinitions.runs.status.${lastRun.status}`)}
              </StatusBadge>
              {age ? <span className="text-xs tabular-nums text-muted-foreground">{age}</span> : null}
            </span>
          )
        },
      },
      {
        accessorKey: 'enabled',
        header: t('agent_orchestrator.processDefinitions.list.col.enabled'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center" onClick={(event) => event.stopPropagation()}>
            <Switch
              checked={row.original.enabled}
              onCheckedChange={(next) => { void toggleEnabled(row.original, next) }}
              aria-label={t('agent_orchestrator.processDefinitions.list.col.enabled')}
            />
          </div>
        ),
      },
    ],
    [t, toggleEnabled],
  )

  function buildBody(values: FormValues): Record<string, unknown> {
    const invalidJson = t('agent_orchestrator.processDefinitions.form.errors.invalidJson')
    const inputDefaults = parseJsonField(values.inputDefaultsJson, 'inputDefaultsJson', invalidJson)
    const inputSchema = parseJsonField(values.inputSchemaJson, 'inputSchemaJson', invalidJson)
    const grantedFeatures = (values.grantedFeaturesText ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    return {
      name: values.name,
      description: values.description?.trim() ? values.description.trim() : undefined,
      targetType: values.targetType,
      targetAgentId: values.targetType === 'agent' ? values.targetAgentId : undefined,
      targetWorkflowId: values.targetType === 'workflow' ? values.targetWorkflowId : undefined,
      inputDefaults,
      inputSchema,
      grantedFeatures,
      scheduleCron: values.scheduleCron?.trim() ? values.scheduleCron.trim() : null,
      scheduleTimezone: values.scheduleTimezone?.trim() ? values.scheduleTimezone.trim() : null,
      scheduleEnabled: values.scheduleEnabled,
      enabled: values.enabled,
    }
  }

  if (mode !== 'list') {
    const isEdit = mode === 'edit' && editing
    const initialValues: Partial<FormValues> = isEdit
      ? {
          id: editing!.id,
          name: editing!.name,
          description: editing!.description ?? undefined,
          targetType: editing!.targetType,
          targetAgentId: editing!.targetAgentId ?? undefined,
          targetWorkflowId: editing!.targetWorkflowId ?? undefined,
          inputDefaultsJson: editing!.inputDefaults ? JSON.stringify(editing!.inputDefaults, null, 2) : '',
          inputSchemaJson: editing!.inputSchema ? JSON.stringify(editing!.inputSchema, null, 2) : '',
          grantedFeaturesText: editing!.grantedFeatures.join('\n'),
          scheduleCron: editing!.scheduleCron ?? '',
          scheduleTimezone: editing!.scheduleTimezone ?? '',
          scheduleEnabled: editing!.scheduleEnabled,
          enabled: editing!.enabled,
          updatedAt: editing!.updatedAt,
        }
      : { targetType: 'agent', scheduleEnabled: true, enabled: true }

    return (
      <Page>
        <PageBody>
          <div className="max-w-2xl">
            <CrudForm<FormValues>
              title={
                isEdit
                  ? t('agent_orchestrator.processDefinitions.form.editTitle')
                  : t('agent_orchestrator.processDefinitions.form.createTitle')
              }
              fields={fields}
              initialValues={initialValues}
              entityIds={[ENTITY_ID]}
              schema={formSchema}
              submitLabel={t('agent_orchestrator.processDefinitions.form.submit')}
              cancelHref="/backend/processes/definitions"
              disableOptimisticLock
              onSubmit={async (values) => {
                const targetId = values.targetType === 'agent' ? values.targetAgentId : values.targetWorkflowId
                if (!targetId?.trim()) {
                  const message = t('agent_orchestrator.processDefinitions.form.errors.targetRequired')
                  const fieldId = values.targetType === 'agent' ? 'targetAgentId' : 'targetWorkflowId'
                  throw createCrudFormError(message, { [fieldId]: message })
                }
                const body = buildBody(values)
                try {
                  if (isEdit) {
                    await withScopedApiRequestHeaders(
                      buildOptimisticLockHeader(editing!.updatedAt),
                      () => updateCrud('agent_orchestrator/process-definitions', { id: editing!.id, ...body }),
                    )
                  } else {
                    await createCrud('agent_orchestrator/process-definitions', body)
                  }
                } catch (err) {
                  if (surfaceRecordConflict(err, t)) return
                  throw err
                }
                flash(t('agent_orchestrator.processDefinitions.flash.saved'), 'success')
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
          <LoadingMessage label={t('agent_orchestrator.processDefinitions.list.title')} />
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
            <h1 className="text-lg font-semibold">{t('agent_orchestrator.processDefinitions.list.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.processDefinitions.list.subtitle')}</p>
          </div>
          <Button size="sm" onClick={() => { setEditing(null); setMode('create') }}>
            <Plus className="mr-2 size-4" />
            {t('agent_orchestrator.processDefinitions.actions.new')}
          </Button>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.processDefinitions.list.empty')}
            description={t('agent_orchestrator.processDefinitions.list.emptyDescription')}
          />
        ) : (
          <DataTable<ProcessDefinitionRow>
            columns={columns}
            data={rows}
            sortable
            onRowClick={(row) => router.push(`/backend/processes/definitions/${encodeURIComponent(row.id)}`)}
            rowActions={(row) => (
              <RowActions
                items={[
                  {
                    id: 'open',
                    label: t('agent_orchestrator.processDefinitions.list.actions.open'),
                    onSelect: () => router.push(`/backend/processes/definitions/${encodeURIComponent(row.id)}`),
                  },
                  {
                    id: 'edit',
                    label: t('agent_orchestrator.processDefinitions.list.actions.edit'),
                    onSelect: () => { setEditing(row); setMode('edit') },
                  },
                  {
                    id: 'delete',
                    label: t('agent_orchestrator.processDefinitions.list.actions.delete'),
                    destructive: true,
                    onSelect: async () => {
                      const confirmed = await confirm({
                        title: t('agent_orchestrator.processDefinitions.confirmDelete.title'),
                        text: t('agent_orchestrator.processDefinitions.confirmDelete.text'),
                        variant: 'destructive',
                      })
                      if (!confirmed) return
                      try {
                        await withScopedApiRequestHeaders(
                          buildOptimisticLockHeader(row.updatedAt),
                          () => deleteCrud('agent_orchestrator/process-definitions', row.id),
                        )
                        flash(t('agent_orchestrator.processDefinitions.flash.deleted'), 'success')
                        await load({ silent: true })
                      } catch (err) {
                        if (surfaceRecordConflict(err, t)) return
                        flash(t('agent_orchestrator.processDefinitions.flash.deleteError'), 'error')
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
