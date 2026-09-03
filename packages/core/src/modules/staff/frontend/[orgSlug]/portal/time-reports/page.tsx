"use client"

/**
 * EP-50. The customer's own closed time reports.
 *
 * Everything the page shows comes from `/api/staff/portal/time-reports`, which
 * scopes every row to the signed-in portal user's own customer entity inside their
 * own tenant and organization. The page passes no customer id and no organization
 * id of its own — `orgSlug` is used for hrefs only, exactly as the other portal
 * pages use it.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard } from '@open-mercato/ui/portal/components/PortalCard'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import { formatDuration } from '@open-mercato/core/modules/staff/lib/time-tracking/duration'

type Props = { params: { orgSlug: string } }

type PortalTimeReport = {
  id: string
  reference: string
  title: string
  periodFrom: string
  periodTo: string
  closedAt: string | null
  totalBillableMinutes: number
  totalNonbillableMinutes: number
}

type PortalTimeReportsResponse = {
  items?: PortalTimeReport[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

const PAGE_SIZE = 20

export default function PortalTimeReportsPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth

  const [reports, setReports] = React.useState<PortalTimeReport[]>([])
  const [page, setPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!loading && !user) router.replace(`/${params.orgSlug}/portal/login`)
  }, [loading, user, router, params.orgSlug])

  const load = React.useCallback(async () => {
    if (!user) return
    setIsLoading(true)
    setError(null)
    try {
      const response = await apiCall<PortalTimeReportsResponse>(
        `/api/staff/portal/time-reports?page=${page}&pageSize=${PAGE_SIZE}`,
      )
      if (!response.ok) {
        setError(t('staff.portal.timeReports.loadFailed', 'Could not load your time reports.'))
        setReports([])
        return
      }
      setReports(response.result?.items ?? [])
      setTotalPages(Math.max(1, response.result?.totalPages ?? 1))
    } catch {
      setError(t('staff.portal.timeReports.loadFailed', 'Could not load your time reports.'))
      setReports([])
    } finally {
      setIsLoading(false)
    }
  }, [user, page, t])

  React.useEffect(() => {
    void load()
  }, [load])

  usePortalAppEvent('staff.timesheets.time_report.portal_published', () => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }
  if (!user) return null

  return (
    <div className="space-y-6">
      <PortalPageHeader
        title={t('staff.portal.timeReports.listTitle', 'Time reports')}
        description={t(
          'staff.portal.timeReports.listDescription',
          'Hours delivered on your projects, as reported at the close of each period.',
        )}
      />

      {error ? <ErrorMessage label={error} /> : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          variant="subtle"
          size="lg"
          title={t('staff.portal.timeReports.emptyTitle', 'No time reports yet')}
          description={t(
            'staff.portal.timeReports.emptyDescription',
            'A report appears here once the period it covers has been closed.',
          )}
        />
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <PortalCard key={report.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/${params.orgSlug}/portal/time-reports/${report.id}`}
                    className="text-base font-medium text-foreground hover:underline"
                  >
                    {report.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {report.reference} · {report.periodFrom} – {report.periodTo}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-base font-medium text-foreground">
                    {formatDuration(report.totalBillableMinutes, 'hm')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('staff.portal.timeReports.billableHours', 'Billable hours')}
                  </p>
                </div>
              </div>
            </PortalCard>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            {t('staff.portal.timeReports.previous', 'Previous')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t('staff.portal.timeReports.pageLabel', 'Page')} {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            {t('staff.portal.timeReports.next', 'Next')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
