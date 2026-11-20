"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ScheduleSendDialog } from '@open-mercato/ui/backend/messages'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { MessageDetail } from '../types'
import { toErrorMessage } from '../utils'

type ScheduleAction = 'reschedule' | 'cancel-schedule' | 'send-now'

type ComposeCapabilities = { schedulingAvailable?: boolean; scheduleMaxDays?: number }

export function MessageDetailScheduledAlert({
  detail,
  onEdit,
  onChanged,
}: {
  detail: MessageDetail
  onEdit: () => void
  onChanged: () => unknown
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'messages-detail-scheduled-send',
  })
  const [pending, setPending] = React.useState<ScheduleAction | null>(null)
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false)
  const [capabilities, setCapabilities] = React.useState<ComposeCapabilities | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void apiCall<ComposeCapabilities>('/api/messages/compose-capabilities', {
      method: 'GET',
      headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
    }).then((response) => {
      if (!cancelled && response.ok) setCapabilities(response.result ?? null)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const scheduledAt = detail.scheduledAt ? new Date(detail.scheduledAt) : null
  const canChangeTime = capabilities?.schedulingAvailable === true && (capabilities.scheduleMaxDays ?? 0) > 0

  const patch = async (action: ScheduleAction, body: Record<string, unknown>, successMessage: string) => {
    setPending(action)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(detail.updatedAt), async () => {
          const call = await apiCall<{ ok?: boolean }>(`/api/messages/${encodeURIComponent(detail.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!call.ok) {
            throw Object.assign(
              new Error(toErrorMessage(call.result) ?? t('messages.errors.scheduleFailed', 'Failed to update the schedule.')),
              { status: call.status, ...(call.result && typeof call.result === 'object' ? call.result : {}) },
            )
          }
        }),
        context: { resourceKind: 'message', messageId: detail.id, action, retryLastMutation },
        mutationPayload: { messageId: detail.id, action, ...body },
      })
      flash(successMessage, 'success')
      await onChanged()
    } catch (error) {
      if (surfaceRecordConflict(error, t)) return
      flash(error instanceof Error ? error.message : t('messages.errors.scheduleFailed', 'Failed to update the schedule.'), 'error')
    } finally {
      setPending(null)
    }
  }

  const cancelSchedule = async () => {
    const confirmed = await confirm({
      title: t('messages.confirm.cancelScheduleTitle', 'Cancel the scheduled send?'),
      text: t('messages.confirm.cancelSchedule', 'The message will not be sent and goes back to your drafts.'),
      confirmText: t('messages.actions.cancelSchedule', 'Cancel schedule'),
      cancelText: t('common.cancel', 'Cancel'),
    })
    if (!confirmed) return
    await patch('cancel-schedule', { scheduledAt: null }, t('messages.flash.scheduleCancelled', 'Schedule cancelled. The message is back in drafts.'))
  }

  const busy = pending !== null

  return (
    <Alert
      status="information"
      footer={detail.canEditDraft ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onEdit}>
            {t('messages.actions.edit', 'Edit')}
          </Button>
          {canChangeTime ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setRescheduleOpen(true)}>
              {t('messages.actions.changeTime', 'Change time')}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void cancelSchedule()}>
            {t('messages.actions.cancelSchedule', 'Cancel schedule')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void patch('send-now', { scheduledAt: null, isDraft: false }, t('messages.flash.sentSuccess', 'Message sent.'))}
          >
            {t('messages.actions.sendNow', 'Send now')}
          </Button>
        </div>
      ) : undefined}
    >
      <AlertTitle>
        {t('messages.detail.scheduledFor', 'Scheduled for {date}', { date: scheduledAt ? scheduledAt.toLocaleString() : '—' })}
      </AlertTitle>
      <AlertDescription>
        {t('messages.compose.scheduleDescription', 'The message is sent automatically at the chosen time. You can edit or cancel it until then.')}
      </AlertDescription>
      {canChangeTime ? (
        <ScheduleSendDialog
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          maxDays={capabilities?.scheduleMaxDays ?? 0}
          initialValue={scheduledAt}
          submitting={busy}
          onConfirm={async (nextScheduledAt) => {
            setRescheduleOpen(false)
            await patch('reschedule', { scheduledAt: nextScheduledAt }, t('messages.flash.scheduledSuccess', 'Message scheduled.'))
          }}
        />
      ) : null}
      {ConfirmDialogElement}
    </Alert>
  )
}
