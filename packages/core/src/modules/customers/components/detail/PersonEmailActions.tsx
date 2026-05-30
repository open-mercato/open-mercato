'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Mail, RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ComposeEmailDialog,
  type ComposeEmailChannel,
  type ComposeEmailValues,
} from './ComposeEmailDialog'

type PersonEmailActionsProps = {
  personId: string
  personEmail: string | null
}

const PERSON_SEND_EMAIL_CONTEXT_ID = 'customers-person-send-email'

/**
 * Person detail "Sync" + "Send email" actions, composed directly into the
 * people-v2 header. The customers module owns this page, so these are built in
 * place rather than self-injected (see ARCHITECTURE.md §4 inject-vs-compose).
 */
export function PersonEmailActions({ personId, personEmail }: PersonEmailActionsProps) {
  const t = useT()
  const router = useRouter()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: PERSON_SEND_EMAIL_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [channels, setChannels] = React.useState<ComposeEmailChannel[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)

  const refreshTimeline = React.useCallback(() => {
    router.refresh()
  }, [router])

  // Event-driven refresh: the outbound-delivery worker + link-channel-message
  // subscriber emit these once the new interaction is persisted, so we refresh
  // the server tree when they fire instead of guessing with a fixed timer.
  useAppEvent('customers.email.linked', refreshTimeline, [refreshTimeline])
  useAppEvent('messages.message.sent', refreshTimeline, [refreshTimeline])
  useAppEvent('communication_channels.message.received', refreshTimeline, [refreshTimeline])

  React.useEffect(() => {
    let cancelled = false
    apiCall<{ items?: unknown[] }>(
      '/api/communication_channels/me/channels',
      { method: 'GET' },
    )
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

  if (!personId) return null
  if (channels === null) return null // loading — render nothing

  if (channels.length === 0) {
    return (
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link href="/backend/profile/communication-channels">
          <Mail className="h-4 w-4" />
          {t('customers.email.compose.noChannel.cta', 'Connect your mailbox')}
        </Link>
      </Button>
    )
  }

  const onSend = async (values: ComposeEmailValues) => {
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
        formId: PERSON_SEND_EMAIL_CONTEXT_ID,
        resourceKind: 'customers.person',
        resourceId: personId,
        retryLastMutation,
      },
      mutationPayload: values as unknown as Record<string, unknown>,
    })
    flash(t('customers.email.compose.sent', 'Email sent'), 'success')
    // The activity timeline refreshes via the `useAppEvent` subscriptions above
    // once the outbound-delivery worker links the new interaction.
    return { messageId }
  }

  const onSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      // Poll every connected channel the user owns. In practice this is one
      // mailbox (Gmail / Microsoft / IMAP), but we iterate so users with
      // multiple connected accounts get all inboxes refreshed at once.
      const operation = async () => {
        const results = await Promise.allSettled(
          channels.map((channel) => {
            const channelId = (channel as { id?: string }).id
            if (!channelId) return Promise.resolve({ ok: false })
            return apiCall(
              `/api/communication_channels/channels/${encodeURIComponent(channelId)}/poll-now`,
              { method: 'POST' },
            )
          }),
        )
        const anyOk = results.some(
          (r) => r.status === 'fulfilled' && (r.value as { ok?: boolean })?.ok !== false,
        )
        if (!anyOk) {
          throw new Error(t('customers.email.sync.failed', 'Failed to sync mailbox'))
        }
      }
      await runMutation({
        operation,
        context: {
          formId: PERSON_SEND_EMAIL_CONTEXT_ID,
          resourceKind: 'customers.person',
          resourceId: personId,
          retryLastMutation,
        },
      })
      flash(
        t(
          'customers.email.sync.success',
          'Sync triggered — new replies will appear in a few seconds.',
        ),
        'success',
      )
      // The activity timeline refreshes via the `useAppEvent` subscriptions
      // above once the poll worker ingests + links new inbound mail.
    } catch (err) {
      flash(
        err instanceof Error ? err.message : t('customers.email.sync.failed', 'Failed to sync mailbox'),
        'error',
      )
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={onSync}
        disabled={syncing}
        title={t('customers.email.sync.tooltip', 'Check your mailbox for new replies')}
      >
        <RefreshCw className={`h-4 w-4${syncing ? ' animate-spin' : ''}`} />
        {syncing
          ? t('customers.email.sync.syncing', 'Syncing...')
          : t('customers.email.sync.button', 'Sync')}
      </Button>
      <Button variant="default" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Mail className="h-4 w-4" />
        {t('customers.email.compose.button', 'Send email')}
      </Button>
      <ComposeEmailDialog
        open={open}
        onOpenChange={setOpen}
        personId={personId}
        defaultRecipient={personEmail}
        channels={channels}
        onSend={onSend}
      />
    </>
  )
}

export default PersonEmailActions
