"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Bot, Copy, Flag, Hand, Play, Save, Workflow as WorkflowIcon } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../../../../components/types'
import type { ProcessMilestone, ProcessRunTriggeredBy, ProcessTrigger } from '../../../../data/validators'
import { manualTrigger, parseProcessTriggers, scheduleTriggers } from '../../../../lib/tasks/triggers'
import { parseProcessMilestones } from '../../../../lib/tasks/milestones'
import { TriggerEditor, invalidScheduleIndexes } from '../TriggerEditor'
import { MilestoneEditor } from '../MilestoneEditor'

type ProcessRunStatus = 'running' | 'completed' | 'failed'

type ProcessDefinitionDetail = {
  id: string
  name: string
  description: string | null
  targetType: 'agent' | 'workflow'
  targetAgentId: string | null
  targetWorkflowId: string | null
  inputDefaults: unknown
  grantedFeatures: string[]
  triggers: ProcessTrigger[]
  milestones: ProcessMilestone[]
  enabled: boolean
  updatedAt: string | null
}

type ProcessRunRow = {
  id: string
  status: ProcessRunStatus
  triggeredBy: ProcessRunTriggeredBy | null
  agentRunId: string | null
  workflowInstanceId: string | null
  failureReason: string | null
  createdAt: string | null
  completedAt: string | null
}

const statusVariant: StatusMap<ProcessRunStatus> = {
  running: 'info',
  completed: 'success',
  failed: 'error',
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function mapDetail(raw: Record<string, unknown>): ProcessDefinitionDetail | null {
  const id = asString(raw.id)
  if (!id) return null
  const granted = raw.grantedFeatures ?? raw.granted_features
  return {
    id,
    name: asString(raw.name) ?? id,
    description: asString(raw.description),
    targetType: raw.targetType === 'workflow' || raw.target_type === 'workflow' ? 'workflow' : 'agent',
    targetAgentId: asString(raw.targetAgentId) ?? asString(raw.target_agent_id),
    targetWorkflowId: asString(raw.targetWorkflowId) ?? asString(raw.target_workflow_id),
    inputDefaults: raw.inputDefaults ?? raw.input_defaults ?? null,
    grantedFeatures: Array.isArray(granted)
      ? granted.filter((value): value is string => typeof value === 'string')
      : [],
    triggers: parseProcessTriggers(raw.triggers),
    milestones: parseProcessMilestones(raw.milestones),
    enabled: (raw.enabled ?? true) !== false,
    updatedAt: asString(raw.updatedAt) ?? asString(raw.updated_at),
  }
}

/** The jsonb `triggered_by` shape, read defensively — a run row predating it has none. */
function mapTriggeredBy(raw: unknown): ProcessRunTriggeredBy | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const kind = record.kind
  if (kind !== 'schedule' && kind !== 'event' && kind !== 'manual' && kind !== 'system') return null
  const ref = typeof record.ref === 'string' && record.ref.length > 0 ? record.ref : undefined
  return kind === 'event' ? { kind, ref: ref ?? '' } : { kind, ref }
}

function mapRun(raw: Record<string, unknown>): ProcessRunRow | null {
  const id = asString(raw.id)
  if (!id) return null
  const statusRaw = asString(raw.status)
  return {
    id,
    status: statusRaw === 'completed' ? 'completed' : statusRaw === 'failed' ? 'failed' : 'running',
    triggeredBy: mapTriggeredBy(raw.triggered_by ?? raw.triggeredBy),
    agentRunId: asString(raw.agent_run_id) ?? asString(raw.agentRunId),
    workflowInstanceId: asString(raw.workflow_instance_id) ?? asString(raw.workflowInstanceId),
    failureReason: asString(raw.failure_reason) ?? asString(raw.failureReason),
    createdAt: asString(raw.created_at) ?? asString(raw.createdAt),
    completedAt: asString(raw.completed_at) ?? asString(raw.completedAt),
  }
}

