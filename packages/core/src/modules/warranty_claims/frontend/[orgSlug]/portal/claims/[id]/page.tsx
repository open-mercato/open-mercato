"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, FileText, MessageSquare, Send, ShieldCheck, Upload } from 'lucide-react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { localizeDictionaryLabel } from '@open-mercato/core/modules/warranty_claims/lib/dictionaryLabels'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import {
  CLAIM_LINE_STATUS_BADGE_VARIANTS,
  CLAIM_STATUS_BADGE_VARIANTS,
} from '../../../../../backend/components/ClaimStatusBadge'

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
  orderNumber: string | null
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

const DEFAULT_ATTACHMENT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const ATTACHMENT_ACCEPT_TYPES = [
  '.avif',
  '.bmp',
  '.csv',
  '.docx',
  '.gif',
  '.jpeg',
  '.jpg',
  '.json',
  '.md',
  '.pdf',
  '.png',
  '.pptx',
  '.txt',
  '.webp',
  '.xlsx',
  '.zip',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/markdown',
  'text/plain',
].join(',')

const BLOCKED_ATTACHMENT_MIME_TYPES = new Set([
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/xml',
])

const ACTIVE_CONTENT_ATTACHMENT_EXTENSIONS = new Set([
  'htm',
  'html',
  'svg',
  'xhtml',
  'xml',
])

const DANGEROUS_EXECUTABLE_EXTENSIONS = new Set([
  'app',
  'apk',
  'bat',
  'cmd',
  'com',
  'dll',
  'exe',
  'hta',
  'htm',
  'html',
  'jar',
  'js',
  'jse',
  'lnk',
  'msi',
  'pif',
  'ps1',
  'psm1',
  'reg',
  'scr',
  'sh',
  'vbe',
  'vbs',
  'wsf',
  'wsh',
])

function hasClaimStatus(status: string): status is keyof typeof CLAIM_STATUS_BADGE_VARIANTS {
  return Object.prototype.hasOwnProperty.call(CLAIM_STATUS_BADGE_VARIANTS, status)
}

function hasLineStatus(status: string): status is keyof typeof CLAIM_LINE_STATUS_BADGE_VARIANTS {
  return Object.prototype.hasOwnProperty.call(CLAIM_LINE_STATUS_BADGE_VARIANTS, status)
}

function statusVariant(status: string): StatusBadgeVariant {
  return hasClaimStatus(status) ? CLAIM_STATUS_BADGE_VARIANTS[status] : 'neutral'
}

