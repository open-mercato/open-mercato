"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Info, MessageSquare, RefreshCw, UserRound } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AttachmentInput } from '@open-mercato/core/modules/attachments/fields/attachment'
import { CLAIM_STATUS_TRANSITIONS } from '../../../data/constants'
import {
  ClaimLineStatusBadge,
  ClaimStatusBadge,
  type ClaimLineStatus,
  type ClaimStatus,
} from '../../components/ClaimStatusBadge'

type ClaimType = 'warranty' | 'return' | 'core_return' | 'vendor_recovery'
type ClaimPriority = 'low' | 'normal' | 'high' | 'urgent'
type Disposition =
  | 'restock'
  | 'repair'
  | 'replace'
  | 'credit'
  | 'refund'
  | 'field_destroy'
  | 'scrap'
  | 'return_to_vendor'
  | 'deny'

type ClaimRecord = {
  id: string
  claimNumber: string | null
  claimType: ClaimType | string | null
  status: ClaimStatus | string | null
  priority: ClaimPriority | string | null
  customerName: string | null
  orderId: string | null
  vendorName: string | null
  vendorRef: string | null
  totalClaimedAmount: string | null
  totalApprovedAmount: string | null
  totalRecoveredAmount: string | null
  slaDueAt: string | null
  updatedAt: string | null
  currencyCode: string | null
  notes: string | null
  reasonCode: string | null
  rejectionReasonCode: string | null
  resolutionSummary: string | null
}

type ClaimLine = {
  id: string
  claimId: string | null
  lineNo: number | null
  productName: string | null
  sku: string | null
  serialNumber: string | null
  faultCode: string | null
  faultDescription: string | null
  qtyClaimed: string | null
  qtyApproved: string | null
  qtyReceived: string | null
  disposition: Disposition | string | null
  lineStatus: ClaimLineStatus | string | null
  creditAmount: string | null
  restockingFee: string | null
  coreChargeAmount: string | null
  coreCreditAmount: string | null
  vendorClaimLineId: string | null
  conditionOnReceipt: string | null
  inspectionNotes: string | null
  updatedAt: string | null
}

type ClaimEvent = {
  id: string
  kind: string
  visibility: 'internal' | 'customer' | string
  body: string | null
  payload: Record<string, unknown> | null
  actorUserId: string | null
  actorCustomerId: string | null
  createdAt: string | null
}

type ClaimTriageSuggestion = {
  priority: {
    currentPriority: string
    suggestedPriority: string
    overdue: boolean
    reason: string
  }
  lines: Array<{
    lineId: string
    lineNo: number
    sku: string | null
    productName: string | null
    serialNumber: string | null
    eligibility: {
      status: string
      reason: string
    }
    suggestedDisposition: string
    reason: string
  }>
  generatedAt: string
}

function eligibilityBadgeVariant(status: string): 'success' | 'error' | 'neutral' {
  if (status === 'in_warranty') return 'success'
  if (status === 'out_of_warranty') return 'error'
  return 'neutral'
}

type ClaimFormValues = Partial<ClaimRecord> & Record<string, unknown>
type ClaimLineFormValues = Partial<ClaimLine> & Record<string, unknown>
type TransitionFormValues = {
  rejectionReasonCode?: string | null
  resolutionSummary?: string | null
}
type VendorRecoveryFormValues = {
  lineIds?: string[]
  vendorName?: string | null
  vendorRef?: string | null
}

type TabId = 'lines' | 'timeline' | 'attachments' | 'ai'

