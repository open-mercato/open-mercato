"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, FileText, MessageSquare, Send, ShieldCheck, Upload } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'

type Props = { params: { orgSlug: string; id: string } }

type PortalClaimLine = {
  id: string
  lineNo: number
  sku: string | null
  productName: string | null
  serialNumber: string | null
  faultCode: string | null
  faultDescription: string | null
  qtyClaimed: string
  qtyApproved: string | null
  lineStatus: string
  disposition: string | null
  creditAmount: string | null
}

type PortalClaim = {
  id: string
  claimNumber: string
  claimType: string
  status: string
  priority: string
  orderId: string | null
  reasonCode: string | null
  rejectionReasonCode: string | null
  resolutionSummary: string | null
  submittedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  lines: PortalClaimLine[]
}

type PortalClaimEvent = {
  id: string
  kind: string
  body: string | null
  payload: Record<string, unknown> | null
  actorCustomerId: string | null
  createdAt: string | null
}

type PortalAttachment = {
  id: string
  url: string
  downloadUrl: string
  fileName: string
  fileSize: number
  mimeType: string | null
  thumbnailUrl: string
  createdAt: string | null
}

type ClaimResponse = { item: PortalClaim }
type EventResponse = { items: PortalClaimEvent[] }
type AttachmentResponse = { items: PortalAttachment[] }
type MutationOkResponse = { ok: boolean; error?: string }
type UploadResponse = MutationOkResponse & { item?: PortalAttachment }

const CLAIM_STATUS_ORDER = [
  'submitted',
  'in_review',
  'approved',
  'awaiting_return',
  'received',
  'inspecting',
  'resolved',
  'closed',
] as const

const CLAIM_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  draft: 'neutral',
  info_requested: 'neutral',
  submitted: 'info',
  in_review: 'info',
  approved: 'warning',
  awaiting_return: 'warning',
  received: 'warning',
  inspecting: 'warning',
  resolved: 'success',
  closed: 'success',
  rejected: 'error',
  cancelled: 'error',
}

const LINE_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  pending: 'neutral',
  approved: 'warning',
  rejected: 'error',
  received: 'warning',
  inspected: 'warning',
  resolved: 'success',
}

const STATUS_SURFACE_CLASSES: Record<StatusBadgeVariant, string> = {
  success: 'border-status-success-border bg-status-success-bg',
  warning: 'border-status-warning-border bg-status-warning-bg',
  error: 'border-status-error-border bg-status-error-bg',
  info: 'border-status-info-border bg-status-info-bg',
  neutral: 'border-status-neutral-border bg-status-neutral-bg',
}

function statusVariant(status: string): StatusBadgeVariant {
  return CLAIM_STATUS_VARIANTS[status] ?? 'neutral'
}

function lineStatusVariant(status: string): StatusBadgeVariant {
  return LINE_STATUS_VARIANTS[status] ?? 'neutral'
}