function lineStatusVariant(status: string): StatusBadgeVariant {
  return hasLineStatus(status) ? CLAIM_LINE_STATUS_BADGE_VARIANTS[status] : 'neutral'
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

function getFileExtensionSegments(fileName: string): string[] {
  const parts = fileName.trim().split('.').filter(Boolean)
  if (parts.length < 2) return []
  return parts.slice(1).map((part) => part.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean)
}

async function fileLooksLikeActiveContent(file: File): Promise<boolean> {
  try {
    const sniff = (await file.slice(0, 512).text()).trimStart().toLowerCase()
    return sniff.startsWith('<svg') || sniff.startsWith('<?xml') || sniff.startsWith('<!doctype html') || sniff.startsWith('<html')
  } catch {
    return false
  }
}

async function validateAttachmentFile(file: File, t: TranslateFn): Promise<string | null> {
  if (file.size > DEFAULT_ATTACHMENT_MAX_UPLOAD_BYTES) {
    return t('attachments.errors.maxUploadSize')
  }
  const extensionSegments = getFileExtensionSegments(file.name)
  const mimeType = file.type.trim().toLowerCase()
  if (extensionSegments.some((extension) => DANGEROUS_EXECUTABLE_EXTENSIONS.has(extension))) {
    return t('attachments.errors.dangerousExecutable')
  }
  if (
    extensionSegments.some((extension) => ACTIVE_CONTENT_ATTACHMENT_EXTENSIONS.has(extension)) ||
    (mimeType && BLOCKED_ATTACHMENT_MIME_TYPES.has(mimeType)) ||
    await fileLooksLikeActiveContent(file)
  ) {
    return t('attachments.errors.activeContentBlocked')
  }
  return null
}

function buildClaimProgressSteps(status: string, t: TranslateFn): StepIndicatorStep[] {
  if (status === 'draft') {
    return [
      { id: 'draft', label: t('warranty_claims.status.draft'), status: 'current', description: t('warranty_claims.portal.detail.notSubmitted') },
      ...CLAIM_STATUS_ORDER.map((step) => ({ id: step, label: t(`warranty_claims.status.${step}`), status: 'pending' as const })),
    ]
  }

  if (status === 'info_requested') {
    return [
      { id: 'submitted', label: t('warranty_claims.status.submitted'), status: 'complete' },
      { id: 'in_review', label: t('warranty_claims.status.in_review'), status: 'complete' },
      { id: 'info_requested', label: t('warranty_claims.portal.actionNeeded'), status: 'error', description: t('warranty_claims.portal.detail.actionNeededDescription') },
      ...CLAIM_STATUS_ORDER.slice(2).map((step) => ({ id: step, label: t(`warranty_claims.status.${step}`), status: 'pending' as const })),
    ]
  }

  if (status === 'rejected' || status === 'cancelled') {
    return [
      { id: 'submitted', label: t('warranty_claims.status.submitted'), status: 'complete' },
      { id: status, label: t(`warranty_claims.status.${status}`), status: 'error', description: t(`warranty_claims.portal.detail.terminal.${status}`) },
    ]
  }

  const currentStatusIndex = CLAIM_STATUS_ORDER.findIndex((step) => step === status)
  return CLAIM_STATUS_ORDER.map((step, index) => ({
    id: step,
    label: t(`warranty_claims.status.${step}`),
    status: currentStatusIndex < 0 ? 'pending' : index < currentStatusIndex ? 'complete' : index === currentStatusIndex ? 'current' : 'pending',
  }))
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
    const validationError = await validateAttachmentFile(selectedFile, t)
    if (validationError) {
      setError(validationError)
      flash(validationError, 'error')
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

  const handleSelectedFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    if (!file) {
      setSelectedFile(null)
      return
    }
    const validationError = await validateAttachmentFile(file, t)
    if (validationError) {
      setSelectedFile(null)
      setFileInputKey((current) => current + 1)
      setError(validationError)
      flash(validationError, 'error')
      return
    }
    setError(null)
    setSelectedFile(file)
  }, [t])

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

  const claimProgressSteps = buildClaimProgressSteps(claim.status, t)
  const isDraft = claim.status === 'draft'
  const needsCustomerAction = claim.status === 'info_requested'
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
        <StepIndicator steps={claimProgressSteps} orientation="vertical" />
        {isDraft ? (
          <Alert status="information" style="lighter" className="mt-4">
            <AlertTitle>{t('warranty_claims.status.draft')}</AlertTitle>
            <AlertDescription>{t('warranty_claims.portal.detail.notSubmitted')}</AlertDescription>
          </Alert>
        ) : null}
        {needsCustomerAction ? (
          <Alert status="warning" style="lighter" className="mt-4">
            <AlertTitle>{t('warranty_claims.portal.actionNeeded')}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>{t('warranty_claims.portal.detail.actionNeededDescription')}</span>
              <Button asChild variant="outline" size="sm">
                <a href="#warranty-claim-comment-box">{t('warranty_claims.portal.detail.goToComment')}</a>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
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
              <dd className="mt-1 text-sm font-medium">{claim.orderNumber ?? t('warranty_claims.portal.value.notAvailable')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('warranty_claims.form.reasonCode')}</dt>
              <dd className="mt-1 text-sm font-medium">{claim.reasonCode ? localizeDictionaryLabel(t, 'reason', claim.reasonCode, claim.reasonCode) : t('warranty_claims.portal.value.notAvailable')}</dd>
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

        <form id="warranty-claim-comment-box" className="mt-6 flex flex-col gap-3" onSubmit={handleCommentSubmit}>
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
                accept={ATTACHMENT_ACCEPT_TYPES}
                onChange={handleSelectedFileChange}
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
