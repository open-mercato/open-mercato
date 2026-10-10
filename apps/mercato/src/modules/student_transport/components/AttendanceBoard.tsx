"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  ATTENDANCE_LEG_FALLBACKS,
  ATTENDANCE_STATUS_FALLBACKS,
} from '../lib/transportEnums'

const CONTEXT_ID = 'student_transport.attendance.board'
const ENTITY_ID = 'student_transport:student_trip_attendance'

export type BoardRow = {
  id: string
  attendanceId: string | null
  subscriptionId: string
  subscriptionNumber: string
  studentName: string
  accountType: string
  direction: string
  guardianName: string | null
  guardianPhone: string | null
  pickupPoint: string | null
  dropoffPoint: string | null
  tripDate: string
  leg: string
  status: string | null
  origin: string | null
  notes: string | null
  recordedAt: string | null
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The driver's board.
 *
 * One row per child and leg with the four marks as direct actions: boarding and
 * alighting are recorded on the vehicle, and an absence is either reported ahead
 * of the run (the parent told us) or discovered at the stop. The board reads
 * *and* writes the same shape, so a correction is one tap.
 */
export default function AttendanceBoard() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [tripDate, setTripDate] = React.useState(todayIso())
  const [leg, setLeg] = React.useState('pickup')
  const [statusFilter, setStatusFilter] = React.useState('')
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const query = useQuery({
    queryKey: ['student-attendance-board', tripDate, leg, statusFilter, scopeVersion],
    queryFn: async () => {
      const params = new URLSearchParams({ tripDate, leg })
      if (statusFilter) params.set('status', statusFilter)
      const call = await apiCall<{ items?: BoardRow[] }>(`/api/student_transport/attendance?${params.toString()}`)
      return call.result?.items ?? []
    },
  })

  const mark = React.useCallback(async (row: BoardRow, status: string) => {
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => apiCallOrThrow('/api/student_transport/attendance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: row.subscriptionId,
            tripDate: row.tripDate,
            leg: row.leg,
            status,
            ...(row.pickupPoint ? { notes: row.pickupPoint } : {}),
          }),
        }, { errorMessage: t('student_transport.errors.attendance_failed', 'Unable to record the attendance.') }),
        mutationPayload: { operation: 'attendance.record', subscriptionId: row.subscriptionId, leg: row.leg, status },
        context: { formId: CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: row.attendanceId ?? row.subscriptionId, retryLastMutation },
      })
      flash(t('student_transport.attendance.marked', 'Attendance recorded.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('student_transport.errors.attendance_failed', 'Unable to record the attendance.'), 'error')
    }
  }, [query, retryLastMutation, runMutation, t])

  const rows = query.data ?? []
  const marked = rows.filter((row) => row.status === 'boarded' || row.status === 'alighted').length

  return (
    <Page>
      <PageBody>
        <PageHeader
          title={t('student_transport.attendance.title', 'Daily run board')}
          description={t('student_transport.attendance.description', 'Mark each child as they board or alight, and record any absence — reported or not.')}
        />

        <div className="flex flex-wrap items-end gap-3 pb-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('student_transport.attendance.date', 'Date')}</span>
            <Input type="date" value={tripDate} onChange={(event) => setTripDate(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('student_transport.attendance.leg', 'Run')}</span>
            <SegmentedControl value={leg} onValueChange={setLeg}>
              <SegmentedControlItem value="pickup">
                {t('student_transport.leg.pickup', ATTENDANCE_LEG_FALLBACKS.pickup)}
              </SegmentedControlItem>
              <SegmentedControlItem value="dropoff">
                {t('student_transport.leg.dropoff', ATTENDANCE_LEG_FALLBACKS.dropoff)}
              </SegmentedControlItem>
            </SegmentedControl>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('student_transport.attendance.filter', 'Show')}</span>
            <SegmentedControl value={statusFilter || 'all'} onValueChange={(value) => setStatusFilter(value === 'all' ? '' : value)}>
              <SegmentedControlItem value="all">{t('student_transport.attendance.all', 'All')}</SegmentedControlItem>
              <SegmentedControlItem value="absent_notified">{t('student_transport.status.absent_notified', ATTENDANCE_STATUS_FALLBACKS.absent_notified)}</SegmentedControlItem>
              <SegmentedControlItem value="absent_unnotified">{t('student_transport.status.absent_unnotified', ATTENDANCE_STATUS_FALLBACKS.absent_unnotified)}</SegmentedControlItem>
            </SegmentedControl>
          </label>
          <span className="text-sm text-muted-foreground">
            {t('student_transport.attendance.progress', '{marked} of {total} marked', { marked, total: rows.length })}
          </span>
        </div>

        {query.isLoading ? (
          <LoadingMessage label={t('student_transport.attendance.loading', 'Loading the run…')} />
        ) : query.isError ? (
          <p className="text-sm text-destructive">{t('student_transport.attendance.error', 'Failed to load the run board.')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('student_transport.attendance.empty', 'No active subscriptions ride on this date.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-start text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{t('student_transport.attendance.student', 'Student')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('student_transport.attendance.point', 'Stop')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('student_transport.attendance.guardian', 'Guardian')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('student_transport.attendance.status', 'Status')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('student_transport.attendance.actions', 'Mark')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="px-3 py-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium text-foreground">{row.studentName}</span>
                        <span className="text-xs text-muted-foreground">{row.subscriptionNumber}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">{row.leg === 'pickup' ? (row.pickupPoint ?? '—') : (row.dropoffPoint ?? '—')}</td>
                    <td className="px-3 py-2">
                      <span className="flex min-w-0 flex-col">
                        <span>{row.guardianName ?? '—'}</span>
                        <span className="text-xs text-muted-foreground">{row.guardianPhone ?? ''}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary">
                        {row.status
                          ? t(`student_transport.status.${row.status}`, ATTENDANCE_STATUS_FALLBACKS[row.status] ?? row.status)
                          : t('student_transport.attendance.unmarked', 'Not marked')}
                      </Badge>
                      {row.origin === 'parent' ? (
                        <span className="ms-2 text-xs text-muted-foreground">{t('student_transport.attendance.reportedByParent', 'reported by the family')}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant={row.status === 'boarded' ? 'default' : 'outline'} onClick={() => { void mark(row, 'boarded') }}>
                          {t('student_transport.status.boarded', ATTENDANCE_STATUS_FALLBACKS.boarded)}
                        </Button>
                        <Button type="button" size="sm" variant={row.status === 'alighted' ? 'default' : 'outline'} onClick={() => { void mark(row, 'alighted') }}>
                          {t('student_transport.status.alighted', ATTENDANCE_STATUS_FALLBACKS.alighted)}
                        </Button>
                        <Button type="button" size="sm" variant={row.status === 'absent_notified' ? 'default' : 'outline'} onClick={() => { void mark(row, 'absent_notified') }}>
                          {t('student_transport.attendance.notifiedShort', 'Absent — reported')}
                        </Button>
                        <Button type="button" size="sm" variant={row.status === 'absent_unnotified' ? 'default' : 'outline'} onClick={() => { void mark(row, 'absent_unnotified') }}>
                          {t('student_transport.attendance.unnotifiedShort', 'Absent — no notice')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
