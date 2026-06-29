'use client'

import * as React from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, Mail, RefreshCw, Reply, TriangleAlert } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Badge } from '../../primitives/badge'
import { Spinner } from '../../primitives/spinner'
import { Alert, AlertDescription } from '../../primitives/alert'
import { EmptyState } from '../EmptyState'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

export type EmailThreadDirection = 'inbound' | 'outbound'

/**
 * Optimistic delivery status for a just-sent outbound message. Server-confirmed
 * messages leave this `undefined` and render without a status indicator.
 */
export type EmailThreadMessageStatus = 'sending' | 'sent' | 'failed'

export type EmailThreadMessage = {
  id: string
  messageId: string | null
  rfcMessageId: string | null
  references: string[]
  direction: EmailThreadDirection
  fromName: string | null
  fromEmail: string | null
  to: string[]
  cc: string[]
  subject: string | null
  bodyText: string | null
  sentAt: string
  providerKey: string | null
  /** Optimistic send status; absent on server-confirmed messages. */
  status?: EmailThreadMessageStatus
  /** Human-readable failure reason shown when `status === 'failed'`. */
  statusError?: string | null
}

export type EmailThread = {
  threadKey: string
  subject: string | null
  preview: string | null
  participants: string[]
  lastMessageAt: string
  messageCount: number
  providerKey: string | null
  lastDirection: EmailThreadDirection
  messages: EmailThreadMessage[]
}

export type EmailThreadsPanelProps = {
  threads: EmailThread[]
  loading?: boolean
  error?: string | null
  /** When false, compose/reply controls are hidden and `composeDisabledHint` is shown. */
  canCompose?: boolean
  composeDisabledHint?: React.ReactNode
  onComposeNew?: () => void
  onReply?: (thread: EmailThread) => void
  onRefresh?: () => void
  /** Invoked when the user retries a message whose `status === 'failed'`. */
  onRetry?: (message: EmailThreadMessage) => void
  className?: string
}

function formatWhen(value: string): string {
  return formatDateTime(value) ?? value
}

/**
 * Entity-agnostic Gmail-style email thread viewer. The host supplies the
 * already-fetched threads plus compose/reply/refresh handlers; this component
 * owns only the master/detail layout, selection, and conversation rendering, so
 * it can be dropped onto the CRM Person page, a Company page, or any module.
 */
