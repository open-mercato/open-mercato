"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
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
import { customerNameOf, formatStudentAmount } from './studentOptions'

const CONTEXT_ID = 'student_transport.children.absence'
const ENTITY_ID = 'student_transport:student_trip_attendance'

export type ChildLeg = { leg: string; status: string | null; origin: string | null; recordedAt: string | null }

export type ChildRow = {
  subscriptionId: string
  subscriptionNumber: string
  studentName: string
  studentGrade: string | null
  accountType: string
  direction: string
  status: string
  guardianName: string | null
  guardianPhone: string | null
  pickupPoint: string | null
  dropoffPoint: string | null
  periodPrice: string
  currencyCode: string
  payer: Record<string, unknown> | null
  school: Record<string, unknown> | null
  legs: ChildLeg[]
}

/**
 * The family's view.
 *
 * Every child the signed-in family is linked to — whether they pay directly or
 * their school is billed — with today's boarding state per leg, and the one
 * action a parent needs before the run: telling the office the child will not
 * ride. The absence is recorded through the same attendance endpoint the driver
 * board uses, so the two views can never disagree.
 */
export default function ParentChildren() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [tripDate, setTripDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [absenceTarget, setAbsenceTarget] = React.useState<{ row: ChildRow; leg: string } | null>(null)
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const query = useQuery({
    queryKey: ['student-children', tripDate, scopeVersion],
    queryFn: async () => {
      const call = await apiCall<{ items?: ChildRow[] }>(`/api/student_transport/children?tripDate=${encodeURIComponent(tripDate)}`)
      return call.result?.items ?? []
    },
  })

  const reportAbsence = React.useCallback(async () => {
    if (!absenceTarget) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => apiCallOrThrow('/api/student_transport/attendance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: absenceTarget.row.subscriptionId,
            tripDate,
            leg: absenceTarget.leg,
            status: 'absent_notified',
            origin: 'parent',
            ...(note.trim() ? { notes: note.trim() } : {}),
          }),
        }, { errorMessage: t('student_transport.errors.attendance_failed', 'Unable to record the attendance.') }),
        mutationPayload: { operation: 'attendance.record', subscriptionId: absenceTarget.row.subscriptionId, leg: absenceTarget.leg },
        context: { formId: CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: absenceTarget.row.subscriptionId, retryLastMutation },
      })
      flash(t('student_transport.children.absenceSaved', 'The office has been told — thank you.'), 'success')
      setAbsenceTarget(null)
      setNote('')
      await query.refetch()
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('student_transport.errors.attendance_failed', 'Unable to record the attendance.'))
    }
  }, [absenceTarget, note, query, retryLastMutation, runMutation, t, tripDate])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void reportAbsence() },
    onCancel: () => setAbsenceTarget(null),
  })

  if (query.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('student_transport.children.loading', 'Loading your children…')} /></PageBody></Page>
  }

  const children = query.data ?? []

  return (
    <Page>
      <PageBody>
        <PageHeader
          title={t('student_transport.children.title', 'My children')}
          description={t('student_transport.children.description', 'Today’s transport for every child linked to this account — and a way to tell the office a child will not ride.')}
        />

        <div className="flex flex-wrap items-end gap-3 pb-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('student_transport.attendance.date', 'Date')}</span>
            <Input type="date" value={tripDate} onChange={(event) => setTripDate(event.target.value)} />
          </label>
        </div>

        {query.isError ? (
          <p className="text-sm text-destructive">{t('student_transport.children.error', 'Could not load the children.')}</p>
        ) : children.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('student_transport.children.empty', 'No active subscriptions are linked to this account.')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {children.map((child) => (
              <section key={child.subscriptionId} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-base font-semibold text-foreground">{child.studentName}</span>
                    <span className="text-xs text-muted-foreground">
                      {[child.studentGrade, child.subscriptionNumber].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <Badge variant="secondary">
                    {child.accountType === 'b2b'
                      ? t('student_transport.children.schoolBilled', 'Billed to the school')
                      : t('student_transport.children.parentBilled', 'Billed to you')}
                  </Badge>
                </div>

                <div className="flex flex-col gap-2">
                  {child.legs.map((entry) => (
                    <div key={entry.leg} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="text-sm font-medium">
                          {t(`student_transport.leg.${entry.leg}`, ATTENDANCE_LEG_FALLBACKS[entry.leg] ?? entry.leg)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {entry.leg === 'pickup' ? (child.pickupPoint ?? '—') : (child.dropoffPoint ?? '—')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {entry.status
                            ? t(`student_transport.status.${entry.status}`, ATTENDANCE_STATUS_FALLBACKS[entry.status] ?? entry.status)
                            : t('student_transport.attendance.unmarked', 'Not marked')}
                        </Badge>
                        {entry.status === null || entry.status === 'absent_unnotified' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setNote('')
                              setError(null)
                              setAbsenceTarget({ row: child, leg: entry.leg })
                            }}
                          >
                            {t('student_transport.children.reportAbsence', 'No ride today')}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted-foreground">
                  <span>
                    {t('student_transport.children.paidBy', 'Paid by: {name}', { name: customerNameOf(child.payer) })}
                    {child.school ? ` · ${customerNameOf(child.school)}` : ''}
                  </span>
                  <span>
                    {t('student_transport.children.periodPrice', 'Subscription: {amount} per period', {
                      amount: formatStudentAmount(child.periodPrice, child.currencyCode),
                    })}
                  </span>
                  {child.guardianPhone ? <span>{child.guardianPhone}</span> : null}
                </div>
              </section>
            ))}
          </div>
        )}

        <Dialog open={absenceTarget !== null} onOpenChange={(open) => { if (!open) setAbsenceTarget(null) }}>
          <DialogContent onKeyDown={handleKeyDown}>
            <DialogHeader>
              <DialogTitle>{t('student_transport.children.absenceTitle', 'Tell the office about an absence')}</DialogTitle>
              <DialogDescription>
                {t('student_transport.children.absenceDescription', '{student} will not ride the {leg} run on {date}.', {
                  student: absenceTarget?.row.studentName ?? '',
                  leg: absenceTarget ? t(`student_transport.leg.${absenceTarget.leg}`, ATTENDANCE_LEG_FALLBACKS[absenceTarget.leg] ?? absenceTarget.leg) : '',
                  date: tripDate,
                })}
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('student_transport.children.absenceNote', 'Note (optional)')}</span>
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
            </label>
            {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAbsenceTarget(null)}>
                {t('student_transport.children.cancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={() => { void reportAbsence() }}>
                {t('student_transport.children.confirmAbsence', 'Report the absence')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}
