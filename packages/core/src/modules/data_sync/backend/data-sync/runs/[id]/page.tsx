"use client"
import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { RotateCcw, XCircle } from 'lucide-react'

type SyncRunDetail = {
  id: string
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  createdCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  batchesCompleted: number
  lastError: string | null
  progressJobId: string | null
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

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-yellow-100 text-yellow-800',
  paused: 'bg-orange-100 text-orange-800',
}

const LOG_LEVEL_STYLES: Record<string, string> = {
  info: 'bg-blue-100 text-blue-800',
  warn: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
}

type SyncRunDetailPageProps = {
  params?: {
    id?: string | string[]
  }
}

function resolveRouteId(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function resolvePathnameId(pathname: string): string | undefined {
  const parts = pathname.split('/').filter(Boolean)
  const runId = parts.at(-1)
  if (!runId || runId === 'runs' || runId === 'data-sync') return undefined
  return decodeURIComponent(runId)
}

export default function SyncRunDetailPage({ params }: SyncRunDetailPageProps) {
  const pathname = usePathname()
  const router = useRouter()
  const runId = resolveRouteId(params?.id) ?? resolvePathnameId(pathname)
  const t = useT()

  const [run, setRun] = React.useState<SyncRunDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = React.useState(false)
  const [expandedLogId, setExpandedLogId] = React.useState<string | null>(null)

  const resolveCurrentRunId = React.useCallback(() => {
    return runId ?? (
      typeof window !== 'undefined'
        ? resolvePathnameId(window.location.pathname)
        : undefined
    )
  }, [runId])

  const loadRun = React.useCallback(async () => {
    const currentRunId = resolveCurrentRunId()
    if (!currentRunId) {
      setError(t('data_sync.runs.detail.loadError'))
      setIsLoading(false)
      return
    }
    const call = await apiCall<SyncRunDetail>(
      `/api/data_sync/runs/${encodeURIComponent(currentRunId)}`,
      undefined,
      { fallback: null },
    )
    if (!call.ok || !call.result) {
      setError(t('data_sync.runs.detail.loadError'))
      setIsLoading(false)
      return
    }
    setRun(call.result)
    setIsLoading(false)
  }, [resolveCurrentRunId, t])

  const loadLogs = React.useCallback(async () => {
    const currentRunId = resolveCurrentRunId()
    if (!currentRunId) return
    setIsLoadingLogs(true)
    const params = new URLSearchParams({ runId: currentRunId, pageSize: '50' })
    const call = await apiCall<{ items: LogEntry[] }>(
      `/api/integrations/logs?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (call.ok && call.result) {
      setLogs(call.result.items)
    }
    setIsLoadingLogs(false)
  }, [resolveCurrentRunId])

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
    const currentRunId = resolveCurrentRunId()
    if (!currentRunId) return
    const call = await apiCall(`/api/data_sync/runs/${encodeURIComponent(currentRunId)}/cancel`, {
      method: 'POST',
    }, { fallback: null })
    if (call.ok) {
      flash(t('data_sync.runs.detail.cancelSuccess'), 'success')
      void loadRun()
    } else {
      flash(t('data_sync.runs.detail.cancelError'), 'error')
    }
  }, [resolveCurrentRunId, t, loadRun])

  const handleRetry = React.useCallback(async () => {
    const currentRunId = resolveCurrentRunId()
    if (!currentRunId) return
    const call = await apiCall<{ id: string }>(`/api/data_sync/runs/${encodeURIComponent(currentRunId)}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromBeginning: false }),
    }, { fallback: null })
    if (call.ok && call.result) {
      flash(t('data_sync.runs.detail.retrySuccess'), 'success')
      router.push(`/backend/data-sync/runs/${encodeURIComponent(call.result.id)}`)
    } else {
      flash(t('data_sync.runs.detail.retryError'), 'error')
    }
  }, [resolveCurrentRunId, router, t])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('data_sync.runs.detail.title')} /></PageBody></Page>
  if (error || !run) return <Page><PageBody><ErrorMessage label={error ?? t('data_sync.runs.detail.loadError')} /></PageBody></Page>

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
              <Badge variant="secondary" className={STATUS_STYLES[run.status] ?? ''}>
                {t(`data_sync.dashboard.status.${run.status}`)}
              </Badge>
              {run.triggeredBy ? <Badge variant="outline">{run.triggeredBy}</Badge> : null}
            </div>
          )}
          actionsContent={(
            <>
              {(run.status === 'running' || run.status === 'pending') ? (
                <Button type="button" variant="destructive" size="sm" onClick={() => void handleCancel()}>
                  <XCircle className="mr-2 h-4 w-4" />
                  {t('data_sync.runs.detail.cancel')}
                </Button>
              ) : null}
              {run.status === 'failed' ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void handleRetry()}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('data_sync.runs.detail.retry')}
                </Button>
              ) : null}
            </>
          )}
        />

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t('data_sync.runs.detail.progress')}</CardTitle>
              <Badge variant="secondary" className={STATUS_STYLES[progressStatus] ?? ''}>
                {t(`data_sync.dashboard.status.${progressStatus}`)}
              </Badge>
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
                <div className="absolute inset-y-0 right-0 w-1/3 rounded-full bg-primary/40" />
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
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-green-600">{run.createdCount}</div>
              <p className="text-sm text-muted-foreground">{t('data_sync.runs.detail.counters.created')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-blue-600">{run.updatedCount}</div>
              <p className="text-sm text-muted-foreground">{t('data_sync.runs.detail.counters.updated')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-gray-600">{run.skippedCount}</div>
              <p className="text-sm text-muted-foreground">{t('data_sync.runs.detail.counters.skipped')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-red-600">{run.failedCount}</div>
              <p className="text-sm text-muted-foreground">{t('data_sync.runs.detail.counters.failed')}</p>
            </CardContent>
          </Card>
        </div>

        {run.lastError && (
          <Card className="border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="text-red-800">{t('data_sync.runs.detail.error')}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm text-red-700 whitespace-pre-wrap">{run.lastError}</pre>
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
            ) : logs.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('data_sync.runs.detail.noLogs')}</p>
            ) : (
              <div className="rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2 text-left font-medium">{t('data_sync.runs.detail.logs.time')}</th>
                      <th className="px-4 py-2 text-left font-medium">{t('data_sync.runs.detail.logs.level')}</th>
                      <th className="px-4 py-2 text-left font-medium">{t('data_sync.runs.detail.logs.message')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <React.Fragment key={log.id}>
                        <tr className="border-b last:border-0">
                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant="secondary" className={LOG_LEVEL_STYLES[log.level] ?? ''}>
                              {log.level}
                            </Badge>
                          </td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => setExpandedLogId((current) => current === log.id ? null : log.id)}
                            >
                              {log.message}
                            </button>
                          </td>
                        </tr>
                        {expandedLogId === log.id && log.payload ? (
                          <tr className="border-b bg-muted/20 last:border-0">
                            <td colSpan={3} className="px-4 py-4">
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border bg-card p-3 text-xs">
                                {JSON.stringify(log.payload, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </Page>
  )
}
