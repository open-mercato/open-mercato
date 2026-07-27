"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Bot, Copy, Play, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { validateCronExpression } from '@open-mercato/scheduler'
import { formatDateTime } from '../../../components/types'
import { isValidIanaTimeZone } from '../../../data/validators'

type TaskRunStatus = 'running' | 'completed' | 'failed'

type TaskDetail = {
  id: string
  name: string
  description: string | null
  targetType: 'agent' | 'workflow'
  targetAgentId: string | null
  targetWorkflowId: string | null
  inputDefaults: unknown
  grantedFeatures: string[]
  scheduleCron: string | null
  scheduleTimezone: string | null
  scheduleEnabled: boolean
  enabled: boolean
}

type TaskRunRow = {
  id: string
  status: TaskRunStatus
  triggeredBy: string
  agentRunId: string | null
  workflowInstanceId: string | null
  failureReason: string | null
  createdAt: string | null
  completedAt: string | null
}

type TriggerRow = {
  id: string
  eventPattern: string
  enabled: boolean
  updatedAt: string | null
}

const statusVariant: StatusMap<TaskRunStatus> = {
  running: 'info',
  completed: 'success',
  failed: 'error',
}

/**
 * Client-side schedule health — recomputes the next occurrence with the same
 * scheduler parser the server validates with. No persisted health flag (the
 * scheduler registration is best-effort by design); an unparseable stored cron
 * is the one state we can detect and must surface.
 */
function ScheduleHealth({
  task,
  locale,
  t,
}: {
  task: { scheduleCron: string | null; scheduleTimezone: string | null; scheduleEnabled: boolean; enabled: boolean }
  locale: string
  t: ReturnType<typeof useT>
}) {
  if (!task.scheduleCron || !task.scheduleEnabled || !task.enabled) return null
  const timezone =
    task.scheduleTimezone && isValidIanaTimeZone(task.scheduleTimezone) ? task.scheduleTimezone : 'UTC'
  const result = validateCronExpression(task.scheduleCron, { timezone, count: 1 })
  if (!result.ok || !result.nextRuns?.length) {
    return (
      <span className="text-status-error-text">{t('agent_orchestrator.tasks.detail.scheduleInvalid')}</span>
    )
  }
  return (
    <span className="text-muted-foreground">
      {t('agent_orchestrator.tasks.detail.scheduleNextRun', undefined, {
        time: formatDateTime(result.nextRuns[0].toISOString(), locale) ?? '',
      })}
    </span>
  )
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function mapDetail(raw: Record<string, unknown>): TaskDetail | null {
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
    scheduleCron: asString(raw.scheduleCron) ?? asString(raw.schedule_cron),
    scheduleTimezone: asString(raw.scheduleTimezone) ?? asString(raw.schedule_timezone),
    scheduleEnabled: (raw.scheduleEnabled ?? raw.schedule_enabled) !== false,
    enabled: (raw.enabled ?? true) !== false,
  }
}

function mapRun(raw: Record<string, unknown>): TaskRunRow | null {
  const id = asString(raw.id)
  if (!id) return null
  const statusRaw = asString(raw.status)
  return {
    id,
    status: statusRaw === 'completed' ? 'completed' : statusRaw === 'failed' ? 'failed' : 'running',
    triggeredBy: asString(raw.triggered_by) ?? asString(raw.triggeredBy) ?? '',
    agentRunId: asString(raw.agent_run_id) ?? asString(raw.agentRunId),
    workflowInstanceId: asString(raw.workflow_instance_id) ?? asString(raw.workflowInstanceId),
    failureReason: asString(raw.failure_reason) ?? asString(raw.failureReason),
    createdAt: asString(raw.created_at) ?? asString(raw.createdAt),
    completedAt: asString(raw.completed_at) ?? asString(raw.completedAt),
  }
}