export function EmailThreadsPanel({
  threads,
  loading = false,
  error = null,
  canCompose = false,
  composeDisabledHint,
  onComposeNew,
  onReply,
  onRefresh,
  onRetry,
  className,
}: EmailThreadsPanelProps) {
  const t = useT()
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null)

  // Keep a valid selection as the thread set changes (refresh, new email).
  React.useEffect(() => {
    if (threads.length === 0) {
      setSelectedKey(null)
      return
    }
    setSelectedKey((current) =>
      current && threads.some((thread) => thread.threadKey === current)
        ? current
        : threads[0].threadKey,
    )
  }, [threads])

  const selected = React.useMemo(
    () => threads.find((thread) => thread.threadKey === selectedKey) ?? null,
    [threads, selectedKey],
  )

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {t('ui.email.threads.count', '{count} conversations', { count: threads.length })}
        </div>
        <div className="flex items-center gap-2">
          {onRefresh ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              {t('ui.email.threads.refresh', 'Refresh')}
            </Button>
          ) : null}
          {canCompose && onComposeNew ? (
            <Button type="button" size="sm" className="gap-2" onClick={onComposeNew}>
              <Mail className="h-4 w-4" />
              {t('ui.email.threads.new', 'New email')}
            </Button>
          ) : null}
        </div>
      </div>

      {!canCompose && composeDisabledHint ? <div>{composeDisabledHint}</div> : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && threads.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('ui.email.threads.loading', 'Loading conversations…')}
        </div>
      ) : threads.length === 0 ? (
        <EmptyState
          icon={<Mail className="h-6 w-6" />}
          title={t('ui.email.threads.empty.title', 'No emails yet')}
          description={t(
            'ui.email.threads.empty.description',
            'Emails you send or receive with this contact will appear here, grouped into conversations.',
          )}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {/* Master: thread list */}
          <div className="md:col-span-1">
            <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {threads.map((thread) => {
                const isSelected = thread.threadKey === selectedKey
                return (
                  <li key={thread.threadKey}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSelectedKey(thread.threadKey)}
                      className={cn(
                        'h-auto w-full flex-col items-stretch justify-start gap-1 whitespace-normal rounded-none p-3 text-left hover:bg-muted',
                        isSelected ? 'bg-muted' : 'bg-transparent',
                      )}
                      aria-current={isSelected}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {thread.subject || t('ui.email.threads.noSubject', '(no subject)')}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatWhen(thread.lastMessageAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {thread.participants.join(', ') ||
                            t('ui.email.threads.unknownParticipant', 'Unknown sender')}
                        </span>
                        <Badge variant="secondary" className="shrink-0">
                          {thread.messageCount}
                        </Badge>
                      </div>
                      {thread.preview ? (
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {thread.preview}
                        </span>
                      ) : null}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Detail: conversation */}
          <div className="md:col-span-2">
            {selected ? (
              <div className="flex flex-col gap-3 rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {selected.subject || t('ui.email.threads.noSubject', '(no subject)')}
                  </h3>
                  {canCompose && onReply ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-2"
                      onClick={() => onReply(selected)}
                    >
                      <Reply className="h-4 w-4" />
                      {t('ui.email.threads.reply', 'Reply')}
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-col gap-3">
                  {selected.messages.map((message) => (
                    <EmailMessageCard key={message.id} message={message} onRetry={onRetry} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-md border border-border p-10 text-sm text-muted-foreground">
                {t('ui.email.threads.selectPrompt', 'Select a conversation to read it.')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EmailMessageCard({
  message,
  onRetry,
}: {
  message: EmailThreadMessage
  onRetry?: (message: EmailThreadMessage) => void
}) {
  const t = useT()
  const isOutbound = message.direction === 'outbound'
  const fromLabel = message.fromName
    ? `${message.fromName}${message.fromEmail ? ` <${message.fromEmail}>` : ''}`
    : message.fromEmail ?? t('ui.email.threads.unknownParticipant', 'Unknown sender')
  return (
    <div
      className={`rounded-md border border-border p-3 ${isOutbound ? 'bg-accent' : 'bg-muted'}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isOutbound ? (
            <ArrowUpRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownLeft className="h-3.5 w-3.5" />
          )}
          <span className="font-medium text-foreground">
            {isOutbound ? t('ui.email.threads.you', 'You') : fromLabel}
          </span>
          {message.to.length > 0 ? (
            <span className="truncate">
              {t('ui.email.threads.toLabel', 'to {recipients}', {
                recipients: message.to.join(', '),
              })}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{formatWhen(message.sentAt)}</span>
      </div>
      <div className="whitespace-pre-wrap break-words text-sm text-foreground">
        {message.bodyText || t('ui.email.threads.noBody', '(no content)')}
      </div>
      <EmailMessageStatus message={message} onRetry={onRetry} />
    </div>
  )
}

/**
 * Renders the optimistic send-status footer for an outbound message: a spinner
 * while sending, a success check once confirmed, or an error with a Retry action
 * on delivery failure. Server-confirmed messages have no `status` and render
 * nothing here.
 */
function EmailMessageStatus({
  message,
  onRetry,
}: {
  message: EmailThreadMessage
  onRetry?: (message: EmailThreadMessage) => void
}) {
  const t = useT()
  if (message.status === 'sending') {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <Spinner className="h-3 w-3" />
        {t('ui.email.threads.status.sending', 'Sending…')}
      </div>
    )
  }
  if (message.status === 'sent') {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-status-success-text" aria-live="polite">
        <Check className="h-3.5 w-3.5 text-status-success-icon" />
        {t('ui.email.threads.status.sent', 'Sent')}
      </div>
    )
  }
  if (message.status === 'failed') {
    return (
      <div
        className="mt-2 flex flex-wrap items-center gap-2 text-xs text-status-error-text"
        aria-live="polite"
      >
        <span className="flex items-center gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 text-status-error-icon" />
          {message.statusError || t('ui.email.threads.status.failed', 'Not delivered')}
        </span>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto px-2 py-0.5 text-xs"
            onClick={() => onRetry(message)}
          >
            {t('ui.email.threads.status.retry', 'Retry')}
          </Button>
        ) : null}
      </div>
    )
  }
  return null
}

export default EmailThreadsPanel
