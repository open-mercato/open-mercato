"use client"

/**
 * EP-50. One closed time report, rendered for the customer it belongs to.
 *
 * The two injection spots are the module's portal extension surface. Their
 * context deliberately carries no money and no staff identity — a portal widget
 * that needs either must ask for it through its own gated endpoint, the same rule
 * the backoffice spots follow.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader } from '@open-mercato/ui/portal/components/PortalCard'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { formatDuration } from '@open-mercato/core/modules/staff/lib/time-tracking/duration'

type Props = { params: { orgSlug: string; id: string } }

type PortalTimeReportProject = {
  timeProjectId: string | null
  projectName: string | null
  billableMinutes: number
  nonbillableMinutes: number
}

type PortalTimeReportDetail = {
  id: string
  reference: string
  title: string
  periodFrom: string
  periodTo: string
  closedAt: string | null
  totalBillableMinutes: number
  totalNonbillableMinutes: number
  projects: PortalTimeReportProject[]
}

export default function PortalTimeReportDetailPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth

  const [report, setReport] = React.useState<PortalTimeReportDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!loading && !user) router.replace(`/${params.orgSlug}/portal/login`)
  }, [loading, user, router, params.orgSlug])

  const load = React.useCallback(async () => {
    if (!user) return
    setIsLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const response = await apiCall<PortalTimeReportDetail>(
        `/api/staff/portal/time-reports/${encodeURIComponent(params.id)}`,
      )
      if (!response.ok) {
        if (response.status === 404) setNotFound(true)
        else setError(t('staff.portal.timeReports.loadFailed', 'Could not load your time reports.'))
        setReport(null)
        return
      }
      setReport(response.result ?? null)
    } catch {
      setError(t('staff.portal.timeReports.loadFailed', 'Could not load your time reports.'))
      setReport(null)
    } finally {
      setIsLoading(false)
    }
  }, [user, params.id, t])

  React.useEffect(() => {
    void load()
  }, [load])

  usePortalAppEvent('staff.timesheets.time_report.portal_published', () => {
    void load()
  }, [load])

  const injectionContext = React.useMemo(
    () => ({
      orgSlug: params.orgSlug,
      reportId: params.id,
      reference: report?.reference ?? null,
      periodFrom: report?.periodFrom ?? null,
      periodTo: report?.periodTo ?? null,
      resolvedFeatures: auth.resolvedFeatures,
    }),
    [params.orgSlug, params.id, report?.reference, report?.periodFrom, report?.periodTo, auth.resolvedFeatures],
  )

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
      <div>
        <Button variant="ghost" asChild>
          <Link href={`/${params.orgSlug}/portal/time-reports`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('staff.portal.timeReports.backToList', 'All time reports')}
          </Link>
        </Button>
      </div>

      <InjectionSpot spotId={extensionPoints.hosts.portalTimeReportBefore.spotId} context={injectionContext} />

      {error ? <ErrorMessage label={error} /> : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      ) : notFound || !report ? (
        <EmptyState
          variant="subtle"
          size="lg"
          title={t('staff.portal.timeReports.notFoundTitle', 'Report not available')}
          description={t(
            'staff.portal.timeReports.notFoundDescription',
            'This report either does not exist or is not part of your account.',
          )}
        />
      ) : (
        <>
          <PortalPageHeader
            label={report.reference}
            title={report.title}
            description={`${report.periodFrom} – ${report.periodTo}`}
          />

          <PortalCard>
            <PortalCardHeader title={t('staff.portal.timeReports.totalsTitle', 'Totals')} />
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">
                  {t('staff.portal.timeReports.billableHours', 'Billable hours')}
                </dt>
                <dd className="text-lg font-medium text-foreground">
                  {formatDuration(report.totalBillableMinutes, 'hm')}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  {t('staff.portal.timeReports.nonBillableHours', 'Non-billable hours')}
                </dt>
                <dd className="text-lg font-medium text-foreground">
                  {formatDuration(report.totalNonbillableMinutes, 'hm')}
                </dd>
              </div>
            </dl>
          </PortalCard>

          <PortalCard>
            <PortalCardHeader title={t('staff.portal.timeReports.projectsTitle', 'By project')} />
            {report.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('staff.portal.timeReports.projectsEmpty', 'No project breakdown is available for this period.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">
                        {t('staff.portal.timeReports.projectColumn', 'Project')}
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        {t('staff.portal.timeReports.billableHours', 'Billable hours')}
                      </th>
                      <th className="py-2 text-right font-medium">
                        {t('staff.portal.timeReports.nonBillableHours', 'Non-billable hours')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.projects.map((line) => (
                      <tr key={line.timeProjectId ?? line.projectName ?? 'unassigned'} className="border-b border-border/60">
                        <td className="py-2 pr-4 text-foreground">
                          {line.projectName ?? t('staff.portal.timeReports.projectUnassigned', 'Unassigned')}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatDuration(line.billableMinutes, 'hm')}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatDuration(line.nonbillableMinutes, 'hm')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PortalCard>
        </>
      )}

      <InjectionSpot spotId={extensionPoints.hosts.portalTimeReportAfter.spotId} context={injectionContext} />
    </div>
  )
}