const CLAIM_LINE_STATUSES: ClaimLineStatus[] = ['pending', 'approved', 'rejected', 'received', 'inspected', 'resolved']
const CLAIM_DISPOSITIONS: Disposition[] = [
  'restock',
  'repair',
  'replace',
  'credit',
  'refund',
  'field_destroy',
  'scrap',
  'return_to_vendor',
  'deny',
]
const DICTIONARY_KEYS = {
  faultCodes: 'warranty_claims.warranty_claim_fault_code',
  rejectionReasons: 'warranty_claims.warranty_claim_rejection_reason',
} as const
const TERMINAL_STATUSES = new Set<string>(['closed', 'cancelled'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeClaim(value: unknown): ClaimRecord | null {
  if (!isRecord(value)) return null
  const id = toStringOrNull(value.id)
  if (!id) return null
  return {
    id,
    claimNumber: toStringOrNull(value.claimNumber),
    claimType: toStringOrNull(value.claimType),
    status: toStringOrNull(value.status),
    priority: toStringOrNull(value.priority),
    customerName: toStringOrNull(value.customerName),
    orderId: toStringOrNull(value.orderId),
    vendorName: toStringOrNull(value.vendorName),
    vendorRef: toStringOrNull(value.vendorRef),
    totalClaimedAmount: toStringOrNull(value.totalClaimedAmount),
    totalApprovedAmount: toStringOrNull(value.totalApprovedAmount),
    totalRecoveredAmount: toStringOrNull(value.totalRecoveredAmount),
    slaDueAt: toStringOrNull(value.slaDueAt),
    updatedAt: toStringOrNull(value.updatedAt),
    currencyCode: toStringOrNull(value.currencyCode),
    notes: toStringOrNull(value.notes),
    reasonCode: toStringOrNull(value.reasonCode),
    rejectionReasonCode: toStringOrNull(value.rejectionReasonCode),
    resolutionSummary: toStringOrNull(value.resolutionSummary),
  }
}

function normalizeLine(value: unknown): ClaimLine | null {
  if (!isRecord(value)) return null
  const id = toStringOrNull(value.id)
  if (!id) return null
  return {
    id,
    claimId: toStringOrNull(value.claimId),
    lineNo: toNumberOrNull(value.lineNo),
    productName: toStringOrNull(value.productName),
    sku: toStringOrNull(value.sku),
    serialNumber: toStringOrNull(value.serialNumber),
    faultCode: toStringOrNull(value.faultCode),
    faultDescription: toStringOrNull(value.faultDescription),
    qtyClaimed: toStringOrNull(value.qtyClaimed),
    qtyApproved: toStringOrNull(value.qtyApproved),
    qtyReceived: toStringOrNull(value.qtyReceived),
    disposition: toStringOrNull(value.disposition),
    lineStatus: toStringOrNull(value.lineStatus),
    creditAmount: toStringOrNull(value.creditAmount),
    restockingFee: toStringOrNull(value.restockingFee),
    coreChargeAmount: toStringOrNull(value.coreChargeAmount),
    coreCreditAmount: toStringOrNull(value.coreCreditAmount),
    vendorClaimLineId: toStringOrNull(value.vendorClaimLineId),
    conditionOnReceipt: toStringOrNull(value.conditionOnReceipt),
    inspectionNotes: toStringOrNull(value.inspectionNotes),
    updatedAt: toStringOrNull(value.updatedAt),
  }
}

function normalizeEvent(value: unknown): ClaimEvent | null {
  if (!isRecord(value)) return null
  const id = toStringOrNull(value.id)
  if (!id) return null
  return {
    id,
    kind: toStringOrNull(value.kind) ?? 'system',
    visibility: toStringOrNull(value.visibility) ?? 'internal',
    body: toStringOrNull(value.body),
    payload: isRecord(value.payload) ? value.payload : null,
    actorUserId: toStringOrNull(value.actorUserId),
    actorCustomerId: toStringOrNull(value.actorCustomerId),
    createdAt: toStringOrNull(value.createdAt),
  }
}

function normalizeDictionaryOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const value = toStringOrNull(item.value)
  if (!value) return null
  return { value, label: toStringOrNull(item.label) ?? value }
}

function nullableText(value: unknown): string | null {
  return toStringOrNull(value)
}

function buildConflictError(call: { status: number; result: unknown }, fallbackMessage: string): Error & Record<string, unknown> {
  const payload = isRecord(call.result) ? call.result : {}
  const message = typeof payload.error === 'string' ? payload.error : fallbackMessage
  return Object.assign(new Error(message), { status: call.status }, payload)
}

function formatAmount(value: string | null, currencyCode: string | null, fallback: string): string {
  const amount = toNumberOrNull(value)
  if (amount === null) return fallback
  if (!currencyCode) return amount.toLocaleString()
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(amount)
}

function formatDateTime(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function relativeTime(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diffMs = date.getTime() - Date.now()
  const absMs = Math.abs(diffMs)
  const unit = absMs >= 86_400_000 ? 'day' : absMs >= 3_600_000 ? 'hour' : 'minute'
  const unitMs = unit === 'day' ? 86_400_000 : unit === 'hour' ? 3_600_000 : 60_000
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
    Math.round(diffMs / unitMs),
    unit,
  )
}

function eventIcon(kind: string) {
  if (kind === 'comment') return MessageSquare
  if (kind === 'assignment') return UserRound
  if (kind === 'status_changed') return RefreshCw
  return Info
}

export default function WarrantyClaimDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [claim, setClaim] = React.useState<ClaimRecord | null>(null)
  const [lines, setLines] = React.useState<ClaimLine[]>([])
  const [events, setEvents] = React.useState<ClaimEvent[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<TabId>('lines')
  const [lineDialog, setLineDialog] = React.useState<{ mode: 'create' } | { mode: 'edit'; line: ClaimLine } | null>(null)
  const [transitionDialog, setTransitionDialog] = React.useState<{ toStatus: ClaimStatus } | null>(null)
  const [vendorDialogOpen, setVendorDialogOpen] = React.useState(false)
  const [commentBody, setCommentBody] = React.useState('')
  const [commentVisibility, setCommentVisibility] = React.useState<'internal' | 'customer'>('internal')
  const [aiSuggestion, setAiSuggestion] = React.useState<ClaimTriageSuggestion | null>(null)
  const [aiLoading, setAiLoading] = React.useState(false)

  const mutationContextId = React.useMemo(() => `warranty-claim:${id || 'pending'}`, [id])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('warranty_claims.common.saveBlocked'),
  })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'warranty_claims.claim',
    resourceId: claim?.id ?? id,
    retryLastMutation,
  }), [claim?.id, id, mutationContextId, retryLastMutation])

  const loadDictionaryOptions = React.useCallback(async (dictionaryKey: string): Promise<CrudFieldOption[]> => {
    const dictionaries = await readApiResultOrThrow<{ items?: Array<{ id?: string; key?: string }> }>(
      '/api/dictionaries',
      undefined,
      {
        fallback: { items: [] },
        errorMessage: t('warranty_claims.form.error.dictionaryLoad'),
      },
    )
    const dictionary = (dictionaries.items ?? []).find((item) => item.key === dictionaryKey)
    if (!dictionary?.id) return []
    const entries = await readApiResultOrThrow<{ items?: unknown[] }>(
      `/api/dictionaries/${encodeURIComponent(dictionary.id)}/entries`,
      undefined,
      {
        fallback: { items: [] },
        errorMessage: t('warranty_claims.form.error.dictionaryLoad'),
      },
    )
    return (entries.items ?? [])
      .map(normalizeDictionaryOption)
      .filter((option): option is CrudFieldOption => option !== null)
  }, [t])

  const loadData = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [claimPayload, linesPayload, eventsPayload] = await Promise.all([
        readApiResultOrThrow<{ items?: unknown[] }>(
          `/api/warranty_claims?ids=${encodeURIComponent(id)}&page=1&pageSize=1`,
          undefined,
          { fallback: { items: [] }, errorMessage: t('warranty_claims.detail.error.load') },
        ),
        readApiResultOrThrow<{ items?: unknown[] }>(
          `/api/warranty_claims/lines?claimId=${encodeURIComponent(id)}&page=1&pageSize=100`,
          undefined,
          { fallback: { items: [] }, errorMessage: t('warranty_claims.detail.error.loadLines') },
        ),
        readApiResultOrThrow<{ items?: unknown[] }>(
          `/api/warranty_claims/events?claimId=${encodeURIComponent(id)}`,
          undefined,
          { fallback: { items: [] }, errorMessage: t('warranty_claims.detail.error.loadEvents') },
        ),
      ])
      const nextClaim = (claimPayload.items ?? []).map(normalizeClaim).find((item): item is ClaimRecord => item !== null) ?? null
      if (!nextClaim) {
        setClaim(null)
        setLines([])
        setEvents([])
        setError(t('warranty_claims.errors.notFound'))
        return
      }
      setClaim(nextClaim)
      setLines((linesPayload.items ?? []).map(normalizeLine).filter((item): item is ClaimLine => item !== null))
      setEvents((eventsPayload.items ?? []).map(normalizeEvent).filter((item): item is ClaimEvent => item !== null))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('warranty_claims.detail.error.load'))
    } finally {
      setLoading(false)
    }
  }, [id, t])

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  const currentStatus = typeof claim?.status === 'string' ? claim.status : 'draft'
  const nextStatuses = React.useMemo(() => {
    if (!claim || !(currentStatus in CLAIM_STATUS_TRANSITIONS)) return []
    return CLAIM_STATUS_TRANSITIONS[currentStatus as ClaimStatus] ?? []
  }, [claim, currentStatus])

  const noValue = t('warranty_claims.common.noValue')
  const isTerminal = TERMINAL_STATUSES.has(currentStatus)
  const eligibleVendorLines = React.useMemo(
    () => lines.filter((line) => line.lineStatus === 'resolved' && !line.vendorClaimLineId),
    [lines],
  )

  const runClaimPost = React.useCallback(async (
    endpoint: string,
    body: Record<string, unknown>,
    successKey: string,
  ) => {
    if (!claim) return
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(claim.updatedAt),
            () => apiCall(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
          )
          if (!call.ok) {
            const errorObject = buildConflictError(call, t('warranty_claims.detail.error.action'))
            if (surfaceRecordConflict(errorObject, t, { onRefresh: loadData })) return call
            throw errorObject
          }
          return call
        },
        context: mutationContext,
        mutationPayload: body,
      })
      flash(t(successKey), 'success')
      await loadData()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      const message = err instanceof Error ? err.message : t('warranty_claims.detail.error.action')
      flash(message, 'error')
    }
  }, [claim, loadData, mutationContext, runMutation, t])

  const loadAiSuggestion = React.useCallback(async () => {
    if (!id) return
    setAiLoading(true)
    try {
      const suggestion = await readApiResultOrThrow<ClaimTriageSuggestion>(
        `/api/warranty_claims/ai/suggest?claimId=${encodeURIComponent(id)}`,
        undefined,
        { errorMessage: t('warranty_claims.detail.error.action') },
      )
      setAiSuggestion(suggestion)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('warranty_claims.detail.error.action')
      flash(message, 'error')
    } finally {
      setAiLoading(false)
    }
  }, [id, t])

  const applyAiDisposition = React.useCallback(async (lineId: string, disposition: string) => {
    if (!claim) return
    const line = lines.find((candidate) => candidate.id === lineId)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(line?.updatedAt ?? null),
          () => updateCrud('warranty_claims/lines', { id: lineId, claimId: claim.id, disposition }, {
            errorMessage: t('warranty_claims.detail.lines.error.save'),
          }),
        ),
        context: mutationContext,
        mutationPayload: { id: lineId, disposition },
      })
      flash(t('warranty_claims.detail.lines.flash.saved'), 'success')
      await loadData()
      await loadAiSuggestion()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      const message = err instanceof Error ? err.message : t('warranty_claims.detail.error.action')
      flash(message, 'error')
    }
  }, [claim, lines, loadAiSuggestion, loadData, mutationContext, runMutation, t])

  const handleTransition = React.useCallback(async (toStatus: ClaimStatus, values?: TransitionFormValues) => {
    if (!claim) return
    await runClaimPost(
      toStatus === 'submitted' && currentStatus === 'draft'
        ? '/api/warranty_claims/submit'
        : '/api/warranty_claims/transition',
      toStatus === 'submitted' && currentStatus === 'draft'
        ? { id: claim.id }
        : {
          id: claim.id,
          toStatus,
          rejectionReasonCode: nullableText(values?.rejectionReasonCode),
          resolutionSummary: nullableText(values?.resolutionSummary),
        },
      'warranty_claims.detail.flash.transitioned',
    )
  }, [claim, currentStatus, runClaimPost])

  const confirmAndTransition = React.useCallback(async (toStatus: ClaimStatus) => {
    if (!claim) return
    if (toStatus === 'rejected') {
      setTransitionDialog({ toStatus })
      return
    }
    if (toStatus === 'cancelled') {
      const confirmed = await confirm({
        title: t('warranty_claims.detail.confirm.cancelTitle'),
        variant: 'destructive',
      })
      if (!confirmed) return
    } else {
      const confirmed = await confirm({
        title: t('warranty_claims.detail.confirm.transitionTitle'),
      })
      if (!confirmed) return
    }
    await handleTransition(toStatus)
  }, [claim, confirm, handleTransition, t])

  const submitComment = React.useCallback(async () => {
    if (!claim || !commentBody.trim()) return
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall('/api/warranty_claims/events', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              claimId: claim.id,
              body: commentBody.trim(),
              visibility: commentVisibility,
            }),
          })
          if (!call.ok) throw buildConflictError(call, t('warranty_claims.detail.error.action'))
          return call
        },
        context: mutationContext,
        mutationPayload: {
          claimId: claim.id,
          body: commentBody.trim(),
          visibility: commentVisibility,
        },
      })
      setCommentBody('')
      flash(t('warranty_claims.detail.flash.commentAdded'), 'success')
      await loadData()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('warranty_claims.detail.error.comment')
      flash(message, 'error')
    }
  }, [claim, commentBody, commentVisibility, loadData, mutationContext, runMutation, t])

  const lineFields = React.useMemo<CrudField[]>(() => [
    { id: 'productName', label: t('warranty_claims.form.productName'), type: 'text', layout: 'half' },
    { id: 'sku', label: t('warranty_claims.form.sku'), type: 'text', layout: 'half' },
    { id: 'serialNumber', label: t('warranty_claims.form.serialNumber'), type: 'text', layout: 'half' },
    {
      id: 'faultCode',
      label: t('warranty_claims.form.faultCode'),
      type: 'select',
      loadOptions: () => loadDictionaryOptions(DICTIONARY_KEYS.faultCodes),
      layout: 'half',
    },
    { id: 'faultDescription', label: t('warranty_claims.form.faultDescription'), type: 'textarea', rows: 3, layout: 'full' },
    { id: 'qtyClaimed', label: t('warranty_claims.form.qtyClaimed'), type: 'number', layout: 'third' },
    { id: 'qtyApproved', label: t('warranty_claims.form.qtyApproved'), type: 'number', layout: 'third' },
    { id: 'qtyReceived', label: t('warranty_claims.form.qtyReceived'), type: 'number', layout: 'third' },
    {
      id: 'lineStatus',
      label: t('warranty_claims.form.lineStatus'),
      type: 'select',
      options: CLAIM_LINE_STATUSES.map((status) => ({ value: status, label: t(`warranty_claims.lineStatus.${status}`) })),
      layout: 'half',
    },
    {
      id: 'disposition',
      label: t('warranty_claims.form.disposition'),
      type: 'select',
      options: CLAIM_DISPOSITIONS.map((disposition) => ({
        value: disposition,
        label: t(`warranty_claims.disposition.${disposition}`),
      })),
      layout: 'half',
    },
    { id: 'creditAmount', label: t('warranty_claims.form.creditAmount'), type: 'number', layout: 'third' },
    { id: 'restockingFee', label: t('warranty_claims.form.restockingFee'), type: 'number', layout: 'third' },
    { id: 'coreChargeAmount', label: t('warranty_claims.form.coreChargeAmount'), type: 'number', layout: 'third' },
    { id: 'coreCreditAmount', label: t('warranty_claims.form.coreCreditAmount'), type: 'number', layout: 'third' },
    { id: 'conditionOnReceipt', label: t('warranty_claims.form.conditionOnReceipt'), type: 'textarea', rows: 3, layout: 'full' },
    { id: 'inspectionNotes', label: t('warranty_claims.form.inspectionNotes'), type: 'textarea', rows: 3, layout: 'full' },
  ], [loadDictionaryOptions, t])

  const lineGroups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'line-main',
      title: t('warranty_claims.form.lineHeader'),
      fields: [
        'productName',
        'sku',
        'serialNumber',
        'faultCode',
        'faultDescription',
        'qtyClaimed',
        'qtyApproved',
        'qtyReceived',
        'lineStatus',
        'disposition',
      ],
    },
    {
      id: 'line-money',
      title: t('warranty_claims.detail.lines.amounts'),
      fields: ['creditAmount', 'restockingFee', 'coreChargeAmount', 'coreCreditAmount'],
    },
    {
      id: 'line-inspection',
      title: t('warranty_claims.detail.lines.inspection'),
      fields: ['conditionOnReceipt', 'inspectionNotes'],
    },
  ], [t])

  const lineColumns = React.useMemo<ColumnDef<ClaimLine>[]>(() => [
    {
      accessorKey: 'lineNo',
      header: t('warranty_claims.form.lineNo'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.lineNo ?? noValue}</span>,
    },
    {
      accessorKey: 'lineStatus',
      header: t('warranty_claims.form.lineStatus'),
      cell: ({ row }) => <ClaimLineStatusBadge status={row.original.lineStatus} />,
    },
    {
      accessorKey: 'productName',
      header: t('warranty_claims.form.productName'),
      cell: ({ row }) => (
        <div className="space-y-1">
          <div className="font-medium">{row.original.productName ?? noValue}</div>
          <div className="text-xs text-muted-foreground">{row.original.sku ?? noValue}</div>
        </div>
      ),
    },
    {
      accessorKey: 'serialNumber',
      header: t('warranty_claims.form.serialNumber'),
      cell: ({ row }) => row.original.serialNumber ?? noValue,
    },
    {
      accessorKey: 'qtyClaimed',
      header: t('warranty_claims.form.qtyClaimed'),
      cell: ({ row }) => row.original.qtyClaimed ?? noValue,
    },
    {
      accessorKey: 'qtyApproved',
      header: t('warranty_claims.form.qtyApproved'),
      cell: ({ row }) => row.original.qtyApproved ?? noValue,
    },
    {
      accessorKey: 'qtyReceived',
      header: t('warranty_claims.form.qtyReceived'),
      cell: ({ row }) => row.original.qtyReceived ?? noValue,
    },
    {
      accessorKey: 'disposition',
      header: t('warranty_claims.form.disposition'),
      cell: ({ row }) => {
        const value = row.original.disposition
        return value ? <StatusBadge variant="neutral">{t(`warranty_claims.disposition.${value}`)}</StatusBadge> : noValue
      },
    },
    {
      accessorKey: 'creditAmount',
      header: t('warranty_claims.form.creditAmount'),
      cell: ({ row }) => formatAmount(row.original.creditAmount, claim?.currencyCode ?? null, noValue),
    },
  ], [claim?.currencyCode, noValue, t])

  const transitionFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'rejectionReasonCode',
      label: t('warranty_claims.form.rejectionReasonCode'),
      type: 'select',
      required: true,
      loadOptions: () => loadDictionaryOptions(DICTIONARY_KEYS.rejectionReasons),
    },
    {
      id: 'resolutionSummary',
      label: t('warranty_claims.form.resolutionSummary'),
      type: 'textarea',
      rows: 3,
      layout: 'full',
    },
  ], [loadDictionaryOptions, t])

  const vendorFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'lineIds',
      label: t('warranty_claims.detail.vendorRecovery.lines'),
      type: 'select',
      multiple: true,
      required: true,
      options: eligibleVendorLines.map((line) => ({
        value: line.id,
        label: `${line.lineNo ?? line.id} - ${line.productName ?? line.sku ?? line.id}`,
      })),
    },
    { id: 'vendorName', label: t('warranty_claims.form.vendorName'), type: 'text', required: true },
    { id: 'vendorRef', label: t('warranty_claims.form.vendorRef'), type: 'text' },
  ], [eligibleVendorLines, t])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('warranty_claims.detail.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !claim) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error ?? t('warranty_claims.errors.notFound')}
            action={(
              <Button asChild variant="outline" size="sm">
                <Link href="/backend/warranty_claims">{t('warranty_claims.detail.actions.backToList')}</Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'lines', label: t('warranty_claims.detail.tabs.lines') },
    { id: 'timeline', label: t('warranty_claims.detail.tabs.timeline') },
    { id: 'attachments', label: t('warranty_claims.detail.tabs.attachments') },
    { id: 'ai', label: t('warranty_claims.detail.tabs.ai') },
  ]

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">{claim.claimNumber ?? claim.id}</h1>
                  <StatusBadge variant="neutral">{t(`warranty_claims.claimType.${claim.claimType ?? 'warranty'}`)}</StatusBadge>
                  <ClaimStatusBadge status={claim.status} />
                  <StatusBadge variant="neutral">{t(`warranty_claims.priority.${claim.priority ?? 'normal'}`)}</StatusBadge>
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span>{t('warranty_claims.detail.customer')}: {claim.customerName ?? noValue}</span>
                  <span>{t('warranty_claims.list.column.order')}: {claim.orderId ?? noValue}</span>
                  <span className={claim.slaDueAt && new Date(claim.slaDueAt).getTime() < Date.now() && !isTerminal ? 'text-status-error-text' : undefined}>
                    {t('warranty_claims.list.column.slaDueAt')}: {relativeTime(claim.slaDueAt, noValue)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href={`/backend/warranty_claims/${claim.id}/edit`}>
                    {t('warranty_claims.detail.actions.edit')}
                  </Link>
                </Button>
                {claim.claimType !== 'vendor_recovery' && eligibleVendorLines.length > 0 ? (
                  <Button type="button" variant="outline" onClick={() => setVendorDialogOpen(true)}>
                    {t('warranty_claims.detail.actions.vendorRecovery')}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">{t('warranty_claims.detail.totalClaimed')}</div>
                <div className="text-lg font-semibold">{formatAmount(claim.totalClaimedAmount, claim.currencyCode, noValue)}</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">{t('warranty_claims.detail.totalApproved')}</div>
                <div className="text-lg font-semibold">{formatAmount(claim.totalApprovedAmount, claim.currencyCode, noValue)}</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">{t('warranty_claims.detail.totalRecovered')}</div>
                <div className="text-lg font-semibold">{formatAmount(claim.totalRecoveredAmount, claim.currencyCode, noValue)}</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {nextStatuses.length ? (
              nextStatuses.map((status) => (
                <Button
                  key={status}
                  type="button"
                  variant={status === 'rejected' || status === 'cancelled' ? 'destructive' : 'outline'}
                  onClick={() => { void confirmAndTransition(status) }}
                >
                  {status === 'submitted' && currentStatus === 'draft'
                    ? t('warranty_claims.detail.actions.submit')
                    : t('warranty_claims.detail.actions.transitionTo', undefined, {
                      status: t(`warranty_claims.status.${status}`),
                    })}
                </Button>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">{t('warranty_claims.detail.actions.noTransitions')}</span>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 border-b border-border">
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  type="button"
                  variant={activeTab === tab.id ? 'secondary' : 'ghost'}
                  onClick={() => setActiveTab(tab.id)}
                  className="rounded-b-none"
                >
                  {tab.label}
                </Button>
              ))}
            </div>

            {activeTab === 'lines' ? (
              <DataTable<ClaimLine>
                embedded
                title={t('warranty_claims.detail.tabs.lines')}
                actions={(
                  <Button type="button" onClick={() => setLineDialog({ mode: 'create' })}>
                    {t('warranty_claims.detail.lines.add')}
                  </Button>
                )}
                columns={lineColumns}
                data={lines}
                emptyState={(
                  <EmptyState
                    title={t('warranty_claims.detail.lines.empty.title')}
                    description={t('warranty_claims.detail.lines.empty.description')}
                    variant="subtle"
                  />
                )}
                rowActions={(line) => (
                  <RowActions
                    items={[
                      {
                        id: 'edit',
                        label: t('warranty_claims.detail.lines.edit'),
                        onSelect: () => setLineDialog({ mode: 'edit', line }),
                      },
                    ]}
                  />
                )}
              />
            ) : null}

            {activeTab === 'timeline' ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="space-y-3">
                    <Textarea
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault()
                          void submitComment()
                        }
                      }}
                      placeholder={t('warranty_claims.detail.timeline.commentPlaceholder')}
                      rows={4}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Select value={commentVisibility} onValueChange={(next) => setCommentVisibility(next === 'customer' ? 'customer' : 'internal')}>
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="internal">{t('warranty_claims.detail.visibility.internal')}</SelectItem>
                          <SelectItem value="customer">{t('warranty_claims.detail.visibility.customer')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button type="button" onClick={() => { void submitComment() }} disabled={!commentBody.trim()}>
                        {t('warranty_claims.detail.timeline.addComment')}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {events.length ? events.map((event) => {
                    const Icon = eventIcon(event.kind)
                    return (
                      <div key={event.id} className="flex gap-3 rounded-lg border border-border bg-card p-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Icon className="h-4 w-4" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{t(`warranty_claims.eventKind.${event.kind}`)}</span>
                            <StatusBadge variant={event.visibility === 'customer' ? 'info' : 'neutral'}>
                              {event.visibility === 'customer'
                                ? t('warranty_claims.detail.visibility.customer')
                                : t('warranty_claims.detail.visibility.internal')}
                            </StatusBadge>
                            <span className="text-xs text-muted-foreground">{formatDateTime(event.createdAt, noValue)}</span>
                          </div>
                          {event.body ? <p className="text-sm">{event.body}</p> : null}
                        </div>
                      </div>
                    )
                  }) : (
                    <EmptyState
                      title={t('warranty_claims.detail.timeline.empty.title')}
                      description={t('warranty_claims.detail.timeline.empty.description')}
                      variant="subtle"
                    />
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === 'attachments' ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <AttachmentInput entityId="warranty_claims:warranty_claim" recordId={claim.id} />
              </div>
            ) : null}

            {activeTab === 'ai' ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{t('warranty_claims.ai.panelTitle')}</h3>
                  <Button variant="outline" onClick={loadAiSuggestion} disabled={aiLoading}>
                    {t('warranty_claims.ai.suggestButton')}
                  </Button>
                </div>
                {aiSuggestion ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-md border border-border p-3">
                      <StatusBadge variant={aiSuggestion.priority.overdue ? 'error' : 'info'}>
                        {aiSuggestion.priority.currentPriority}
                        {' → '}
                        {aiSuggestion.priority.suggestedPriority}
                      </StatusBadge>
                      <p className="mt-2 text-sm text-muted-foreground">{aiSuggestion.priority.reason}</p>
                    </div>
                    <div className="space-y-2">
                      {aiSuggestion.lines.map((suggestedLine) => (
                        <div
                          key={suggestedLine.lineId}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium">
                              #{suggestedLine.lineNo}
                              {' '}
                              {suggestedLine.productName ?? suggestedLine.sku ?? suggestedLine.serialNumber ?? suggestedLine.lineId}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <StatusBadge variant={eligibilityBadgeVariant(suggestedLine.eligibility.status)}>
                                {suggestedLine.eligibility.status}
                              </StatusBadge>
                              <StatusBadge variant="info">
                                {t(`warranty_claims.disposition.${suggestedLine.suggestedDisposition}`)}
                              </StatusBadge>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">{suggestedLine.reason}</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => applyAiDisposition(suggestedLine.lineId, suggestedLine.suggestedDisposition)}
                          >
                            {t('warranty_claims.ai.apply')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <EmptyState
                      title={t('warranty_claims.ai.panelTitle')}
                      description={t('warranty_claims.ai.empty.description')}
                      variant="subtle"
                    />
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </PageBody>

      <Dialog open={lineDialog !== null} onOpenChange={(open) => { if (!open) setLineDialog(null) }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {lineDialog?.mode === 'edit'
                ? t('warranty_claims.detail.lines.edit')
                : t('warranty_claims.detail.lines.add')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<ClaimLineFormValues>
            embedded
            title={lineDialog?.mode === 'edit' ? t('warranty_claims.detail.lines.edit') : t('warranty_claims.detail.lines.add')}
            fields={lineFields}
            groups={lineGroups}
            initialValues={lineDialog?.mode === 'edit'
              ? { ...lineDialog.line }
              : { claimId: claim.id, qtyClaimed: '1', lineStatus: 'pending' }}
            submitLabel={t('warranty_claims.form.submit')}
            onSubmit={async (values) => {
              const payload: Record<string, unknown> = {
                claimId: claim.id,
                productName: nullableText(values.productName),
                sku: nullableText(values.sku),
                serialNumber: nullableText(values.serialNumber),
                faultCode: nullableText(values.faultCode),
                faultDescription: nullableText(values.faultDescription),
                qtyClaimed: values.qtyClaimed ?? 1,
                qtyApproved: values.qtyApproved ?? null,
                qtyReceived: values.qtyReceived ?? null,
                lineStatus: nullableText(values.lineStatus) ?? 'pending',
                disposition: nullableText(values.disposition),
                creditAmount: values.creditAmount ?? null,
                restockingFee: values.restockingFee ?? null,
                coreChargeAmount: values.coreChargeAmount ?? null,
                coreCreditAmount: values.coreCreditAmount ?? null,
                conditionOnReceipt: nullableText(values.conditionOnReceipt),
                inspectionNotes: nullableText(values.inspectionNotes),
              }
              if (lineDialog?.mode === 'edit') {
                await updateCrud('warranty_claims/lines', { id: lineDialog.line.id, ...payload }, {
                  errorMessage: t('warranty_claims.detail.lines.error.save'),
                })
                flash(t('warranty_claims.detail.lines.flash.saved'), 'success')
              } else {
                await createCrud('warranty_claims/lines', payload, {
                  errorMessage: t('warranty_claims.detail.lines.error.save'),
                })
                flash(t('warranty_claims.detail.lines.flash.created'), 'success')
              }
              setLineDialog(null)
              await loadData()
            }}
            onDelete={lineDialog?.mode === 'edit'
              ? async () => {
                await deleteCrud('warranty_claims/lines', {
                  body: { id: lineDialog.line.id, claimId: claim.id },
                  errorMessage: t('warranty_claims.detail.lines.error.delete'),
                })
                flash(t('warranty_claims.detail.lines.flash.deleted'), 'success')
                setLineDialog(null)
                await loadData()
              }
              : undefined}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={transitionDialog !== null} onOpenChange={(open) => { if (!open) setTransitionDialog(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('warranty_claims.detail.confirm.rejectTitle')}</DialogTitle>
          </DialogHeader>
          <CrudForm<TransitionFormValues>
            embedded
            title={t('warranty_claims.detail.confirm.rejectTitle')}
            fields={transitionFields}
            initialValues={{ rejectionReasonCode: claim.rejectionReasonCode ?? '', resolutionSummary: claim.resolutionSummary ?? '' }}
            submitLabel={t('warranty_claims.detail.actions.transition')}
            onSubmit={async (values) => {
              if (!transitionDialog) return
              await handleTransition(transitionDialog.toStatus, values)
              setTransitionDialog(null)
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('warranty_claims.detail.actions.vendorRecovery')}</DialogTitle>
          </DialogHeader>
          <CrudForm<VendorRecoveryFormValues>
            embedded
            title={t('warranty_claims.detail.actions.vendorRecovery')}
            fields={vendorFields}
            initialValues={{ lineIds: eligibleVendorLines.map((line) => line.id), vendorName: '', vendorRef: '' }}
            submitLabel={t('warranty_claims.detail.actions.vendorRecovery')}
            onSubmit={async (values) => {
              const lineIds = Array.isArray(values.lineIds) ? values.lineIds.filter((lineId): lineId is string => typeof lineId === 'string') : []
              if (!lineIds.length) {
                flash(t('warranty_claims.errors.vendorRecoveryNeedsResolvedLines'), 'error')
                return
              }
              await runClaimPost(
                '/api/warranty_claims/vendor-recovery',
                {
                  claimId: claim.id,
                  lineIds,
                  vendorName: nullableText(values.vendorName),
                  vendorRef: nullableText(values.vendorRef),
                },
                'warranty_claims.detail.vendorRecovery.created',
              )
              setVendorDialogOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </Page>
  )
}
