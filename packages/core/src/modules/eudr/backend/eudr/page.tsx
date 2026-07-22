"use client"

import * as React from 'react'
import Link from 'next/link'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Download } from 'lucide-react'
import type { AnnualReport } from '../../lib/annual-report'

type StatusCounts = Record<string, number>

type IncompleteSubmissionQueueItem = { id: string; label: string | null; completeness: number; url: string }
type ReviewDueQueueItem = { id: string; label: string | null; dueAt: string; url: string }
type AmendWindowQueueItem = { id: string; label: string; expiresAt: string; url: string }
type PlotWarningQueueItem = { id: string; label: string; warnings: string[]; url: string }

type ComplianceQueues = {
  incompleteSubmissions?: IncompleteSubmissionQueueItem[]
  reviewsDue?: ReviewDueQueueItem[]
  amendWindow?: AmendWindowQueueItem[]
  plotsWithWarnings?: PlotWarningQueueItem[]
}

type ComplianceOverview = {
  deadline: {
    date: string
    daysLeft: number
  }
  mappingsInScope?: number
  submissions?: {
    total: number
    byStatus: StatusCounts
    avgCompleteness: number | null
    incomplete: number
  }
  statements: {
    total: number
    byStatus: StatusCounts
    notReady: number
    missingReference: number
  }
  riskReviewsDueSoon?: number
  plots?: {
    active: number
    withWarnings: number
  }
  queues: ComplianceQueues
}

const STATEMENT_STATUSES = ['draft', 'submitted', 'available', 'withdrawn', 'archived'] as const
const CURRENT_REPORT_YEAR = new Date().getUTCFullYear()
const REPORT_YEARS = Array.from({ length: 6 }, (_, index) => CURRENT_REPORT_YEAR - index)

function formatDeadlineDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function isPastDue(value: string): boolean {
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

function QueueRow({ href, label, meta, metaClassName }: {
  href: string
  label: string
  meta: string
  metaClassName?: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
    >
      <span className="truncate font-medium">{label}</span>
      <span className={`shrink-0 text-xs ${metaClassName ?? 'text-muted-foreground'}`}>{meta}</span>
    </Link>
  )
}

function QueueCard({ title, href, emptyLabel, children }: {
  title: string
  href: string
  emptyLabel: string
  children: React.ReactNode[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link href={href} className="hover:underline">{title}</Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {children.length > 0 ? (
          <div className="space-y-2">{children}</div>
        ) : (
          <EmptyState size="sm" variant="subtle" title={emptyLabel} />
        )}
      </CardContent>
    </Card>
  )
}

function AnnualReportCard({ scopeVersion }: { scopeVersion: number }) {
  const translate = useT()
  const [year, setYear] = React.useState(CURRENT_REPORT_YEAR)
  const [report, setReport] = React.useState<AnnualReport | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [downloadingFormat, setDownloadingFormat] = React.useState<'json' | 'csv' | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function loadReport() {
      setLoading(true)
      setError(null)
      try {
        const call = await apiCall<AnnualReport>(`/api/eudr/reports/annual?year=${year}`)
        if (cancelled) return
        if (!call.ok || !call.result) {
          setReport(null)
          setError(translate('eudr.annualReport.loadError'))
          return
        }
        setReport(call.result)
      } catch {
        if (!cancelled) {
          setReport(null)
          setError(translate('eudr.annualReport.loadError'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadReport()
    return () => {
      cancelled = true
    }
  }, [scopeVersion, translate, year])

  const downloadReport = React.useCallback(async (format: 'json' | 'csv') => {
    setDownloadingFormat(format)
    try {
      const call = await apiCall<Blob>(
        `/api/eudr/reports/annual?year=${year}&format=${format}`,
        undefined,
        { parse: (response) => response.blob() },
      )
      if (!call.ok || !call.result) throw new Error('[internal] eudr annual report download failed')

      const objectUrl = URL.createObjectURL(call.result)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `eudr-annual-report-${year}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      flash(translate('eudr.annualReport.downloadError'), 'error')
    } finally {
      setDownloadingFormat(null)
    }
  }, [translate, year])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate('eudr.annualReport.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          id="eudr-annual-report-year"
          label={translate('eudr.annualReport.yearLabel')}
          className="max-w-48"
        >
          <Select
            value={String(year)}
            onValueChange={(value) => {
              if (!value) return
              setYear(Number(value))
            }}
          >
            <SelectTrigger id="eudr-annual-report-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_YEARS.map((reportYear) => (
                <SelectItem key={reportYear} value={String(reportYear)}>
                  {reportYear}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        {loading ? (
          <LoadingMessage label={translate('eudr.annualReport.loading')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : report && report.statements.total > 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate('eudr.annualReport.totals', {
              statements: report.statements.total,
              commodities: report.statements.byCommodity.length,
            })}
          </p>
        ) : (
          <EmptyState
            size="sm"
            variant="subtle"
            title={translate('eudr.annualReport.empty')}
          />
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => void downloadReport('json')}
            disabled={loading || downloadingFormat !== null}
          >
            <Download className="size-4" aria-hidden="true" />
            {translate('eudr.annualReport.downloadJson')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void downloadReport('csv')}
            disabled={loading || downloadingFormat !== null}
          >
            <Download className="size-4" aria-hidden="true" />
            {translate('eudr.annualReport.downloadCsv')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function EudrOverviewPage() {
  const translate = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [overview, setOverview] = React.useState<ComplianceOverview | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function loadOverview() {
      setLoading(true)
      setError(null)
      try {
        const call = await apiCall<ComplianceOverview>('/api/eudr/dashboard/widgets/compliance-overview')
        if (cancelled) return
        if (!call.ok || !call.result) {
          setError(translate('eudr.overview.loadError'))
          return
        }
        setOverview(call.result)
      } catch {
        if (!cancelled) setError(translate('eudr.overview.loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadOverview()
    return () => {
      cancelled = true
    }
  }, [scopeVersion, translate])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={translate('eudr.overview.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !overview) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? translate('eudr.overview.loadError')} />
        </PageBody>
      </Page>
    )
  }

  const queues = overview.queues ?? {}
  const recordUnavailableLabel = translate('eudr.common.recordUnavailable')

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{translate('eudr.overview.title')}</h1>
            <Badge variant="warning">
              {translate('eudr.overview.deadlineCountdown', {
                daysLeft: overview.deadline.daysLeft,
                date: formatDeadlineDate(overview.deadline.date),
              })}
            </Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {overview.mappingsInScope !== undefined ? (
              <Link href="/backend/eudr/product-mappings" className="block">
                <KpiCard
                  title={translate('eudr.overview.kpis.mappingsInScope')}
                  value={overview.mappingsInScope}
                  className="h-full transition-colors hover:bg-muted/50"
                />
              </Link>
            ) : null}
            {overview.plots ? (
              <Link href="/backend/eudr/plots" className="block">
                <KpiCard
                  title={translate('eudr.overview.kpis.activePlots')}
                  value={overview.plots.active}
                  className="h-full transition-colors hover:bg-muted/50"
                  footer={(
                    <p className="text-xs text-muted-foreground">
                      {translate('eudr.overview.kpis.plotsWithWarnings', { count: overview.plots.withWarnings })}
                    </p>
                  )}
                />
              </Link>
            ) : null}
            {overview.submissions ? (
              <Link href="/backend/eudr/evidence-submissions" className="block">
                <KpiCard
                  title={translate('eudr.overview.kpis.submissionsCompleteness')}
                  value={typeof overview.submissions.avgCompleteness === 'number'
                    ? Math.round(overview.submissions.avgCompleteness)
                    : null}
                  suffix="%"
                  className="h-full transition-colors hover:bg-muted/50"
                  footer={(
                    <p className="text-xs text-muted-foreground">
                      {translate('eudr.overview.kpis.submissionsIncomplete', { count: overview.submissions.incomplete })}
                    </p>
                  )}
                />
              </Link>
            ) : null}
            <Link href="/backend/eudr/statements" className="block">
              <KpiCard
                title={translate('eudr.overview.kpis.statements')}
                value={overview.statements.total}
                className="h-full transition-colors hover:bg-muted/50"
                footer={(
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {STATEMENT_STATUSES.map((status) => (
                      <span key={status}>
                        {translate(`eudr.statementStatus.${status}`)}: {overview.statements.byStatus[status] ?? 0}
                      </span>
                    ))}
                  </div>
                )}
              />
            </Link>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {queues.incompleteSubmissions ? (
              <QueueCard
                title={translate('eudr.overview.queues.incompleteSubmissions.title')}
                href="/backend/eudr/evidence-submissions"
                emptyLabel={translate('eudr.overview.queues.empty')}
              >
                {queues.incompleteSubmissions.map((item) => (
                  <QueueRow
                    key={item.id}
                    href={item.url}
                    label={item.label ?? recordUnavailableLabel}
                    meta={`${item.completeness}%`}
                  />
                ))}
              </QueueCard>
            ) : null}
            {queues.reviewsDue ? (
              <QueueCard
                title={translate('eudr.overview.queues.reviewsDue.title')}
                href="/backend/eudr/risk-assessments"
                emptyLabel={translate('eudr.overview.queues.empty')}
              >
                {queues.reviewsDue.map((item) => (
                  <QueueRow
                    key={item.id}
                    href={item.url}
                    label={item.label ?? recordUnavailableLabel}
                    meta={formatDate(item.dueAt)}
                    metaClassName={isPastDue(item.dueAt) ? 'text-status-warning-text' : undefined}
                  />
                ))}
              </QueueCard>
            ) : null}
            {queues.amendWindow ? (
              <QueueCard
                title={translate('eudr.overview.queues.amendWindow.title')}
                href="/backend/eudr/statements?status=available"
                emptyLabel={translate('eudr.overview.queues.empty')}
              >
                {queues.amendWindow.map((item) => (
                  <QueueRow
                    key={item.id}
                    href={item.url}
                    label={item.label}
                    meta={translate('eudr.overview.queues.amendWindow.expires', { date: formatDateTime(item.expiresAt) })}
                  />
                ))}
              </QueueCard>
            ) : null}
            {queues.plotsWithWarnings ? (
              <QueueCard
                title={translate('eudr.overview.queues.plotsWithWarnings.title')}
                href="/backend/eudr/plots"
                emptyLabel={translate('eudr.overview.queues.empty')}
              >
                {queues.plotsWithWarnings.map((item) => (
                  <QueueRow
                    key={item.id}
                    href={item.url}
                    label={item.label}
                    meta={item.warnings.map((code) => translate(`eudr.errors.${code}`)).join(', ')}
                    metaClassName="text-status-warning-text"
                  />
                ))}
              </QueueCard>
            ) : null}
          </div>

          <AnnualReportCard scopeVersion={scopeVersion} />
        </div>
      </PageBody>
    </Page>
  )
}
