'use client'

import * as React from 'react'
import { Lock, Users } from 'lucide-react'
import { EmailReplyForwardActions } from '../../../components/detail/EmailReplyForwardActions'
import {
  ComposeEmailDialog,
  type ComposeEmailChannel,
  type ComposeEmailValues,
} from '../../../components/detail/ComposeEmailDialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { EmailCardWidgetData } from './widget'

type ReplyMode = 'reply' | 'replyAll' | 'forward'

type WidgetProps = {
  data?: EmailCardWidgetData
  context?: Record<string, unknown> & { data?: EmailCardWidgetData }
}

export function PersonEmailCardActionsWidget({ data, context }: WidgetProps) {
  const t = useT()

  // Merge data from both the `data` prop (set by InjectionSpot) and `context.data`
  // following the same pattern as person-send-email widget.
  const eff: EmailCardWidgetData = { ...(context?.data ?? {}), ...(data ?? {}) }

  const personId = eff.personId ?? null
  const rfcMessageId = eff.rfcMessageId ?? null
  const fromAddress = eff.fromAddress ?? null

  const [mode, setMode] = React.useState<ReplyMode | null>(null)
  const [channels, setChannels] = React.useState<ComposeEmailChannel[] | null>(null)

  React.useEffect(() => {
    let cancelled = false
    apiCall<{ items?: unknown[] }>('/api/communication_channels/me/channels', { method: 'GET' })
      .then((r) => {
        if (cancelled) return
        const allItems: unknown[] = Array.isArray(r.result?.items) ? r.result!.items! : []
        const connected = allItems.filter(
          (item) =>
            item !== null &&
            typeof item === 'object' &&
            (item as Record<string, unknown>).status === 'connected',
        ) as ComposeEmailChannel[]
        setChannels(connected)
      })
      .catch(() => {
        if (!cancelled) setChannels([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Return null when we have neither a person to send to nor an RFC message ID to thread against.
  // The buttons would be non-functional in that case.
  if (!personId || !rfcMessageId) return null

  // Channels still loading — render nothing to avoid a flash of disabled buttons.
  if (channels === null) return null

  const subjectBase = eff.subject ?? ''
  const reSubject = subjectBase.toLowerCase().startsWith('re:')
    ? subjectBase
    : `Re: ${subjectBase}`.trim()
  const fwdSubject = subjectBase.toLowerCase().startsWith('fwd:')
    ? subjectBase
    : `Fwd: ${subjectBase}`.trim()

  const replyTo =
    mode == null
      ? null
      : {
          inReplyTo: rfcMessageId,
          references: Array.from(new Set([...(eff.references ?? []), rfcMessageId])),
          to: mode === 'forward' ? [] : fromAddress ? [fromAddress] : [],
          cc: mode === 'replyAll' ? (eff.ccAddresses ?? undefined) : undefined,
          subject: mode === 'forward' ? fwdSubject : reSubject,
        }

  const onSend = async (values: ComposeEmailValues): Promise<{ messageId: string | null }> => {
    const response = await apiCall<{ messageId?: string }>(
      `/api/customers/people/${encodeURIComponent(personId)}/emails`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      },
    )
    if (!response.ok) {
      const err = response.result as { error?: string } | null
      throw new Error(err?.error ?? t('customers.email.errors.sendFailed', 'Send failed'))
    }
    flash(t('customers.email.compose.sent', 'Email sent'), 'success')
    return { messageId: response.result?.messageId ?? null }
  }

  const noChannels = channels.length === 0

  return (
    <>
      <EmailReplyForwardActions
        onReply={() => setMode('reply')}
        onReplyAll={() => setMode('replyAll')}
        onForward={() => setMode('forward')}
        disabled={noChannels}
      />
      {eff.isAuthor === true && eff.currentVisibility ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            eff.currentVisibility === 'private'
              ? t('customers.email.visibility.flipToShared.label', 'Share with teammates')
              : t('customers.email.visibility.flipToPrivate.label', 'Make private')
          }
          title={
            eff.currentVisibility === 'private'
              ? t('customers.email.visibility.flipToShared.label', 'Share with teammates')
              : t('customers.email.visibility.flipToPrivate.label', 'Make private')
          }
          onClick={async (e) => {
            e.stopPropagation()
            if (!eff.interactionId) return
            const next = eff.currentVisibility === 'private' ? 'shared' : 'private'
            const r = await apiCall<{ ok?: boolean }>(
              `/api/customers/interactions/${eff.interactionId}/visibility`,
              {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ visibility: next }),
              },
            )
            if (!r.ok) {
              const err = r.result as { error?: string } | null
              flash(
                err?.error ?? t('customers.email.errors.flipFailed', 'Visibility update failed'),
                'error',
              )
              return
            }
            flash(
              next === 'shared'
                ? t('customers.email.visibility.flipToShared.success', 'Email shared with teammates')
                : t('customers.email.visibility.flipToPrivate.success', 'Email made private'),
              'success',
            )
            // Hard reload to reflect the visibility change in the activity timeline.
            // v1 pragmatic choice: plumbing a refresh callback from the host widget
            // injection context would add significant scope. Revisit when the
            // ActivityHistorySection exposes a refresh mechanism.
            if (typeof window !== 'undefined') window.location.reload()
          }}
        >
          {eff.currentVisibility === 'private' ? (
            <Lock className="h-4 w-4" />
          ) : (
            <Users className="h-4 w-4" />
          )}
        </Button>
      ) : null}
      {mode != null && (
        <ComposeEmailDialog
          open={mode != null}
          onOpenChange={(open) => setMode(open ? mode : null)}
          personId={personId}
          defaultRecipient={fromAddress}
          channels={channels}
          replyTo={replyTo}
          onSend={onSend}
        />
      )}
    </>
  )
}

export default PersonEmailCardActionsWidget
