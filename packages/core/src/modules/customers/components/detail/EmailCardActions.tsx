'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Users } from 'lucide-react'
import { EmailReplyForwardActions } from './EmailReplyForwardActions'
import {
  ComposeEmailDialog,
  type ComposeEmailChannel,
  type ComposeEmailValues,
} from './ComposeEmailDialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type EmailCardWidgetData = {
  interactionId?: string | null
  externalMessageId?: string | null
  rfcMessageId?: string | null
  personId?: string | null
  fromAddress?: string | null
  toAddresses?: string[] | null
  ccAddresses?: string[] | null
  subject?: string | null
  inReplyTo?: string | null
  references?: string[] | null
  /** Current visibility state of the email row, for toggling. */
  currentVisibility?: 'private' | 'shared' | null
  /** True when authorUserId === currentUserId. Drives whether the toggle renders. */
  isAuthor?: boolean | null
}

type ReplyMode = 'reply' | 'replyAll' | 'forward'

type EmailCardActionsProps = {
  data: EmailCardWidgetData
}

const PERSON_EMAIL_CARD_ACTIONS_CONTEXT_ID = 'customers-person-email-card-actions'

/**
 * Reply / Reply All / Forward (+ visibility toggle) actions for an email
 * activity card. Composed directly into `ActivityCard` — the customers module
 * owns the timeline, so this is built in place rather than self-injected (see
 * ARCHITECTURE.md §4 inject-vs-compose).
 */
export function EmailCardActions({ data }: EmailCardActionsProps) {
  const t = useT()
  const router = useRouter()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: PERSON_EMAIL_CARD_ACTIONS_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const personId = data.personId ?? null
  const rfcMessageId = data.rfcMessageId ?? null
  const fromAddress = data.fromAddress ?? null

  const [mode, setMode] = React.useState<ReplyMode | null>(null)
  const [channels, setChannels] = React.useState<ComposeEmailChannel[] | null>(null)

  React.useEffect(() => {
    let cancelled = false
    apiCall<{ items?: unknown[] }>('/api/communication_channels/me/channels', {
      method: 'GET',
      // Mount-time chrome fetch: degrade silently on an expired session.
      headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
    })
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

  const refreshTimeline = React.useCallback(() => {
    router.refresh()
  }, [router])

  // Event-driven refresh so a sent reply/forward surfaces on the activity
  // timeline once the worker links it, without a fixed-timer guess.
  useAppEvent('customers.email.linked', refreshTimeline, [refreshTimeline])
  useAppEvent('messages.message.sent', refreshTimeline, [refreshTimeline])

  // Return null when we have neither a person to send to nor an RFC message ID to thread against.
  // The buttons would be non-functional in that case.
  if (!personId || !rfcMessageId) return null

  // Channels still loading — render nothing to avoid a flash of disabled buttons.
  if (channels === null) return null

  const subjectBase = data.subject ?? ''
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
          references: Array.from(new Set([...(data.references ?? []), rfcMessageId])),
          to: mode === 'forward' ? [] : fromAddress ? [fromAddress] : [],
          cc: mode === 'replyAll' ? (data.ccAddresses ?? undefined) : undefined,
          subject: mode === 'forward' ? fwdSubject : reSubject,
        }

  const onSend = async (values: ComposeEmailValues): Promise<{ messageId: string | null }> => {
    const operation = async () => {
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
      return response.result?.messageId ?? null
    }
    const messageId = await runMutation({
      operation,
      context: {
        formId: PERSON_EMAIL_CARD_ACTIONS_CONTEXT_ID,
        resourceKind: 'customers.person',
        resourceId: personId,
        retryLastMutation,
      },
      mutationPayload: values as unknown as Record<string, unknown>,
    })
    flash(t('customers.email.compose.sent', 'Email sent'), 'success')
    return { messageId }
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
      {data.isAuthor === true && data.currentVisibility ? (
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={
            data.currentVisibility === 'private'
              ? t('customers.email.visibility.flipToShared.label', 'Share with teammates')
              : t('customers.email.visibility.flipToPrivate.label', 'Make private')
          }
          title={
            data.currentVisibility === 'private'
              ? t('customers.email.visibility.flipToShared.label', 'Share with teammates')
              : t('customers.email.visibility.flipToPrivate.label', 'Make private')
          }
          onClick={async (e) => {
            e.stopPropagation()
            const interactionId = data.interactionId
            if (!interactionId) return
            const next = data.currentVisibility === 'private' ? 'shared' : 'private'
            try {
              await runMutation({
                // optimistic-lock-exempt: dedicated single-field visibility
                // action endpoint (shared/private toggle), not a full-record
                // edit. The canonical interaction edit/delete is version-locked
                // at the command layer (customers.interactions.* commands); this
                // idempotent toggle derives `next` from freshly-loaded state.
                operation: async () => {
                  const r = await apiCall<{ ok?: boolean }>(
                    `/api/customers/interactions/${interactionId}/visibility`,
                    {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ visibility: next }),
                    },
                  )
                  if (!r.ok) {
                    const err = r.result as { error?: string } | null
                    throw new Error(
                      err?.error ?? t('customers.email.errors.flipFailed', 'Visibility update failed'),
                    )
                  }
                },
                context: {
                  formId: PERSON_EMAIL_CARD_ACTIONS_CONTEXT_ID,
                  resourceKind: 'customers.interaction',
                  resourceId: interactionId,
                  retryLastMutation,
                },
                mutationPayload: { visibility: next },
              })
            } catch (err) {
              flash(
                err instanceof Error
                  ? err.message
                  : t('customers.email.errors.flipFailed', 'Visibility update failed'),
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
            // Refresh the server tree so the activity timeline reflects the new
            // visibility without a full page reload (keeps scroll position).
            router.refresh()
          }}
        >
          {data.currentVisibility === 'private' ? (
            <Lock className="h-4 w-4" />
          ) : (
            <Users className="h-4 w-4" />
          )}
        </IconButton>
      ) : null}
      {mode != null && (
        <ComposeEmailDialog
          open={mode != null}
          onOpenChange={(open) => setMode(open ? mode : null)}
          defaultRecipient={fromAddress}
          channels={channels}
          replyTo={replyTo}
          onSend={onSend}
        />
      )}
    </>
  )
}

export default EmailCardActions
