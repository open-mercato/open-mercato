"use client"

import { useQuery } from '@tanstack/react-query'
import type { MessageContentProps } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { PriorityBadge } from './PriorityBadge'

type MessageConfirmationResult = {
  messageId: string
  confirmed: boolean
  confirmedAt: string | null
  confirmedByUserId: string | null
}

function toErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = toErrorMessage(item)
      if (nested) return nested
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      toErrorMessage(record.error)
      ?? toErrorMessage(record.message)
      ?? toErrorMessage(record.detail)
      ?? null
    )
  }
  return null
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export function MessageConfirmationContent({ message }: MessageContentProps) {
  const t = useT()

  const confirmationQuery = useQuery({
    queryKey: ['messages', 'confirmation', message.id],
    queryFn: async () => {
      const call = await apiCall<MessageConfirmationResult>(`/api/messages/${encodeURIComponent(message.id)}/confirmation`)
      if (!call.ok || !call.result) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.loadDetailFailed', 'Failed to load message details.'),
        )
      }
      return call.result
    },
    enabled: Boolean(message.id),
  })

  const confirmation = confirmationQuery.data

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <PriorityBadge priority={message.priority} />
      </div>
      <div className="text-sm whitespace-pre-wrap">{message.body}</div>
      <div className="rounded border p-3 text-sm">
        <p className="font-medium">
          {confirmation?.confirmed
            ? t('messages.confirmation.confirmed', 'Confirmed')
            : t('messages.confirmation.notConfirmed', 'Not confirmed')}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('messages.confirmation.confirmedAt', 'Confirmed at')}: {formatDateTime(confirmation?.confirmedAt ?? null)}
        </p>
      </div>
    </div>
  )
}

export default MessageConfirmationContent
