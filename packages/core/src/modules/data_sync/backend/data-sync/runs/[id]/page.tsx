"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
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
  triggeredBy: string | null
  createdAt: string
  updatedAt: string
}

type LogEntry = {
  id: string
  level: 'info' | 'warn' | 'error'
  message: string
  createdAt: string
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

export default function SyncRunDetailPage() {
  const params = useParams<{ id: string }>()
  const runId = params.id
  const t = useT()

  const [run, setRun] = React.useState<SyncRunDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = React.useState(false)

  const loadRun = React.useCallback(async () => {
    const call = await apiCall<SyncRunDetail>(
      `/api/data_sync/runs/${encodeURIComponent(runId)}`,
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
  }, [runId, t])

  const loadLogs = React.useCallback(async () => {
    setIsLoadingLogs(true)
    const params = new URLSearchParams({ runId, pageSize: '50' })
    const call = await apiCall<{ items: LogEntry[] }>(
      `/api/integrations/logs?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (call.ok && call.result) {
      setLogs(call.result.items)
    }
    setIsLoadingLogs(false)
  }, [runId])

  React.useEffect(() => {
    void loadRun()
    void loadLogs()
  }, [loadRun, loadLogs])

  React.useEffect(() => {
    if (!run || (run.status !== 'running' && run.status !== 'pending')) return
    const interval = setInterval(() => { void loadRun() }, 4000)
    return () => clearInterval(interval)
  }, [run?.status, loadRun])

  const handleCancel = React.useCallback(async () => {
    const call = await apiCall(`/api/data_sync/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
    }, { fallback: null })
    if (call.ok) {
      flash(t('data_sync.runs.detail.cancelSuccess'), 'success')
      void loadRun()
    } else {
      flash(t('data_sync.runs.detail.cancelError'), 'error')
    }
  }, [runId, t, loadRun])

  const handleRetry = React.useCallback(async () => {
    const call = await apiCall<{ id: string }>(`/api/data_sync/runs/${encodeURIComponent(runId)}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromBeginning: false }),
    }, { fallback: null })
    if (call.ok && call.result) {
      flash(t('data_sync.runs.detail.retrySuccess'), 'success')
      window.location.href = `/backend/data-sync/runs/${encodeURIComponent(call.result.id)}`
    } else {
      flash(t('data_sync.runs.detail.retryError'), 'error')
    }
  }, [runId, t])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('data_sync.runs.detail.title')} /></PageBody></Page>
  if (error || !run) return <Page><PageBody><ErrorMessage label={error ?? t('data_sync.runs.detail.loadError')} /></PageBody></Page>

  const totalProcessed = run.createdCount + run.updatedCount + run.skippedCount + run.failedCount
  const progressPercent = totalProcessed > 0 ? Math.min(100, Math.round((totalProcessed / Math.max(totalProcessed, 1)) * 100)) : (run.status === 'completed' ? 100 : 0)

  return (
    <Page>
      <PageBody className="space-y-6">
        <div>
          <Link href="/backend/data-sync" className="text-sm text-muted-foreground hover:underline">
            {t('data_sync.runs.detail.back')}
          </Link>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{run.integrationId} — {run.entityType}</h1>
            <div className="flex gap-2 mt-2">
              <Badge variant="outline">{t(`data_sync.dashboard.direction.${run.direction}`)}</Badge>
              <Badge variant="secondary" className={STATUS_STYLES[run.status] ?? ''}>
                {t(`data_sync.dashboard.status.${run.status}`)}
              </Badge>
              {run.triggeredBy && <Badge variant="outline">{run.triggeredBy}</Badge>}
            </div>
          </div>
          <div className="flex gap-2">
            {(run.status === 'running' || run.status === 'pending') && (
              <Button type="button" variant="destructive" size="sm" onClick={() => void handleCancel()}>
                {t('data_sync.runs.detail.cancel')}
              </Button>
            )}
            {run.status === 'failed' && (
              <Button type="button" variant="outline" size="sm" onClick={() => void handleRetry()}>
                {t('data_sync.runs.detail.retry')}
              </Button>
            )}
          </div>
        </div>

        {(run.status === 'running' || run.status === 'pending') && (
          <Card>
            <CardHeader>
              <CardTitle>{t('data_sync.runs.detail.progress')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={progressPercent} className="h-3" />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{totalProcessed} items processed</span>
                <span>{run.batchesCompleted} batches</span>
              </div>
            </CardContent>
          </Card>
        )}

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
                      <th className="px-4 py-2 text-left font-medium">Time</th>
                      <th className="px-4 py-2 text-left font-medium">Level</th>
                      <th className="px-4 py-2 text-left font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b last:border-0">
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="secondary" className={LOG_LEVEL_STYLES[log.level] ?? ''}>
                            {log.level}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">{log.message}</td>
                      </tr>
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