function mapTrigger(raw: Record<string, unknown>): TriggerRow | null {
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    eventPattern: asString(raw.eventPattern) ?? asString(raw.event_pattern) ?? '',
    enabled: (raw.enabled ?? true) !== false,
    updatedAt: asString(raw.updatedAt) ?? asString(raw.updated_at) ?? null,
  }
}

export default function AgenticTaskDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const taskId = params?.id ?? ''

  const [task, setTask] = React.useState<TaskDetail | null>(null)
  const [triggers, setTriggers] = React.useState<TriggerRow[]>([])
  const [runs, setRuns] = React.useState<TaskRunRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [runOpen, setRunOpen] = React.useState(false)
  const [runInput, setRunInput] = React.useState('')
  const [runBusy, setRunBusy] = React.useState(false)
  const [triggerOpen, setTriggerOpen] = React.useState(false)
  const [triggerPattern, setTriggerPattern] = React.useState('')
  const [triggerBusy, setTriggerBusy] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.tasks',
    blockedMessage: t('agent_orchestrator.tasks.flash.blocked'),
  })
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const loadDetail = React.useCallback(async () => {
    const call = await apiCall<{ task?: Record<string, unknown>; eventTriggers?: Array<Record<string, unknown>> }>(
      `/api/agent_orchestrator/tasks/${encodeURIComponent(taskId)}`,
      undefined,
      { fallback: {} },
    )
    if (!call.ok || !call.result?.task) {
      setError(t('agent_orchestrator.tasks.detail.error'))
      return false
    }
    setTask(mapDetail(call.result.task))
    setTriggers(
      (Array.isArray(call.result.eventTriggers) ? call.result.eventTriggers : [])
        .map(mapTrigger)
        .filter((row): row is TriggerRow => !!row),
    )
    return true
  }, [taskId, t])

  const loadRuns = React.useCallback(async () => {
    const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/agent_orchestrator/task-runs?taskDefinitionId=${encodeURIComponent(taskId)}&pageSize=50`,
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) return
    setRuns(
      (Array.isArray(call.result?.items) ? call.result.items : [])
        .map(mapRun)
        .filter((row): row is TaskRunRow => !!row),
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

  useAppEvent('agent_orchestrator.task_run.*', () => {
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
          flash(t('agent_orchestrator.tasks.run.invalidJson'), 'error')
          return
        }
      } catch {
        flash(t('agent_orchestrator.tasks.run.invalidJson'), 'error')
        return
      }
    }
    setRunBusy(true)
    try {
      await runMutation({
        operation: () =>
          apiCallOrThrow(`/api/agent_orchestrator/tasks/${encodeURIComponent(taskId)}/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(parsed ? { input: parsed } : {}),
          }),
        context: { retryLastMutation },
        mutationPayload: { taskId },
      })
      flash(t('agent_orchestrator.tasks.run.started'), 'success')
      setRunOpen(false)
      await loadRuns()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.tasks.run.error'), 'error')
    } finally {
      setRunBusy(false)
    }
  }, [runBusy, runInput, runMutation, retryLastMutation, taskId, t, loadRuns])

  const submitTrigger = React.useCallback(async () => {
    if (triggerBusy || !triggerPattern.trim()) return
    setTriggerBusy(true)
    try {
      await runMutation({
        operation: () =>
          apiCallOrThrow(`/api/agent_orchestrator/tasks/${encodeURIComponent(taskId)}/event-triggers`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ eventPattern: triggerPattern.trim() }),
          }),
        context: { retryLastMutation },
        mutationPayload: { taskId },
      })
      flash(t('agent_orchestrator.tasks.triggers.added'), 'success')
      setTriggerOpen(false)
      setTriggerPattern('')
      await loadDetail()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.tasks.triggers.error'), 'error')
    } finally {
      setTriggerBusy(false)
    }
  }, [triggerBusy, triggerPattern, runMutation, retryLastMutation, taskId, t, loadDetail])

  const deleteTrigger = React.useCallback(async (trigger: TriggerRow) => {
    const confirmed = await confirm({
      text: t('agent_orchestrator.tasks.triggers.confirmDelete.text', undefined, { pattern: trigger.eventPattern }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(trigger.updatedAt),
            () =>
              apiCallOrThrow(
                `/api/agent_orchestrator/tasks/${encodeURIComponent(taskId)}/event-triggers/${encodeURIComponent(trigger.id)}`,
                { method: 'DELETE' },
              ),
          ),
        context: { retryLastMutation },
        mutationPayload: { triggerId: trigger.id },
      })
      flash(t('agent_orchestrator.tasks.triggers.deleted'), 'success')
      await loadDetail()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        await loadDetail()
        return
      }
      flash(err instanceof Error ? err.message : t('agent_orchestrator.tasks.triggers.error'), 'error')
    }
  }, [confirm, runMutation, retryLastMutation, taskId, t, loadDetail])

  const runColumns = React.useMemo<ColumnDef<TaskRunRow>[]>(
    () => [
      {
        accessorKey: 'status',
        header: t('agent_orchestrator.tasks.runs.col.status'),
        cell: ({ row }) => (
          <StatusBadge variant={statusVariant[row.original.status]}>
            {t(`agent_orchestrator.tasks.runs.status.${row.original.status}`)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'triggeredBy',
        header: t('agent_orchestrator.tasks.runs.col.triggeredBy'),
        cell: ({ row }) => <span className="truncate font-mono text-xs">{row.original.triggeredBy}</span>,
      },
      {
        accessorKey: 'createdAt',
        header: t('agent_orchestrator.tasks.runs.col.started'),
        cell: ({ row }) => <span className="text-xs tabular-nums">{formatDateTime(row.original.createdAt, locale) ?? '—'}</span>,
      },
      {
        accessorKey: 'completedAt',
        header: t('agent_orchestrator.tasks.runs.col.completed'),
        cell: ({ row }) => <span className="text-xs tabular-nums">{formatDateTime(row.original.completedAt, locale) ?? '—'}</span>,
      },
      {
        id: 'result',
        header: t('agent_orchestrator.tasks.runs.col.result'),
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
                {t('agent_orchestrator.tasks.runs.openTrace')}
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
                {t('agent_orchestrator.tasks.runs.openInstance')}
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
        flash(t('agent_orchestrator.tasks.api.copied'), 'success')
      } catch {
        flash(t('agent_orchestrator.tasks.api.copyFailed'), 'error')
      }
    },
    [t],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('agent_orchestrator.tasks.detail.title')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !task) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('agent_orchestrator.tasks.detail.error')} />
        </PageBody>
      </Page>
    )
  }

  const TargetIcon = task.targetType === 'agent' ? Bot : WorkflowIcon
  const targetId = task.targetType === 'agent' ? task.targetAgentId : task.targetWorkflowId

  // API trigger facts — the primary machine entry point for agentic tasks.
  // `origin` resolves client-side only, so the snippet shows the real host.
  const apiPath = `/api/agent_orchestrator/tasks/${task.id}/run`
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
          <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/agentic-tasks')}>
            {t('agent_orchestrator.tasks.detail.back')}
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
                  <StatusBadge variant="warning">{t('agent_orchestrator.tasks.detail.disabled')}</StatusBadge>
                ) : null}
                {task.scheduleCron ? (
                  <span className="font-mono text-muted-foreground">
                    {task.scheduleCron}
                    {!task.scheduleEnabled ? ` (${t('agent_orchestrator.tasks.list.schedulePaused')})` : ''}
                  </span>
                ) : null}
                <ScheduleHealth task={task} locale={locale} t={t} />
              </div>
            </div>
            <Button size="sm" onClick={openRunDialog} disabled={!task.enabled}>
              <Play className="mr-2 size-4" />
              {t('agent_orchestrator.tasks.detail.runNow')}
            </Button>
          </div>
          {task.grantedFeatures.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('agent_orchestrator.tasks.detail.grantedFeatures')}
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
              <h2 className="text-base font-semibold text-foreground">{t('agent_orchestrator.tasks.api.title')}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t('agent_orchestrator.tasks.api.description')}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs font-semibold text-foreground">POST</span>
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              {apiUrl}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyToClipboard(apiUrl)}>
              <Copy className="mr-2 size-4" />
              {t('agent_orchestrator.tasks.api.copyUrl')}
            </Button>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('agent_orchestrator.tasks.api.curlTitle')}
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyToClipboard(curlExample)}>
                <Copy className="mr-2 size-3.5" />
                {t('agent_orchestrator.tasks.api.copyCurl')}
              </Button>
            </div>
            <pre className="mt-1.5 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-muted-foreground">
              {curlExample}
            </pre>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('agent_orchestrator.tasks.api.authNote')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('agent_orchestrator.tasks.api.responseNote')}</p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">{t('agent_orchestrator.tasks.triggers.title')}</h2>
            <Button variant="outline" size="sm" onClick={() => setTriggerOpen(true)}>
              <Plus className="mr-2 size-4" />
              {t('agent_orchestrator.tasks.triggers.add')}
            </Button>
          </div>
          {triggers.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t('agent_orchestrator.tasks.triggers.empty')}</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {triggers.map((trigger) => (
                <li key={trigger.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate font-mono text-sm text-foreground">{trigger.eventPattern}</span>
                  {!trigger.enabled ? (
                    <StatusBadge variant="warning">{t('agent_orchestrator.tasks.detail.disabled')}</StatusBadge>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('agent_orchestrator.tasks.triggers.delete')}
                    onClick={() => { void deleteTrigger(trigger) }}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">{t('agent_orchestrator.tasks.runs.title')}</h2>
          {runs.length === 0 ? (
            <EmptyState
              title={t('agent_orchestrator.tasks.runs.empty')}
              description={t('agent_orchestrator.tasks.runs.emptyDescription')}
            />
          ) : (
            <DataTable<TaskRunRow> columns={runColumns} data={runs} sortable />
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
              <DialogTitle>{t('agent_orchestrator.tasks.run.title')}</DialogTitle>
              <DialogDescription>{t('agent_orchestrator.tasks.run.description')}</DialogDescription>
            </DialogHeader>
            <Textarea
              value={runInput}
              onChange={(event) => setRunInput(event.target.value)}
              rows={10}
              className="font-mono text-xs"
              aria-label={t('agent_orchestrator.tasks.run.inputLabel')}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRunOpen(false)} disabled={runBusy}>
                {t('agent_orchestrator.tasks.run.cancel')}
              </Button>
              <Button size="sm" onClick={() => { void submitRun() }} disabled={runBusy}>
                <Play className="mr-2 size-4" />
                {t('agent_orchestrator.tasks.run.submit')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={triggerOpen} onOpenChange={setTriggerOpen}>
          <DialogContent
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void submitTrigger()
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('agent_orchestrator.tasks.triggers.addTitle')}</DialogTitle>
              <DialogDescription>{t('agent_orchestrator.tasks.triggers.addDescription')}</DialogDescription>
            </DialogHeader>
            <Input
              value={triggerPattern}
              onChange={(event) => setTriggerPattern(event.target.value)}
              placeholder="customers.deal.created"
              className="font-mono"
              aria-label={t('agent_orchestrator.tasks.triggers.patternLabel')}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setTriggerOpen(false)} disabled={triggerBusy}>
                {t('agent_orchestrator.tasks.run.cancel')}
              </Button>
              <Button size="sm" onClick={() => { void submitTrigger() }} disabled={triggerBusy || !triggerPattern.trim()}>
                {t('agent_orchestrator.tasks.triggers.submit')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
