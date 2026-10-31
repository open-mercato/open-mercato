"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Paperclip, Trash2 } from 'lucide-react'
import { replaceWithPageReload } from '@open-mercato/shared/lib/navigation/pageReload'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalCard } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  ATTACHMENT_ACCEPT_TYPES,
  resolvePortalMaxUploadBytes,
  validateAttachmentFile,
} from '@open-mercato/core/modules/staff/lib/support-ui/portalAttachmentValidation'
import {
  forgetFailedUpload,
  getRetryableUpload,
  readFailedUploadNames,
  rememberFailedUploads,
} from '@open-mercato/core/modules/staff/lib/support-ui/portalPendingUploads'
import {
  PORTAL_SUPPORT_STATUS_VARIANTS,
  PORTAL_SUPPORT_UPDATED_EVENT,
  formatFileSize,
  formatPortalDate,
  isPortalSupportAccountNotLinked,
  portalSupportStatusLabel,
  readPortalTicketIdFromEvent,
  type PortalSupportAttachment,
  type PortalSupportOptions,
  type PortalSupportTicketDetail,
} from '@open-mercato/core/modules/staff/lib/support-ui/portalSupport'
import { PortalSupportNotLinked } from '@open-mercato/core/modules/staff/lib/support-ui/PortalSupportNotLinked'

type Props = { params: { orgSlug: string; id: string } }

type UploadOutcome = { status: 'uploaded' } | { status: 'rejected' } | { status: 'failed'; reason: string | null }

type UploadErrorBody = { error?: unknown }

const MUTATION_CONTEXT_ID = 'staff-portal-support-detail'
const SPOT_BEFORE = 'portal:staff.support_ticket:before'
const SPOT_AFTER = 'portal:staff.support_ticket:after'

