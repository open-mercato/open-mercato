"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Leaf } from 'lucide-react'
import type { EudrComplianceOverviewSettings } from './widget'

type StatusCounts = Record<string, number>

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
}

type Translate = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
) => string

const SUBMISSION_STATUSES = ['draft', 'submitted', 'verified', 'rejected'] as const
const STATEMENT_STATUSES = ['draft', 'submitted', 'available', 'withdrawn', 'archived'] as const

async function loadOverview(): Promise<ComplianceOverview> {
  const call = await apiCall<ComplianceOverview>('/api/eudr/dashboard/widgets/compliance-overview')
  if (!call.ok || !call.result) {
    const message = `[internal] EUDR compliance overview request failed with status ${call.status}`
    throw new Error(message)
  }
  return call.result
}

function formatDeadlineDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

function formatCompleteness(value: number | null, t: Translate): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('eudr.common.empty')
  return `${Math.round(value)}%`
}

function isOverviewEmpty(data: ComplianceOverview): boolean {
  return (data.mappingsInScope ?? 0) === 0
    && (data.submissions?.total ?? 0) === 0
    && data.statements.total === 0
    && (data.riskReviewsDueSoon ?? 0) === 0
}

function StatusBreakdown({
  title,
  statuses,
  byStatus,
  labelPrefix,
  t,
}: {
  title: string
  statuses: readonly string[]
  byStatus: StatusCounts
  labelPrefix: string
  t: Translate
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {statuses.map((status) => (
          <span key={status}>
            {t(`${labelPrefix}.${status}`)}: {byStatus[status] ?? 0}
          </span>
        ))}
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  href,
  onOpen,
}: {
  label: string
  value: number
  href?: string
  onOpen: (href: string) => void
}) {
  const content = (
    <span className="flex w-full items-center justify-between gap-3">
      <span className="text-left text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold text-foreground">{value}</span>
    </span>
  )

  if (!href) {
    return (
      <div className="flex min-h-16 items-center rounded-md border bg-background px-3 py-2">
        {content}
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-16 w-full justify-start px-3 py-2"
      onClick={() => onOpen(href)}
    >
      {content}
    </Button>
  )
}

const EudrComplianceOverviewWidget: React.FC<DashboardWidgetComponentProps<EudrComplianceOverviewSettings>> = ({
  mode,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const router = useRouter()
  const [overview, setOverview] = React.useState<ComplianceOverview | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const data = await loadOverview()
      setOverview(data)
    } catch (err) {
      console.error('Failed to load EUDR compliance overview widget data', err)
      setError(t('eudr.dashboard.error'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <p className="text-sm text-muted-foreground">{t('eudr.dashboard.noSettings')}</p>
    )
  }

  if (loading) {
    return <LoadingMessage label={t('eudr.dashboard.loading')} />
  }

  if (error) {
    return <ErrorMessage label={error} />
  }

  if (!overview || isOverviewEmpty(overview)) {
    return (
      <EmptyState
        size="sm"
        variant="subtle"
        icon={<Leaf className="h-5 w-5" aria-hidden />}
        title={t('eudr.dashboard.empty.title')}
        description={t('eudr.dashboard.empty.description')}
      />
    )
  }

  const deadlineDate = formatDeadlineDate(overview.deadline.date)

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold">
          {t('eudr.dashboard.daysToDeadline', {
            daysLeft: overview.deadline.daysLeft,
            date: deadlineDate,
          })}
        </p>
        {overview.mappingsInScope !== undefined ? (
          <p className="text-xs text-muted-foreground">
            {t('eudr.dashboard.mappingsInScope', { count: overview.mappingsInScope })}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label={t('eudr.dashboard.notReady')}
          value={overview.statements.notReady}
          href="/backend/eudr/statements?status=draft"
          onOpen={router.push}
        />
        {overview.submissions ? (
          <StatTile
            label={t('eudr.dashboard.incompleteSubmissions')}
            value={overview.submissions.incomplete}
            href="/backend/eudr/evidence-submissions"
            onOpen={router.push}
          />
        ) : null}
        <StatTile
          label={t('eudr.dashboard.missingReference')}
          value={overview.statements.missingReference}
          href="/backend/eudr/statements"
          onOpen={router.push}
        />
        {overview.riskReviewsDueSoon !== undefined ? (
          <StatTile
            label={t('eudr.dashboard.riskReviewsDueSoon')}
            value={overview.riskReviewsDueSoon}
            onOpen={router.push}
          />
        ) : null}
      </div>

      <div className="space-y-3 rounded-md border bg-muted/20 p-3">
        {overview.submissions ? (
          <>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t('eudr.dashboard.avgCompleteness')}</span>
              <span className="font-medium">{formatCompleteness(overview.submissions.avgCompleteness, t)}</span>
            </div>
            <StatusBreakdown
              title={t('eudr.dashboard.submissionsByStatus')}
              statuses={SUBMISSION_STATUSES}
              byStatus={overview.submissions.byStatus}
              labelPrefix="eudr.submissionStatus"
              t={t}
            />
          </>
        ) : null}
        <StatusBreakdown
          title={t('eudr.dashboard.statementsByStatus')}
          statuses={STATEMENT_STATUSES}
          byStatus={overview.statements.byStatus}
          labelPrefix="eudr.statementStatus"
          t={t}
        />
      </div>
    </div>
  )
}

export default EudrComplianceOverviewWidget
