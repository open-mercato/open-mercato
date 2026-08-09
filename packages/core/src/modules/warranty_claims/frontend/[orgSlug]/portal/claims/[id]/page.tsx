"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, CircleAlert, Info, Paperclip, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { localizeDictionaryLabel } from '@open-mercato/core/modules/warranty_claims/lib/dictionaryLabels'
import { formatQuantity } from '@open-mercato/core/modules/warranty_claims/lib/quantity'
import {
  ATTACHMENT_ACCEPT_TYPES,
  validateAttachmentFile,
} from '@open-mercato/core/modules/warranty_claims/lib/portalAttachmentValidation'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
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
type ClaimActionResponse = MutationOkResponse & { claimId?: string; status?: string }

type PortalClaimAction = 'submit' | 'withdraw'

type TrackerStepState = 'complete' | 'current' | 'pending'

type TrackerStep = {
  id: string
  title: string
  description: string
  state: TrackerStepState
  dateLabel: string | null
}

type BannerTone = 'info' | 'success' | 'warning' | 'error'

type ActivityEntry = {
  id: string
  title: string
  description: string
  createdAt: string | null
  href?: string
}

const TRACKER_STEP_KEYS = ['received', 'review', 'decision', 'return', 'resolved'] as const

const STATUS_STEP_INDEX: Record<string, number> = {
  draft: 0,
  submitted: 1,
  in_review: 1,
  info_requested: 1,
  rejected: 2,
  cancelled: 2,
  approved: 3,
  awaiting_return: 3,
  received: 4,
  inspecting: 4,
  resolved: 5,
  closed: 5,
}

const LINE_STATUS_DOT_COLORS: Record<string, string> = {
  pending: '#a3a3a3',
  approved: '#10B981',
  rejected: '#F28026',
  received: '#6552e3',
  inspected: '#6552e3',
  resolved: '#10B981',
}

const BANNER_TONE_CLASSES: Record<BannerTone, { wrapper: string; text: string; icon: string }> = {
  info: {
    wrapper: 'bg-[#f1f4fe] dark:bg-indigo-950/40',
    text: 'text-[#38408c] dark:text-indigo-300',
    icon: 'text-[#4A53C4] dark:text-indigo-300',
  },
  success: {
    wrapper: 'bg-[#eefaf3] dark:bg-emerald-950/40',
    text: 'text-[#1c6b43] dark:text-emerald-300',
    icon: 'text-[#21ad61] dark:text-emerald-300',
  },
  warning: {
    wrapper: 'bg-[#fdf5e7] dark:bg-amber-950/40',
    text: 'text-[#8a5a1d] dark:text-amber-300',
    icon: 'text-[#d97706] dark:text-amber-300',
  },
  error: {
    wrapper: 'bg-[#fdeeee] dark:bg-red-950/40',
    text: 'text-[#933535] dark:text-red-300',
    icon: 'text-[#dc2626] dark:text-red-300',
  },
}

function bannerTone(status: string): BannerTone {
  if (status === 'rejected' || status === 'cancelled') return 'error'
  if (status === 'info_requested') return 'warning'
  if (status === 'approved' || status === 'resolved' || status === 'closed') return 'success'
  return 'info'
}

function bannerMessage(claim: PortalClaim, t: TranslateFn): string {
  switch (claim.status) {
    case 'draft':
      return t('warranty_claims.portal.tracker.banner.draft')
    case 'info_requested':
      return t('warranty_claims.portal.tracker.banner.infoRequested')
    case 'approved':
      return t('warranty_claims.portal.tracker.banner.approved')
    case 'awaiting_return':
      return t('warranty_claims.portal.tracker.banner.awaitingReturn')
    case 'received':
    case 'inspecting':
      return t('warranty_claims.portal.tracker.banner.goodsFlow')
    case 'resolved':
    case 'closed':
      return claim.resolutionSummary ?? t('warranty_claims.portal.tracker.banner.resolved')
    case 'rejected': {
      const reason = claim.rejectionReasonCode
        ? localizeDictionaryLabel(t, 'rejection', claim.rejectionReasonCode, claim.rejectionReasonCode)
        : null
      const base = t('warranty_claims.portal.detail.terminal.rejected')
      const parts = [base, reason, claim.resolutionSummary].filter((part): part is string => Boolean(part))
      return parts.join(' ')
    }
    case 'cancelled':
      return t('warranty_claims.portal.detail.terminal.cancelled')
    default:
      return t('warranty_claims.portal.tracker.banner.review')
  }
}

function formatShortDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatLongDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function buildTrackerSteps(claim: PortalClaim, t: TranslateFn): TrackerStep[] {
  const currentIndex = STATUS_STEP_INDEX[claim.status] ?? 1
  return TRACKER_STEP_KEYS.map((key, index) => {
    const state: TrackerStepState = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'pending'
    let dateLabel: string | null = null
    if (index === 0 && state === 'complete') dateLabel = formatShortDate(claim.submittedAt)
    if (index === TRACKER_STEP_KEYS.length - 1 && state === 'complete') {
      dateLabel = formatShortDate(claim.resolvedAt ?? claim.closedAt)
    }
    if (state === 'current') dateLabel = t('warranty_claims.portal.tracker.step.now')
    return {
      id: key,
      title: t(`warranty_claims.portal.tracker.step.${key}.title`),
      description: t(`warranty_claims.portal.tracker.step.${key}.description`),
      state,
      dateLabel,
    }
  })
}

function buildClaimTitle(claim: PortalClaim, t: TranslateFn): string {
  const typeLabel = t(`warranty_claims.claimType.${claim.claimType}`)
  if (claim.reasonCode) {
    const reasonLabel = localizeDictionaryLabel(t, 'reason', claim.reasonCode, claim.reasonCode)
    return t('warranty_claims.portal.tracker.titleWithReason', { reason: reasonLabel, type: typeLabel })
  }
  return t('warranty_claims.portal.tracker.titleFallback', { type: typeLabel })
}

function buildClaimSubtitle(claim: PortalClaim, t: TranslateFn): string {
  if (claim.status === 'draft') {
    const created = formatLongDate(claim.createdAt)
    return created
      ? t('warranty_claims.portal.tracker.draftCreated', { date: created })
      : t('warranty_claims.portal.detail.notSubmitted')
  }
  const submitted = formatLongDate(claim.submittedAt) ?? formatLongDate(claim.createdAt)
  if (!submitted) return t('warranty_claims.portal.value.notAvailable')
  if (claim.orderNumber) {
    return t('warranty_claims.portal.tracker.submittedFromOrder', { date: submitted, order: claim.orderNumber })
  }
  return t('warranty_claims.portal.tracker.submittedOn', { date: submitted })
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

function eventTitle(event: PortalClaimEvent, t: TranslateFn): string {
  if (event.kind === 'comment') {
    return event.actorCustomerId
      ? t('warranty_claims.portal.tracker.event.youReplied')
      : t('warranty_claims.portal.tracker.event.teamReplied')
  }
  return t(`warranty_claims.portal.event.${event.kind}`)
}

function buildActivityEntries(
  events: PortalClaimEvent[],
  attachments: PortalAttachment[],
  t: TranslateFn,
): ActivityEntry[] {
  const eventEntries: ActivityEntry[] = events.map((event) => ({
    id: `event-${event.id}`,
    title: eventTitle(event, t),
    description: formatEventBody(event, t),
    createdAt: event.createdAt,
  }))
  const attachmentEntries: ActivityEntry[] = attachments.map((attachment) => ({
    id: `attachment-${attachment.id}`,
    title: t('warranty_claims.portal.tracker.event.attachmentAdded'),
    description: attachment.fileName,
    createdAt: attachment.createdAt,
    href: attachment.downloadUrl,
  }))
  return [...eventEntries, ...attachmentEntries].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0
    return rightTime - leftTime
  })
}

const DETAIL_MUTATION_CONTEXT_ID = 'warranty_claims.portal.claim.detail'

const SECTION_CLASS = 'flex w-full flex-col gap-[12px] border-t border-[#ededed] px-[28px] pb-[22px] pt-[20px] dark:border-border'
const SECTION_HEADING_CLASS = 'text-[14px] font-semibold text-[#0f0f12] dark:text-foreground'
const DARK_BUTTON_CLASS = 'rounded-[8px] bg-[#262626] px-[10px] py-[6px] text-[14px] font-medium leading-[20px] tracking-[-0.084px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-foreground dark:text-background'

export default function WarrantyClaimPortalDetailPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const guardedMutation = useGuardedMutation<Record<string, unknown>>({
    contextId: DETAIL_MUTATION_CONTEXT_ID,
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
  const [fileInputKey, setFileInputKey] = React.useState(0)
  const [uploading, setUploading] = React.useState(false)
  const [claimAction, setClaimAction] = React.useState<PortalClaimAction | null>(null)
  const [actionSubmitting, setActionSubmitting] = React.useState(false)

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
          formId: DETAIL_MUTATION_CONTEXT_ID,
          resourceKind: 'warranty_claims.claim_event',
          resourceId: claim.id,
          retryLastMutation: guardedMutation.retryLastMutation,
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

  const uploadAttachment = React.useCallback(async (file: File) => {
    if (!claim || uploading) return
    const validationError = await validateAttachmentFile(file, t)
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
      form.set('file', file)
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
          formId: DETAIL_MUTATION_CONTEXT_ID,
          resourceKind: 'attachments.attachment',
          resourceId: claim.id,
          retryLastMutation: guardedMutation.retryLastMutation,
        },
        mutationPayload: { claimId: claim.id, fileName: file.name, fileSize: file.size },
      })
      if (!result.ok || !result.result?.ok) {
        setError(t('warranty_claims.portal.detail.attachmentError'))
        return
      }
      flash(t('warranty_claims.portal.detail.attachmentSuccess'), 'success')
      await refreshAttachments(claim.id)
    } catch {
      setError(t('warranty_claims.portal.detail.attachmentError'))
    } finally {
      setUploading(false)
      setFileInputKey((current) => current + 1)
    }
  }, [claim, guardedMutation, refreshAttachments, t, uploading])

  const runClaimAction = React.useCallback(async (action: PortalClaimAction) => {
    if (!claim || actionSubmitting) return
    setActionSubmitting(true)
    setError(null)
    try {
      const endpoint = `/api/warranty_claims/portal/claims/${encodeURIComponent(claim.id)}/${action}`
      const result = await guardedMutation.runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(claim.updatedAt),
          () => apiCall<ClaimActionResponse>(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({}),
          }),
        ),
        context: {
          moduleId: 'warranty_claims',
          entityId: 'warranty_claims.claim',
          operation: action === 'submit' ? 'portal_submit' : 'portal_withdraw',
          claimId: claim.id,
          formId: DETAIL_MUTATION_CONTEXT_ID,
          resourceKind: 'warranty_claims.claim',
          resourceId: claim.id,
          retryLastMutation: guardedMutation.retryLastMutation,
        },
        mutationPayload: { claimId: claim.id, action },
      })
      if (!result.ok || !result.result?.ok) {
        const message = result.status === 409
          ? t('warranty_claims.portal.detail.actionConflict', 'This claim changed in the meantime. It has been reloaded — please try again.')
          : action === 'submit'
            ? t('warranty_claims.portal.detail.submitError', 'The claim could not be submitted.')
            : t('warranty_claims.portal.detail.withdrawError', 'The claim could not be withdrawn.')
        setError(message)
        flash(message, 'error')
        if (result.status === 409) {
          setClaimAction(null)
          await loadClaim()
        }
        return
      }
      setClaimAction(null)
      flash(
        action === 'submit'
          ? t('warranty_claims.portal.detail.submitSuccess', 'Your claim has been submitted.')
          : t('warranty_claims.portal.detail.withdrawSuccess', 'Your claim has been withdrawn.'),
        'success',
      )
      await loadClaim()
    } catch {
      const message = action === 'submit'
        ? t('warranty_claims.portal.detail.submitError', 'The claim could not be submitted.')
        : t('warranty_claims.portal.detail.withdrawError', 'The claim could not be withdrawn.')
      setError(message)
      flash(message, 'error')
    } finally {
      setActionSubmitting(false)
    }
  }, [actionSubmitting, claim, guardedMutation, loadClaim, t])

  const handleSelectedFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    if (!file) return
    void uploadAttachment(file)
  }, [uploadAttachment])

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

  const trackerSteps = buildTrackerSteps(claim, t)
  const isDraft = claim.status === 'draft'
  const canWithdraw = claim.status === 'draft' || claim.status === 'submitted'
  const tone = bannerTone(claim.status)
  const toneClasses = BANNER_TONE_CLASSES[tone]
  const BannerIcon = tone === 'error' ? CircleAlert : tone === 'warning' ? TriangleAlert : Info
  const activityEntries = buildActivityEntries(events, attachments, t)

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-[14px]">
      <Link
        href={`/${params.orgSlug}/portal/claims`}
        className="text-[13px] font-medium text-[#737378] transition-colors hover:text-[#0f0f12] dark:text-muted-foreground dark:hover:text-foreground"
      >
        {'←'}  {t('warranty_claims.portal.listTitle')}
      </Link>

      {error ? <ErrorMessage label={error} /> : null}

      <div className="w-full overflow-hidden rounded-[16px] border border-[#e2e2e2] bg-white dark:border-border dark:bg-card">
        <div className="flex w-full flex-col gap-[10px] px-[28px] pb-[20px] pt-[26px]">
          <div className="flex w-full items-center gap-[8px]">
            <div className="flex items-center gap-[6px] rounded-[6px] border border-[#e2e2e2] bg-white px-[10px] py-[4px] dark:border-border dark:bg-transparent">
              <span className="text-[11.5px] font-medium text-[#6b6b70] dark:text-muted-foreground">
                {t(`warranty_claims.claimType.${claim.claimType}`)}
              </span>
              <span className="text-[13px] font-semibold text-[#0f0f12] dark:text-foreground">
                {claim.claimNumber}
              </span>
            </div>
            <div className="min-w-px flex-1" />
            {isDraft ? (
              <button
                type="button"
                className={DARK_BUTTON_CLASS}
                onClick={() => setClaimAction('submit')}
                disabled={actionSubmitting}
              >
                {t('warranty_claims.portal.submit')}
              </button>
            ) : null}
            {canWithdraw ? (
              <button
                type="button"
                className="rounded-[8px] border border-[#dc2626] bg-white px-[10px] py-[6px] text-[14px] font-medium leading-[20px] tracking-[-0.084px] text-[#dc2626] transition-colors hover:bg-[#fdeeee] disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/40"
                onClick={() => setClaimAction('withdraw')}
                disabled={actionSubmitting}
              >
                {t('warranty_claims.portal.detail.withdraw', 'Withdraw claim')}
              </button>
            ) : null}
          </div>
          <h1 className="text-[20px] font-bold text-[#0a0a0a] dark:text-foreground">
            {buildClaimTitle(claim, t)}
          </h1>
          <p className="text-[13px] text-[#737378] dark:text-muted-foreground">
            {buildClaimSubtitle(claim, t)}
          </p>
        </div>

        <div className="w-full px-[28px] pb-[22px]">
          <div className={`flex w-full items-start gap-[10px] rounded-[10px] px-[14px] py-[12px] ${toneClasses.wrapper}`}>
            <BannerIcon className={`mt-px size-[16px] shrink-0 ${toneClasses.icon}`} strokeWidth={1.7} aria-hidden="true" />
            <p className={`min-w-px flex-1 text-[13px] ${toneClasses.text}`}>
              {bannerMessage(claim, t)}
            </p>
          </div>
        </div>

        <div className="flex w-full flex-col px-[28px] pb-[24px]">
          {trackerSteps.map((step, index) => (
            <div key={step.id} className="flex w-full items-stretch gap-[14px]">
              <div className="flex flex-col items-center">
                {step.state === 'complete' ? (
                  <span className="flex size-[24px] shrink-0 items-center justify-center rounded-full bg-[#21ad61]">
                    <Check className="size-[11px] text-white" strokeWidth={2.5} aria-hidden="true" />
                  </span>
                ) : step.state === 'current' ? (
                  <span className="flex size-[24px] shrink-0 items-center justify-center rounded-full bg-[#6552e3] text-[12px] font-semibold text-white">
                    {index + 1}
                  </span>
                ) : (
                  <span className="flex size-[24px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#e2e2e2] text-[12px] font-semibold text-[#737378] dark:border-border dark:text-muted-foreground">
                    {index + 1}
                  </span>
                )}
                {index < trackerSteps.length - 1 ? (
                  <span
                    className={`min-h-[10px] w-[2px] flex-1 ${step.state === 'complete' ? 'bg-[#21ad61]' : 'bg-[#ebebeb] dark:bg-border'}`}
                  />
                ) : null}
              </div>
              <div className="flex min-w-px flex-1 flex-col gap-[2px] pb-[14px]">
                <div className="flex w-full items-center gap-[8px]">
                  <p
                    className={
                      step.state === 'pending'
                        ? 'text-[14px] font-medium text-[#737378] dark:text-muted-foreground'
                        : 'text-[14px] font-semibold text-[#0f0f12] dark:text-foreground'
                    }
                  >
                    {step.title}
                  </p>
                  <div className="min-w-px flex-1" />
                  {step.dateLabel ? (
                    <p className="text-[12px] text-[#8e8e8e] dark:text-muted-foreground">{step.dateLabel}</p>
                  ) : null}
                </div>
                <p className="w-full text-[12px] text-[#8e8e8e] dark:text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className={SECTION_CLASS}>
          <p className={SECTION_HEADING_CLASS}>{t('warranty_claims.portal.tracker.items')}</p>
          {claim.lines.length > 0 ? (
            claim.lines.map((line) => (
              <div
                key={line.id}
                className="flex w-full items-center gap-[12px] rounded-[10px] border border-[#ededed] px-[14px] py-[12px] dark:border-border"
              >
                <div className="flex min-w-px flex-1 flex-col gap-[2px]">
                  <p className="text-[14px] font-medium text-[#0f0f12] dark:text-foreground">
                    {line.productName ?? line.sku ?? t('warranty_claims.portal.value.unnamedLine')}
                  </p>
                  <p className="text-[12px] text-[#8e8e8e] dark:text-muted-foreground">
                    {line.sku
                      ? t('warranty_claims.portal.tracker.itemMeta', {
                          sku: line.sku,
                          qty: formatQuantity(line.qtyClaimed, t('warranty_claims.portal.value.notAvailable')),
                        })
                      : t('warranty_claims.portal.tracker.itemQty', {
                          qty: formatQuantity(line.qtyClaimed, t('warranty_claims.portal.value.notAvailable')),
                        })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-[6px] rounded-[6px] border border-[#e2e2e2] bg-white px-[9px] py-[4px] dark:border-border dark:bg-transparent">
                  <span
                    className="size-[6px] shrink-0 rounded-full"
                    style={{ backgroundColor: LINE_STATUS_DOT_COLORS[line.lineStatus] ?? '#a3a3a3' }}
                    aria-hidden="true"
                  />
                  <span className="text-[12px] font-medium text-[#0f0f12] dark:text-foreground">
                    {t(`warranty_claims.lineStatus.${line.lineStatus}`)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-[12px] text-[#8e8e8e] dark:text-muted-foreground">
              {t('warranty_claims.portal.detail.linesEmpty.description')}
            </p>
          )}
        </div>

        <div className={SECTION_CLASS}>
          <p className={SECTION_HEADING_CLASS}>{t('warranty_claims.portal.tracker.activity')}</p>
          {activityEntries.length > 0 ? (
            activityEntries.map((entry) => (
              <div key={entry.id} className="flex w-full items-start gap-[10px]">
                <span className="mt-[5px] size-[7px] shrink-0 rounded-full bg-[#D1D1D6] dark:bg-muted-foreground/40" aria-hidden="true" />
                <div className="flex min-w-px flex-1 flex-col gap-px">
                  <div className="flex w-full items-start gap-[8px]">
                    <p className="text-[13px] font-medium text-[#0f0f12] dark:text-foreground">{entry.title}</p>
                    <div className="min-w-px flex-1" />
                    {entry.createdAt ? (
                      <p className="text-[12px] text-[#8e8e8e] dark:text-muted-foreground">{formatShortDate(entry.createdAt)}</p>
                    ) : null}
                  </div>
                  {entry.href ? (
                    <a
                      href={entry.href}
                      target="_blank"
                      rel="noreferrer"
                      className="whitespace-pre-wrap text-[12px] text-[#8e8e8e] underline-offset-2 hover:underline dark:text-muted-foreground"
                    >
                      {entry.description}
                    </a>
                  ) : (
                    <p className="whitespace-pre-wrap text-[12px] text-[#8e8e8e] dark:text-muted-foreground">{entry.description}</p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-[12px] text-[#8e8e8e] dark:text-muted-foreground">
              {t('warranty_claims.portal.detail.timelineEmpty.description')}
            </p>
          )}
        </div>

        <div className={SECTION_CLASS}>
          <p className={SECTION_HEADING_CLASS}>{t('warranty_claims.portal.tracker.message')}</p>
          <form id="warranty-claim-comment-box" className="flex w-full flex-col gap-[12px]" onSubmit={handleCommentSubmit}>
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={handleCommentKeyDown}
              placeholder={t('warranty_claims.portal.tracker.messagePlaceholder')}
              disabled={commentSubmitting}
              maxLength={8000}
              className="h-[156px] resize-none rounded-[12px] border-[#ebebeb] bg-white px-[12px] py-[10px] text-[14px] tracking-[-0.084px] shadow-[0px_1px_2px_0px_rgba(10,13,20,0.03)] placeholder:text-[#a3a3a3] dark:border-border dark:bg-background"
            />
            <div className="flex w-full items-center gap-[8px]">
              <label className={`flex items-center gap-[6px] ${uploading ? 'cursor-default opacity-70' : 'cursor-pointer'}`}>
                {uploading ? (
                  <Spinner className="size-[14px]" />
                ) : (
                  <Paperclip className="size-[14px] text-[#737378] dark:text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                )}
                <span className="text-[12px] font-medium text-[#737378] transition-colors hover:text-[#0f0f12] dark:text-muted-foreground dark:hover:text-foreground">
                  {uploading
                    ? t('warranty_claims.portal.detail.uploading')
                    : t('warranty_claims.portal.tracker.attachFiles')}
                </span>
                <input
                  key={fileInputKey}
                  type="file"
                  accept={ATTACHMENT_ACCEPT_TYPES}
                  onChange={handleSelectedFileChange}
                  disabled={uploading}
                  className="sr-only"
                />
              </label>
              <div className="min-w-px flex-1" />
              <button type="submit" className={DARK_BUTTON_CLASS} disabled={commentSubmitting || !comment.trim()}>
                {commentSubmitting
                  ? t('warranty_claims.portal.tracker.sending')
                  : t('warranty_claims.portal.tracker.send')}
              </button>
            </div>
          </form>
        </div>
      </div>

      <Dialog
        open={claimAction !== null}
        onOpenChange={(open) => {
          if (!open && !actionSubmitting) setClaimAction(null)
        }}
      >
        <DialogContent
          className="max-w-lg"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              if (claimAction && !actionSubmitting) void runClaimAction(claimAction)
            }
            if (event.key === 'Escape' && !actionSubmitting) {
              setClaimAction(null)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {claimAction === 'withdraw'
                ? t('warranty_claims.portal.detail.withdrawDialog.title', 'Withdraw this claim?')
                : t('warranty_claims.portal.detail.submitDialog.title', 'Submit this claim?')}
            </DialogTitle>
            <DialogDescription>
              {claimAction === 'withdraw'
                ? t('warranty_claims.portal.detail.withdrawDialog.description', 'The claim will be cancelled and cannot be reopened. This cannot be undone.')
                : t('warranty_claims.portal.detail.submitDialog.description', 'Your claim will be sent to our support team for review. You can still add comments and photos afterwards.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClaimAction(null)}
              disabled={actionSubmitting}
            >
              {t('warranty_claims.portal.detail.dialogCancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant={claimAction === 'withdraw' ? 'destructive' : 'default'}
              onClick={() => {
                if (claimAction) void runClaimAction(claimAction)
              }}
              disabled={actionSubmitting}
            >
              {claimAction === 'withdraw'
                ? (actionSubmitting
                  ? t('warranty_claims.portal.detail.withdrawing', 'Withdrawing...')
                  : t('warranty_claims.portal.detail.withdrawConfirm', 'Withdraw claim'))
                : (actionSubmitting
                  ? t('warranty_claims.portal.detail.submitting', 'Submitting...')
                  : t('warranty_claims.portal.detail.submitConfirm', 'Submit claim'))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
