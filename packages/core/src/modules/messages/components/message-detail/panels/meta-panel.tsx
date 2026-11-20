"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { MessageDetail, MessageDetailExternalParticipant } from '../types'
import { toErrorMessage } from '../utils'

type DeliveryStatus = NonNullable<MessageDetailExternalParticipant['deliveryStatus']>

const DELIVERY_WINDOW_EXCEEDED_ERROR = 'delivery window exceeded'

const deliveryStatusVariants: Record<DeliveryStatus, StatusBadgeVariant> = {
  pending: 'neutral',
  sent: 'success',
  failed: 'error',
}

function deliveryErrorLabel(t: ReturnType<typeof useT>, error: string | null): string | null {
  return error === DELIVERY_WINDOW_EXCEEDED_ERROR
    ? t('messages.detail.deliveryError.windowExceeded', 'Delivery attempts stopped after the retry window')
    : error
}

function participantLabel(participant: MessageDetailExternalParticipant): string {
  return participant.name ? `${participant.name} <${participant.email}>` : participant.email
}

function FailedDeliveryAlert({
  detail,
  failed,
  onResent,
}: {
  detail: MessageDetail
  failed: MessageDetailExternalParticipant[]
  onResent?: () => unknown
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'messages-detail-resend-failed',
  })
  const [resending, setResending] = React.useState(false)

  const resend = async () => {
    const confirmed = await confirm({
      title: t('messages.detail.resendFailed.confirmTitle', 'Resend to {count} addresses?', { count: failed.length }),
      description: t(
        'messages.detail.resendFailed.confirmDescription',
        'A new message with the same subject and content is sent to the addresses that did not receive it.',
      ),
      confirmText: t('messages.actions.resendFailed', 'Resend to failed'),
    })
    if (!confirmed) return
    setResending(true)
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall<{ id?: string }>(`/api/messages/${encodeURIComponent(detail.id)}/resend-failed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participantIds: failed.map((participant) => participant.id) }),
          })
          if (!call.ok) {
            throw new Error(toErrorMessage(call.result) ?? t('messages.errors.resendFailed', 'Failed to resend the message.'))
          }
        },
        context: { resourceKind: 'message', messageId: detail.id, action: 'resend-failed', retryLastMutation },
        mutationPayload: { messageId: detail.id, action: 'resend-failed' },
      })
      flash(t('messages.flash.resendFailedSuccess', 'Message resent to the failed addresses.'), 'success')
      await onResent?.()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('messages.errors.resendFailed', 'Failed to resend the message.'), 'error')
    } finally {
      setResending(false)
    }
  }

  return (
    <Alert
      status="warning"
      footer={detail.canResendFailed ? (
        <Button type="button" size="sm" variant="outline" disabled={resending} onClick={() => void resend()}>
          {t('messages.actions.resendFailed', 'Resend to failed')}
        </Button>
      ) : undefined}
    >
      <AlertTitle>{t('messages.detail.failedAddresses', 'Not delivered to {count} addresses', { count: failed.length })}</AlertTitle>
      <AlertDescription>
        <ul className="space-y-1">
          {failed.map((participant) => (
            <li key={participant.id} className="break-all">
              {participantLabel(participant)}
              {participant.deliveryError ? <span className="text-muted-foreground"> — {deliveryErrorLabel(t, participant.deliveryError)}</span> : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
      {ConfirmDialogElement}
    </Alert>
  )
}

export function MessageDetailMetaSection({
  detail,
  onResent,
}: {
  detail: MessageDetail
  onResent?: () => unknown
}) {
  const t = useT()
  const outboundParticipants = (detail.externalParticipants ?? []).filter(
    (participant) => participant.deliveryStatus !== null,
  )
  const failedParticipants = outboundParticipants.filter((participant) => participant.deliveryStatus === 'failed')
  const deliveryStatusLabels: Record<DeliveryStatus, string> = {
    pending: t('messages.detail.deliveryStatus.pending', 'Pending'),
    sent: t('messages.detail.deliveryStatus.sent', 'Sent'),
    failed: t('messages.detail.deliveryStatus.failed', 'Failed'),
  }

  if (outboundParticipants.length > 0) {
    return (
      <div className="space-y-3">
        {failedParticipants.length > 0 ? (
          <FailedDeliveryAlert detail={detail} failed={failedParticipants} onResent={onResent} />
        ) : null}
        <div className="space-y-2 rounded border p-3 text-sm">
          <p className="font-medium">{t('messages.detail.participants', 'Recipients')}</p>
          <ul className="space-y-1">
            {outboundParticipants.map((participant) => {
              const status = participant.deliveryStatus ?? 'pending'
              return (
                <li key={participant.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="break-all">{participantLabel(participant)}</span>
                  <StatusBadge variant={deliveryStatusVariants[status]} dot>
                    <span title={deliveryErrorLabel(t, participant.deliveryError) ?? undefined}>{deliveryStatusLabels[status]}</span>
                  </StatusBadge>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {detail.externalEmail ? (
        <div className="space-y-1 rounded border p-3 text-sm">
          <p className="font-medium">{t('messages.externalEmail', 'External email')}</p>
          <p>{detail.externalEmail}</p>
        </div>
      ) : null}
    </div>
  )
}