function formatDateTime(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatFileSize(bytes: number, t: TranslateFn): string {
  if (bytes < 1024) return t('warranty_claims.portal.file.bytes', { size: bytes })
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return t('warranty_claims.portal.file.kilobytes', { size: kilobytes.toFixed(1) })
  return t('warranty_claims.portal.file.megabytes', { size: (kilobytes / 1024).toFixed(1) })
}

function formatEventBody(event: PortalClaimEvent, t: TranslateFn): string {
  if (event.body) return event.body
  const payload = event.payload
  const from = typeof payload?.from === 'string' ? payload.from : null
  const to = typeof payload?.to === 'string' ? payload.to : null
  if (from && to) {
    return t('warranty_claims.portal.event.transition', {
      from: t(`warranty_claims.status.${from}`),
      to: t(`warranty_claims.status.${to}`),
    })
  }
  return t('warranty_claims.portal.event.noDetails')
}

export default function WarrantyClaimPortalDetailPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const guardedMutation = useGuardedMutation<Record<string, unknown>>({
    contextId: 'warranty_claims.portal.claim.detail',
    blockedMessage: t('warranty_claims.portal.detail.blocked'),
  })
  const [claim, setClaim] = React.useState<PortalClaim | null>(null)
  const [events, setEvents] = React.useState<PortalClaimEvent[]>([])
  const [attachments, setAttachments] = React.useState<PortalAttachment[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [comment, setComment] = React.useState('')
  const [commentSubmitting, setCommentSubmitting] = React.useState(false)
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = React.useState(0)
  const [uploading, setUploading] = React.useState(false)

  React.useEffect(() => {
    if (!loading && !user) {
      router.replace(`/${params.orgSlug}/portal/login`)
    }
  }, [loading, user, router, params.orgSlug])

  const refreshEvents = React.useCallback(async (claimId: string) => {
    const result = await apiCall<EventResponse>(`/api/warranty_claims/portal/events?claimId=${encodeURIComponent(claimId)}`)
    if (result.ok && result.result) setEvents(result.result.items)
  }, [])

  const refreshAttachments = React.useCallback(async (claimId: string) => {
    const result = await apiCall<AttachmentResponse>(`/api/warranty_claims/portal/attachments?claimId=${encodeURIComponent(claimId)}`)
    if (result.ok && result.result) setAttachments(result.result.items)
  }, [])

  const loadClaim = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const detail = await apiCall<ClaimResponse>(`/api/warranty_claims/portal/claims/${encodeURIComponent(params.id)}`)
      if (detail.status === 404) {
        setClaim(null)
        setNotFound(true)
        return
      }
      if (!detail.ok || !detail.result) {
        setError(t('warranty_claims.portal.detail.loadError'))
        return
      }
      setClaim(detail.result.item)
      await Promise.all([
        refreshEvents(detail.result.item.id),
        refreshAttachments(detail.result.item.id),
      ])
    } catch {
      setError(t('warranty_claims.portal.detail.loadError'))
    } finally {
      setIsLoading(false)
    }
  }, [params.id, refreshAttachments, refreshEvents, t])

  React.useEffect(() => {
    if (user) void loadClaim()
  }, [loadClaim, user])

  const submitComment = React.useCallback(async () => {
    if (!claim || commentSubmitting) return
    const body = comment.trim()
    if (!body) return
    setCommentSubmitting(true)
    setError(null)
    try {
      const result = await guardedMutation.runMutation({
        operation: () => apiCall<MutationOkResponse>('/api/warranty_claims/portal/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ claimId: claim.id, body }),
        }),
        context: {
          moduleId: 'warranty_claims',
          entityId: 'warranty_claims.claim_event',
          operation: 'portal_comment',
          claimId: claim.id,
        },
        mutationPayload: { claimId: claim.id, body },
      })
      if (!result.ok || !result.result?.ok) {
        setError(t('warranty_claims.portal.detail.commentError'))
        return
      }
      setComment('')
      flash(t('warranty_claims.portal.detail.commentSuccess'), 'success')
      await refreshEvents(claim.id)
    } catch {
      setError(t('warranty_claims.portal.detail.commentError'))
    } finally {
      setCommentSubmitting(false)
    }
  }, [claim, comment, commentSubmitting, guardedMutation, refreshEvents, t])

  const uploadAttachment = React.useCallback(async () => {
    if (!claim || uploading) return
    if (!selectedFile) {
      setError(t('warranty_claims.portal.detail.fileRequired'))
      return
    }
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('claimId', claim.id)
      form.set('file', selectedFile)
      const result = await guardedMutation.runMutation({
        operation: () => apiCall<UploadResponse>('/api/warranty_claims/portal/attachments', {
          method: 'POST',
          credentials: 'include',
          body: form,
        }),
        context: {
          moduleId: 'warranty_claims',
          entityId: 'attachments.attachment',
          operation: 'portal_attachment_upload',
          claimId: claim.id,
        },
        mutationPayload: { claimId: claim.id, fileName: selectedFile.name, fileSize: selectedFile.size },
      })
      if (!result.ok || !result.result?.ok) {
        setError(t('warranty_claims.portal.detail.attachmentError'))
        return
      }
      setSelectedFile(null)
      setFileInputKey((current) => current + 1)
      flash(t('warranty_claims.portal.detail.attachmentSuccess'), 'success')
      await refreshAttachments(claim.id)
    } catch {
      setError(t('warranty_claims.portal.detail.attachmentError'))
    } finally {
      setUploading(false)
    }
  }, [claim, guardedMutation, refreshAttachments, selectedFile, t, uploading])

  const handleCommentSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitComment()
  }, [submitComment])

  const handleCommentKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submitComment()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setComment('')
    }
  }, [submitComment])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (!user) return null

  if (isLoading) {
    return <LoadingMessage label={t('warranty_claims.portal.detail.loading')} />
  }

  if (notFound) {
    return (
      <PortalEmptyState
        icon={<ShieldCheck className="size-5" />}
        title={t('warranty_claims.portal.detail.notFoundTitle')}
        description={t('warranty_claims.portal.detail.notFoundDescription')}
        action={
          <Button asChild>
            <Link href={`/${params.orgSlug}/portal/claims`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('warranty_claims.portal.detail.back')}
            </Link>
          </Button>
        }
      />
    )
  }

  if (!claim) {
    return <ErrorMessage label={error ?? t('warranty_claims.portal.detail.loadError')} />
  }

  const currentStatusIndex = CLAIM_STATUS_ORDER.findIndex((status) => status === claim.status)
  const isTerminalException = claim.status === 'rejected' || claim.status === 'cancelled'

  return (
    <div className="flex flex-col gap-8">
      <PortalPageHeader
        label={t('warranty_claims.portal.nav')}
        title={claim.claimNumber}
        description={t('warranty_claims.portal.detail.description')}
        action={
          <Button asChild variant="outline">
            <Link href={`/${params.orgSlug}/portal/claims`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('warranty_claims.portal.detail.back')}
            </Link>
          </Button>
        }
      />

      {error ? (
        <ErrorMessage label={error} />
      ) : null}

      {isTerminalException ? (
        <Alert status="error" style="lighter">
          <AlertTitle>{t(`warranty_claims.status.${claim.status}`)}</AlertTitle>
          <AlertDescription>{t(`warranty_claims.portal.detail.terminal.${claim.status}`)}</AlertDescription>
        </Alert>
      ) : null}

      <PortalCard>
        <PortalCardHeader
          label={t('warranty_claims.portal.detail.status')}
          title={t('warranty_claims.portal.detail.statusProgress')}
          action={
            <StatusBadge variant={statusVariant(claim.status)} dot>
              {t(`warranty_claims.status.${claim.status}`)}
            </StatusBadge>
          }
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {CLAIM_STATUS_ORDER.map((status, index) => {
            const isCurrent = claim.status === status
            const isComplete = currentStatusIndex >= 0 && index < currentStatusIndex
            const variant = isCurrent ? statusVariant(status) : isComplete ? 'success' : 'neutral'
            return (
              <div
                key={status}
                className={cn(
                  'rounded-lg border border-border bg-card p-3',
                  isCurrent && STATUS_SURFACE_CLASSES[statusVariant(status)],
                  isComplete && 'bg-muted/30',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <StatusBadge variant={variant} dot>
                  {t(`warranty_claims.status.${status}`)}
                </StatusBadge>
                <p className="mt-2 text-xs text-muted-foreground">
                  {isCurrent
                    ? t('warranty_claims.portal.detail.currentStatus')
                    : isComplete
                      ? t('warranty_claims.portal.detail.completedStatus')
                      : t('warranty_claims.portal.detail.pendingStatus')}
                </p>
              </div>
            )
          })}
        </div>
      </PortalCard>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <PortalCard>
          <PortalCardHeader
            label={t('warranty_claims.portal.detail.claimNumber')}
            title={claim.claimNumber}
            description={t(`warranty_claims.claimType.${claim.claimType}`)}
          />
          <dl className="grid gap-4 md:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t('warranty_claims.portal.detail.order')}</dt>
              <dd className="mt-1 text-sm font-medium">{claim.orderId ?? t('warranty_claims.portal.value.notAvailable')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('warranty_claims.form.reasonCode')}</dt>
              <dd className="mt-1 text-sm font-medium">{claim.reasonCode ?? t('warranty_claims.portal.value.notAvailable')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('warranty_claims.portal.detail.createdAt')}</dt>
              <dd className="mt-1 text-sm font-medium">{formatDateTime(claim.createdAt, t('warranty_claims.portal.value.notAvailable'))}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('warranty_claims.portal.detail.updatedAt')}</dt>
              <dd className="mt-1 text-sm font-medium">{formatDateTime(claim.updatedAt, t('warranty_claims.portal.value.notAvailable'))}</dd>
            </div>
          </dl>
          {claim.resolutionSummary ? (
            <div className="mt-5 rounded-lg border border-border bg-muted/30 p-4">
              <h3 className="text-sm font-semibold">{t('warranty_claims.form.resolutionSummary')}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{claim.resolutionSummary}</p>
            </div>
          ) : null}
        </PortalCard>

        <PortalCard>
          <PortalCardHeader
            label={t('warranty_claims.portal.detail.status')}
            title={t(`warranty_claims.status.${claim.status}`)}
          />
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t('warranty_claims.portal.detail.submittedAt')}</dt>
              <dd className="font-medium">{formatDateTime(claim.submittedAt, t('warranty_claims.portal.value.notAvailable'))}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t('warranty_claims.portal.detail.resolvedAt')}</dt>
              <dd className="font-medium">{formatDateTime(claim.resolvedAt, t('warranty_claims.portal.value.notAvailable'))}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t('warranty_claims.portal.detail.closedAt')}</dt>
              <dd className="font-medium">{formatDateTime(claim.closedAt, t('warranty_claims.portal.value.notAvailable'))}</dd>
            </div>
          </dl>
        </PortalCard>
      </div>

      <PortalCard>
        <PortalCardHeader
          label={t('warranty_claims.portal.detail.lines')}
          title={t('warranty_claims.portal.detail.linesTitle')}
        />
        {claim.lines.length > 0 ? (
          <div className="grid gap-3">
            {claim.lines.map((line) => (
              <div key={line.id} className="rounded-lg border border-border bg-background p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{line.productName ?? line.sku ?? t('warranty_claims.portal.value.unnamedLine')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {line.serialNumber ?? t('warranty_claims.portal.value.noSerial')}
                    </p>
                  </div>
                  <StatusBadge variant={lineStatusVariant(line.lineStatus)} dot>
                    {t(`warranty_claims.lineStatus.${line.lineStatus}`)}
                  </StatusBadge>
                </div>
                <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('warranty_claims.form.qtyClaimed')}</dt>
                    <dd className="mt-1 font-medium">{line.qtyClaimed}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('warranty_claims.form.qtyApproved')}</dt>
                    <dd className="mt-1 font-medium">{line.qtyApproved ?? t('warranty_claims.portal.value.notAvailable')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('warranty_claims.form.disposition')}</dt>
                    <dd className="mt-1 font-medium">
                      {line.disposition ? t(`warranty_claims.disposition.${line.disposition}`) : t('warranty_claims.portal.value.notAvailable')}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <PortalEmptyState
            icon={<ShieldCheck className="size-5" />}
            title={t('warranty_claims.portal.detail.linesEmpty.title')}
            description={t('warranty_claims.portal.detail.linesEmpty.description')}
          />
        )}
      </PortalCard>

      <PortalCard>
        <PortalCardHeader
          label={t('warranty_claims.portal.detail.timeline')}
          title={t('warranty_claims.portal.detail.timelineTitle')}
        />
        {events.length > 0 ? (
          <ol className="space-y-4">
            {events.map((event) => (
              <li key={event.id} className="flex gap-3">
                <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {event.kind === 'comment' ? <MessageSquare className="size-4" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1 rounded-lg border border-border bg-background p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <p className="text-sm font-semibold">{t(`warranty_claims.portal.event.${event.kind}`)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt, t('warranty_claims.portal.value.notAvailable'))}
                    </p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{formatEventBody(event, t)}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <PortalEmptyState
            icon={<MessageSquare className="size-5" />}
            title={t('warranty_claims.portal.detail.timelineEmpty.title')}
            description={t('warranty_claims.portal.detail.timelineEmpty.description')}
          />
        )}

        <form className="mt-6 flex flex-col gap-3" onSubmit={handleCommentSubmit}>
          <FormField label={t('warranty_claims.portal.detail.commentTitle')}>
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={handleCommentKeyDown}
              placeholder={t('warranty_claims.portal.commentPlaceholder')}
              disabled={commentSubmitting}
              maxLength={8000}
              showCount
            />
          </FormField>
          <div className="flex justify-end">
            <Button type="submit" disabled={commentSubmitting || !comment.trim()}>
              <Send className="size-4" aria-hidden="true" />
              {commentSubmitting ? t('warranty_claims.portal.detail.sendingComment') : t('warranty_claims.portal.detail.sendComment')}
            </Button>
          </div>
        </form>
      </PortalCard>

      <PortalCard>
        <PortalCardHeader
          label={t('warranty_claims.detail.tabs.attachments')}
          title={t('warranty_claims.portal.detail.attachmentsTitle')}
        />
        {attachments.length > 0 ? (
          <div className="grid gap-3">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <FileText className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{attachment.fileName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatFileSize(attachment.fileSize, t)} - {formatDateTime(attachment.createdAt, t('warranty_claims.portal.value.notAvailable'))}
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a href={attachment.downloadUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" aria-hidden="true" />
                    {t('warranty_claims.portal.detail.openAttachment')}
                  </a>
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <PortalEmptyState
            icon={<FileText className="size-5" />}
            title={t('warranty_claims.portal.detail.attachmentsEmpty.title')}
            description={t('warranty_claims.portal.detail.attachmentsEmpty.description')}
          />
        )}

        <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <FormField
              label={t('warranty_claims.portal.detail.chooseFile')}
              description={selectedFile
                ? t('warranty_claims.portal.detail.selectedFile', { name: selectedFile.name })
                : t('warranty_claims.portal.detail.noFileSelected')}
            >
              <Input
                key={fileInputKey}
                type="file"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                disabled={uploading}
              />
            </FormField>
            <Button type="button" onClick={uploadAttachment} disabled={uploading || !selectedFile}>
              <Upload className="size-4" aria-hidden="true" />
              {uploading ? t('warranty_claims.portal.detail.uploading') : t('warranty_claims.portal.detail.upload')}
            </Button>
          </div>
        </div>
      </PortalCard>
    </div>
  )
}
