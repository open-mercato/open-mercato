'use client'

import * as React from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  EmailThreadsPanel,
  mergeOptimisticEmailThreads,
  type EmailThread,
  type EmailThreadMessage,
  type EmailThreadMessageStatus,
} from '@open-mercato/ui/backend/messages'
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

/** A client-side outbound message shown immediately, before the worker confirms delivery. */
type OptimisticSend = {
  clientId: string
  threadKey: string
  /** Stored so a failed send can be retried with the same payload. */
  values: ComposeEmailValues
  message: EmailThreadMessage
}

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

/** Read the Open Mercato `messageId` off a delivery event payload, if present. */
function readEventMessageId(event: unknown): string | null {
  const payload = (event as { payload?: unknown } | undefined)?.payload
  const messageId = (payload as { messageId?: unknown } | undefined)?.messageId
  return typeof messageId === 'string' ? messageId : null
}

export function PersonEmailThreadsTab({ personId, defaultRecipient }: PersonEmailThreadsTabProps) {
  const t = useT()
  const [threads, setThreads] = React.useState<EmailThread[]>([])
  const [optimistic, setOptimistic] = React.useState<OptimisticSend[]>([])
  const [channels, setChannels] = React.useState<ComposeEmailChannel[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [replyTo, setReplyTo] = React.useState<ReplyState>(null)
  const burstTimer = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const channelsRef = React.useRef<ComposeEmailChannel[]>([])
  channelsRef.current = channels
  const optimisticRef = React.useRef<OptimisticSend[]>([])
  optimisticRef.current = optimistic

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

  // Build the optimistic message rendered immediately after a send, deriving the
  // sender address/provider from the channel the user composed from.
  const buildOptimisticMessage = React.useCallback(
    (
      clientId: string,
      messageId: string | null,
      values: ComposeEmailValues,
      status: EmailThreadMessageStatus,
    ): EmailThreadMessage => {
      const channel = channelsRef.current.find(
        (c) => (c as { id?: string }).id === values.userChannelId,
      ) as { externalIdentifier?: string | null; providerKey?: string | null } | undefined
      return {
        id: `optimistic:${clientId}`,
        messageId,
        rfcMessageId: null,
        references: values.references ?? [],
        direction: 'outbound',
        fromName: null,
        fromEmail: channel?.externalIdentifier ?? null,
        to: values.to,
        cc: values.cc ?? [],
        subject: values.subject,
        bodyText: values.body,
        sentAt: new Date().toISOString(),
        providerKey: channel?.providerKey ?? null,
        status,
      }
    },
    [],
  )

  // Wrap the send through the mutation guard so record-lock/conflict handling and
  // retry flows run; shared by the initial send and the failure-retry path.
  const sendEmail = React.useCallback(
    async (values: ComposeEmailValues): Promise<{ messageId: string | null; threadId: string | null }> => {
      const operation = async () => {
        const response = await apiCall<{ messageId?: string; threadId?: string }>(
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
        return {
          messageId: response.result?.messageId ?? null,
          threadId: response.result?.threadId ?? null,
        }
      }
      const result = await runMutation({
        operation,
        context: {
          formId: CONTEXT_ID,
          resourceKind: 'customers.person',
          resourceId: personId,
          retryLastMutation,
        },
        mutationPayload: values as unknown as Record<string, unknown>,
      })
      return result ?? { messageId: null, threadId: null }
    },
    [personId, runMutation, retryLastMutation, t],
  )

  const setMessageStatus = React.useCallback(
    (matcher: (entry: OptimisticSend) => boolean, patch: Partial<EmailThreadMessage>) => {
      setOptimistic((prev) =>
        prev.map((entry) =>
          matcher(entry) ? { ...entry, message: { ...entry.message, ...patch } } : entry,
        ),
      )
    },
    [],
  )

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

  // Drop optimistic placeholders once the server thread set includes the real,
  // linked message (deduped by messageId) so we never show it twice.
  React.useEffect(() => {
    setOptimistic((prev) => {
      if (prev.length === 0) return prev
      const serverIds = new Set<string>()
      for (const thread of threads) {
        for (const message of thread.messages) {
          if (message.messageId) serverIds.add(message.messageId)
        }
      }
      const next = prev.filter((entry) => !(entry.message.messageId && serverIds.has(entry.message.messageId)))
      return next.length === prev.length ? prev : next
    })
  }, [threads])

  // Live reconciliation via the DOM event bridge; polling above is the fallback.
  useAppEvent('customers.email.linked', () => { void loadThreads() }, [loadThreads])
  useAppEvent('messages.message.sent', () => { void loadThreads() }, [loadThreads])
  useAppEvent('communication_channels.message.received', () => { void loadThreads() }, [loadThreads])
  // Outbound delivery succeeded: flip the placeholder to "sent", then refetch so
  // the real linked message replaces it once the linking subscriber has run.
  useAppEvent(
    'communication_channels.message.sent',
    (event) => {
      const messageId = readEventMessageId(event)
      if (messageId) setMessageStatus((e) => e.message.messageId === messageId, { status: 'sent' })
      void loadThreads()
    },
    [setMessageStatus, loadThreads],
  )
  // Outbound delivery failed: surface the failure inline with a Retry affordance.
  useAppEvent(
    'communication_channels.message.delivery_failed',
    (event) => {
      const messageId = readEventMessageId(event)
      if (messageId) {
        setMessageStatus((e) => e.message.messageId === messageId, {
          status: 'failed',
          statusError: t('customers.email.errors.deliveryFailed', 'Delivery failed — not sent'),
        })
      }
    },
    [setMessageStatus, t],
  )

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
      const { messageId, threadId } = await sendEmail(values)
      flash(t('customers.email.compose.sent', 'Email sent'), 'success')
      // Show the message immediately in a "sending" state. It reconciles to
      // "sent" (or "failed" + Retry) via the delivery events above, and is
      // replaced by the server record once the worker links it. Requires a
      // messageId so reconciliation can dedupe; otherwise fall back to polling.
      if (messageId) {
        const clientId = crypto.randomUUID()
        const message = buildOptimisticMessage(clientId, messageId, values, 'sending')
        setOptimistic((prev) => [
          ...prev,
          { clientId, threadKey: threadId ?? `optimistic:${clientId}`, values, message },
        ])
      }
      startBurst()
      return { messageId }
    },
    [sendEmail, t, buildOptimisticMessage, startBurst],
  )

  const onRetry = React.useCallback(
    async (message: EmailThreadMessage) => {
      const entry = optimisticRef.current.find((e) => e.message.id === message.id)
      if (!entry) return
      setMessageStatus((e) => e.message.id === message.id, { status: 'sending', statusError: null })
      try {
        const { messageId } = await sendEmail(entry.values)
        // Re-point the placeholder at the new message id so reconciliation works.
        setMessageStatus((e) => e.message.id === message.id, { messageId, status: 'sending' })
        startBurst()
      } catch (err) {
        setMessageStatus((e) => e.message.id === message.id, {
          status: 'failed',
          statusError: err instanceof Error ? err.message : t('customers.email.errors.sendFailed', 'Send failed'),
        })
      }
    },
    [sendEmail, setMessageStatus, startBurst, t],
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

  const mergedThreads = React.useMemo(
    () =>
      mergeOptimisticEmailThreads(
        threads,
        optimistic.map((entry) => ({ ...entry.message, threadKey: entry.threadKey })),
      ),
    [threads, optimistic],
  )

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
        threads={mergedThreads}
        loading={loading}
        error={error}
        canCompose={canCompose}
        composeDisabledHint={composeDisabledHint}
        onComposeNew={onComposeNew}
        onReply={onReply}
        onRefresh={() => { void onRefresh() }}
        onRetry={(message) => { void onRetry(message) }}
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
