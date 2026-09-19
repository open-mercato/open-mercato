"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { z } from 'zod'
import { Plus, Bot, Workflow as WorkflowIcon, CalendarClock, Hand, Radio, X, TriangleAlert } from 'lucide-react'
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
import { formatRelativeAge } from '../../../components/types'
import { useCoalescedReload } from '../../../components/useCoalescedReload'
import { PROCESS_STATUS_LABEL_KEY, type ProcessInstanceStatus } from '../../../components/processTypes'
import {
  processMilestonesSchema,
  processSingleAgentSchema,
  processTriggersSchema,
  type ProcessMilestone,
  type ProcessSingleAgent,
  type ProcessTrigger,
} from '../../../data/validators'
import { parseProcessTriggers, scheduleTriggers, eventTriggers, manualTrigger } from '../../../lib/tasks/triggers'
import { parseProcessMilestones } from '../../../lib/tasks/milestones'
import { TriggerEditor, invalidScheduleIndexes } from './TriggerEditor'
import { MilestoneEditor } from './MilestoneEditor'
import {
  parseGrantedFeaturesText,
  resolveFeaturePrefill,
  unknownFeatureIds,
} from './formHelpers'

const ENTITY_ID = 'agent_orchestrator:process_definition'

type ProcessLastExecution = { status: string; completedAt: string | null }

/**
 * The execution status is DERIVED from the workflow instance, so the vocabulary is
 * the projection's, not a ledger's. An unknown value renders neutral rather than
 * being coerced into one of these — a status this list does not know is not a
 * failure.
 */
const lastExecutionVariant: StatusMap<string> = {
  running: 'info',
  waiting_on_you: 'warning',
  question_open: 'warning',
  docs_requested: 'warning',
  fraud_hold: 'warning',
  auto_completing: 'info',
  auto_completed: 'success',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
}

function mapLastExecution(raw: unknown): ProcessLastExecution | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const status = record.status
  if (typeof status !== 'string') return null
  const completed = record.completed_at ?? record.completedAt
  return { status, completedAt: typeof completed === 'string' ? completed : null }
}

type ProcessDefinitionRow = {
  id: string
  name: string
  description: string | null
  /** Derived from the bound workflow id, not stored — see the list route. */
  workflowMode: 'single_agent' | 'workflow'
  workflowId: string | null
  /** Read back from the generated workflow; null once it has been extended by hand. */
  singleAgent: ProcessSingleAgent | null
  inputDefaults: unknown
  inputSchema: unknown
  grantedFeatures: string[]
  triggers: ProcessTrigger[]
  milestones: ProcessMilestone[]
  enabled: boolean
  lastExecution: ProcessLastExecution | null
  updatedAt: string | null
}

type FormValues = {
  id?: string
  name: string
  description?: string
  workflowMode: 'single_agent' | 'workflow'
  agentId?: string
  workflowId?: string
  autoApproveThreshold?: string
  inputDefaultsJson?: string
  inputSchemaJson?: string
  grantedFeaturesText?: string
  triggers: ProcessTrigger[]
  milestones: ProcessMilestone[]
  enabled: boolean
  updatedAt?: string | null
}

/**
 * The disposition rule a single-agent process runs with, as one choice instead of
 * a threshold plus a margin plus a boolean. `ask` is the safe default: a process
 * that mutates the domain without anyone looking is a decision, not a default.
 */
const AUTO_APPROVE_CHOICES = ['ask', '0.8', '0.9', '0.95'] as const

function parseOnResult(threshold: string | undefined): ProcessSingleAgent['onResult'] {
  if (!threshold || threshold === 'ask') return { alwaysAsk: true }
  const value = Number.parseFloat(threshold)
  if (!Number.isFinite(value)) return { alwaysAsk: true }
  return { autoApproveThreshold: value, autoApproveMargin: 0 }
}

