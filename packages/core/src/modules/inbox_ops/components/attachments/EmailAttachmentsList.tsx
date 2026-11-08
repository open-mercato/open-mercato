"use client"

import * as React from 'react'
import { Download, Paperclip } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { TabEmptyState } from '@open-mercato/ui/backend/detail/TabEmptyState'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { InboxEmailAttachmentListItem, InboxEmailAttachmentListResponse } from '../../data/validators'
import {
  ATTACHMENT_STATUS_VARIANTS,
  attachmentReasonLabels,
  attachmentStatusLabels,
  formatAttachmentSize,
} from './attachmentLabels'

type ListState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'hidden' }
  | { kind: 'ready'; items: InboxEmailAttachmentListItem[] }

export type EmailAttachmentsListProps = {
  emailId: string
  /** Wrap the list in a collapsible "Attachments" section (proposal page, Messages thread). */
  asSection?: boolean
  /** Render nothing when the email has no listed parts (Messages thread) instead of the empty state. */
  hideWhenEmpty?: boolean
  /**
   * The caller already knows the email recorded no parts (`attachmentsStatus` is `null`): the list
   * is empty without a request.
   */
  knownEmpty?: boolean
}

/**
 * The ledger of an inbound email's attachment parts (`GET /api/inbox_ops/emails/[id]/attachments`).
 * A 401, 403 or 404 hides the list, so viewers who may not read the email see nothing — including a
 * signed-out reader of a public message link, who must not be bounced to the session refresh. Downloads
 * go through the attachments file route, which the inbox_ops owner access resolver guards.
 */
export function EmailAttachmentsList({ emailId, asSection = false, hideWhenEmpty = false, knownEmpty = false }: EmailAttachmentsListProps) {
  const t = useT()
  const locale = useLocale()
  // Bumped by the error state's Retry to run the request again.
  const [attempt, setAttempt] = React.useState(0)
  const [state, setState] = React.useState<ListState>(() => (knownEmpty ? { kind: 'ready', items: [] } : { kind: 'loading' }))

  React.useEffect(() => {
    if (knownEmpty) {
      setState({ kind: 'ready', items: [] })
      return
    }
    const controller = new AbortController()
    setState({ kind: 'loading' })
    apiCall<InboxEmailAttachmentListResponse>(`/api/inbox_ops/emails/${encodeURIComponent(emailId)}/attachments`, {
      signal: controller.signal,
      // A viewer without inbox access (or without a session, on a public message link) gets the
      // section hidden — never an access-denied banner or a session-refresh redirect.
      headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
    })
      .then((call) => {
        if (controller.signal.aborted) return
        if (call.status === 401 || call.status === 403 || call.status === 404) setState({ kind: 'hidden' })
        else if (call.ok && Array.isArray(call.result?.items)) setState({ kind: 'ready', items: call.result.items })
        else setState({ kind: 'error' })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' })
      })
    return () => controller.abort()
  }, [emailId, knownEmpty, attempt])

  const statuses = attachmentStatusLabels(t)
  const reasons = attachmentReasonLabels(t)

  if (state.kind === 'hidden') return null
  // A list that may turn out hidden or empty stays invisible while it loads, so the host layout doesn't jump.
  if (state.kind === 'loading' && hideWhenEmpty) return null
  if (state.kind === 'ready' && state.items.length === 0 && hideWhenEmpty) return null

  let content: React.ReactNode
  if (state.kind === 'loading') {
    content = <LoadingMessage label={t('inbox_ops.attachments.loading', 'Loading attachments...')} />
  } else if (state.kind === 'error') {
    content = (
      <ErrorMessage
        label={t('inbox_ops.attachments.loadFailed', 'Failed to load attachments')}
        action={(
          <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {t('inbox_ops.action.retry', 'Retry')}
          </Button>
        )}
      />
    )
  } else if (state.items.length === 0) {
    content = <TabEmptyState title={t('inbox_ops.attachments.empty', 'No attachments were recorded for this email.')} />
  } else {
    content = (
      <ul className="space-y-2">
        {state.items.map((item) => {
          const name = item.fileName || t('inbox_ops.attachments.unnamed', 'Unnamed attachment')
          const details = [item.mimeType, formatAttachmentSize(t, item.sizeBytes, locale)].filter(Boolean).join(' · ')
          return (
            <li key={item.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{name}</div>
                {details ? <div className="truncate text-xs text-muted-foreground">{details}</div> : null}
                {item.reason ? (
                  <div className="text-xs text-muted-foreground">{reasons[item.reason] ?? item.reason}</div>
                ) : null}
              </div>
              {item.status === 'stored' && item.url ? (
                <Button asChild variant="outline" size="sm">
                  <a href={item.url} download aria-label={t('inbox_ops.attachments.downloadFile', 'Download {name}', { name })}>
                    <Download className="h-4 w-4" aria-hidden />
                    {t('inbox_ops.attachments.download', 'Download')}
                  </a>
                </Button>
              ) : (
                <StatusBadge variant={ATTACHMENT_STATUS_VARIANTS[item.status] ?? 'neutral'} dot>
                  {statuses[item.status] ?? item.status}
                </StatusBadge>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  if (!asSection) return <>{content}</>
  return (
    <CollapsibleSection
      title={t('inbox_ops.attachments.title', 'Attachments')}
      count={state.kind === 'ready' ? state.items.length : undefined}
    >
      {content}
    </CollapsibleSection>
  )
}

