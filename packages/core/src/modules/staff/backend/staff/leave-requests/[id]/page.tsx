"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LeaveRequestForm, buildLeaveRequestPayload, type LeaveRequestFormValues } from '@open-mercato/core/modules/staff/components/LeaveRequestForm'

type LeaveRequestRecord = {
  id: string
  member?: { id?: string; displayName?: string }
  memberId?: string | null
  member_id?: string | null
  startDate?: string | null
  start_date?: string | null
  endDate?: string | null
  end_date?: string | null
  timezone?: string | null
  status?: 'pending' | 'approved' | 'rejected'
  unavailabilityReasonEntryId?: string | null
  unavailability_reason_entry_id?: string | null
  unavailabilityReasonValue?: string | null
  unavailability_reason_value?: string | null
  note?: string | null
  decisionComment?: string | null
  decision_comment?: string | null
  decidedAt?: string | null
  decided_at?: string | null
} & Record<string, unknown>

type LeaveRequestsResponse = {
  items?: LeaveRequestRecord[]
}

export default function StaffLeaveRequestDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<LeaveRequestRecord | null>(null)
  const [decisionComment, setDecisionComment] = React.useState('')

  React.useEffect(() => {
    if (!id) {
      setError(t('staff.leaveRequests.errors.notFound', 'Leave request not found.'))
      setIsLoading(false)
      return
    }
    const requestId = id
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: requestId })
        const payload = await readApiResultOrThrow<LeaveRequestsResponse>(
          `/api/staff/leave-requests?${params.toString()}`,
          undefined,
          { errorMessage: t('staff.leaveRequests.errors.load', 'Failed to load leave request.') },
        )
        const entry = Array.isArray(payload.items) ? payload.items[0] : null
        if (!entry) throw new Error(t('staff.leaveRequests.errors.notFound', 'Leave request not found.'))
        if (!cancelled) {
          setRecord(entry)
          setDecisionComment(
            typeof entry.decisionComment === 'string'
              ? entry.decisionComment
              : typeof entry.decision_comment === 'string'
                ? entry.decision_comment
                : ''
          )
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('staff.leaveRequests.errors.load', 'Failed to load leave request.')
          setError(message)
          setRecord(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id, t])

  const status = record?.status ?? 'pending'
  const memberLabel = record?.member?.displayName ?? null
  const dateSummary = formatDateRange(
    record?.startDate ?? record?.start_date ?? null,
    record?.endDate ?? record?.end_date ?? null,
  )
  const initialValues = React.useMemo<LeaveRequestFormValues>(() => ({
    id: record?.id,
    memberId: record?.memberId ?? record?.member_id ?? null,
    memberLabel,
    startDate: record?.startDate ?? record?.start_date ?? null,
    endDate: record?.endDate ?? record?.end_date ?? null,
    timezone: record?.timezone ?? null,
    unavailabilityReasonEntryId: record?.unavailabilityReasonEntryId ?? record?.unavailability_reason_entry_id ?? null,
    unavailabilityReasonValue: record?.unavailabilityReasonValue ?? record?.unavailability_reason_value ?? null,
    note: record?.note ?? null,
  }), [record, memberLabel])

  const messageContextPreview = React.useMemo(() => (
    <div className="space-y-1">
      <p className="font-medium">{t('staff.leaveRequests.messages.contextTitle', 'Linked leave request')}</p>
      {memberLabel ? (
        <p className="text-xs text-muted-foreground">
          {t('staff.leaveRequests.detail.member', 'Team member')}: {memberLabel}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t('staff.leaveRequests.detail.dates', 'Dates')}: {dateSummary}
      </p>
    </div>
  ), [dateSummary, memberLabel, t])

  const handleSubmit = React.useCallback(async (values: LeaveRequestFormValues) => {
    if (!record?.id) return
    const payload = buildLeaveRequestPayload(values, { id: record.id })
    await updateCrud('staff/leave-requests', payload, {
      errorMessage: t('staff.leaveRequests.form.errors.update', 'Failed to update leave request.'),
    })
    flash(t('staff.leaveRequests.form.flash.updated', 'Leave request updated.'), 'success')
    router.push('/backend/staff/leave-requests')
  }, [record?.id, router, t])

  const handleDecision = React.useCallback(async (action: 'accept' | 'reject') => {
    if (!record?.id) return
    const endpoint = action === 'accept' ? '/api/staff/leave-requests/accept' : '/api/staff/leave-requests/reject'
    await apiCallOrThrow(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: record.id, decisionComment: decisionComment || null }),
    })
    flash(
      action === 'accept'
        ? t('staff.leaveRequests.messages.accepted', 'Leave request approved.')
        : t('staff.leaveRequests.messages.rejected', 'Leave request rejected.'),
      'success',
    )
    router.refresh()
  }, [decisionComment, record?.id, router, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('staff.leaveRequests.form.loading', 'Loading leave request...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('staff.leaveRequests.errors.load', 'Failed to load leave request.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-6 space-y-2 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={resolveStatusVariant(status)}>
              {t(`staff.leaveRequests.status.${status}`, status)}
            </Badge>
            {record.decided_at || record.decidedAt ? (
              <span className="text-xs text-muted-foreground">
                {t('staff.leaveRequests.decision.at', 'Decision at')} {formatDateLabel(record.decidedAt ?? record.decided_at ?? null)}
              </span>
            ) : null}
          </div>
          {memberLabel ? (
            <p className="text-sm text-muted-foreground">
              {t('staff.leaveRequests.detail.member', 'Team member')}: {memberLabel}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {t('staff.leaveRequests.detail.dates', 'Dates')}: {dateSummary}
          </p>
        </div>

        {status === 'pending' ? (
          <div className="mb-6 rounded-lg border bg-card p-4">
            <div className="mb-3 text-sm font-medium">{t('staff.leaveRequests.decision.title', 'Decision')}</div>
            <Textarea
              value={decisionComment}
              onChange={(event) => setDecisionComment(event.target.value)}
              placeholder={t('staff.leaveRequests.decision.placeholder', 'Add a comment (optional)')}
              className="mb-3"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => handleDecision('accept')}>
                {t('staff.leaveRequests.actions.accept', 'Approve')}
              </Button>
              <Button variant="destructive" onClick={() => handleDecision('reject')}>
                {t('staff.leaveRequests.actions.reject', 'Reject')}
              </Button>
            </div>
          </div>
        ) : record.decisionComment || record.decision_comment ? (
          <div className="mb-6 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            <div className="mb-1 font-medium text-foreground">{t('staff.leaveRequests.decision.comment', 'Decision comment')}</div>
            <p>{record.decisionComment ?? record.decision_comment}</p>
          </div>
        ) : null}

        <LeaveRequestForm
          title={t('staff.leaveRequests.form.editTitle', 'Leave request')}
          submitLabel={t('staff.leaveRequests.form.actions.save', 'Save')}
          backHref="/backend/staff/leave-requests"
          cancelHref="/backend/staff/leave-requests"
          initialValues={initialValues}
          onSubmit={handleSubmit}
          allowMemberSelect
          memberLabel={memberLabel}
          extraActions={record.id ? (
            <SendObjectMessageDialog
              object={{
                entityModule: 'staff',
                entityType: 'leave_request',
                entityId: record.id,
                sourceEntityType: 'staff:leave_request',
                sourceEntityId: record.id,
              }}
              lockedType="staff.leave_request_approval"
              requiredActionConfig={{
                mode: 'required',
                options: [
                  { id: 'approve', label: t('staff.notifications.leaveRequest.actions.approve', 'Approve') },
                  { id: 'reject', label: t('staff.notifications.leaveRequest.actions.reject', 'Reject') },
                ],
              }}
              defaultValues={{
                type: 'staff.leave_request_approval',
                subject: t('staff.leaveRequests.messages.compose.subject', 'Leave request approval needed'),
                body: t('staff.leaveRequests.messages.compose.body', 'Please review this leave request and take action.'),
              }}
              contextPreview={messageContextPreview}
              renderTrigger={({ openComposer, disabled }) => (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={openComposer}
                  disabled={disabled}
                  aria-label={t('staff.leaveRequests.messages.compose.action', 'Send for review')}
                  title={t('staff.leaveRequests.messages.compose.action', 'Send for review')}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            />
          ) : null}
        />
      </PageBody>
    </Page>
  )
}

function resolveStatusVariant(status: 'pending' | 'approved' | 'rejected') {
  if (status === 'approved') return 'default'
  if (status === 'rejected') return 'destructive'
  return 'secondary'
}

function formatDateLabel(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

function formatDateRange(start?: string | null, end?: string | null): string {
  const startLabel = formatDateLabel(start)
  const endLabel = formatDateLabel(end)
  if (startLabel && endLabel) return `${startLabel} -> ${endLabel}`
  return startLabel || endLabel || '-'
}
