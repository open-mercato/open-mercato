"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { LogList, type LogListEntry } from '@open-mercato/ui/backend/LogList'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { Bookmark, Lock, Play, RotateCcw, XCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { getSyncRunStatusVariant } from '../../../../lib/syncRunStatus'
import { resolveResumePoint } from '../../../../lib/resume-point'
import { applicableStartControls, type StartControlMap } from '../../../../lib/start-controls'
import { useDataSyncRunAccess } from '../../../../components/useDataSyncRunAccess'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  buildRetryFailureMessage,
  resolveRunParameterText,
  type RetryFailureBody,
} from '../../../../components/RunParameterFields'

type RunParameterDeclaration = {
  key: string
  label?: string
  labelKey?: string
}

type SyncRunDetail = {
  id: string
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  // The API has returned both since the run-scoped-cursor work; this type
  // simply never declared them, which is why no surface could render them.
  cursor: string | null
  initialCursor: string | null
  createdCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  batchesCompleted: number
  lastError: string | null
  progressJobId: string | null
  parameters: Record<string, unknown> | null
  progressJob: {
    id: string
    status: string
    progressPercent: number
    processedCount: number
    totalCount: number | null
    etaSeconds: number | null
    meta?: Record<string, unknown> | null
  } | null
  triggeredBy: string | null
  createdAt: string
  updatedAt: string
}

type ProgressEventPayload = {
  jobId?: string
  status?: string
  progressPercent?: number
  processedCount?: number
  totalCount?: number | null
  etaSeconds?: number | null
  meta?: Record<string, unknown> | null
}

type LogEntry = {
  id: string
  level: 'info' | 'warn' | 'error'
  message: string
  createdAt: string
  payload?: Record<string, unknown> | null
}

function formatEtaSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.ceil((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

type SyncRunDetailPageProps = {
  params?: {
    id?: string
  }
}

const LOG_PAGE_SIZE = 50

export default function SyncRunDetailPage({ params }: SyncRunDetailPageProps) {
  const router = useRouter()
  const runId = params?.id
  const t = useT()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'data_sync.runDetail',
  })

  const [run, setRun] = React.useState<SyncRunDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = React.useState(false)
  const [logsTotal, setLogsTotal] = React.useState(0)
  const [logsPage, setLogsPage] = React.useState(1)
  const logsPageRef = React.useRef(1)
  const [parameterLabels, setParameterLabels] = React.useState<Record<string, string>>({})
  // Fails OPEN: `null` means "not resolved", and `applicableStartControls`
  // already defaults an unknown entity type to "every control applies". Hiding
  // a valid action because an unrelated request failed would be worse than
  // showing one the endpoint will accept anyway.
  const [startControls, setStartControls] = React.useState<StartControlMap | null>(null)
  // The resume-point line is a statement about the run, not an affordance, so a
  // `data_sync.view` holder still sees it — they just get no buttons.
  const { canRunSync } = useDataSyncRunAccess()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  /**
   * `flash` takes a string and has no action slot, so the one refusal whose
   * remedy is a navigation gets a persistent banner instead of a toast that
   * scrolls away with nowhere to go.
   */
  const [staleParameters, setStaleParameters] = React.useState(false)
  // Declarations cannot change between two refreshes of the same run, so the
  // options list is fetched once per integration rather than on every progress
  // event that re-reads the run.
  const parameterLabelsIntegrationRef = React.useRef<string | null>(null)

  // The run row stores machine keys. Resolve the adapter's declared labels so a
  // past run reads as "Start id" rather than "startId"; keys the adapter no
  // longer declares keep their raw form, which keeps historical runs readable.
  const loadIntegrationOptions = React.useCallback(async (integrationId: string) => {
    if (parameterLabelsIntegrationRef.current === integrationId) return
    parameterLabelsIntegrationRef.current = integrationId
    const call = await apiCall<{ items?: Array<{ integrationId: string; runParameters?: RunParameterDeclaration[]; startControls?: StartControlMap }> }>(
      '/api/data_sync/options',
      undefined,
      { fallback: { items: [] } },
    )
    const item = (call.result?.items ?? []).find((entry) => entry.integrationId === integrationId)
    setStartControls(item?.startControls ?? {})
    const declared = item?.runParameters ?? []
    const labels: Record<string, string> = {}
    for (const param of declared) {
      const resolved = resolveRunParameterText(t, param.labelKey, param.label)
      if (resolved) labels[param.key] = resolved
    }
    setParameterLabels(labels)
  }, [t])

  const loadRun = React.useCallback(async () => {
    if (!runId) {
      setError(t('data_sync.runs.detail.loadError'))
      setIsLoading(false)
      return
    }
    setIsNotFound(false)
    const call = await apiCall<SyncRunDetail>(
      `/api/data_sync/runs/${encodeURIComponent(runId)}`,
      undefined,
      { fallback: null },
    )
    if (!call.ok || !call.result) {
      if (call.status === 404) {
        setIsNotFound(true)
      } else {
        setError(t('data_sync.runs.detail.loadError'))
      }
      setIsLoading(false)
      return
    }
    setRun(call.result)
    setIsLoading(false)
    // Fetched unconditionally now: the from-the-beginning action is gated on the
    // adapter's start-control declaration, so a run with no parameters needs the
    // options response too.
    void loadIntegrationOptions(call.result.integrationId)
  }, [loadIntegrationOptions, runId, t])

  const loadLogs = React.useCallback(async (page?: number) => {
    if (!runId) return
    const targetPage = page ?? logsPageRef.current
    setIsLoadingLogs(true)
    const params = new URLSearchParams({ runId, pageSize: String(LOG_PAGE_SIZE), page: String(targetPage) })
    const call = await apiCall<{ items: LogEntry[]; total?: number }>(
      `/api/integrations/logs?${params.toString()}`,
      undefined,
      { fallback: { items: [], total: 0 } },
    )
    if (call.ok && call.result) {
      setLogs(call.result.items)
      if (typeof call.result.total === 'number') setLogsTotal(call.result.total)
      logsPageRef.current = targetPage
      setLogsPage(targetPage)
    }
    setIsLoadingLogs(false)
  }, [runId])

  React.useEffect(() => {
    void loadRun()
    void loadLogs()
  }, [loadRun, loadLogs])

  const handleProgressEvent = React.useCallback((payload: ProgressEventPayload) => {
    const eventJobId = typeof payload.jobId === 'string' ? payload.jobId : null
    if (!eventJobId) return

    setRun((current) => {
      if (!current?.progressJobId || current.progressJobId !== eventJobId) return current
      return {
        ...current,
        status: (payload.status as SyncRunDetail['status']) ?? current.status,
        progressJob: {
          id: eventJobId,
          status: payload.status ?? current.progressJob?.status ?? current.status,
          progressPercent: payload.progressPercent ?? current.progressJob?.progressPercent ?? 0,
          processedCount: payload.processedCount ?? current.progressJob?.processedCount ?? 0,
          totalCount: payload.totalCount ?? current.progressJob?.totalCount ?? null,
          etaSeconds: payload.etaSeconds ?? current.progressJob?.etaSeconds ?? null,
          meta: payload.meta ?? current.progressJob?.meta ?? null,
        },
      }
    })
  }, [])

  useAppEvent('progress.job.updated', (event) => {
    handleProgressEvent(event.payload as ProgressEventPayload)
  }, [handleProgressEvent])

  useAppEvent('progress.job.started', (event) => {
    handleProgressEvent(event.payload as ProgressEventPayload)
  }, [handleProgressEvent])

  useAppEvent('progress.job.completed', (event) => {
    handleProgressEvent(event.payload as ProgressEventPayload)
    void loadRun()
    void loadLogs()
  }, [handleProgressEvent, loadLogs, loadRun])

  useAppEvent('progress.job.failed', (event) => {
    handleProgressEvent(event.payload as ProgressEventPayload)
    void loadRun()
    void loadLogs()
  }, [handleProgressEvent, loadLogs, loadRun])

  useAppEvent('progress.job.cancelled', (event) => {
    handleProgressEvent(event.payload as ProgressEventPayload)
    void loadRun()
    void loadLogs()
  }, [handleProgressEvent, loadLogs, loadRun])

  useAppEvent('om:bridge:reconnected', () => {
    void loadRun()
    void loadLogs()
  }, [loadLogs, loadRun])

  const handleCancel = React.useCallback(async () => {
    if (!runId) return
    const call = await runMutation({
      // optimistic-lock-exempt: run lifecycle action endpoint (cancel), not a concurrent record edit
      operation: () => apiCall(`/api/data_sync/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
      }, { fallback: null }),
      mutationPayload: { runId },
      context: {
        operation: 'update',
        actionId: 'cancel-sync-run',
        runId,
      },
    })
    if (call.ok) {
      flash(t('data_sync.runs.detail.cancelSuccess'), 'success')
      void loadRun()
    } else {
      flash(t('data_sync.runs.detail.cancelError'), 'error')
    }
  }, [runId, runMutation, t, loadRun])

  const handleRetry = React.useCallback(async () => {
    if (!runId) return
    const call = await runMutation({
      // optimistic-lock-exempt: starts a new retry run (create), not a concurrent record edit
      operation: () => apiCall<{ id: string }>(`/api/data_sync/runs/${encodeURIComponent(runId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromBeginning: false }),
      }, { fallback: null }),
      mutationPayload: { runId, fromBeginning: false },
      context: {
        operation: 'create',
        actionId: 'retry-sync-run',
        runId,
      },
    })
    if (call.ok && call.result) {
      flash(t('data_sync.runs.detail.retrySuccess'), 'success')
      router.push(`/backend/data-sync/runs/${encodeURIComponent(call.result.id)}`)
    } else {
      const failure = call.result as RetryFailureBody | null
      setStaleParameters(failure?.code === 'parametersStale')
      flash(buildRetryFailureMessage(failure, t), 'error')
    }
  }, [runId, router, runMutation, t])

  const handleRetryFromBeginning = React.useCallback(async () => {
    if (!runId || !run) return
    const resumePoint = resolveResumePoint(run)
    const recordEstimate = run.progressJob?.totalCount ?? null
    // Prose, not a layout: ConfirmDialogOptions.text is a string and neither it
    // nor ConfirmDialogProps exposes a node slot. The information survives.
    const text = [
      recordEstimate
        ? t('data_sync.runs.detail.retryFromBeginning.confirmWithEstimate', 'This ignores the saved cursor and reads the entire source again — about {count} records — instead of continuing.', { count: recordEstimate })
        : t('data_sync.runs.detail.retryFromBeginning.confirm', 'This ignores the saved cursor and reads the entire source again, instead of continuing.'),
      resumePoint.kind === 'resumes'
        ? t('data_sync.runs.detail.retryFromBeginning.confirmResumePoint', 'A resumable retry would start at batch {batch}; this one starts at the beginning.', { batch: resumePoint.batchesCompleted })
        : t('data_sync.runs.detail.retryFromBeginning.confirmNoResumePoint', 'This run committed no batch, so only a from-the-beginning retry has a start position you can rely on.'),
      t('data_sync.runs.detail.retryFromBeginning.confirmMatched', 'Existing records are matched and updated, not duplicated.'),
    ].join(' ')

    const confirmed = await confirm({
      title: t('data_sync.runs.detail.retryFromBeginning.title', 'Retry from the beginning?'),
      text,
      confirmText: t('data_sync.runs.detail.retryFromBeginning.action', 'Retry from the beginning'),
      // Not destructive: a full replay updates matched records rather than
      // deleting anything, and the red budget belongs to Cancel run.
      variant: 'default',
    })
    if (!confirmed) return

    const call = await runMutation({
      // optimistic-lock-exempt: starts a new retry run (create), not a concurrent record edit
      operation: () => apiCall<{ id: string }>(`/api/data_sync/runs/${encodeURIComponent(runId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromBeginning: true }),
      }, { fallback: null }),
      mutationPayload: { runId, fromBeginning: true },
      context: { operation: 'create', actionId: 'retry-sync-run-from-beginning', runId },
    })
    if (call.ok && call.result) {
      flash(t('data_sync.runs.detail.retrySuccess'), 'success')
      router.push(`/backend/data-sync/runs/${encodeURIComponent(call.result.id)}`)
    } else {
      const failure = call.result as RetryFailureBody | null
      setStaleParameters(failure?.code === 'parametersStale')
      flash(buildRetryFailureMessage(failure, t), 'error')
    }
  }, [confirm, run, runId, router, runMutation, t])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('data_sync.runs.detail.title')} /></PageBody></Page>
  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('data_sync.runs.detail.notFound', 'Sync run not found.')}
            backHref="/backend/data-sync"
            backLabel={t('data_sync.runs.detail.back')}
          />
        </PageBody>
      </Page>
    )
  }
  if (error || !run) return <Page><PageBody><ErrorMessage label={error ?? t('data_sync.runs.detail.loadError')} /></PageBody></Page>

  const resumePoint = resolveResumePoint(run)
  // `null` (unresolved, including a failed fetch) and an entity type the
  // adapter does not restrict both mean the control applies.
  const canReplayFromStart = applicableStartControls(startControls, run.entityType).fullSync
  const overflowActions = canRunSync && resumePoint.kind !== 'none' && canReplayFromStart
    ? [{
      id: 'retry-from-beginning',
      label: run.status === 'cancelled'
        ? t('data_sync.runs.detail.retryFromBeginning.actionCancelled', 'Start from the beginning')
        : t('data_sync.runs.detail.retryFromBeginning.action', 'Retry from the beginning'),
      onSelect: () => { void handleRetryFromBeginning() },
    }]
    : []
  const totalProcessed = run.createdCount + run.updatedCount + run.skippedCount + run.failedCount
  const progressPercent = run.progressJob?.progressPercent ?? (run.status === 'completed' ? 100 : 0)
  const progressStatus = run.progressJob?.status ?? run.status
  const processedCount = run.progressJob?.processedCount ?? totalProcessed
  const hasProgressTotal = typeof run.progressJob?.totalCount === 'number' && run.progressJob.totalCount > 0
  const etaLabel = run.progressJob?.etaSeconds && run.progressJob.etaSeconds > 0
    ? formatEtaSeconds(run.progressJob.etaSeconds)
    : null

  return (
    <Page>
      {ConfirmDialogElement}
      <PageBody className="space-y-6">
        <FormHeader
          mode="detail"
          backHref="/backend/data-sync"
          backLabel={t('data_sync.runs.detail.back')}
          entityTypeLabel={t('data_sync.runs.detail.title')}
          title={`${run.integrationId} — ${run.entityType}`}
          statusBadge={(
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{t(`data_sync.dashboard.direction.${run.direction}`)}</Badge>
              <StatusBadge variant={getSyncRunStatusVariant(run.status)}>
                {t(`data_sync.dashboard.status.${run.status}`)}
              </StatusBadge>
              {run.triggeredBy ? <Badge variant="outline">{run.triggeredBy}</Badge> : null}
            </div>
          )}
          actionsContent={(
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canRunSync && (run.status === 'running' || run.status === 'pending') ? (
                  <Button type="button" variant="destructive" size="sm" onClick={() => void handleCancel()}>
                    <XCircle className="mr-2 h-4 w-4" />
                    {t('data_sync.runs.detail.cancel')}
                  </Button>
                ) : null}
                {canRunSync && run.status === 'completed' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { router.push(`/backend/data-sync?from=${encodeURIComponent(run.id)}`) }}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {t('data_sync.runs.detail.runAgain', 'Run again')}
                  </Button>
                ) : null}
                {canRunSync && resumePoint.kind !== 'none' ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => void handleRetry()}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {/* A cancelled run was stopped on purpose — nothing went
                        wrong, and "Retry" misdescribes that. */}
                    {run.status === 'cancelled'
                      ? t('data_sync.runs.detail.resume', 'Resume')
                      : t('data_sync.runs.detail.retry')}
                  </Button>
                ) : null}
                {/* RowActions renders nothing for an empty list, so an
                    overflow with no items never appears. */}
                <RowActions items={overflowActions} />
              </div>
              {resumePoint.kind === 'resumes' ? (
                <p className="flex flex-wrap items-center justify-end gap-1 text-xs text-muted-foreground">
                  <Bookmark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('data_sync.runs.detail.resumePoint.resumes', 'Resumes from batch {batch} —', { batch: resumePoint.batchesCompleted })}</span>
                  {/* Verbatim and never truncated: an adapter cursor is the only
                      value an operator can paste into a support ticket. */}
                  <span className="font-mono break-all">{resumePoint.cursor}</span>
                </p>
              ) : null}
              {canRunSync && run.status === 'completed' ? (
                <p className="text-xs text-muted-foreground">
                  {t('data_sync.runs.detail.runAgain.hint', "Opens the start form with this run's settings")}
                </p>
              ) : null}
              {resumePoint.kind !== 'none' && !canReplayFromStart ? (
                <p className="flex max-w-prose items-start justify-end gap-1 text-right text-xs text-muted-foreground">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t('data_sync.runs.detail.retryFromBeginning.unsupported', 'This feed cannot be replayed from the start — {integration} does not support a full sync of {entityType}.', {
                      integration: run.integrationId,
                      entityType: run.entityType,
                    })}
                  </span>
                </p>
              ) : null}
              {resumePoint.kind === 'noCommittedBatch' ? (
                <p className="flex max-w-prose items-start justify-end gap-1 text-right text-xs text-muted-foreground">
                  <Bookmark className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('data_sync.runs.detail.resumePoint.noCommittedBatch', "This run committed no batch. Retry starts from this feed's last saved position, which may be earlier than this run began.")}</span>
                </p>
              ) : null}
            </div>
          )}
        />

        {staleParameters ? (
          <Alert status="error">
            <AlertDescription className="space-y-2">
              <p>{buildRetryFailureMessage({ code: 'parametersStale' }, t)}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { router.push(`/backend/data-sync?from=${encodeURIComponent(run.id)}`) }}
              >
                <Play className="mr-2 h-4 w-4" />
                {t('data_sync.runs.detail.startNewRunFromHere', 'Start a new run with these settings…')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t('data_sync.runs.detail.progress')}</CardTitle>
              <StatusBadge variant={getSyncRunStatusVariant(progressStatus)}>
                {t(`data_sync.dashboard.status.${progressStatus}`)}
              </StatusBadge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">
                {hasProgressTotal
                  ? t('data_sync.runs.detail.progress.percent', { percent: progressPercent })
                  : t('data_sync.runs.detail.progress.itemsProcessed', { count: processedCount })}
              </span>
              {etaLabel ? (
                <span className="text-muted-foreground">
                  {t('data_sync.runs.detail.progress.eta', { eta: etaLabel })}
                </span>
              ) : null}
            </div>
            {hasProgressTotal ? (
              <Progress value={progressPercent} className="h-3" />
            ) : (
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
                <div className="absolute inset-y-0 left-0 w-1/2 animate-pulse rounded-full bg-primary/80" />
                <div className="absolute inset-y-0 right-0 w-1/3 rounded-full bg-primary/10" />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>
                {hasProgressTotal
                  ? t('data_sync.runs.detail.progress.itemsProcessedTotal', {
                      processed: processedCount,
                      total: run.progressJob?.totalCount ?? 0,
                    })
                  : t('data_sync.runs.detail.progress.itemsProcessed', { count: processedCount })}
              </span>
              <span>{t('data_sync.runs.detail.progress.batches', { count: run.batchesCompleted })}</span>
            </div>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm">
                <dt className="font-medium text-muted-foreground">{t('data_sync.runs.detail.cursor.startedFrom', 'Started from')}</dt>
                <dd className={run.initialCursor ? 'font-mono break-all text-right' : 'text-muted-foreground'}>
                  {run.initialCursor ?? t('data_sync.runs.detail.cursor.beginningOfSource', 'beginning of source')}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm">
                <dt className="font-medium text-muted-foreground">{t('data_sync.runs.detail.cursor.committedThrough', 'Committed through')}</dt>
                <dd className={run.cursor ? 'font-mono break-all text-right' : 'text-muted-foreground'}>
                  {run.cursor ?? t('data_sync.runs.detail.cursor.nothingCommitted', 'nothing committed')}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-status-success-text">{run.createdCount}</div>
              <p className="text-sm text-muted-foreground">{t('data_sync.runs.detail.counters.created')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-status-info-text">{run.updatedCount}</div>
              <p className="text-sm text-muted-foreground">{t('data_sync.runs.detail.counters.updated')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-muted-foreground">{run.skippedCount}</div>
              <p className="text-sm text-muted-foreground">{t('data_sync.runs.detail.counters.skipped')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-status-error-text">{run.failedCount}</div>
              <p className="text-sm text-muted-foreground">{t('data_sync.runs.detail.counters.failed')}</p>
            </CardContent>
          </Card>
        </div>

        {run.parameters && Object.keys(run.parameters).length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('data_sync.runs.detail.parameters', 'Run parameters')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Object.entries(run.parameters).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm">
                    <dt className="font-medium text-muted-foreground">{parameterLabels[key] ?? key}</dt>
                    <dd className="font-mono text-foreground">
                      {typeof value === 'boolean' ? String(value) : String(value ?? '')}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ) : null}

        {run.lastError && (
          <Card className="border-status-error-border bg-status-error-bg">
            <CardHeader>
              <CardTitle className="text-status-error-text">{t('data_sync.runs.detail.error')}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm text-status-error-text whitespace-pre-wrap">{run.lastError}</pre>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('data_sync.runs.detail.logs')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingLogs ? (
              <div className="flex justify-center py-4"><Spinner /></div>
            ) : (
              <LogList
                entries={logs.map<LogListEntry>((log) => ({
                  id: log.id,
                  time: new Date(log.createdAt).toLocaleString(),
                  level: log.level,
                  message: log.message,
                  body: log.payload ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border bg-card p-3 text-xs">
                      {log.payload.kind === 'export-item-failure' && typeof log.payload.summary === 'string'
                        ? log.payload.summary
                        : JSON.stringify(log.payload, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('data_sync.runs.detail.logs.noPayload', 'No payload recorded for this log entry.')}
                    </p>
                  ),
                }))}
                emptyMessage={t('data_sync.runs.detail.noLogs')}
              />
            )}
            {logsTotal > LOG_PAGE_SIZE && (
              <Pagination
                className="mt-4"
                page={logsPage}
                pageSize={LOG_PAGE_SIZE}
                total={logsTotal}
                onPageChange={(next) => { void loadLogs(next) }}
              />
            )}
          </CardContent>
        </Card>
      </PageBody>
    </Page>
  )
}
