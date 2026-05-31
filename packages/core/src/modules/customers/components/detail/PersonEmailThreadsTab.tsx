'use client'

import * as React from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmailThreadsPanel, type EmailThread } from '@open-mercato/ui/backend/messages'
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

type PersonEmailThreadsTabProps = {
  personId: string
  defaultRecipient?: string | null
}

const CONTEXT_ID = 'customers-person-email-threads'
const MAX_REFERENCES = 40
// Background heartbeat so inbound replies (fetched by the IMAP/push poll and
// linked asynchronously) surface without a manual page reload.
const BACKGROUND_POLL_MS = 20000
// After a send or a manual refresh, outbound delivery + CRM linking happen on a
// queue worker — poll more aggressively for a short window to catch the new
// message as soon as it lands, then fall back to the background heartbeat.
const BURST_INTERVAL_MS = 3000
const BURST_DURATION_MS = 36000

type ReplyState = {
  inReplyTo?: string
  references?: string[]
  to: string[]
  cc?: string[]
  subject: string
  parentMessageId?: string
} | null

/** Picks the external address to reply to: latest inbound sender, else a known participant. */
function resolveReplyRecipient(thread: EmailThread, fallback: string | null): string | null {
  for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
    const message = thread.messages[i]
    if (message.direction === 'inbound' && message.fromEmail) return message.fromEmail
  }
  return thread.participants[0] ?? fallback
}

