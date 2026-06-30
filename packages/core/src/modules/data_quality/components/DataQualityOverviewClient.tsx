"use client"

import * as React from 'react'
import Link from 'next/link'
import { Activity, AlertCircle, AlertTriangle, Play, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SummaryData = {
  score: number
  openFindingCount: number
  criticalCount: number
  warningCount: number
  lastScanRun: { id: string; status: string; finishedAt: string | null } | null
}

type ScanSummary = {
  id: string
  status: string
  score?: number | null
  suiteName?: string | null
  targetEntityType?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

type FindingSummary = {
  id: string
  checkName?: string | null
  targetEntityType?: string | null
  targetRecordId?: string | null
  recordLink?: string | null
  severity: string
  message: string
}

type ListResponse<T> = {
  items?: T[]
}

function formatDateTime(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return parsed.toLocaleString()
}

export function DataQualityOverviewClient() {
  const t = useT()
  const [summary, setSummary] = React.useState<SummaryData | null>(null)
  const [recentScans, setRecentScans] = React.useState<ScanSummary[]>([])
  const [topFindings, setTopFindings] = React.useState<FindingSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [startingScan, setStartingScan] = React.useState(false)
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'data_quality.overview.start_scan',
  })

  const loadOverview = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [scansCall, findingsCall, criticalCall, warningCall] = await Promise.all([
        apiCall<ListResponse<ScanSummary> & { total?: number }>('/api/data_quality/scans?page=1&pageSize=5'),
        apiCall<ListResponse<FindingSummary> & { total?: number }>('/api/data_quality/findings?page=1&pageSize=5&status=open'),
        apiCall<{ total?: number }>('/api/data_quality/findings?page=1&pageSize=1&status=open&severity=critical'),
        apiCall<{ total?: number }>('/api/data_quality/findings?page=1&pageSize=1&status=open&severity=warning'),
      ])

      if (!scansCall.ok || !findingsCall.ok || !criticalCall.ok || !warningCall.ok) {
        throw new Error(t('data_quality.summary.loadError', 'Failed to load the data quality overview.'))
      }

      const scans = Array.isArray(scansCall.result?.items) ? scansCall.result.items : []
      const findings = Array.isArray(findingsCall.result?.items) ? findingsCall.result.items : []
      const latestScan = scans[0] ?? null

      setSummary({
        score: latestScan?.score ?? 0,
        openFindingCount: findingsCall.result?.total ?? findings.length,
        criticalCount: criticalCall.result?.total ?? 0,
        warningCount: warningCall.result?.total ?? 0,
        lastScanRun: latestScan
          ? { id: latestScan.id, status: latestScan.status, finishedAt: latestScan.finishedAt ?? null }
          : null,
      })
      setRecentScans(scans)
      setTopFindings(findings)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('data_quality.summary.loadError', 'Failed to load the data quality overview.'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  const handleStartScan = React.useCallback(async () => {
    setStartingScan(true)
    try {
      const suitesCall = await apiCall<{ items?: Array<{ id: string }> }>('/api/data_quality/suites?page=1&pageSize=100&enabled=true')
      const suiteId = Array.isArray(suitesCall.result?.items) ? suitesCall.result.items[0]?.id : undefined
      if (!suitesCall.ok || !suiteId) {
        throw new Error(t('data_quality.errors.noEnabledSuite', 'Create and enable a suite before starting a scan from the overview.'))
      }

      const result = await runMutation({
        operation: () => apiCall('/api/data_quality/scans', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ suiteId }),
        }),
        context: { source: 'overview', suiteId },
        mutationPayload: { source: 'overview', suiteId },
      })

      if (!result.ok) {
        throw new Error(t('data_quality.errors.scanStartFailed', 'Failed to start the scan.'))
      }

      flash(t('data_quality.scans.startSuccess', 'Scan started successfully.'), 'success')
      await loadOverview()
    } catch (nextError) {
      flash(
        nextError instanceof Error ? nextError.message : t('data_quality.errors.scanStartFailed', 'Failed to start the scan.'),
        'error',
      )
    } finally {
      setStartingScan(false)
    }
  }, [loadOverview, runMutation, t])

  if (loading) {
    return <LoadingMessage label={t('data_quality.summary.loading', 'Loading overview...')} />
  }

  if (error) {
    return (
      <ErrorMessage
        label={error}
        action={
          <Button type="button" variant="outline" onClick={() => { void loadOverview() }}>
            {t('common.retry', 'Retry')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('data_quality.summary.title', 'Data Quality Overview')}
        description={t('data_quality.widgets.scorecard.description', 'Shows data quality score, open findings, and last scan status.')}
        actions={(
          <>
            <Button variant="outline" asChild>
              <Link href="/backend/data-quality/checks">{t('data_quality.nav.checks', 'Checks')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/backend/data-quality/scans">{t('data_quality.nav.scans', 'Scans')}</Link>
            </Button>
            <Button type="button" onClick={() => { void handleStartScan() }} disabled={startingScan}>
              {startingScan ? <Spinner className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              {t('data_quality.scans.start', 'Start Scan')}
            </Button>
          </>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="space-y-1 pb-2">
            <CardDescription className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              {t('data_quality.summary.score', 'Quality Score')}
            </CardDescription>
            <CardTitle>{summary?.score ?? 0}%</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {summary?.lastScanRun
              ? t('data_quality.summary.lastScan', 'Last Scan')
              : t('data_quality.summary.noScans', 'No scans run yet')}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1 pb-2">
            <CardDescription className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              {t('data_quality.summary.openFindings', 'Open Findings')}
            </CardDescription>
            <CardTitle>{summary?.openFindingCount ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t('data_quality.findings.emptyDescription', 'Findings will appear here after running a scan.')}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1 pb-2">
            <CardDescription className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {t('data_quality.summary.criticalFindings', 'Critical')}
            </CardDescription>
            <CardTitle>{summary?.criticalCount ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t('data_quality.severity.critical', 'Critical')}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1 pb-2">
            <CardDescription className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {t('data_quality.summary.warningFindings', 'Warnings')}
            </CardDescription>
            <CardTitle>{summary?.warningCount ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {summary?.lastScanRun
              ? formatDateTime(summary.lastScanRun.finishedAt, t('data_quality.summary.noScans', 'No scans run yet'))
              : t('data_quality.summary.noScans', 'No scans run yet')}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('data_quality.summary.recentScans', 'Recent Scans')}</CardTitle>
            <CardDescription>{t('data_quality.scans.emptyDescription', 'Start a scan from a suite or the overview page.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {recentScans.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('data_quality.scans.empty', 'No scans have been run yet.')}</p>
            ) : (
              <ul className="space-y-3">
                {recentScans.map((scan) => (
                  <li key={scan.id} className="flex items-start justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0">
                    <div className="space-y-1">
                      <Link href={`/backend/data-quality/scans/${scan.id}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                        {scan.suiteName ?? scan.targetEntityType ?? scan.id}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTime(scan.finishedAt ?? scan.startedAt, t('data_quality.summary.noScans', 'No scans run yet'))}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">{scan.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('data_quality.summary.topFindings', 'Top Open Findings')}</CardTitle>
            <CardDescription>{t('data_quality.findings.emptyDescription', 'Findings will appear here after running a scan.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {topFindings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('data_quality.findings.empty', 'No findings recorded.')}</p>
            ) : (
              <ul className="space-y-3">
                {topFindings.map((finding) => {
                  const recordLabel = finding.targetRecordId ? finding.targetRecordId.slice(0, 8) : '—'
                  return (
                    <li key={finding.id} className="space-y-1 border-b pb-3 last:border-b-0 last:pb-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">{finding.checkName ?? finding.targetEntityType ?? t('data_quality.findings.title', 'Findings')}</p>
                          <p className="text-sm text-muted-foreground">{finding.message}</p>
                        </div>
                        <span className="text-sm text-muted-foreground">{finding.severity}</span>
                      </div>
                      {finding.recordLink ? (
                        <Link href={finding.recordLink} className="text-sm text-primary underline-offset-4 hover:underline">
                          {recordLabel}
                        </Link>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
