"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FindingsTable } from './FindingsTable'

type ScanRunDetail = {
  id: string
  suiteName?: string | null
  targetEntityType?: string | null
  status: string
  progress?: number | null
  score?: number | null
  openFindingCount?: number | null
  findingCount?: number | null
  totalCount?: number | null
  startedAt?: string | null
  finishedAt?: string | null
  requestedBy?: string | null
  requestedByName?: string | null
}

type ScanListResponse = {
  items?: ScanRunDetail[]
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString()
}

export function ScanRunDetailClient({ scanId }: { scanId: string }) {
  const t = useT()
  const { data, isLoading, isFetching, error, refetch } = useQuery<ScanRunDetail>({
    queryKey: ['data_quality_scan', scanId],
    queryFn: async () => {
      const result = await apiCall<ScanListResponse>(`/api/data_quality/scans?id=${encodeURIComponent(scanId)}&page=1&pageSize=1`)
      if (!result.ok) {
        await raiseCrudError(result.response, t('data_quality.errors.scanLoadFailed', 'Failed to load the scan run.'))
      }
      const scan = Array.isArray(result.result?.items) ? result.result.items[0] : null
      if (!scan) {
        throw new Error(t('data_quality.errors.scanNotFound', 'Scan not found.'))
      }
      return scan
    },
    enabled: Boolean(scanId),
  })

  if (isLoading) {
    return <LoadingMessage label={t('data_quality.scans.loading', 'Loading scan run...')} />
  }

  if (error || !data) {
    return (
      <ErrorMessage
        label={error instanceof Error ? error.message : t('data_quality.errors.scanNotFound', 'Scan not found.')}
        action={
          <Button type="button" variant="outline" onClick={() => { void refetch() }}>
            {t('common.retry', 'Retry')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.suiteName ?? data.targetEntityType ?? t('data_quality.scans.title', 'Scan Runs')}
        description={data.targetEntityType ?? undefined}
        actions={(
          <>
            <Button variant="outline" asChild>
              <Link href="/backend/data-quality/scans">{t('data_quality.nav.scans', 'Scans')}</Link>
            </Button>
            <Button type="button" variant="outline" onClick={() => { void refetch() }} disabled={isFetching}>
              {t('common.refresh', 'Refresh')}
            </Button>
          </>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="space-y-1 pb-2">
            <CardDescription>{t('data_quality.scans.columns.status', 'Status')}</CardDescription>
            <CardTitle>{data.status}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t('data_quality.scans.columns.target', 'Target')}: {data.targetEntityType ?? '—'}</CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-1 pb-2">
            <CardDescription>{t('data_quality.scans.columns.score', 'Score')}</CardDescription>
            <CardTitle>{data.score ?? 0}%</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t('data_quality.summary.openFindings', 'Open Findings')}: {data.openFindingCount ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-1 pb-2">
            <CardDescription>{t('data_quality.scans.columns.findings', 'Findings')}</CardDescription>
            <CardTitle>{data.findingCount ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t('data_quality.scans.columns.records', 'Records')}: {data.totalCount ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-1 pb-2">
            <CardDescription>{t('data_quality.scans.columns.finishedAt', 'Finished')}</CardDescription>
            <CardTitle>{formatDateTime(data.finishedAt)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t('data_quality.scans.columns.requestedBy', 'Requested by')}: {data.requestedByName ?? data.requestedBy ?? '—'}</CardContent>
        </Card>
      </div>

      <FindingsTable scanRunId={scanId} title={t('data_quality.findings.title', 'Findings')} />
    </div>
  )
}