export default function PortalSupportTicketDetailPage({ params }: Props) {
  const t = useT()
  const locale = useLocale()
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const guardedMutation = useGuardedMutation<Record<string, unknown>>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.portal.support.blocked', 'This action is not available right now.'),
  })
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [ticket, setTicket] = React.useState<PortalSupportTicketDetail | null>(null)
  const [attachments, setAttachments] = React.useState<PortalSupportAttachment[]>([])
  const [failedUploads, setFailedUploads] = React.useState<string[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [notLinked, setNotLinked] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [reply, setReply] = React.useState('')
  const [replying, setReplying] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [maxUploadBytes, setMaxUploadBytes] = React.useState(() => resolvePortalMaxUploadBytes(null))
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!loading && !user) replaceWithPageReload(`/${params.orgSlug}/portal/login`)
  }, [loading, user, params.orgSlug])

  React.useEffect(() => {
    setFailedUploads(readFailedUploadNames(params.id))
  }, [params.id])

  React.useEffect(() => {
    if (!user) return
    let cancelled = false
    void (async () => {
      try {
        const response = await apiCall<PortalSupportOptions>('/api/staff/portal/support-tickets/options', { credentials: 'include' })
        if (!cancelled && response.ok) setMaxUploadBytes(resolvePortalMaxUploadBytes(response.result?.maxUploadBytes))
      } catch (err) {
        getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_support_options_failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  const loadSeqRef = React.useRef(0)

  const load = React.useCallback(async () => {
    if (!user) return
    const requestSeq = loadSeqRef.current + 1
    loadSeqRef.current = requestSeq
    const isStale = () => requestSeq !== loadSeqRef.current
    setError(null)
    try {
      const detail = await apiCall<PortalSupportTicketDetail>(`/api/staff/portal/support-tickets/${encodeURIComponent(params.id)}`, {
        credentials: 'include',
      })
      if (isStale()) return
      if (isPortalSupportAccountNotLinked(detail)) {
        setNotLinked(true)
        setTicket(null)
        return
      }
      if (detail.status === 404) {
        setNotFound(true)
        setTicket(null)
        return
      }
      if (!detail.ok || !detail.result) {
        setError(t('staff.portal.support.detail.loadFailed', 'Could not load this ticket.'))
        return
      }
      setNotFound(false)
      setTicket(detail.result)
      setAttachments(detail.result.attachments ?? [])
    } catch (err) {
      if (isStale()) return
      getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_support_detail_failed' })
      setError(t('staff.portal.support.detail.loadFailed', 'Could not load this ticket.'))
    } finally {
      if (!isStale()) setIsLoading(false)
    }
  }, [user, params.id, t])

  React.useEffect(() => {
    void load()
  }, [load])

  usePortalAppEvent(PORTAL_SUPPORT_UPDATED_EVENT, (event) => {
    if (readPortalTicketIdFromEvent(event) === params.id) void load()
  }, [load, params.id])

  const clearFailed = React.useCallback((fileName: string) => {
    forgetFailedUpload(params.id, fileName)
    setFailedUploads((current) => current.filter((entry) => entry !== fileName))
  }, [params.id])

  const markFailed = React.useCallback((file: File) => {
    rememberFailedUploads(params.id, [file])
    setFailedUploads((current) => (current.includes(file.name) ? current : [...current, file.name]))
  }, [params.id])

  const sendReply = React.useCallback(async () => {
    const body = reply.trim()
    if (!ticket || !body || replying) return
    setReplying(true)
    setError(null)
    try {
      const result = await guardedMutation.runMutation({
        operation: () =>
          apiCall<{ ok?: boolean; reopened?: boolean }>(`/api/staff/portal/support-tickets/${encodeURIComponent(ticket.id)}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ body }),
          }),
        context: {
          moduleId: 'staff',
          entityId: 'staff.support_ticket',
          operation: 'portal_support_message',
          formId: MUTATION_CONTEXT_ID,
          ticketId: ticket.id,
          retryLastMutation: guardedMutation.retryLastMutation,
        },
        mutationPayload: { ticketId: ticket.id, body },
      })
      if (!result.ok) {
        setError(
          result.status === 429
            ? t('staff.portal.support.detail.rateLimited', 'You have sent many messages recently. Please try again later.')
            : t('staff.portal.support.detail.replyFailed', 'Could not send your message.'),
        )
        return
      }
      setReply('')
      flash(
        result.result?.reopened
          ? t('staff.portal.support.detail.reopened', 'Your message was sent and the ticket was reopened.')
          : t('staff.portal.support.detail.replySent', 'Your message was sent.'),
        'success',
      )
      await load()
    } catch {
      setError(t('staff.portal.support.detail.replyFailed', 'Could not send your message.'))
    } finally {
      setReplying(false)
    }
  }, [ticket, reply, replying, guardedMutation, load, t])

  const uploadFile = React.useCallback(async (file: File): Promise<UploadOutcome> => {
    if (!ticket) return { status: 'failed', reason: null }
    const validationError = await validateAttachmentFile(file, t, maxUploadBytes)
    if (validationError) {
      flash(`${file.name}: ${validationError}`, 'error')
      return { status: 'rejected' }
    }
    const form = new FormData()
    form.set('file', file)
    const result = await guardedMutation.runMutation({
      operation: () =>
        apiCall<UploadErrorBody>(`/api/staff/portal/support-tickets/${encodeURIComponent(ticket.id)}/attachments`, {
          method: 'POST',
          credentials: 'include',
          body: form,
        }),
      context: {
        moduleId: 'staff',
        entityId: 'attachments.attachment',
        operation: 'portal_support_attachment_upload',
        formId: MUTATION_CONTEXT_ID,
        ticketId: ticket.id,
        retryLastMutation: guardedMutation.retryLastMutation,
      },
      mutationPayload: { ticketId: ticket.id, fileName: file.name },
    })
    if (result.ok) return { status: 'uploaded' }
    const reason = result.result?.error
    return { status: 'failed', reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null }
  }, [ticket, guardedMutation, maxUploadBytes, t])

  const uploadFiles = React.useCallback(async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        let outcome: UploadOutcome
        try {
          outcome = await uploadFile(file)
        } catch (err) {
          getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_support_upload_failed' })
          outcome = { status: 'failed', reason: null }
        }
        if (outcome.status === 'uploaded') {
          clearFailed(file.name)
        } else if (outcome.status === 'failed') {
          markFailed(file)
          flash(
            outcome.reason
              ? t('staff.portal.support.attachments.uploadFailedReason', 'Could not upload {name}: {reason}', {
                  name: file.name,
                  reason: outcome.reason,
                })
              : t('staff.portal.support.attachments.uploadFailed', 'Could not upload {name}.', { name: file.name }),
            'error',
          )
        }
      }
      await load()
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [uploadFile, clearFailed, markFailed, load, t])

  const onFilesPicked = React.useCallback(async (list: FileList | null) => {
    if (!list || !list.length) return
    await uploadFiles(Array.from(list))
  }, [uploadFiles])

  const retryUpload = React.useCallback(async (fileName: string) => {
    const file = getRetryableUpload(params.id, fileName)
    if (!file) return
    await uploadFiles([file])
  }, [params.id, uploadFiles])

  const deleteAttachment = React.useCallback(async (attachment: PortalSupportAttachment) => {
    if (!ticket) return
    const confirmed = await confirm({
      title: t('staff.portal.support.attachments.deleteConfirm', 'Delete {name}?', { name: attachment.fileName }),
      variant: 'destructive',
    })
    if (!confirmed) return
    const result = await guardedMutation.runMutation({
      operation: () =>
        apiCall(
          `/api/staff/portal/support-tickets/${encodeURIComponent(ticket.id)}/attachments?attachmentId=${encodeURIComponent(attachment.id)}`,
          { method: 'DELETE', credentials: 'include' },
        ),
      context: {
        moduleId: 'staff',
        entityId: 'attachments.attachment',
        operation: 'portal_support_attachment_delete',
        formId: MUTATION_CONTEXT_ID,
        ticketId: ticket.id,
        retryLastMutation: guardedMutation.retryLastMutation,
      },
      mutationPayload: { ticketId: ticket.id, attachmentId: attachment.id },
    })
    if (!result.ok) {
      flash(t('staff.portal.support.attachments.deleteFailed', 'Could not delete the file.'), 'error')
      return
    }
    await load()
  }, [ticket, confirm, guardedMutation, load, t])

  const injectionContext = React.useMemo(
    () => ({
      orgSlug: params.orgSlug,
      ticketId: params.id,
      supportReference: ticket?.supportReference ?? null,
      portalStatus: ticket?.portalStatus ?? null,
      resolvedFeatures: auth.resolvedFeatures,
    }),
    [params.orgSlug, params.id, ticket?.supportReference, ticket?.portalStatus, auth.resolvedFeatures],
  )

  const customerAuthorLabel = (isSelf: boolean, name: string | null) => {
    if (isSelf) return t('staff.portal.support.detail.you', 'You')
    return name ?? t('staff.portal.support.detail.colleague', 'A colleague')
  }

  if (loading || (isLoading && !ticket && !notFound && !notLinked)) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }
  if (!user) return null

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" asChild>
          <Link href={`/${params.orgSlug}/portal/support`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('staff.portal.support.backToList', 'All tickets')}
          </Link>
        </Button>
      </div>

      <InjectionSpot spotId={SPOT_BEFORE} context={injectionContext} />

      {error ? (
        <ErrorMessage
          label={error}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {t('staff.portal.support.retry', 'Try again')}
            </Button>
          }
        />
      ) : null}

      {notLinked ? (
        <PortalSupportNotLinked />
      ) : notFound || (!ticket && !error) ? (
        <PortalEmptyState
          title={t('staff.portal.support.detail.notFoundTitle', 'Ticket not found')}
          description={t('staff.portal.support.detail.notFoundDescription', 'This ticket does not exist or is not yours.')}
        />
      ) : !ticket ? null : (
        <>
          <PortalCard>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-muted-foreground">
                  {ticket.supportReference} · {ticket.category.label}
                </p>
                <h1 className="text-xl font-semibold text-foreground">{ticket.subject}</h1>
              </div>
              <StatusBadge variant={PORTAL_SUPPORT_STATUS_VARIANTS[ticket.portalStatus] ?? 'neutral'} dot>
                {portalSupportStatusLabel(t, ticket.portalStatus)}
              </StatusBadge>
            </div>
          </PortalCard>

          <PortalCard>
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t('staff.portal.support.detail.conversation', 'Conversation')}
            </h2>
            <ol className="space-y-3" data-testid="support-thread">
              <li className="rounded-md border border-border bg-muted p-3">
                <p className="text-xs text-muted-foreground">
                  {customerAuthorLabel(ticket.requester?.isSelf ?? false, ticket.requester?.name ?? null)}
                  {' · '}
                  {formatPortalDate(ticket.createdAt, locale)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{ticket.description}</p>
              </li>
              {ticket.messages.map((message) => (
                <li
                  key={message.id}
                  data-author-kind={message.authorKind}
                  className={
                    message.authorKind === 'customer'
                      ? 'rounded-md border border-border bg-muted p-3'
                      : 'rounded-md border border-border bg-card p-3'
                  }
                >
                  <p className="text-xs text-muted-foreground">
                    {message.authorKind === 'customer'
                      ? customerAuthorLabel(message.isSelf ?? false, message.authorName)
                      : message.authorName
                        ? t('staff.portal.support.detail.supportTeamNamed', 'Support team · {name}', { name: message.authorName })
                        : t('staff.portal.support.detail.supportTeam', 'Support team')}
                    {' · '}
                    {formatPortalDate(message.createdAt, locale)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{message.body}</p>
                </li>
              ))}
            </ol>

            {ticket.canReply ? (
              <form
                className="mt-4 space-y-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void sendReply()
                }}
              >
                <Textarea
                  rows={4}
                  value={reply}
                  maxLength={10000}
                  aria-label={t('staff.portal.support.detail.replyLabel', 'Your reply')}
                  placeholder={t('staff.portal.support.detail.replyPlaceholder', 'Write a reply')}
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault()
                      void sendReply()
                    }
                  }}
                />
                {ticket.portalStatus === 'resolved' ? (
                  <p className="text-xs text-muted-foreground">
                    {t('staff.portal.support.detail.reopenHint', 'Replying reopens this ticket.')}
                  </p>
                ) : null}
                <div className="flex justify-end">
                  <Button type="submit" disabled={!reply.trim() || replying}>
                    {replying ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    {t('staff.portal.support.detail.send', 'Send reply')}
                  </Button>
                </div>
              </form>
            ) : null}
          </PortalCard>

          <PortalCard>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">{t('staff.portal.support.attachments.title', 'Files')}</h2>
              {ticket.canReply ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT_TYPES}
                    className="sr-only"
                    data-testid="support-detail-file-input"
                    onChange={(event) => void onFilesPicked(event.target.files)}
                  />
                  <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? <Spinner className="mr-2 h-4 w-4" /> : <Paperclip className="mr-2 h-4 w-4" />}
                    {t('staff.portal.support.attachments.add', 'Add files')}
                  </Button>
                </>
              ) : null}
            </div>
            {failedUploads.length ? (
              <div
                className="mb-3 space-y-2 rounded-md border border-status-error-border bg-status-error-bg p-3"
                data-testid="support-failed-uploads"
              >
                <p className="text-sm text-status-error-text">
                  {t('staff.portal.support.attachments.failedHeading', 'These files could not be uploaded.')}
                </p>
                <ul className="space-y-1 text-sm text-status-error-text">
                  {failedUploads.map((name) => {
                    const retryable = ticket.canReply && getRetryableUpload(params.id, name) !== null
                    return (
                      <li key={name} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate">{name}</span>
                        {retryable ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading}
                            onClick={() => void retryUpload(name)}
                          >
                            {t('staff.portal.support.attachments.retry', 'Retry')}
                          </Button>
                        ) : (
                          <span className="text-xs">
                            {t('staff.portal.support.attachments.reattach', 'Please attach this file again.')}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
            {attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('staff.portal.support.attachments.empty', 'No files yet.')}</p>
            ) : (
              <ul className="space-y-2" data-testid="support-attachments">
                {attachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center justify-between gap-2 text-sm">
                    <a className="flex min-w-0 items-center gap-2 text-foreground hover:underline" href={attachment.downloadUrl}>
                      <Download className="h-4 w-4 shrink-0" />
                      <span className="truncate">{attachment.fileName}</span>
                      <span className="shrink-0 text-muted-foreground">{formatFileSize(t, attachment.fileSize)}</span>
                    </a>
                    {ticket.canReply && attachment.canDelete ? (
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('staff.portal.support.attachments.delete', 'Delete file')}
                        onClick={() => void deleteAttachment(attachment)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </PortalCard>
        </>
      )}

      <InjectionSpot spotId={SPOT_AFTER} context={injectionContext} />
      {ConfirmDialogElement}
    </div>
  )
}
