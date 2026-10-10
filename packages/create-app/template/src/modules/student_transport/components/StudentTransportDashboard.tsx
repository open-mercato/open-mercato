"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatStudentAmount } from './studentOptions'

export type StudentTransportSummary = {
  tripDate: string
  activeSubscriptions: number
  suspendedSubscriptions: number
  b2cChildren: number
  b2bChildren: number
  b2cMonthValue: string
  b2bMonthValue: string
  pickupMarked: number
  dropoffMarked: number
  absencesNotified: number
  absencesUnnotified: number
}

const BOARD_HREF = '/backend/education/attendance'
const SUBSCRIPTIONS_HREF = '/backend/education/subscriptions'

export default function StudentTransportDashboard() {
  const t = useT()
  const query = useQuery({
    queryKey: ['student-transport-summary'],
    queryFn: async (): Promise<StudentTransportSummary | null> => {
      const call = await apiCall<StudentTransportSummary>('/api/student_transport/dashboard-summary')
      return call.result ?? null
    },
    refetchInterval: 60 * 1000,
  })

  if (query.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('student_transport.dashboard.loading', 'Loading the transport summary…')} /></PageBody></Page>
  }

  const summary = query.data

  return (
    <Page>
      <PageBody>
        <PageHeader
          title={t('student_transport.dashboard.title', 'School transport')}
          description={t('student_transport.dashboard.description', 'Who rides today, how the runs are marked, and the value of the subscription book by payer.')}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title={t('student_transport.dashboard.active', 'Active subscriptions')}
            value={summary?.activeSubscriptions ?? null}
            headerAction={(
              <Link href={`${SUBSCRIPTIONS_HREF}?status=active`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                {t('student_transport.dashboard.view', 'View')}
              </Link>
            )}
          />
          <KpiCard
            title={t('student_transport.dashboard.pickupMarked', 'Boarded this morning')}
            value={summary?.pickupMarked ?? null}
            headerAction={(
              <Link href={BOARD_HREF} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                {t('student_transport.dashboard.board', 'Board')}
              </Link>
            )}
          />
          <KpiCard
            title={t('student_transport.dashboard.dropoffMarked', 'Alighted this afternoon')}
            value={summary?.dropoffMarked ?? null}
          />
          <KpiCard
            title={t('student_transport.dashboard.absences', 'Absences reported')}
            value={summary ? summary.absencesNotified + summary.absencesUnnotified : null}
            footer={summary ? (
              <span className="text-xs text-muted-foreground">
                {t('student_transport.dashboard.absenceSplit', '{notified} reported ahead · {unnotified} without notice', {
                  notified: summary.absencesNotified,
                  unnotified: summary.absencesUnnotified,
                })}
              </span>
            ) : undefined}
          />
          <KpiCard
            title={t('student_transport.dashboard.b2c', 'Children billed to families')}
            value={summary?.b2cChildren ?? null}
            footer={summary ? (
              <span className="text-xs text-muted-foreground">
                {t('student_transport.dashboard.b2cValue', 'Subscription value: {amount}', {
                  amount: formatStudentAmount(summary.b2cMonthValue),
                })}
              </span>
            ) : undefined}
          />
          <KpiCard
            title={t('student_transport.dashboard.b2b', 'Children billed to schools')}
            value={summary?.b2bChildren ?? null}
            footer={summary ? (
              <span className="text-xs text-muted-foreground">
                {t('student_transport.dashboard.b2bValue', 'Subscription value: {amount}', {
                  amount: formatStudentAmount(summary.b2bMonthValue),
                })}
              </span>
            ) : undefined}
          />
          <KpiCard
            title={t('student_transport.dashboard.suspended', 'Suspended')}
            value={summary?.suspendedSubscriptions ?? null}
          />
        </div>
      </PageBody>
    </Page>
  )
}