function formatOnResult(onResult: ProcessSingleAgent['onResult'] | undefined): string {
  if (!onResult || 'alwaysAsk' in onResult) return 'ask'
  return String(onResult.autoApproveThreshold)
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
  const singleAgentRaw = item.single_agent ?? item.singleAgent
  const parsedSingleAgent = singleAgentRaw ? processSingleAgentSchema.safeParse(singleAgentRaw) : null
  return {
    id,
    name: readString(item, 'name'),
    description: typeof item.description === 'string' ? item.description : null,
    workflowMode: readString(item, 'workflow_mode', 'workflowMode') === 'single_agent' ? 'single_agent' : 'workflow',
    workflowId: readString(item, 'workflow_id', 'workflowId') || null,
    singleAgent: parsedSingleAgent?.success ? parsedSingleAgent.data : null,
    inputDefaults: item.input_defaults ?? item.inputDefaults ?? null,
    inputSchema: item.input_schema ?? item.inputSchema ?? null,
    grantedFeatures: Array.isArray(grantedRaw)
      ? grantedRaw.filter((value): value is string => typeof value === 'string')
      : [],
    triggers: parseProcessTriggers(item.triggers),
    milestones: parseProcessMilestones(item.milestones),
    enabled: (item.enabled ?? true) !== false,
    lastExecution: mapLastExecution(item.last_execution ?? item.lastExecution),
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
  const workflowMode = values?.workflowMode === 'single_agent' ? ('single_agent' as const) : ('workflow' as const)

  React.useEffect(() => {
    if (isEdit || prefilledRef.current) return
    const prefill = resolveFeaturePrefill(features)
    if (prefill) {
      prefilledRef.current = true
      setValue(prefill.join('\n'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowMode])

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
      {features.length === 0 ? (
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
 * One compact cell answering "how can this start" — the question no surface
 * could answer while cron, event triggers and the run route were three
 * unrelated mechanisms.
 */
function TriggerSummary({ triggers, t }: { triggers: ProcessTrigger[]; t: ReturnType<typeof useT> }) {
  const schedules = scheduleTriggers(triggers)
  const events = eventTriggers(triggers)
  const manual = manualTrigger(triggers)
  if (triggers.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('agent_orchestrator.processDefinitions.triggers.none')}</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {schedules.map((trigger, index) => (
        <span
          key={`schedule-${index}`}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground"
        >
          <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
          {trigger.cron}
          {!trigger.enabled ? (
            <span className="font-sans text-muted-foreground">
              ({t('agent_orchestrator.processDefinitions.list.schedulePaused')})
            </span>
          ) : null}
        </span>
      ))}
      {events.map((trigger, index) => (
        <span
          key={`event-${index}`}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground"
        >
          <Radio className="size-3.5 shrink-0 text-muted-foreground" />
          {trigger.eventPattern}
        </span>
      ))}
      {manual ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground">
          <Hand className="size-3.5 shrink-0 text-muted-foreground" />
          {t('agent_orchestrator.processDefinitions.triggers.manual.badge')}
        </span>
      ) : null}
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
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoading(true)
    setError(null)
    const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/processes?pageSize=100',
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
  useAppEvent('agent_orchestrator.process.execution.*', () => {
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
        () => updateCrud('agent_orchestrator/processes', {
          id: row.id,
          name: row.name,
          workflowMode: row.workflowMode,
          workflowId: row.workflowId ?? undefined,
          singleAgent: row.singleAgent ?? undefined,
          grantedFeatures: row.grantedFeatures,
          triggers: row.triggers,
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
          workflowMode: z.enum(['single_agent', 'workflow']),
          agentId: z.string().optional(),
          workflowId: z.string().optional(),
          autoApproveThreshold: z.string().optional(),
          inputDefaultsJson: z.string().optional(),
          inputSchemaJson: z.string().optional(),
          grantedFeaturesText: z.string().optional(),
          triggers: processTriggersSchema,
          milestones: processMilestonesSchema,
          enabled: z.boolean(),
        })
        .superRefine((data, ctx) => {
          // Every process points at a workflow: name one, or name the agent the
          // generated one runs. The server-side schema enforces the same rule.
          if (data.workflowMode === 'single_agent' && !data.agentId?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['agentId'],
              message: 'agent_orchestrator.processDefinitions.form.errors.agentRequired',
            })
          }
          if (data.workflowMode === 'workflow' && !data.workflowId?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['workflowId'],
              message: 'agent_orchestrator.processDefinitions.form.errors.workflowRequired',
            })
          }
          // Invalid cron is rejected AT SAVE, not discovered at fire time. The
          // same parser the server-side `withScheduleSemanticChecks` runs.
          for (const index of invalidScheduleIndexes(data.triggers)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['triggers', index, 'cron'],
              message: 'agent_orchestrator.processDefinitions.form.errors.cronInvalid',
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
        id: 'workflowMode',
        label: t('agent_orchestrator.processDefinitions.form.workflowMode'),
        type: 'select',
        description: t('agent_orchestrator.processDefinitions.form.workflowModeHint'),
        options: [
          { value: 'single_agent', label: t('agent_orchestrator.processDefinitions.mode.singleAgent') },
          { value: 'workflow', label: t('agent_orchestrator.processDefinitions.mode.workflow') },
        ],
      },
      {
        id: 'agentId',
        label: t('agent_orchestrator.processDefinitions.form.agent'),
        type: 'combobox',
        description: t('agent_orchestrator.processDefinitions.form.agentHint'),
        options: agents,
        seedOptions: agents,
        allowCustomValues: true,
        visibleWhen: { field: 'workflowMode', equals: 'single_agent' },
      },
      {
        id: 'autoApproveThreshold',
        label: t('agent_orchestrator.processDefinitions.form.autoApprove'),
        type: 'select',
        description: t('agent_orchestrator.processDefinitions.form.autoApproveHint'),
        visibleWhen: { field: 'workflowMode', equals: 'single_agent' },
        options: AUTO_APPROVE_CHOICES.map((choice) => ({
          value: choice,
          label:
            choice === 'ask'
              ? t('agent_orchestrator.processDefinitions.form.autoApproveAsk')
              : t('agent_orchestrator.processDefinitions.form.autoApproveAt', undefined, { threshold: choice }),
        })),
      },
      {
        id: 'workflowId',
        label: t('agent_orchestrator.processDefinitions.form.workflow'),
        type: 'combobox',
        options: workflows,
        seedOptions: workflows,
        allowCustomValues: true,
        visibleWhen: { field: 'workflowMode', equals: 'workflow' },
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
        id: 'triggers',
        label: t('agent_orchestrator.processDefinitions.triggers.title'),
        type: 'custom',
        description: t('agent_orchestrator.processDefinitions.triggers.description'),
        component: ({ value, setValue }) => (
          <TriggerEditor
            value={Array.isArray(value) ? (value as ProcessTrigger[]) : []}
            onChange={(next) => setValue(next)}
            locale={locale}
            t={t}
          />
        ),
      },
      {
        id: 'milestones',
        label: t('agent_orchestrator.processDefinitions.milestones.title'),
        type: 'custom',
        description: t('agent_orchestrator.processDefinitions.milestones.description'),
        component: ({ value, values, setValue }) => (
          <MilestoneEditor
            value={Array.isArray(value) ? (value as ProcessMilestone[]) : []}
            onChange={(next) => setValue(next)}
            workflowId={typeof values?.workflowId === 'string' ? values.workflowId : null}
            t={t}
          />
        ),
      },
      { id: 'enabled', label: t('agent_orchestrator.processDefinitions.form.enabled'), type: 'checkbox' },
    ],
    [t, agents, workflows, featureCatalog, locale, mode],
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
        accessorKey: 'workflowMode',
        header: t('agent_orchestrator.processDefinitions.list.col.runs'),
        cell: ({ row }) => {
          // Both modes run a workflow; what differs is who wrote it. Naming the
          // agent for a generated one is what the reader actually wants to know.
          const isSingleAgent = row.original.workflowMode === 'single_agent'
          const Icon = isSingleAgent ? Bot : WorkflowIcon
          const label = isSingleAgent
            ? row.original.singleAgent?.agentId ?? row.original.workflowId
            : row.original.workflowId
          return (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{label ?? '—'}</span>
            </span>
          )
        },
      },
      {
        accessorKey: 'triggers',
        header: t('agent_orchestrator.processDefinitions.list.col.triggers'),
        enableSorting: false,
        cell: ({ row }) => <TriggerSummary triggers={row.original.triggers} t={t} />,
      },
      {
        accessorKey: 'lastExecution',
        header: t('agent_orchestrator.processDefinitions.list.col.lastExecution'),
        enableSorting: false,
        cell: ({ row }) => {
          const last = row.original.lastExecution
          if (!last) {
            return <span className="text-xs text-muted-foreground">{t('agent_orchestrator.processDefinitions.list.lastExecutionNever')}</span>
          }
          const age = formatRelativeAge(last.completedAt)
          return (
            <span className="inline-flex items-center gap-1.5">
              <StatusBadge variant={lastExecutionVariant[last.status] ?? 'neutral'}>
                {t(PROCESS_STATUS_LABEL_KEY[last.status as ProcessInstanceStatus] ?? last.status)}
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
      workflowMode: values.workflowMode,
      workflowId: values.workflowMode === 'workflow' ? values.workflowId : undefined,
      singleAgent:
        values.workflowMode === 'single_agent' && values.agentId
          ? { agentId: values.agentId, onResult: parseOnResult(values.autoApproveThreshold) }
          : undefined,
      inputDefaults,
      inputSchema,
      grantedFeatures,
      triggers: values.triggers ?? [],
      milestones: values.milestones ?? [],
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
          workflowMode: editing!.workflowMode,
          agentId: editing!.singleAgent?.agentId ?? undefined,
          workflowId: editing!.workflowId ?? undefined,
          autoApproveThreshold: formatOnResult(editing!.singleAgent?.onResult),
          inputDefaultsJson: editing!.inputDefaults ? JSON.stringify(editing!.inputDefaults, null, 2) : '',
          inputSchemaJson: editing!.inputSchema ? JSON.stringify(editing!.inputSchema, null, 2) : '',
          grantedFeaturesText: editing!.grantedFeatures.join('\n'),
          triggers: editing!.triggers,
          milestones: editing!.milestones,
          enabled: editing!.enabled,
          updatedAt: editing!.updatedAt,
        }
      : {
          workflowMode: 'single_agent',
          autoApproveThreshold: 'ask',
          // A new definition can be started by hand unless the author says
          // otherwise — the same default the manual-trigger backfill gives every
          // definition that predates this phase.
          triggers: [{ kind: 'manual', requireFeatures: [] }],
          milestones: [],
          enabled: true,
        }

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
                const body = buildBody(values)
                try {
                  if (isEdit) {
                    await withScopedApiRequestHeaders(
                      buildOptimisticLockHeader(editing!.updatedAt),
                      () => updateCrud('agent_orchestrator/processes', { id: editing!.id, ...body }),
                    )
                  } else {
                    await createCrud('agent_orchestrator/processes', body)
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
                          () => deleteCrud('agent_orchestrator/processes', row.id),
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
