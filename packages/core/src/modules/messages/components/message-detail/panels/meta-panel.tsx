"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { MessageDetail, MessageDetailExternalParticipant } from '../types'

type DeliveryStatus = NonNullable<MessageDetailExternalParticipant['deliveryStatus']>

const deliveryStatusVariants: Record<DeliveryStatus, StatusBadgeVariant> = {
  pending: 'neutral',
  sent: 'success',
  failed: 'error',
}

export function MessageDetailMetaSection({ detail }: { detail: MessageDetail }) {
  const t = useT()
  const outboundParticipants = (detail.externalParticipants ?? []).filter(
    (participant) => participant.deliveryStatus !== null,
  )
  const deliveryStatusLabels: Record<DeliveryStatus, string> = {
    pending: t('messages.detail.deliveryStatus.pending', 'Pending'),
    sent: t('messages.detail.deliveryStatus.sent', 'Sent'),
    failed: t('messages.detail.deliveryStatus.failed', 'Failed'),
  }

  if (outboundParticipants.length > 0) {
    return (
      <div className="space-y-2 rounded border p-3 text-sm">
        <p className="font-medium">{t('messages.detail.participants', 'Recipients')}</p>
        <ul className="space-y-1">
          {outboundParticipants.map((participant) => {
            const status = participant.deliveryStatus ?? 'pending'
            return (
              <li key={participant.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="break-all">{participant.name ? `${participant.name} <${participant.email}>` : participant.email}</span>
                <StatusBadge variant={deliveryStatusVariants[status]} dot>
                  <span title={participant.deliveryError ?? undefined}>{deliveryStatusLabels[status]}</span>
                </StatusBadge>
              </li>
            )
          })}
        </ul>
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