function buildReplyState(thread: EmailThread, fallbackRecipient: string | null): ReplyState {
  const last = thread.messages[thread.messages.length - 1]
  if (!last) return null
  const recipient = resolveReplyRecipient(thread, fallbackRecipient)
  const references = Array.from(
    new Set([...(last.references ?? []), ...(last.rfcMessageId ? [last.rfcMessageId] : [])]),
  ).slice(-MAX_REFERENCES)
  const baseSubject = thread.subject ?? ''
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`.trim()
  return {
    inReplyTo: last.rfcMessageId ?? undefined,
    references: references.length > 0 ? references : undefined,
    to: recipient ? [recipient] : [],
    subject,
    parentMessageId: last.messageId ?? undefined,
  }
}

export function PersonEmailThreadsTab({ personId, defaultRecipient }: PersonEmailThreadsTabProps) {
  const t = useT()
  const [threads, setThreads] = React.useState<EmailThread[]>([])
  const [channels, setChannels] = React.useState<ComposeEmailChannel[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [replyTo, setReplyTo] = React.useState<ReplyState>(null)
  const burstTimer = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const channelsRef = React.useRef<ComposeEmailChannel[]>([])
  channelsRef.current = channels

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  // `showLoading` drives the panel spinner; background/burst polls run silently
  // so they never flicker the already-rendered thread list.
  const loadThreads = React.useCallback(
    async (opts?: { showLoading?: boolean }) => {
      if (opts?.showLoading) setLoading(true)
      try {
        const response = await apiCall<{ threads?: EmailThread[] }>(
          `/api/customers/people/${encodeURIComponent(personId)}/email-threads`,
          // Background poll: degrade silently on an expired session instead of
          // hijacking the whole page with a login redirect.
          { method: 'GET', headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } },
        )
        if (!response.ok) {
          const err = response.result as { error?: string } | null
          throw new Error(err?.error ?? t('customers.email.threads.loadFailed', 'Failed to load emails'))
        }
        setThreads(Array.isArray(response.result?.threads) ? response.result!.threads! : [])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('customers.email.threads.loadFailed', 'Failed to load emails'))
      } finally {
        if (opts?.showLoading) setLoading(false)
      }
    },
    [personId, t],
  )

  const loadChannels = React.useCallback(async () => {
    try {
      const response = await apiCall<{ items?: unknown[] }>(
        '/api/communication_channels/me/channels',
        { method: 'GET', headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } },
      )
      const items: unknown[] = Array.isArray(response.result?.items) ? response.result!.items! : []
      const connected = items.filter(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          (item as Record<string, unknown>).status === 'connected',
      ) as ComposeEmailChannel[]
      setChannels(connected)
    } catch {
      setChannels([])
    }
  }, [])

  // Poll every connected mailbox now (fetches new mail server-side). Inbound
  // ingest + CRM linking happen on workers, so callers should burst-poll after.
  const triggerSync = React.useCallback(async () => {
    await Promise.allSettled(
      channelsRef.current.map((channel) => {
        const channelId = (channel as { id?: string }).id
        if (!channelId) return Promise.resolve()
        return apiCall(
          `/api/communication_channels/channels/${encodeURIComponent(channelId)}/poll-now`,
          { method: 'POST', headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } },
        )
      }),
    )
  }, [])

  const startBurst = React.useCallback(() => {
    if (burstTimer.current) clearInterval(burstTimer.current)
    const startedAt = Date.now()
    burstTimer.current = setInterval(() => {
      if (Date.now() - startedAt > BURST_DURATION_MS) {
        if (burstTimer.current) {
          clearInterval(burstTimer.current)
          burstTimer.current = null
        }
        return
      }
      void loadThreads()
    }, BURST_INTERVAL_MS)
  }, [loadThreads])

  // Initial load.
  React.useEffect(() => {
    void loadThreads({ showLoading: true })
    void loadChannels()
  }, [loadThreads, loadChannels])

  // Background heartbeat — surfaces inbound replies without a page reload.
  React.useEffect(() => {
    const id = setInterval(() => { void loadThreads() }, BACKGROUND_POLL_MS)
    return () => clearInterval(id)
  }, [loadThreads])

  // Clean up the burst timer on unmount.
  React.useEffect(() => () => {
    if (burstTimer.current) clearInterval(burstTimer.current)
  }, [])

  // Bonus live refresh when the DOM event bridge delivers (best-effort; the
  // polling above is the reliable path).
  useAppEvent('customers.email.linked', () => { void loadThreads() }, [loadThreads])
  useAppEvent('messages.message.sent', () => { void loadThreads() }, [loadThreads])
  useAppEvent('communication_channels.message.received', () => { void loadThreads() }, [loadThreads])

  const onComposeNew = React.useCallback(() => {
    setReplyTo(null)
    setDialogOpen(true)
  }, [])

  const onReply = React.useCallback(
    (thread: EmailThread) => {
      setReplyTo(buildReplyState(thread, defaultRecipient ?? null))
      setDialogOpen(true)
    },
    [defaultRecipient],
  )

  const onSend = React.useCallback(
    async (values: ComposeEmailValues) => {
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
          formId: CONTEXT_ID,
          resourceKind: 'customers.person',
          resourceId: personId,
          retryLastMutation,
        },
        mutationPayload: values as unknown as Record<string, unknown>,
      })
      flash(t('customers.email.compose.sent', 'Email sent'), 'success')
      // Outbound delivery + CRM linking run on a worker; burst-poll until the
      // new message lands in its thread.
      startBurst()
      return { messageId }
    },
    [personId, runMutation, retryLastMutation, t, startBurst],
  )

  const onRefresh = React.useCallback(async () => {
    setLoading(true)
    try {
      await triggerSync()
      await loadThreads()
    } finally {
      setLoading(false)
    }
    startBurst()
  }, [triggerSync, loadThreads, startBurst])

  const canCompose = channels.length > 0

  const composeDisabledHint = (
    <Button asChild variant="outline" size="sm" className="gap-2">
      <Link href="/backend/profile/communication-channels">
        <Mail className="h-4 w-4" />
        {t('customers.email.compose.noChannel.cta', 'Connect your mailbox')}
      </Link>
    </Button>
  )

  return (
    <>
      <EmailThreadsPanel
        threads={threads}
        loading={loading}
        error={error}
        canCompose={canCompose}
        composeDisabledHint={composeDisabledHint}
        onComposeNew={onComposeNew}
        onReply={onReply}
        onRefresh={() => { void onRefresh() }}
      />
      <ComposeEmailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultRecipient={defaultRecipient}
        channels={channels}
        replyTo={replyTo}
        onSend={onSend}
      />
    </>
  )
}

export default PersonEmailThreadsTab
