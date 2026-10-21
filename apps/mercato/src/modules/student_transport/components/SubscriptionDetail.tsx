"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ATTENDANCE_LEG_FALLBACKS,
  ATTENDANCE_STATUS_FALLBACKS,
  SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS,
  SUBSCRIPTION_DIRECTION_FALLBACKS,
  SUBSCRIPTION_STATUS_FALLBACKS,
} from '../lib/transportEnums'
import { customerNameOf, formatStudentAmount, formatStudentDate } from './studentOptions'
import { RESOURCE, type StudentSubscriptionRow } from './SubscriptionTable'

const ENTITY_ID = 'student_transport:student_subscription'
const DETAIL_MUTATION_CONTEXT_ID = 'student_transport.subscriptions.detail'
const SUBSCRIPTIONS_HREF = '/backend/education/subscriptions'

type HistoryRow = {
  id: string
  tripDate: string
  leg: string
  status: string
  origin: string
  notes: string | null
  recordedAt: string | null
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium text-foreground">{value}</span>
    </div>
  )
}

export default function SubscriptionDetail({ id }: { id: string }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: DETAIL_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const query = useQuery({
    queryKey: ['student-subscription-detail', id],
    queryFn: () => fetchCrudList<StudentSubscriptionRow>(RESOURCE, { ids: String(id), pageSize: 1 }),
  })
  const subscription = query.data?.items?.[0]

  const historyQuery = useQuery({
    queryKey: ['student-subscription-history', id],
    queryFn: async () => {
      const call = await apiCall<{ items?: HistoryRow[] }>(
        `/api/student_transport/attendance?mode=history&subscriptionId=${encodeURIComponent(id)}`,
      )
      return call.result?.items ?? []
    },
  })

  const runAction = React.useCallback(async (action: 'activate' | 'suspend' | 'end' | 'invoice') => {
    if (!subscription) return
    if (action === 'suspend' || action === 'end') {
      const confirmed = await confirm({
        title: action === 'end'
          ? t('student_transport.subscriptions.actions.end.confirm', 'End this subscription? No further attendance is recorded on it.')
          : t('student_transport.subscriptions.actions.suspend.confirm', 'Suspend this subscription?'),
        variant: action === 'end' ? 'destructive' : 'default',
      })
      if (!confirmed) return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(subscription.updatedAt ?? subscription.updated_at ?? null),
          () => apiCallOrThrow(`/api/student_transport/subscriptions/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: subscription.id }),
          }, { errorMessage: t('student_transport.errors.action_failed', 'The action could not be completed.') }),
        ),
        mutationPayload: { operation: `subscriptions.${action}`, id: subscription.id, updatedAt: subscription.updatedAt ?? null },
        context: { formId: DETAIL_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: subscription.id, retryLastMutation },
      })
      flash(t(`student_transport.subscriptions.actions.${action}.success`, 'Subscription updated.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('student_transport.errors.action_failed', 'The action could not be completed.'), 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, subscription, t])

  if (query.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('student_transport.subscriptions.detail.loading', 'Loading subscription…')} /></PageBody></Page>
  }
  if (query.isError) {
    return <Page><PageBody><ErrorMessage label={t('student_transport.subscriptions.detail.error', 'Could not load the subscription.')} /></PageBody></Page>
  }
  if (!subscription) {
    return (
      <Page><PageBody>
        <RecordNotFoundState
          label={t('student_transport.subscriptions.form.error.notFound', 'Subscription not found.')}
          backHref={SUBSCRIPTIONS_HREF}
          backLabel={t('student_transport.subscriptions.actions.backToList', 'Back to subscriptions')}
        />
      </PageBody></Page>
    )
  }

  const raw = subscription as unknown as Record<string, unknown>
  const statusLabel = t(`student_transport.status.${subscription.status}`, SUBSCRIPTION_STATUS_FALLBACKS[subscription.status] ?? subscription.status)
  const history = historyQuery.data ?? []

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">{subscription.student_name}</h1>
                <Badge variant="secondary">{statusLabel}</Badge>
                <Badge variant="secondary">
                  {t(`student_transport.account_type.${subscription.account_type}`, SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS[subscription.account_type] ?? subscription.account_type)}
                </Badge>
                <Badge variant="secondary">
                  {t(`student_transport.direction.${subscription.direction}`, SUBSCRIPTION_DIRECTION_FALLBACKS[subscription.direction] ?? subscription.direction)}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {subscription.subscription_number} ·{' '}
                {[formatStudentDate(subscription.start_date), formatStudentDate(subscription.end_date)].join(' → ')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {subscription.status !== 'ended' && (
                <Button asChild variant="outline">
                  <Link href={`${SUBSCRIPTIONS_HREF}/${subscription.id}/edit`}>{t('student_transport.subscriptions.actions.edit', 'Edit')}</Link>
                </Button>
              )}
              {(subscription.status === 'draft' || subscription.status === 'suspended') && (
                <Button type="button" onClick={() => { void runAction('activate') }}>
                  {t('student_transport.subscriptions.actions.activate.label', 'Activate')}
                </Button>
              )}
              {subscription.status === 'active' && (
                <Button type="button" variant="outline" onClick={() => { void runAction('suspend') }}>
                  {t('student_transport.subscriptions.actions.suspend.label', 'Suspend')}
                </Button>
              )}
              {subscription.status !== 'ended' && (
                <Button type="button" variant="outline" onClick={() => { void runAction('end') }}>
                  {t('student_transport.subscriptions.actions.end.label', 'End')}
                </Button>
              )}
              {(subscription.status === 'active' || subscription.status === 'ended') && (
                <Button type="button" onClick={() => { void runAction('invoice') }}>
                  {t('student_transport.subscriptions.actions.invoice.label', 'Invoice period')}
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DetailSection title={t('student_transport.subscriptions.detail.student', 'Student')}>
              <FieldRow label={t('student_transport.subscriptions.form.fields.studentGrade', 'Grade')} value={subscription.student_grade ?? '—'} />
              <FieldRow label={t('student_transport.subscriptions.form.fields.guardianName', 'Guardian')} value={String(raw.guardian_name ?? '—')} />
              <FieldRow label={t('student_transport.subscriptions.form.fields.guardianPhone', 'Guardian phone')} value={subscription.guardian_phone ?? '—'} />
              <FieldRow label={t('student_transport.subscriptions.form.fields.pickupPoint', 'Pickup point')} value={subscription.pickup_point ?? '—'} />
              <FieldRow label={t('student_transport.subscriptions.form.fields.dropoffPoint', 'Drop-off point')} value={subscription.dropoff_point ?? '—'} />
            </DetailSection>

            <DetailSection title={t('student_transport.subscriptions.detail.billing', 'Billing')}>
              <FieldRow label={t('student_transport.subscriptions.columns.payer', 'Billed to')} value={customerNameOf(subscription.customer_snapshot)} />
              <FieldRow label={t('student_transport.subscriptions.form.fields.school', 'School')} value={customerNameOf(subscription.school_snapshot)} />
              <FieldRow
                label={t('student_transport.subscriptions.form.fields.plan', 'Plan')}
                value={typeof raw.plan_snapshot === 'object' && raw.plan_snapshot
                  ? String((raw.plan_snapshot as Record<string, unknown>).name ?? '—')
                  : '—'}
              />
              <FieldRow
                label={t('student_transport.subscriptions.columns.price', 'Per period')}
                value={formatStudentAmount(subscription.period_price, subscription.currency_code)}
              />
            </DetailSection>
          </div>

          <DetailSection title={t('student_transport.subscriptions.detail.history', 'Boarding log')}>
            {historyQuery.isLoading ? (
              <LoadingMessage label={t('student_transport.subscriptions.detail.historyLoading', 'Loading the log…')} />
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('student_transport.subscriptions.detail.historyEmpty', 'No attendance recorded yet.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-start text-muted-foreground">
                      <th className="py-2 text-start font-medium">{t('student_transport.attendance.date', 'Date')}</th>
                      <th className="py-2 text-start font-medium">{t('student_transport.attendance.leg', 'Run')}</th>
                      <th className="py-2 text-start font-medium">{t('student_transport.attendance.status', 'Status')}</th>
                      <th className="py-2 text-start font-medium">{t('student_transport.subscriptions.detail.recordedBy', 'Recorded by')}</th>
                      <th className="py-2 text-start font-medium">{t('student_transport.subscriptions.form.fields.notes', 'Notes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/60">
                        <td className="py-2">{formatStudentDate(entry.tripDate)}</td>
                        <td className="py-2">
                          {t(`student_transport.leg.${entry.leg}`, ATTENDANCE_LEG_FALLBACKS[entry.leg] ?? entry.leg)}
                        </td>
                        <td className="py-2">
                          <Badge variant="secondary">
                            {t(`student_transport.status.${entry.status}`, ATTENDANCE_STATUS_FALLBACKS[entry.status] ?? entry.status)}
                          </Badge>
                        </td>
                        <td className="py-2">
                          {entry.origin === 'parent'
                            ? t('student_transport.subscriptions.detail.byParent', 'Family')
                            : t('student_transport.subscriptions.detail.byStaff', 'Staff')}
                        </td>
                        <td className="py-2">{entry.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DetailSection>

          {String(raw.notes ?? '').length ? (
            <DetailSection title={t('student_transport.subscriptions.form.fields.notes', 'Notes')}>
              <p className="whitespace-pre-wrap text-sm text-foreground">{String(raw.notes)}</p>
            </DetailSection>
          ) : null}
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