export default function ProcessDefinitionDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const taskId = params?.id ?? ''

  const [task, setTask] = React.useState<ProcessDefinitionDetail | null>(null)
  const [triggerDraft, setTriggerDraft] = React.useState<ProcessTrigger[]>([])
  const [milestoneDraft, setMilestoneDraft] = React.useState<ProcessMilestone[]>([])
  const [runs, setRuns] = React.useState<ProcessRunRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [runOpen, setRunOpen] = React.useState(false)
  const [runInput, setRunInput] = React.useState('')
  const [runBusy, setRunBusy] = React.useState(false)
  const [triggerBusy, setTriggerBusy] = React.useState(false)
  const [milestoneBusy, setMilestoneBusy] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.processDefinitions',
    blockedMessage: t('agent_orchestrator.processDefinitions.flash.blocked'),
  })

  const loadDetail = React.useCallback(async () => {
    const call = await apiCall<{ task?: Record<string, unknown> }>(
      `/api/agent_orchestrator/process-definitions/${encodeURIComponent(taskId)}`,
      undefined,
      { fallback: {} },
    )
    if (!call.ok || !call.result?.task) {
      setError(t('agent_orchestrator.processDefinitions.detail.error'))
      return false
    }
    const detail = mapDetail(call.result.task)
    setTask(detail)
    setTriggerDraft(detail?.triggers ?? [])
    setMilestoneDraft(detail?.milestones ?? [])
    return true
  }, [taskId, t])

  const loadRuns = React.useCallback(async () => {
    const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/agent_orchestrator/process-runs?processDefinitionId=${encodeURIComponent(taskId)}&pageSize=50`,
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) return
    setRuns(
      (Array.isArray(call.result?.items) ? call.result.items : [])
        .map(mapRun)
        .filter((row): row is ProcessRunRow => !!row),
    )
  }, [taskId])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const ok = await loadDetail()
      if (cancelled) return
      if (ok) await loadRuns()
      if (!cancelled) setIsLoading(false)
    }
    if (taskId) void load()
    return () => { cancelled = true }
  }, [taskId, loadDetail, loadRuns])

  useAppEvent('agent_orchestrator.process_run.*', () => {
    void loadRuns()
  })

  const openRunDialog = React.useCallback(() => {
    setRunInput(task?.inputDefaults ? JSON.stringify(task.inputDefaults, null, 2) : '{}')
    setRunOpen(true)
  }, [task])

  const submitRun = React.useCallback(async () => {
    if (runBusy) return
    let parsed: Record<string, unknown> | undefined
    const trimmed = runInput.trim()
    if (trimmed) {
      try {
        const value = JSON.parse(trimmed)
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>
        } else {
          flash(t('agent_orchestrator.processDefinitions.run.invalidJson'), 'error')
          return
        }
      } catch {
        flash(t('agent_orchestrator.processDefinitions.run.invalidJson'), 'error')
        return
      }
    }
    setRunBusy(true)
    try {
      await runMutation({
        operation: () =>
          apiCallOrThrow(`/api/agent_orchestrator/process-definitions/${encodeURIComponent(taskId)}/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(parsed ? { input: parsed } : {}),
          }),
        context: { retryLastMutation },
        mutationPayload: { taskId },
      })
      flash(t('agent_orchestrator.processDefinitions.run.started'), 'success')
      setRunOpen(false)
      await loadRuns()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.processDefinitions.run.error'), 'error')
    } finally {
      setRunBusy(false)
    }
  }, [runBusy, runInput, runMutation, retryLastMutation, taskId, t, loadRuns])

  /**
   * Trigger edits mutate the PARENT definition, so the parent's optimistic-lock
   * header applies — no per-child override (there is no child record any more).
   */
  const saveTriggers = React.useCallback(async () => {
    if (triggerBusy || !task) return
    if (invalidScheduleIndexes(triggerDraft).length > 0) {
      flash(t('agent_orchestrator.processDefinitions.form.errors.cronInvalid'), 'error')
      return
    }
    setTriggerBusy(true)
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(task.updatedAt),
            () =>
              updateCrud('agent_orchestrator/process-definitions', {
                id: task.id,
                name: task.name,
                targetType: task.targetType,
                targetAgentId: task.targetAgentId ?? undefined,
                targetWorkflowId: task.targetWorkflowId ?? undefined,
                triggers: triggerDraft,
              }),
          ),
        context: { retryLastMutation },
        mutationPayload: { taskId },
      })
      flash(t('agent_orchestrator.processDefinitions.triggers.saved'), 'success')
      await loadDetail()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        await loadDetail()
        return
      }
      flash(err instanceof Error ? err.message : t('agent_orchestrator.processDefinitions.triggers.error'), 'error')
    } finally {
      setTriggerBusy(false)
    }
  }, [triggerBusy, task, triggerDraft, runMutation, retryLastMutation, taskId, t, loadDetail])

  /**
   * Milestone rows mutate the PARENT definition, so the parent's
   * optimistic-lock header is the one that applies — no per-child override,
   * because there is no child record.
   */
  const saveMilestones = React.useCallback(async () => {
    if (milestoneBusy || !task) return
    setMilestoneBusy(true)
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(task.updatedAt),
            () =>
              updateCrud('agent_orchestrator/process-definitions', {
                id: task.id,
                name: task.name,
                targetType: task.targetType,
                targetAgentId: task.targetAgentId ?? undefined,
                targetWorkflowId: task.targetWorkflowId ?? undefined,
                milestones: milestoneDraft,
              }),
          ),
        context: { retryLastMutation },
        mutationPayload: { taskId },
      })
      flash(t('agent_orchestrator.processDefinitions.milestones.saved'), 'success')
      await loadDetail()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        await loadDetail()
        return
      }
      flash(err instanceof Error ? err.message : t('agent_orchestrator.processDefinitions.milestones.error'), 'error')
    } finally {
      setMilestoneBusy(false)
    }
  }, [milestoneBusy, task, milestoneDraft, runMutation, retryLastMutation, taskId, t, loadDetail])

  const runColumns = React.useMemo<ColumnDef<ProcessRunRow>[]>(
    () => [
      {
        accessorKey: 'status',
        header: t('agent_orchestrator.processDefinitions.runs.col.status'),
        cell: ({ row }) => (
          <StatusBadge variant={statusVariant[row.original.status]}>
            {t(`agent_orchestrator.processDefinitions.runs.status.${row.original.status}`)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'triggeredBy',
        header: t('agent_orchestrator.processDefinitions.runs.col.triggeredBy'),
        cell: ({ row }) => {
          const source = row.original.triggeredBy
          if (!source) return <span className="text-xs text-muted-foreground">—</span>
          return (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="text-xs text-foreground">
                {t(`agent_orchestrator.processDefinitions.runs.triggeredBy.${source.kind}`)}
              </span>
              {source.ref ? (
                <span className="truncate font-mono text-xs text-muted-foreground">{source.ref}</span>
              ) : null}
            </span>
          )
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('agent_orchestrator.processDefinitions.runs.col.started'),
        cell: ({ row }) => <span className="text-xs tabular-nums">{formatDateTime(row.original.createdAt, locale) ?? '—'}</span>,
      },
      {
        accessorKey: 'completedAt',
        header: t('agent_orchestrator.processDefinitions.runs.col.completed'),
        cell: ({ row }) => <span className="text-xs tabular-nums">{formatDateTime(row.original.completedAt, locale) ?? '—'}</span>,
      },
      {
        id: 'result',
        header: t('agent_orchestrator.processDefinitions.runs.col.result'),
        cell: ({ row }) => {
          if (row.original.failureReason) {
            return <span className="truncate text-xs text-status-error-text">{row.original.failureReason}</span>
          }
          if (row.original.agentRunId) {
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation()
                  router.push(`/backend/traces/${encodeURIComponent(row.original.agentRunId!)}`)
                }}
              >
                {t('agent_orchestrator.processDefinitions.runs.openTrace')}
              </Button>
            )
          }
          if (row.original.workflowInstanceId) {
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation()
                  router.push(`/backend/workflows/instances/${encodeURIComponent(row.original.workflowInstanceId!)}`)
                }}
              >
                {t('agent_orchestrator.processDefinitions.runs.openInstance')}
              </Button>
            )
          }
          return <span className="text-xs text-muted-foreground">—</span>
        },
      },
    ],
    [t, locale, router],
  )

  const [origin, setOrigin] = React.useState('')
  React.useEffect(() => {
    setOrigin(window.location.origin)
  }, [])
  const copyToClipboard = React.useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        flash(t('agent_orchestrator.processDefinitions.api.copied'), 'success')
      } catch {
        flash(t('agent_orchestrator.processDefinitions.api.copyFailed'), 'error')
      }
    },
    [t],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('agent_orchestrator.processDefinitions.detail.title')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !task) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('agent_orchestrator.processDefinitions.detail.error')} />
        </PageBody>
      </Page>
    )
  }

  const TargetIcon = task.targetType === 'agent' ? Bot : WorkflowIcon
  const targetId = task.targetType === 'agent' ? task.targetAgentId : task.targetWorkflowId
  const schedules = scheduleTriggers(task.triggers)
  // Run-now mirrors the server gate exactly: no declared manual trigger, no
  // hand-start (the route 403s), so the button must not promise one.
  const allowsManual = manualTrigger(task.triggers) !== null

  // API trigger facts — the primary machine entry point for process definitions.
  // `origin` resolves client-side only, so the snippet shows the real host.
  const apiPath = `/api/agent_orchestrator/process-definitions/${task.id}/run`
  const apiUrl = `${origin}${apiPath}`
  const inputExample =
    task.inputDefaults && typeof task.inputDefaults === 'object' && !Array.isArray(task.inputDefaults)
      ? (task.inputDefaults as Record<string, unknown>)
      : {}
  const curlExample = [
    `curl -X POST '${apiUrl}' \\`,
    `  -H 'x-api-key: <YOUR_API_KEY>' \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '${JSON.stringify({ input: inputExample, idempotencyKey: 'unique-key-123' })}'`,
  ].join('\n')

  return (
    <Page>
      <PageBody className="space-y-6">
        <div className="mb-2">
          <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/processes/definitions')}>
            {t('agent_orchestrator.processDefinitions.detail.back')}
          </Button>
        </div>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{task.name}</h1>
              {task.description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{task.description}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-medium text-foreground">
                  <TargetIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono">{targetId ?? '—'}</span>
                </span>
                {!task.enabled ? (
                  <StatusBadge variant="warning">{t('agent_orchestrator.processDefinitions.detail.disabled')}</StatusBadge>
                ) : null}
                {schedules.map((trigger, index) => (
                  <span key={`schedule-${index}`} className="font-mono text-muted-foreground">
                    {trigger.cron}
                    {!trigger.enabled ? ` (${t('agent_orchestrator.processDefinitions.list.schedulePaused')})` : ''}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button size="sm" onClick={openRunDialog} disabled={!task.enabled || !allowsManual}>
                <Play className="mr-2 size-4" />
                {t('agent_orchestrator.processDefinitions.detail.runNow')}
              </Button>
              {!allowsManual ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Hand className="size-3.5 shrink-0" />
                  {t('agent_orchestrator.processDefinitions.triggers.manual.required')}
                </span>
              ) : null}
            </div>
          </div>
          {task.grantedFeatures.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('agent_orchestrator.processDefinitions.detail.grantedFeatures')}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {task.grantedFeatures.map((feature) => (
                  <span key={feature} className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {feature}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">{t('agent_orchestrator.processDefinitions.api.title')}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t('agent_orchestrator.processDefinitions.api.description')}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs font-semibold text-foreground">POST</span>
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              {apiUrl}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyToClipboard(apiUrl)}>
              <Copy className="mr-2 size-4" />
              {t('agent_orchestrator.processDefinitions.api.copyUrl')}
            </Button>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('agent_orchestrator.processDefinitions.api.curlTitle')}
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyToClipboard(curlExample)}>
                <Copy className="mr-2 size-3.5" />
                {t('agent_orchestrator.processDefinitions.api.copyCurl')}
              </Button>
            </div>
            <pre className="mt-1.5 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-muted-foreground">
              {curlExample}
            </pre>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('agent_orchestrator.processDefinitions.api.authNote')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('agent_orchestrator.processDefinitions.api.responseNote')}</p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">{t('agent_orchestrator.processDefinitions.triggers.title')}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t('agent_orchestrator.processDefinitions.triggers.description')}</p>
            </div>
            <Button size="sm" onClick={() => { void saveTriggers() }} disabled={triggerBusy}>
              <Save className="mr-2 size-4" />
              {t('agent_orchestrator.processDefinitions.triggers.save')}
            </Button>
          </div>
          <div
            className="mt-3"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void saveTriggers()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setTriggerDraft(task.triggers)
              }
            }}
          >
            <TriggerEditor
              value={triggerDraft}
              onChange={setTriggerDraft}
              disabled={triggerBusy}
              locale={locale}
              t={t}
            />
          </div>
        </section>

        {task.targetType === 'workflow' ? (
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                  <Flag className="size-4 shrink-0 text-muted-foreground" />
                  {t('agent_orchestrator.processDefinitions.milestones.title')}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t('agent_orchestrator.processDefinitions.milestones.description')}
                </p>
              </div>
              <Button size="sm" onClick={() => { void saveMilestones() }} disabled={milestoneBusy}>
                <Save className="mr-2 size-4" />
                {t('agent_orchestrator.processDefinitions.milestones.save')}
              </Button>
            </div>
            <div
              className="mt-3"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void saveMilestones()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setMilestoneDraft(task.milestones)
                }
              }}
            >
              <MilestoneEditor
                value={milestoneDraft}
                onChange={setMilestoneDraft}
                targetType={task.targetType}
                workflowId={task.targetWorkflowId}
                disabled={milestoneBusy}
                t={t}
              />
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">{t('agent_orchestrator.processDefinitions.runs.title')}</h2>
          {runs.length === 0 ? (
            <EmptyState
              title={t('agent_orchestrator.processDefinitions.runs.empty')}
              description={t('agent_orchestrator.processDefinitions.runs.emptyDescription')}
            />
          ) : (
            <DataTable<ProcessRunRow> columns={runColumns} data={runs} sortable />
          )}
        </section>

        <Dialog open={runOpen} onOpenChange={setRunOpen}>
          <DialogContent
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void submitRun()
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('agent_orchestrator.processDefinitions.run.title')}</DialogTitle>
              <DialogDescription>{t('agent_orchestrator.processDefinitions.run.description')}</DialogDescription>
            </DialogHeader>
            <Textarea
              value={runInput}
              onChange={(event) => setRunInput(event.target.value)}
              rows={10}
              className="font-mono text-xs"
              aria-label={t('agent_orchestrator.processDefinitions.run.inputLabel')}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRunOpen(false)} disabled={runBusy}>
                {t('agent_orchestrator.processDefinitions.run.cancel')}
              </Button>
              <Button size="sm" onClick={() => { void submitRun() }} disabled={runBusy}>
                <Play className="mr-2 size-4" />
                {t('agent_orchestrator.processDefinitions.run.submit')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

      </PageBody>
    </Page>
  )
}
