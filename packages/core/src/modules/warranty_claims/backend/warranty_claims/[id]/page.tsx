"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Copy, Hash, Info, MessageSquare, Pencil, RefreshCw, Trash2, UserRound } from 'lucide-react'
import { hasFeature } from '@open-mercato/shared/security/features'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import type { TranslateFn, TranslateParams } from '@open-mercato/shared/lib/i18n/context'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatRelativeTime } from '@open-mercato/shared/lib/time'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ActionsDropdown } from '@open-mercato/ui/backend/forms/ActionsDropdown'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
// Lazy-load the chat surface so the claim detail route chunk does not carry the AI
// SDK runtime for every operator — it only renders once a triage chat session is open.
const LazyAiChat = React.lazy(async () => {
  const mod = await import('@open-mercato/ui/ai/AiChat')
  return { default: mod.AiChat }
})
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { AttachmentInput } from '@open-mercato/core/modules/attachments/fields/attachment'
import {
  fetchAssignableStaffMembersPage,
  type AssignableStaffMember,
} from '@open-mercato/core/modules/customers/lib/assignableStaff'
import { CLAIM_STATUS_TRANSITIONS } from '../../../data/constants'
import {
  ClaimStatusBadge,
  type ClaimLineStatus,
  type ClaimStatus,
} from '../../components/ClaimStatusBadge'
import { ClaimSlaIndicator } from '../../components/claimSla'
import {
  ClaimLineProductPicker,
  EntitlementChip,
  computeEntitlementPreview,
  type ClaimProductPick,
} from '../../components/productLookup'
import { AiAssessButtons } from '../../components/AiAssessButtons'
import { useUserDisplayNames } from '../../components/useUserDisplayNames'
import { ReceivingPanel } from '../../components/ReceivingPanel'
import { ReturnLabelPanel } from '../../components/ReturnLabelPanel'
import { VendorRecoverySuggestionsPanel } from '../../components/VendorRecoverySuggestionsPanel'
import { ClaimStageProgress } from '../../components/ClaimStageProgress'
import { claimTypeAllowsLineFinancialAdjustments, resolveClaimTypeUiConfig } from '../../../lib/claimTypeConfig'
import { isTerminal } from '../../../lib/stateMachine'
import { formatQuantity, parseQuantity, quantityInputValue } from '../../../lib/quantity'
import { localizeDictionaryLabel, type DictionaryLabelKind } from '../../../lib/dictionaryLabels'
import {
  TIMELINE_FILTERS,
  filterTimelineEvents,
  isTimelineFilterId,
  type TimelineFilterId,
} from '../../../lib/timelineFilters'

type ClaimType = 'warranty' | 'return' | 'core_return' | 'vendor_recovery'
type ClaimChannel = 'staff' | 'portal' | 'api'
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

type TriageMessage = {
  messageKey: string
  params?: TranslateParams
}

type TriageMessageValue = TriageMessage | string

type ClaimRiskLevel = 'none' | 'low' | 'medium' | 'high'

type ClaimRiskSignal = {
  id: string
  level: 'low' | 'medium' | 'high'
  messageKey: string
  params?: TranslateParams
  relatedClaimNumbers?: string[]
}

type ClaimRiskAssessment = {
  level: ClaimRiskLevel
  signals: ClaimRiskSignal[]
}

type RiskApiResponse = {
  ok?: boolean
  result?: ClaimRiskAssessment
}

type FeatureCheckResponse = {
  ok?: boolean
  granted?: string[]
}

type ClaimRecord = {
  id: string
  claimNumber: string | null
  claimType: ClaimType | string | null
  channel: ClaimChannel | string | null
  status: ClaimStatus | string | null
  priority: ClaimPriority | string | null
  customerId: string | null
  customerName: string | null
  orderId: string | null
  orderNumber: string | null
  salesReturnId: string | null
  replacementOrderId: string | null
  creditMemoId: string | null
  awaitingStaffReply: boolean
  vendorName: string | null
  vendorRef: string | null
  totalClaimedAmount: string | null
  totalApprovedAmount: string | null
  totalRecoveredAmount: string | null
  slaDueAt: string | null
  slaPausedAt: string | null
  submittedAt: string | null
  assigneeUserId: string | null
  assigneeName: string | null
  createdAt: string | null
  updatedAt: string | null
  currencyCode: string | null
  notes: string | null
  reasonCode: string | null
  rejectionReasonCode: string | null
  resolutionSummary: string | null
  returnLabelUrl: string | null
  returnTrackingNumber: string | null
  returnCarrier: string | null
}

type ClaimLine = {
  id: string
  claimId: string | null
  lineNo: number | null
  productId: string | null
  variantId: string | null
  productName: string | null
  orderLineId: string | null
  sku: string | null
  serialNumber: string | null
  purchaseDate: string | null
  warrantyMonths: number | null
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
  conditionGrade: string | null
  quarantineStatus: string | null
  inspectionNotes: string | null
  assessmentPayload: Record<string, unknown> | null
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
    reason: TriageMessageValue
  }
  lines: Array<{
    lineId: string
    lineNo: number
    sku: string | null
    productName: string | null
    serialNumber: string | null
    eligibility: {
      status: string
      reason: TriageMessageValue
    }
    suggestedDisposition: string
    reason: TriageMessageValue
  }>
  risk?: ClaimRiskAssessment
  generatedAt: string
}

type InlineLineUpdateField = 'qtyApproved' | 'disposition' | 'lineStatus'
type InlineLineUpdateValue = string | null
type InlineLineSaveHandler = (
  line: ClaimLine,
  field: InlineLineUpdateField,
  value: InlineLineUpdateValue,
) => Promise<void>

type SelectOption = {
  value: string
  label: string
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
const LINE_EDITABLE_CLAIM_STATUSES = new Set<string>([
  'draft',
  'submitted',
  'in_review',
  'info_requested',
  'approved',
  'received',
  'inspecting',
])
// Must match the server-side receiving gate (`assertReceivingStatus` accepts only received /
// inspecting). Showing the controls at approved / awaiting_return guided agents into an
// operation the API rejects with a wrong-state error (WQA-006 / FLOW-02).
const RECEIVING_CAPABLE_CLAIM_STATUSES = new Set<string>([
  'received',
  'inspecting',
])
const DELETABLE_CLAIM_STATUSES = new Set<string>(['draft', 'cancelled'])
const LINE_STATUS_TRANSITIONS: Record<ClaimLineStatus, ClaimLineStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['received', 'resolved'],
  rejected: [],
  received: ['inspected'],
  inspected: ['resolved'],
  resolved: [],
}
const EMPTY_RISK_ASSESSMENT: ClaimRiskAssessment = { level: 'none', signals: [] }
const UNASSIGNED_SELECT_VALUE = '__unassigned__'
const CLEAR_SELECT_VALUE = '__clear__'
const AGENT_ID = 'warranty_claims.claims_assistant'

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

function toTranslateParams(value: unknown): TranslateParams | undefined {
  if (!isRecord(value)) return undefined
  const params: TranslateParams = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      params[key] = entry
    }
  }
  return Object.keys(params).length ? params : undefined
}

function normalizeRiskSignal(value: unknown): ClaimRiskSignal | null {
  if (!isRecord(value)) return null
  const id = toStringOrNull(value.id)
  const level = toStringOrNull(value.level)
  const messageKey = toStringOrNull(value.messageKey)
  if (!id || !messageKey || (level !== 'low' && level !== 'medium' && level !== 'high')) return null
  const relatedClaimNumbers = Array.isArray(value.relatedClaimNumbers)
    ? value.relatedClaimNumbers.filter((claimNumber): claimNumber is string => typeof claimNumber === 'string' && claimNumber.length > 0)
    : undefined
  return {
    id,
    level,
    messageKey,
    params: toTranslateParams(value.params),
    relatedClaimNumbers: relatedClaimNumbers?.length ? relatedClaimNumbers : undefined,
  }
}

function normalizeRiskAssessment(value: unknown): ClaimRiskAssessment {
  if (!isRecord(value)) return EMPTY_RISK_ASSESSMENT
  const level = toStringOrNull(value.level)
  const normalizedLevel: ClaimRiskLevel =
    level === 'low' || level === 'medium' || level === 'high' || level === 'none'
      ? level
      : 'none'
  const signals = Array.isArray(value.signals)
    ? value.signals.map(normalizeRiskSignal).filter((signal): signal is ClaimRiskSignal => signal !== null)
    : []
  return { level: normalizedLevel, signals }
}

function normalizeRiskResponse(value: unknown): ClaimRiskAssessment {
  if (!isRecord(value)) return EMPTY_RISK_ASSESSMENT
  if ('result' in value) return normalizeRiskAssessment(value.result)
  return normalizeRiskAssessment(value)
}

function isClaimLineStatusValue(value: string | null | undefined): value is ClaimLineStatus {
  return typeof value === 'string' && CLAIM_LINE_STATUSES.includes(value as ClaimLineStatus)
}

function buildLineStatusOptions(status: string | null | undefined, t: TranslateFn): SelectOption[] {
  const current = isClaimLineStatusValue(status) ? status : 'pending'
  const values = Array.from(new Set<ClaimLineStatus>([current, ...LINE_STATUS_TRANSITIONS[current]]))
  return values.map((value) => ({ value, label: t(`warranty_claims.lineStatus.${value}`) }))
}

function buildDispositionOptions(
  allowedDispositions: readonly string[],
  currentDisposition: string | null | undefined,
  t: TranslateFn,
): SelectOption[] {
  const values = new Set<string>(
    CLAIM_DISPOSITIONS.filter((disposition) => allowedDispositions.includes(disposition)),
  )
  if (currentDisposition) values.add(currentDisposition)
  return Array.from(values).map((disposition) => ({
    value: disposition,
    label: t(`warranty_claims.disposition.${disposition}`, disposition),
  }))
}

function formatTriageMessage(value: TriageMessageValue, t: TranslateFn): string {
  if (typeof value === 'string') return t(value)
  return t(value.messageKey, value.params)
}

function triageLineHeading(
  suggestedLine: ClaimTriageSuggestion['lines'][number],
  lines: ClaimLine[],
  t: TranslateFn,
): string {
  const name = suggestedLine.productName ?? suggestedLine.sku ?? suggestedLine.serialNumber ?? null
  const lineNo = toNumberOrNull(suggestedLine.lineNo)
    ?? lines.find((line) => line.id === suggestedLine.lineId)?.lineNo
    ?? null
  const label = name ?? t('warranty_claims.detail.lines.unnamed', 'Unnamed line')
  return lineNo !== null ? `#${lineNo} ${label}` : label
}

function formatTimelineBody(event: ClaimEvent, t: TranslateFn, userNames: Record<string, string>): string | null {
  if (event.body) return event.body
  const payload = event.payload
  const action = payload ? toStringOrNull(payload.action) : null
  if (event.kind === 'system' && action === 'sla_paused') return t('warranty_claims.timeline.slaPaused')
  if (event.kind === 'system' && action === 'sla_resumed') return t('warranty_claims.timeline.slaResumed')
  if (event.kind === 'system' && action === 'auto_approved') return t('warranty_claims.timeline.autoApproved')
  if (event.kind === 'system' && action === 'sales_return_created') return t('warranty_claims.timeline.salesReturnCreated')
  if (event.kind === 'system' && action === 'sales_return_orphaned') return t('warranty_claims.timeline.salesReturnOrphaned')
  if (event.kind === 'system' && action === 'undo_sales_return_created') return t('warranty_claims.timeline.undoSalesReturnCreated')
  if (event.kind === 'system' && action === 'replacement_order_created') return t('warranty_claims.timeline.replacementOrderCreated')
  if (event.kind === 'system' && action === 'replacement_order_orphaned') return t('warranty_claims.timeline.replacementOrderOrphaned')
  if (event.kind === 'system' && action === 'undo_replacement_order_created') return t('warranty_claims.timeline.undoReplacementOrderCreated')
  if (event.kind === 'system' && action === 'credit_memo_created') return t('warranty_claims.timeline.creditMemoCreated')
  if (event.kind === 'system' && action === 'credit_memo_orphaned') return t('warranty_claims.timeline.creditMemoOrphaned')
  if (event.kind === 'system' && action === 'undo_credit_memo_created') return t('warranty_claims.timeline.undoCreditMemoCreated')
  if (event.kind === 'assignment') {
    const assigneeUserId = payload ? toStringOrNull(payload.assigneeUserId) : null
    if (!assigneeUserId) return t('warranty_claims.timeline.unassigned')
    return t('warranty_claims.timeline.assignedTo', { name: userNames[assigneeUserId] ?? t('warranty_claims.detail.unknownUser') })
  }
  const from = payload ? toStringOrNull(payload.from) ?? toStringOrNull(payload.fromStatus) : null
  const to = payload ? toStringOrNull(payload.to) ?? toStringOrNull(payload.toStatus) : null
  if (event.kind === 'status_changed' && from && to) {
    const statusLine = `${t(`warranty_claims.status.${from}`)} → ${t(`warranty_claims.status.${to}`)}`
    const systemNote = payload ? toStringOrNull(payload.systemNote) : null
    if (systemNote && systemNote.startsWith('warranty_claims.')) {
      return `${statusLine} — ${t(systemNote)}`
    }
    return statusLine
  }
  return null
}

function resolveTimelineActor(event: ClaimEvent, claim: ClaimRecord, userNames: Record<string, string>, t: TranslateFn): string {
  if (event.actorUserId) return userNames[event.actorUserId] ?? t('warranty_claims.detail.unknownUser')
  if (event.actorCustomerId) return claim.customerName ?? t('warranty_claims.detail.customerActor')
  return t('warranty_claims.detail.systemActor')
}

function translateErrorMessage(err: unknown, t: TranslateFn, fallbackKey: string): string {
  if (err instanceof Error && err.message) return t(err.message)
  return t(fallbackKey)
}

function buildRiskSignalTitle(signal: ClaimRiskSignal): string | undefined {
  return signal.relatedClaimNumbers?.length ? signal.relatedClaimNumbers.join(', ') : undefined
}

function riskSignalVariant(signal: ClaimRiskSignal): 'warning' | 'error' {
  return signal.level === 'high' ? 'error' : 'warning'
}

function normalizeClaim(value: unknown): ClaimRecord | null {
  if (!isRecord(value)) return null
  const id = toStringOrNull(value.id)
  if (!id) return null
  return {
    id,
    claimNumber: toStringOrNull(value.claimNumber),
    claimType: toStringOrNull(value.claimType),
    channel: toStringOrNull(value.channel),
    status: toStringOrNull(value.status),
    priority: toStringOrNull(value.priority),
    customerId: toStringOrNull(value.customerId),
    customerName: toStringOrNull(value.customerName),
    orderId: toStringOrNull(value.orderId),
    orderNumber: toStringOrNull(value.orderNumber),
    salesReturnId: toStringOrNull(value.salesReturnId),
    replacementOrderId: toStringOrNull(value.replacementOrderId),
    creditMemoId: toStringOrNull(value.creditMemoId),
    awaitingStaffReply: parseBooleanFromUnknown(value.awaitingStaffReply) ?? false,
    vendorName: toStringOrNull(value.vendorName),
    vendorRef: toStringOrNull(value.vendorRef),
    totalClaimedAmount: toStringOrNull(value.totalClaimedAmount),
    totalApprovedAmount: toStringOrNull(value.totalApprovedAmount),
    totalRecoveredAmount: toStringOrNull(value.totalRecoveredAmount),
    slaDueAt: toStringOrNull(value.slaDueAt),
    slaPausedAt: toStringOrNull(value.slaPausedAt),
    submittedAt: toStringOrNull(value.submittedAt),
    assigneeUserId: toStringOrNull(value.assigneeUserId),
    assigneeName: toStringOrNull(value.assigneeName),
    createdAt: toStringOrNull(value.createdAt),
    updatedAt: toStringOrNull(value.updatedAt),
    currencyCode: toStringOrNull(value.currencyCode),
    notes: toStringOrNull(value.notes),
    reasonCode: toStringOrNull(value.reasonCode),
    rejectionReasonCode: toStringOrNull(value.rejectionReasonCode),
    resolutionSummary: toStringOrNull(value.resolutionSummary),
    returnLabelUrl: toStringOrNull(value.returnLabelUrl),
    returnTrackingNumber: toStringOrNull(value.returnTrackingNumber),
    returnCarrier: toStringOrNull(value.returnCarrier),
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
    productId: toStringOrNull(value.productId),
    variantId: toStringOrNull(value.variantId),
    productName: toStringOrNull(value.productName),
    orderLineId: toStringOrNull(value.orderLineId),
    sku: toStringOrNull(value.sku),
    serialNumber: toStringOrNull(value.serialNumber),
    purchaseDate: toStringOrNull(value.purchaseDate),
    warrantyMonths: toNumberOrNull(value.warrantyMonths),
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
    conditionGrade: toStringOrNull(value.conditionGrade),
    quarantineStatus: toStringOrNull(value.quarantineStatus),
    inspectionNotes: toStringOrNull(value.inspectionNotes),
    assessmentPayload: isRecord(value.assessmentPayload) ? value.assessmentPayload : null,
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

function buildConflictError(
  call: { status: number; result: unknown },
  fallbackMessage: string,
  t?: TranslateFn,
): Error & Record<string, unknown> {
  const payload = isRecord(call.result) ? call.result : {}
  const rawMessage = typeof payload.error === 'string' ? payload.error : fallbackMessage
  const message = t ? t(rawMessage) : rawMessage
  return Object.assign(new Error(message), { status: call.status }, payload)
}

function readDraftReplyPayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  return isRecord(value.result) ? value.result : value
}

function isDraftReplyNotConfigured(value: unknown): boolean {
  const payload = readDraftReplyPayload(value)
  return payload.notConfigured === true
}

function readDraftReply(value: unknown): string | null {
  return toStringOrNull(readDraftReplyPayload(value).draft)
}

function readErrorKey(value: unknown): string | null {
  return isRecord(value) ? toStringOrNull(value.error) : null
}

function formatAmount(value: string | null, currencyCode: string | null, fallback: string): string {
  const amount = toNumberOrNull(value)
  if (amount === null) return fallback
  if (!currencyCode) return amount.toLocaleString()
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(amount)
}

function eventIcon(kind: string) {
  if (kind === 'comment') return MessageSquare
  if (kind === 'assignment') return UserRound
  if (kind === 'status_changed') return RefreshCw
  return Info
}

const TIMELINE_FILTER_LABELS: Record<TimelineFilterId, { key: string; fallback: string }> = {
  all: { key: 'warranty_claims.detail.timeline.filter.all', fallback: 'All' },
  comments: { key: 'warranty_claims.detail.timeline.filter.comments', fallback: 'Comments' },
  status_changes: { key: 'warranty_claims.detail.timeline.filter.statusChanges', fallback: 'Status changes' },
  customer_visible: { key: 'warranty_claims.detail.timeline.filter.customerVisible', fallback: 'Customer-visible' },
}

function RiskSignalChips({ signals, t }: { signals: ClaimRiskSignal[]; t: TranslateFn }) {
  if (!signals.length) return null
  return (
    <>
      {signals.map((signal) => (
        <span key={signal.id} title={buildRiskSignalTitle(signal)}>
          <StatusBadge variant={riskSignalVariant(signal)}>
            {t(signal.messageKey, signal.params)}
          </StatusBadge>
        </span>
      ))}
    </>
  )
}

export function InlineQtyApprovedCell({
  line,
  disabled,
  label,
  onSave,
}: {
  line: ClaimLine
  disabled: boolean
  label: string
  onSave: InlineLineSaveHandler
}) {
  const currentValue = quantityInputValue(line.qtyApproved)
  const [draft, setDraft] = React.useState(currentValue)
  const blurSaveSuppressedRef = React.useRef(false)

  React.useEffect(() => {
    setDraft(currentValue)
  }, [currentValue])

  const commit = React.useCallback((value: string) => {
    const nextValue = value.trim().length ? value.trim() : null
    if (parseQuantity(nextValue) === parseQuantity(line.qtyApproved)) return
    void onSave(line, 'qtyApproved', nextValue)
  }, [line, onSave])

  return (
    <Input
      type="number"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      aria-label={label}
      className="w-24"
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => { blurSaveSuppressedRef.current = false }}
      onBlur={() => {
        if (blurSaveSuppressedRef.current) {
          blurSaveSuppressedRef.current = false
          return
        }
        commit(draft)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          blurSaveSuppressedRef.current = true
          setDraft(currentValue)
          event.currentTarget.blur()
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          blurSaveSuppressedRef.current = true
          commit(draft)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function InlineLineSelectCell({
  line,
  field,
  value,
  options,
  label,
  emptyLabel,
  disabled,
  onSave,
}: {
  line: ClaimLine
  field: Exclude<InlineLineUpdateField, 'qtyApproved'>
  value: string | null
  options: SelectOption[]
  label: string
  emptyLabel?: string
  disabled: boolean
  onSave: InlineLineSaveHandler
}) {
  const selectedValue = value ?? CLEAR_SELECT_VALUE

  return (
    <Select
      value={selectedValue}
      disabled={disabled}
      onValueChange={(nextValue) => {
        const normalizedValue = nextValue === CLEAR_SELECT_VALUE ? null : nextValue
        if (normalizedValue === value) return
        void onSave(line, field, normalizedValue)
      }}
    >
      <SelectTrigger aria-label={label} className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel ? <SelectItem value={CLEAR_SELECT_VALUE}>{emptyLabel}</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default function WarrantyClaimDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const currentUserId = useCurrentUserId()
  const [claim, setClaim] = React.useState<ClaimRecord | null>(null)
  const [lines, setLines] = React.useState<ClaimLine[]>([])
  const [events, setEvents] = React.useState<ClaimEvent[]>([])
  const [attachmentCount, setAttachmentCount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<TabId>('lines')
  const [timelineFilter, setTimelineFilter] = React.useState<TimelineFilterId>('all')
  const [customerLink, setCustomerLink] = React.useState<{ customerId: string; href: string } | null>(null)
  const [lineDialog, setLineDialog] = React.useState<{ mode: 'create' } | { mode: 'edit'; line: ClaimLine } | null>(null)
  const [defaultWarrantyMonths, setDefaultWarrantyMonths] = React.useState<number | null>(null)
  const [featureAccess, setFeatureAccess] = React.useState({
    claimManage: false,
    claimDelete: false,
    receivingManage: false,
    salesReturnsCreate: false,
    salesOrdersManage: false,
    salesCreditMemosManage: false,
  })

  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ result?: { defaultWarrantyMonths?: number | null } }>('/api/warranty_claims/settings-general', undefined, { fallback: {} })
      .then((call) => {
        if (cancelled || !call.ok) return
        const months = call.result?.result?.defaultWarrantyMonths
        setDefaultWarrantyMonths(typeof months === 'number' && Number.isFinite(months) ? months : null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void apiCall<FeatureCheckResponse>(
      '/api/auth/feature-check',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          features: [
            'warranty_claims.claim.manage',
            'warranty_claims.claim.delete',
            'warranty_claims.receiving.manage',
            'sales.returns.create',
            'sales.orders.manage',
            'sales.credit_memos.manage',
          ],
        }),
      },
      { fallback: { ok: false, granted: [] } },
    )
      .then((call) => {
        if (cancelled || !call.ok) return
        const granted = Array.isArray(call.result?.granted) ? call.result.granted : []
        const allGranted = call.result?.ok === true
        setFeatureAccess({
          claimManage: allGranted || hasFeature(granted, 'warranty_claims.claim.manage'),
          claimDelete: allGranted || hasFeature(granted, 'warranty_claims.claim.delete'),
          receivingManage: allGranted || hasFeature(granted, 'warranty_claims.receiving.manage'),
          salesReturnsCreate: allGranted || hasFeature(granted, 'sales.returns.create'),
          salesOrdersManage: allGranted || hasFeature(granted, 'sales.orders.manage'),
          salesCreditMemosManage: allGranted || hasFeature(granted, 'sales.credit_memos.manage'),
        })
      })
      .catch(() => {
        if (!cancelled) {
          setFeatureAccess({
            claimManage: false,
            claimDelete: false,
            receivingManage: false,
            salesReturnsCreate: false,
            salesOrdersManage: false,
            salesCreditMemosManage: false,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])
  const [transitionDialog, setTransitionDialog] = React.useState<{ toStatus: ClaimStatus } | null>(null)
  const [vendorDialogOpen, setVendorDialogOpen] = React.useState(false)
  const [commentBody, setCommentBody] = React.useState('')
  const [commentVisibility, setCommentVisibility] = React.useState<'internal' | 'customer'>('internal')
  const [aiSuggestion, setAiSuggestion] = React.useState<ClaimTriageSuggestion | null>(null)
  const [aiLoading, setAiLoading] = React.useState(false)
  const [appliedTriageLineIds, setAppliedTriageLineIds] = React.useState<Set<string>>(new Set())
  const [draftReplyLoading, setDraftReplyLoading] = React.useState(false)
  const [draftReplyHidden, setDraftReplyHidden] = React.useState(false)
  const [riskAssessment, setRiskAssessment] = React.useState<ClaimRiskAssessment>(EMPTY_RISK_ASSESSMENT)
  const [slaAtRiskThresholdPct, setSlaAtRiskThresholdPct] = React.useState<number | undefined>(undefined)
  const [assignDialogOpen, setAssignDialogOpen] = React.useState(false)
  const [assignSearch, setAssignSearch] = React.useState('')
  const [assignOptions, setAssignOptions] = React.useState<AssignableStaffMember[]>([])
  const [assignLoading, setAssignLoading] = React.useState(false)
  const [selectedAssigneeUserId, setSelectedAssigneeUserId] = React.useState<string>(UNASSIGNED_SELECT_VALUE)
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

  const loadDictionaryOptions = React.useCallback(async (
    dictionaryKey: string,
    kind: DictionaryLabelKind,
  ): Promise<CrudFieldOption[]> => {
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
      .map((option) => ({
        ...option,
        label: localizeDictionaryLabel(t, kind, option.value, option.label),
      }))
  }, [t])

  const loadData = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const [claimPayload, linesPayload, eventsPayload, riskPayload, statsPayload, attachmentsPayload] = await Promise.all([
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
        readApiResultOrThrow<RiskApiResponse>(
          `/api/warranty_claims/risk?claimId=${encodeURIComponent(id)}`,
          undefined,
          {
            fallback: { ok: true, result: EMPTY_RISK_ASSESSMENT },
            errorMessage: t('warranty_claims.detail.error.loadRisk'),
          },
        ),
        readApiResultOrThrow<{ ok?: boolean; result?: { slaAtRiskThresholdPct?: number } }>(
          '/api/warranty_claims/stats',
          undefined,
          { fallback: { ok: true, result: {} } },
        ),
        readApiResultOrThrow<{ items?: unknown[] }>(
          `/api/attachments?entityId=${encodeURIComponent('warranty_claims:warranty_claim')}&recordId=${encodeURIComponent(id)}`,
          undefined,
          { fallback: { items: [] } },
        ),
      ])
      const nextClaim = (claimPayload.items ?? []).map(normalizeClaim).find((item): item is ClaimRecord => item !== null) ?? null
      if (!nextClaim) {
        setClaim(null)
        setLines([])
        setEvents([])
        setAttachmentCount(0)
        setRiskAssessment(EMPTY_RISK_ASSESSMENT)
        setNotFound(true)
        return
      }
      setClaim(nextClaim)
      setLines((linesPayload.items ?? []).map(normalizeLine).filter((item): item is ClaimLine => item !== null))
      setEvents((eventsPayload.items ?? []).map(normalizeEvent).filter((item): item is ClaimEvent => item !== null))
      setAttachmentCount(Array.isArray(attachmentsPayload.items) ? attachmentsPayload.items.length : 0)
      setRiskAssessment(normalizeRiskResponse(riskPayload))
      const nextThreshold = statsPayload?.result?.slaAtRiskThresholdPct
      setSlaAtRiskThresholdPct(typeof nextThreshold === 'number' ? nextThreshold : undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('warranty_claims.detail.error.load'))
    } finally {
      setLoading(false)
    }
  }, [id, t])

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  useAppEvent('warranty_claims.claim.*', (event) => {
    const eventClaimId = toStringOrNull(event.payload.claimId)
    if (eventClaimId === id) void loadData()
  }, [id, loadData])

  const referencedUserIds = React.useMemo(() => {
    const collected = new Set<string>()
    if (claim?.assigneeUserId) collected.add(claim.assigneeUserId)
    for (const event of events) {
      if (event.actorUserId) collected.add(event.actorUserId)
      if (event.kind === 'assignment') {
        const assigneeUserId = toStringOrNull(event.payload?.assigneeUserId)
        if (assigneeUserId) collected.add(assigneeUserId)
      }
    }
    return [...collected]
  }, [claim?.assigneeUserId, events])
  const userNames = useUserDisplayNames(referencedUserIds)

  React.useEffect(() => {
    if (!assignDialogOpen) return
    const controller = new AbortController()
    setAssignLoading(true)
    fetchAssignableStaffMembersPage(assignSearch, { page: 1, pageSize: 24, signal: controller.signal })
      .then((page) => setAssignOptions(page.items))
      .catch(() => setAssignOptions([]))
      .finally(() => {
        if (!controller.signal.aborted) setAssignLoading(false)
      })
    return () => controller.abort()
  }, [assignDialogOpen, assignSearch])

  const claimCustomerId = claim?.customerId ?? null
  React.useEffect(() => {
    if (!claimCustomerId || customerLink?.customerId === claimCustomerId) return
    const controller = new AbortController()
    const idsParam = encodeURIComponent(claimCustomerId)
    const hasMatch = (payload: { items?: unknown[] } | null) =>
      (payload?.items ?? []).some((item) => isRecord(item) && toStringOrNull(item.id) === claimCustomerId)
    const resolveCustomerHref = async (): Promise<string | null> => {
      const people = await apiCall<{ items?: unknown[] }>(
        `/api/customers/people?ids=${idsParam}&pageSize=1`,
        { signal: controller.signal },
        { fallback: { items: [] } },
      )
      if (people.ok && hasMatch(people.result)) return `/backend/customers/people/${claimCustomerId}`
      const companies = await apiCall<{ items?: unknown[] }>(
        `/api/customers/companies?ids=${idsParam}&pageSize=1`,
        { signal: controller.signal },
        { fallback: { items: [] } },
      )
      if (companies.ok && hasMatch(companies.result)) return `/backend/customers/companies/${claimCustomerId}`
      return null
    }
    resolveCustomerHref()
      .then((href) => {
        if (controller.signal.aborted || !href) return
        setCustomerLink({ customerId: claimCustomerId, href })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [claimCustomerId, customerLink])

  const filteredTimelineEvents = React.useMemo(
    () => filterTimelineEvents(events, timelineFilter),
    [events, timelineFilter],
  )

  const currentStatus = typeof claim?.status === 'string' ? claim.status : 'draft'
  const nextStatuses = React.useMemo(() => {
    if (!claim || !(currentStatus in CLAIM_STATUS_TRANSITIONS)) return []
    return CLAIM_STATUS_TRANSITIONS[currentStatus as ClaimStatus] ?? []
  }, [claim, currentStatus])
  const primaryNextStatus = React.useMemo(
    () => nextStatuses.find((status) => status !== 'cancelled' && status !== 'rejected' && status !== 'info_requested') ?? nextStatuses[0] ?? null,
    [nextStatuses],
  )
  const resolutionStatuses = React.useMemo(
    () => nextStatuses.filter((status) => status !== primaryNextStatus),
    [nextStatuses, primaryNextStatus],
  )

  const noValue = t('warranty_claims.common.noValue')
  const linesEditable = LINE_EDITABLE_CLAIM_STATUSES.has(currentStatus)
  const linesInlineEditable = linesEditable && featureAccess.claimManage
  // FLOW-04 gating. `claimActive` = not fully terminal (closed/cancelled): reassignment and
  // vendor-recovery (which requires resolved lines) stay available. `claimMutable` is stricter —
  // it also excludes resolved/rejected, where header fields and lines are server-locked — so the
  // header "Edit" and AI mutating controls are hidden there instead of leading to a dead form.
  const claimActive = !isTerminal(currentStatus)
  const claimMutable = claimActive && currentStatus !== 'resolved' && currentStatus !== 'rejected'
  const allowedDispositions = React.useMemo(
    () => resolveClaimTypeUiConfig(claim?.claimType).allowedDispositions,
    [claim?.claimType],
  )
  const currentLineDisposition = lineDialog?.mode === 'edit' ? lineDialog.line.disposition : null
  const riskSignals = riskAssessment.signals
  const assigneeDisplayName = claim?.assigneeUserId
    ? claim.assigneeName ?? userNames[claim.assigneeUserId] ?? t('warranty_claims.detail.unknownUser')
    : t('warranty_claims.detail.unassigned')
  const eligibleVendorLines = React.useMemo(
    () => lines.filter((line) => line.lineStatus === 'resolved' && !line.vendorClaimLineId),
    [lines],
  )
  const assignableOptions = React.useMemo(() => {
    const byUserId = new Map<string, AssignableStaffMember>()
    for (const option of assignOptions) byUserId.set(option.userId, option)
    if (claim?.assigneeUserId && !byUserId.has(claim.assigneeUserId)) {
      byUserId.set(claim.assigneeUserId, {
        teamMemberId: claim.assigneeUserId,
        userId: claim.assigneeUserId,
        displayName: userNames[claim.assigneeUserId] ?? t('warranty_claims.detail.unknownUser'),
        email: null,
        teamName: null,
      })
    }
    return Array.from(byUserId.values())
  }, [assignOptions, claim?.assigneeUserId, userNames, t])

  const openAssignDialog = React.useCallback(() => {
    setSelectedAssigneeUserId(claim?.assigneeUserId ?? UNASSIGNED_SELECT_VALUE)
    setAssignSearch('')
    setAssignDialogOpen(true)
  }, [claim?.assigneeUserId])

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
          if (!call.ok) throw buildConflictError(call, t('warranty_claims.detail.error.action'), t)
          return call
        },
        context: mutationContext,
        mutationPayload: body,
      })
      flash(t(successKey), 'success')
      await loadData()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      const message = translateErrorMessage(err, t, 'warranty_claims.detail.error.action')
      flash(message, 'error')
    }
  }, [claim, loadData, mutationContext, runMutation, t])

  const createSalesReturn = React.useCallback(async () => {
    if (!claim) return
    const payload = { claimId: claim.id }
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(claim.updatedAt),
            () => apiCall<{ salesReturnId?: string; skippedLineIds?: string[] }>('/api/warranty_claims/sales-return', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          )
          if (!response.ok) throw buildConflictError(response, t('warranty_claims.detail.error.action'), t)
          return response
        },
        context: mutationContext,
        mutationPayload: payload,
      })
      flash(t('warranty_claims.detail.createSalesReturnSuccess'), 'success')
      const skippedCount = call?.result?.skippedLineIds?.length ?? 0
      if (skippedCount > 0) {
        flash(t('warranty_claims.detail.createSalesReturnSkipped', undefined, { count: skippedCount }), 'info')
      }
      await loadData()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      const message = translateErrorMessage(err, t, 'warranty_claims.detail.error.action')
      flash(message, 'error')
    }
  }, [claim, loadData, mutationContext, runMutation, t])

  const createReplacementOrder = React.useCallback(async () => {
    if (!claim) return
    const payload = { claimId: claim.id }
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(claim.updatedAt),
            () => apiCall<{ replacementOrderId?: string; skippedLineIds?: string[] }>('/api/warranty_claims/replacement-order', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          )
          if (!response.ok) throw buildConflictError(response, t('warranty_claims.detail.error.action'), t)
          return response
        },
        context: mutationContext,
        mutationPayload: payload,
      })
      flash(t('warranty_claims.detail.createReplacementOrderSuccess'), 'success')
      const skippedCount = call?.result?.skippedLineIds?.length ?? 0
      if (skippedCount > 0) {
        flash(t('warranty_claims.detail.createReplacementOrderSkipped', undefined, { count: skippedCount }), 'info')
      }
      await loadData()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      const message = translateErrorMessage(err, t, 'warranty_claims.detail.error.action')
      flash(message, 'error')
    }
  }, [claim, loadData, mutationContext, runMutation, t])

  const createCreditMemo = React.useCallback(async () => {
    if (!claim) return
    const payload = { claimId: claim.id }
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(claim.updatedAt),
            () => apiCall<{ creditMemoId?: string; skippedLineIds?: string[]; grandTotalGrossAmount?: string; currencyCode?: string }>('/api/warranty_claims/credit-memo', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          )
          if (!response.ok) throw buildConflictError(response, t('warranty_claims.detail.error.action'), t)
          return response
        },
        context: mutationContext,
        mutationPayload: payload,
      })
      flash(
        t('warranty_claims.detail.createCreditMemoSuccess', undefined, {
          amount: call?.result?.grandTotalGrossAmount ?? '',
          currency: call?.result?.currencyCode ?? '',
        }),
        'success',
      )
      const skippedCount = call?.result?.skippedLineIds?.length ?? 0
      if (skippedCount > 0) {
        flash(t('warranty_claims.detail.createCreditMemoSkipped', undefined, { count: skippedCount }), 'info')
      }
      await loadData()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      const message = translateErrorMessage(err, t, 'warranty_claims.detail.error.action')
      flash(message, 'error')
    }
  }, [claim, loadData, mutationContext, runMutation, t])

  const performAssignment = React.useCallback(async (assigneeUserId: string | null) => {
    if (!claim) return false
    const payload = { id: claim.id, assigneeUserId }
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(claim.updatedAt),
            () => apiCall('/api/warranty_claims/assign', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          )
          if (!call.ok) throw buildConflictError(call, t('warranty_claims.detail.error.action'), t)
          return call
        },
        context: mutationContext,
        mutationPayload: payload,
      })
      flash(t('warranty_claims.list.flash.assigned'), 'success')
      await loadData()
      return true
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return false
      flash(translateErrorMessage(err, t, 'warranty_claims.detail.error.action'), 'error')
      return false
    }
  }, [claim, loadData, mutationContext, runMutation, t])

  const assignClaim = React.useCallback(async () => {
    const assigneeUserId = selectedAssigneeUserId === UNASSIGNED_SELECT_VALUE ? null : selectedAssigneeUserId
    const success = await performAssignment(assigneeUserId)
    if (success) setAssignDialogOpen(false)
  }, [performAssignment, selectedAssigneeUserId])

  const assignToMe = React.useCallback(async () => {
    if (!currentUserId) return
    await performAssignment(currentUserId)
  }, [currentUserId, performAssignment])

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
      setAppliedTriageLineIds(new Set())
    } catch (err) {
      const message = translateErrorMessage(err, t, 'warranty_claims.detail.error.action')
      flash(message, 'error')
    } finally {
      setAiLoading(false)
    }
  }, [id, t])

  const applyAiDisposition = React.useCallback(async (lineId: string, disposition: string) => {
    if (!claim) return
    const line = lines.find((candidate) => candidate.id === lineId)
    if (!line) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(line.updatedAt),
          () => updateCrud('warranty_claims/lines', { id: lineId, claimId: claim.id, disposition }, {
            errorMessage: t('warranty_claims.detail.lines.error.save'),
          }),
        ),
        context: mutationContext,
        mutationPayload: { id: lineId, claimId: claim.id, disposition },
      })
      flash(t('warranty_claims.detail.lines.flash.saved'), 'success')
      setAppliedTriageLineIds((prev) => new Set(prev).add(lineId))
      await loadData()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      const message = translateErrorMessage(err, t, 'warranty_claims.detail.error.action')
      flash(message, 'error')
    }
  }, [claim, lines, loadData, mutationContext, runMutation, t])

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

  const generateSupplierRecovery = React.useCallback(async ({
    lineIds,
    vendorName,
  }: {
    lineIds: string[]
    vendorName: string
  }) => {
    if (!claim) return
    if (!lineIds.length || !vendorName.trim()) {
      flash(t('warranty_claims.errors.vendorRecoveryNeedsResolvedLines'), 'error')
      return
    }
    await runClaimPost(
      '/api/warranty_claims/vendor-recovery',
      {
        claimId: claim.id,
        lineIds,
        vendorName: vendorName.trim(),
        vendorRef: null,
      },
      'warranty_claims.detail.vendorRecovery.created',
    )
  }, [claim, runClaimPost, t])

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

  const deleteClaim = React.useCallback(async () => {
    if (!claim || !featureAccess.claimDelete || !DELETABLE_CLAIM_STATUSES.has(currentStatus)) return
    const confirmed = await confirm({
      title: t('warranty_claims.audit.claim.delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(claim.updatedAt),
          () => deleteCrud('warranty_claims', claim.id, {
            errorMessage: t('warranty_claims.edit.error.delete'),
          }),
        ),
        context: mutationContext,
        mutationPayload: { id: claim.id },
      })
      flash(t('warranty_claims.edit.deleted'), 'success')
      router.push('/backend/warranty_claims')
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      flash(translateErrorMessage(err, t, 'warranty_claims.edit.error.delete'), 'error')
    }
  }, [claim, confirm, currentStatus, featureAccess.claimDelete, loadData, mutationContext, router, runMutation, t])

  const headerMoreActions = React.useMemo(() => {
    if (!claim) return []
    const items = [
      ...(claimMutable ? [{
        id: 'edit',
        label: t('warranty_claims.detail.actions.edit'),
        icon: Pencil,
        onSelect: () => router.push(`/backend/warranty_claims/${claim.id}/edit`),
      }] : []),
      {
        id: 'copy-link',
        label: t('warranty_claims.detail.copyLink'),
        icon: Copy,
        onSelect: async () => {
          try {
            await navigator.clipboard.writeText(window.location.href)
            flash(t('warranty_claims.detail.linkCopied'), 'success')
          } catch {
            flash(t('warranty_claims.detail.copyFailed', 'Could not copy to the clipboard.'), 'error')
          }
        },
      },
    ]
    if (claim.claimNumber) {
      items.push({
        id: 'copy-number',
        label: t('warranty_claims.detail.copyClaimNumber', 'Copy claim number'),
        icon: Hash,
        onSelect: async () => {
          try {
            await navigator.clipboard.writeText(claim.claimNumber ?? '')
            flash(t('warranty_claims.detail.claimNumberCopied', 'Claim number copied.'), 'success')
          } catch {
            flash(t('warranty_claims.detail.copyFailed', 'Could not copy to the clipboard.'), 'error')
          }
        },
      })
    }
    if (claim.orderId) {
      items.push({
        id: 'view-order',
        label: claim.orderNumber ?? t('warranty_claims.detail.viewOrder'),
        icon: Copy,
        onSelect: () => router.push(`/backend/sales/documents/${claim.orderId}`),
      })
    }
    if (featureAccess.claimManage && claimActive) {
      items.push({
        id: 'assign',
        label: t('warranty_claims.detail.reassign'),
        icon: UserRound,
        onSelect: openAssignDialog,
      })
      if (currentUserId && claim.assigneeUserId !== currentUserId) {
        items.push({
          id: 'assign-to-me',
          label: t('warranty_claims.detail.assignToMe'),
          icon: UserRound,
          onSelect: () => { void assignToMe() },
        })
      }
      if (claim.claimType !== 'vendor_recovery' && eligibleVendorLines.length > 0) {
        items.push({
          id: 'vendor-recovery',
          label: t('warranty_claims.detail.actions.vendorRecovery'),
          icon: RefreshCw,
          onSelect: () => setVendorDialogOpen(true),
        })
      }
    }
    return items
  }, [assignToMe, claim, claimActive, claimMutable, currentUserId, eligibleVendorLines.length, featureAccess.claimManage, openAssignDialog, router, t])

  const submitComment = React.useCallback(async () => {
    if (!claim || !commentBody.trim()) return
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(claim.updatedAt),
            () => apiCall('/api/warranty_claims/events', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                claimId: claim.id,
                body: commentBody.trim(),
                visibility: commentVisibility,
              }),
            }),
          )
          if (!call.ok) throw buildConflictError(call, t('warranty_claims.detail.error.action'), t)
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
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      const message = translateErrorMessage(err, t, 'warranty_claims.detail.error.comment')
      flash(message, 'error')
    }
  }, [claim, commentBody, commentVisibility, loadData, mutationContext, runMutation, t])

  const draftReplyWithAi = React.useCallback(async () => {
    if (!claim) return
    setDraftReplyLoading(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const draftCall = await apiCall('/api/warranty_claims/ai/draft-reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ claimId: claim.id }),
          })
          if (isDraftReplyNotConfigured(draftCall.result)) return draftCall
          if (!draftCall.ok) throw new Error(readErrorKey(draftCall.result) ?? 'warranty_claims.ai.draftError')
          return draftCall
        },
        context: mutationContext,
        mutationPayload: { claimId: claim.id },
      })
      if (isDraftReplyNotConfigured(call.result)) {
        setDraftReplyHidden(true)
        return
      }
      const draft = readDraftReply(call.result)
      if (!draft) {
        flash(t('warranty_claims.ai.draftError'), 'error')
        return
      }
      setCommentBody(draft)
      setCommentVisibility('customer')
    } catch (err) {
      flash(translateErrorMessage(err, t, 'warranty_claims.ai.draftError'), 'error')
    } finally {
      setDraftReplyLoading(false)
    }
  }, [claim, mutationContext, runMutation, t])

  const saveLineInlineField = React.useCallback<InlineLineSaveHandler>(async (line, field, value) => {
    if (!claim) return
    const payload: Record<string, unknown> = { id: line.id, claimId: claim.id, [field]: value }
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(line.updatedAt),
          () => updateCrud('warranty_claims/lines', payload, {
            errorMessage: t('warranty_claims.detail.lines.error.save'),
          }),
        ),
        context: mutationContext,
        mutationPayload: payload,
      })
      flash(t('warranty_claims.detail.lines.flash.saved'), 'success')
      await loadData()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadData })) return
      flash(translateErrorMessage(err, t, 'warranty_claims.detail.lines.error.save'), 'error')
    }
  }, [claim, loadData, mutationContext, runMutation, t])

  const lineFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'productLookup',
      label: t('warranty_claims.form.productLookup'),
      type: 'custom',
      layout: 'full',
      component: ({ values, setFormValue }) => (
        <ClaimLineProductPicker
          value={{
            productId: nullableText(values?.productId),
            variantId: nullableText(values?.variantId),
            productName: nullableText(values?.productName),
            sku: nullableText(values?.sku),
          }}
          onPick={(pick: ClaimProductPick) => {
            setFormValue?.('productId', pick.productId)
            setFormValue?.('variantId', pick.variantId)
            setFormValue?.('sku', pick.sku)
            setFormValue?.('productName', pick.productName)
          }}
          onClear={() => {
            setFormValue?.('productId', null)
            setFormValue?.('variantId', null)
          }}
          hideLabel
        />
      ),
    },
    { id: 'productName', label: t('warranty_claims.form.productName'), type: 'text', layout: 'half' },
    { id: 'sku', label: t('warranty_claims.form.sku'), type: 'text', layout: 'half' },
    { id: 'serialNumber', label: t('warranty_claims.form.serialNumber'), type: 'text', layout: 'half' },
    { id: 'purchaseDate', label: t('warranty_claims.form.purchaseDate'), type: 'date', layout: 'half' },
    { id: 'warrantyMonths', label: t('warranty_claims.form.warrantyMonths'), type: 'number', layout: 'half' },
    {
      id: 'entitlementPreview',
      label: t('warranty_claims.form.entitlement'),
      type: 'custom',
      layout: 'half',
      component: ({ values }) => {
        const purchaseDateText = nullableText(values?.purchaseDate)
        const purchaseDate = purchaseDateText ? new Date(purchaseDateText) : null
        const monthsValue = Number(values?.warrantyMonths)
        const months = Number.isFinite(monthsValue) && String(values?.warrantyMonths ?? '').trim() !== '' ? monthsValue : null
        return <EntitlementChip status={computeEntitlementPreview(purchaseDate, months)} t={t} />
      },
    },
    {
      id: 'faultCode',
      label: t('warranty_claims.form.faultCode'),
      type: 'select',
      loadOptions: () => loadDictionaryOptions(DICTIONARY_KEYS.faultCodes, 'fault'),
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
      options: buildDispositionOptions(allowedDispositions, currentLineDisposition, t),
      layout: 'half',
    },
    { id: 'creditAmount', label: t('warranty_claims.form.creditAmount'), type: 'number', layout: 'third' },
    { id: 'restockingFee', label: t('warranty_claims.form.restockingFee'), type: 'number', layout: 'third' },
    { id: 'coreChargeAmount', label: t('warranty_claims.form.coreChargeAmount'), type: 'number', layout: 'third' },
    { id: 'coreCreditAmount', label: t('warranty_claims.form.coreCreditAmount'), type: 'number', layout: 'third' },
    { id: 'conditionOnReceipt', label: t('warranty_claims.form.conditionOnReceipt'), type: 'textarea', rows: 3, layout: 'full' },
    { id: 'inspectionNotes', label: t('warranty_claims.form.inspectionNotes'), type: 'textarea', rows: 3, layout: 'full' },
  ], [allowedDispositions, currentLineDisposition, loadDictionaryOptions, t])

  const lineGroups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'line-main',
      title: t(resolveClaimTypeUiConfig(claim?.claimType).lineHeaderKey),
      fields: [
        'productLookup',
        'productName',
        'sku',
        'serialNumber',
        'purchaseDate',
        'warrantyMonths',
        'entitlementPreview',
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
      // Restock / core fields belong only to return-family claims; warranty & vendor-recovery
      // settle on the credit amount alone (LINE-05).
      fields: claimTypeAllowsLineFinancialAdjustments(claim?.claimType)
        ? ['creditAmount', 'restockingFee', 'coreChargeAmount', 'coreCreditAmount']
        : ['creditAmount'],
    },
    {
      id: 'line-inspection',
      title: t('warranty_claims.detail.lines.inspection'),
      fields: ['conditionOnReceipt', 'inspectionNotes'],
    },
  ], [claim?.claimType, t])

  const lineColumns = React.useMemo<ColumnDef<ClaimLine>[]>(() => [
    {
      accessorKey: 'lineNo',
      header: t('warranty_claims.detail.lines.column.number'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.lineNo ?? noValue}</span>,
    },
    {
      accessorKey: 'lineStatus',
      header: t('warranty_claims.detail.lines.column.status'),
      cell: ({ row }) => (
        <InlineLineSelectCell
          line={row.original}
          field="lineStatus"
          value={row.original.lineStatus}
          label={t('warranty_claims.form.lineStatus')}
          options={buildLineStatusOptions(row.original.lineStatus, t)}
          disabled={!linesInlineEditable}
          onSave={saveLineInlineField}
        />
      ),
    },
    {
      accessorKey: 'productName',
      header: t('warranty_claims.detail.lines.column.product'),
      cell: ({ row }) => (
        <div className="max-w-80 space-y-0.5">
          <div className="truncate font-medium" title={row.original.productName ?? undefined}>{row.original.productName ?? noValue}</div>
          <div className="truncate text-xs text-muted-foreground">
            {[row.original.sku, row.original.serialNumber].filter(Boolean).join(' / ') || noValue}
          </div>
        </div>
      ),
    },
    {
      id: 'entitlement',
      header: t('warranty_claims.detail.lines.column.entitlement'),
      cell: ({ row }) => {
        const purchaseDate = row.original.purchaseDate ? new Date(row.original.purchaseDate) : null
        return (
          <EntitlementChip
            status={computeEntitlementPreview(purchaseDate, row.original.warrantyMonths)}
            t={t}
          />
        )
      },
    },
    {
      accessorKey: 'qtyClaimed',
      header: t('warranty_claims.lines.header.qtyClaimed'),
      cell: ({ row }) => formatQuantity(row.original.qtyClaimed, noValue),
    },
    {
      accessorKey: 'qtyApproved',
      header: t('warranty_claims.lines.header.qtyApproved'),
      cell: ({ row }) => (
        <InlineQtyApprovedCell
          line={row.original}
          disabled={!linesInlineEditable}
          label={t('warranty_claims.form.qtyApproved')}
          onSave={saveLineInlineField}
        />
      ),
    },
    {
      accessorKey: 'disposition',
      header: t('warranty_claims.form.disposition'),
      cell: ({ row }) => (
        <InlineLineSelectCell
          line={row.original}
          field="disposition"
          value={row.original.disposition}
          label={t('warranty_claims.form.disposition')}
          emptyLabel={noValue}
          options={buildDispositionOptions(allowedDispositions, row.original.disposition, t)}
          disabled={!linesInlineEditable}
          onSave={saveLineInlineField}
        />
      ),
    },
    {
      accessorKey: 'creditAmount',
      header: t('warranty_claims.detail.lines.column.credit'),
      cell: ({ row }) => formatAmount(row.original.creditAmount, claim?.currencyCode ?? null, noValue),
    },
  ], [allowedDispositions, claim?.currencyCode, linesInlineEditable, noValue, saveLineInlineField, t])

  const transitionFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'rejectionReasonCode',
      label: t('warranty_claims.form.rejectionReasonCode'),
      type: 'select',
      required: true,
      loadOptions: () => loadDictionaryOptions(DICTIONARY_KEYS.rejectionReasons, 'rejection'),
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
        label: [
          t('warranty_claims.form.lines.lineLabel', 'Line {number}', { number: line.lineNo ?? '?' }),
          line.productName ?? line.sku,
        ].filter(Boolean).join(' — '),
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

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('warranty_claims.errors.notFound')}
            backHref="/backend/warranty_claims"
            backLabel={t('warranty_claims.detail.actions.backToList')}
          />
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

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'lines', label: t('warranty_claims.detail.tabs.lines'), count: lines.length },
    { id: 'timeline', label: t('warranty_claims.detail.tabs.timeline'), count: events.length },
    { id: 'attachments', label: t('warranty_claims.detail.tabs.attachments'), count: attachmentCount },
    { id: 'ai', label: t('warranty_claims.detail.tabs.ai') },
  ]
  const approvedLineCount = lines.filter((line) => line.lineStatus === 'approved').length
  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="px-8 pb-5 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                  {t(`warranty_claims.claimType.${claim.claimType ?? 'warranty'}`)}
                  <span className="ml-1 font-semibold text-foreground">
                    {claim.claimNumber ?? t('warranty_claims.detail.unnumbered', 'Unnumbered claim')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {featureAccess.claimDelete ? (
                    <IconButton
                      type="button"
                      variant="outline"
                      size="default"
                      className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={!DELETABLE_CLAIM_STATUSES.has(currentStatus)}
                      aria-label={t('warranty_claims.audit.claim.delete')}
                      title={DELETABLE_CLAIM_STATUSES.has(currentStatus)
                        ? t('warranty_claims.audit.claim.delete')
                        : t('warranty_claims.errors.deleteNotAllowed')}
                      onClick={() => { void deleteClaim() }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  ) : null}
                  <ActionsDropdown
                    items={headerMoreActions}
                    triggerMode="icon"
                    ariaLabel={t('ui.actions.actions', 'Actions')}
                  />
                  <Select
                    value=""
                    disabled={!featureAccess.claimManage || resolutionStatuses.length === 0}
                    onValueChange={(status) => { void confirmAndTransition(status as ClaimStatus) }}
                  >
                    <SelectTrigger className="h-8 w-28" aria-label={t('warranty_claims.edit.fulfillment.resolution')}>
                      <SelectValue placeholder={t('warranty_claims.edit.fulfillment.resolution')} />
                    </SelectTrigger>
                    <SelectContent>
                      {resolutionStatuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {t(`warranty_claims.status.${status}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {featureAccess.claimManage && primaryNextStatus ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => { void confirmAndTransition(primaryNextStatus) }}
                    >
                      {primaryNextStatus === 'submitted' && currentStatus === 'draft'
                        ? t('warranty_claims.detail.actions.submit')
                        : primaryNextStatus === 'in_review' && currentStatus === 'submitted'
                          ? t('warranty_claims.list.actions.startReview')
                          : t(`warranty_claims.status.${primaryNextStatus}`)}
                    </Button>
                  ) : null}
                </div>
              </div>
              <h1 className="mt-3 max-w-3xl text-2xl font-bold tracking-tight text-foreground">
                {claim.notes || claim.reasonCode || claim.claimNumber || t('warranty_claims.detail.unnumbered', 'Unnumbered claim')}
              </h1>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:max-w-4xl xl:grid-cols-6">
              <div>
                <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.customer')}</p>
                <div className="mt-1 text-sm font-medium text-foreground">
                  <span>
                    {claim.customerName ? (
                      customerLink && customerLink.customerId === claim.customerId ? (
                        <Link
                          href={customerLink.href}
                          className="text-foreground underline-offset-4 hover:underline"
                        >
                          {claim.customerName}
                        </Link>
                      ) : (
                        claim.customerName
                      )
                    ) : (
                      noValue
                    )}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.priority', 'Priority')}</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {t(`warranty_claims.priority.${claim.priority ?? 'normal'}`)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.opened')}</p>
                <p className="mt-1 text-sm font-medium text-foreground" title={formatDateTime(claim.createdAt) ?? undefined}>
                  {formatRelativeTime(claim.createdAt, { locale, translate: t }) ?? noValue}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('warranty_claims.list.column.slaDueAt')}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <ClaimSlaIndicator
                    slaDueAt={claim.slaDueAt}
                    slaPausedAt={claim.slaPausedAt}
                    submittedAt={claim.submittedAt}
                    status={claim.status}
                    atRiskThresholdPct={slaAtRiskThresholdPct}
                  />
                  <RiskSignalChips signals={riskSignals} t={t} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.owner')}</p>
                <p className="mt-1 truncate text-sm font-medium text-foreground" title={assigneeDisplayName}>{assigneeDisplayName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.state')}</p>
                <div className="mt-1">
                  <ClaimStatusBadge status={claim.status} />
                </div>
              </div>
            </div>
            </div>
            <ClaimStageProgress status={claim.status} />
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as TabId)}
            variant="underline"
          >
            <TabsList className="h-auto w-full flex-wrap gap-1 px-7" aria-label={t('warranty_claims.detail.tabs.label', 'Claim sections')}>
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  count={tab.count}
                  data-tab-id={tab.id}
                  className="px-3.5 pb-2.5 pt-3"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="lines" className="mt-0">
              <div>
                <div className="grid items-center gap-4 border-b border-border px-8 py-5 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.totalClaimed')}</p>
                    <p className="mt-1 text-base font-semibold text-foreground">
                      {formatAmount(claim.totalClaimedAmount, claim.currencyCode, noValue)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t('warranty_claims.detail.lines.count', { count: lines.length })}
                    </p>
                  </div>
                  <div className="xl:border-l xl:border-border xl:pl-5">
                    <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.totalApproved')}</p>
                    <p className="mt-1 text-base font-semibold text-foreground">
                      {formatAmount(claim.totalApprovedAmount, claim.currencyCode, noValue)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t('warranty_claims.detail.lines.approvedCount', { count: approvedLineCount })}
                    </p>
                  </div>
                  <div className="xl:border-l xl:border-border xl:pl-5">
                    <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.totalRecovered')}</p>
                    <p className="mt-1 text-base font-semibold text-foreground">
                      {formatAmount(claim.totalRecoveredAmount, claim.currencyCode, noValue)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {claim.vendorName ?? t('warranty_claims.detail.lines.noVendorClaims')}
                    </p>
                  </div>
                  {linesInlineEditable ? (
                    <Button type="button" variant="outline" size="sm" className="justify-self-start xl:justify-self-end" onClick={() => setLineDialog({ mode: 'create' })}>
                      {t('warranty_claims.detail.lines.add')}
                    </Button>
                  ) : null}
                </div>
                <div className="pb-3">
                  <DataTable<ClaimLine>
                    embedded
                    columns={lineColumns}
                    data={lines}
                    stickyActionsColumn
                    emptyState={(
                      <EmptyState
                        title={t('warranty_claims.detail.lines.empty.title')}
                        description={t('warranty_claims.detail.lines.empty.description')}
                        variant="subtle"
                      />
                    )}
                    rowActions={linesInlineEditable ? (line) => (
                      <RowActions
                        items={[
                          {
                            id: 'edit',
                            label: t('warranty_claims.detail.lines.edit'),
                            onSelect: () => setLineDialog({ mode: 'edit', line }),
                          },
                        ]}
                      />
                    ) : undefined}
                  />
                </div>
                <div className="px-8 pb-8">
                  <ReceivingPanel
                    claimId={claim.id}
                    lines={lines}
                    canManage={featureAccess.receivingManage}
                    receivingCapable={RECEIVING_CAPABLE_CLAIM_STATUSES.has(currentStatus)}
                    onRefresh={loadData}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="timeline" className="mt-0">
              <div className="mx-8 max-w-3xl space-y-5 pb-8 pt-6">
                {featureAccess.claimManage ? (
                  <div>
                    <div className="space-y-4">
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
                        rows={6}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Select value={commentVisibility} onValueChange={(next) => setCommentVisibility(next === 'customer' ? 'customer' : 'internal')}>
                            <SelectTrigger className="w-40" aria-label={t('warranty_claims.detail.visibility.label')}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="internal">{t('warranty_claims.detail.visibility.internal')}</SelectItem>
                              <SelectItem value="customer">{t('warranty_claims.detail.visibility.customer')}</SelectItem>
                            </SelectContent>
                          </Select>
                          {!draftReplyHidden && featureAccess.claimManage && claimMutable ? (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => { void draftReplyWithAi() }}
                              disabled={draftReplyLoading}
                            >
                              <AiIcon className="size-4" aria-hidden="true" />
                              {draftReplyLoading
                                ? t('warranty_claims.ai.draftingReply')
                                : t('warranty_claims.ai.draftReply')}
                            </Button>
                          ) : null}
                        </div>
                        <Button type="button" onClick={() => { void submitComment() }} disabled={!commentBody.trim()}>
                          {t('warranty_claims.detail.timeline.addComment')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="space-y-3">
                  {events.length ? (
                    <SegmentedControl
                      size="sm"
                      value={timelineFilter}
                      onValueChange={(next) => setTimelineFilter(isTimelineFilterId(next) ? next : 'all')}
                      aria-label={t('warranty_claims.detail.timeline.filter.label', 'Filter timeline')}
                    >
                      {TIMELINE_FILTERS.map((filter) => (
                        <SegmentedControlItem key={filter} value={filter}>
                          {t(TIMELINE_FILTER_LABELS[filter].key, TIMELINE_FILTER_LABELS[filter].fallback)}
                        </SegmentedControlItem>
                      ))}
                    </SegmentedControl>
                  ) : null}
                  {filteredTimelineEvents.length ? filteredTimelineEvents.map((event) => {
                    const Icon = eventIcon(event.kind)
                    const body = formatTimelineBody(event, t, userNames)
                    const actor = resolveTimelineActor(event, claim, userNames, t)
                    return (
                      <div key={event.id} className="flex gap-3 py-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Icon className="h-4 w-4" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{t(`warranty_claims.eventKind.${event.kind}`)}</span>
                            <span className="text-sm text-muted-foreground">{actor}</span>
                            <StatusBadge variant={event.visibility === 'customer' ? 'info' : 'neutral'}>
                              {event.visibility === 'customer'
                                ? t('warranty_claims.detail.visibility.customer')
                                : t('warranty_claims.detail.visibility.internal')}
                            </StatusBadge>
                            <span className="text-xs text-muted-foreground">{formatDateTime(event.createdAt) ?? noValue}</span>
                          </div>
                          {body ? <p className="text-sm">{body}</p> : null}
                        </div>
                      </div>
                    )
                  }) : events.length ? (
                    <EmptyState
                      title={t('warranty_claims.detail.timeline.filterEmpty.title', 'No matching events')}
                      description={t('warranty_claims.detail.timeline.filterEmpty.description', 'No timeline events match the selected filter.')}
                      variant="subtle"
                    />
                  ) : (
                    <EmptyState
                      title={t('warranty_claims.detail.timeline.empty.title')}
                      description={t('warranty_claims.detail.timeline.empty.description')}
                      variant="subtle"
                    />
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="attachments" className="mt-0">
              <div className="px-8 pb-8 pt-6">
                <AttachmentInput entityId="warranty_claims:warranty_claim" recordId={claim.id} onCountChange={setAttachmentCount} />
              </div>
            </TabsContent>

            <TabsContent value="ai" className="mt-0">
              <div className="grid gap-4 px-8 pb-8 pt-6 xl:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">{t('warranty_claims.triage.panelTitle')}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{t('warranty_claims.triage.panelSubtitle')}</p>
                    </div>
                    <Button type="button" variant="outline" onClick={loadAiSuggestion} disabled={aiLoading}>
                      {t('warranty_claims.triage.suggestButton')}
                    </Button>
                  </div>
                  {aiSuggestion ? (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-md border border-border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge variant={aiSuggestion.priority.overdue ? 'error' : 'info'}>
                            {t(`warranty_claims.priority.${aiSuggestion.priority.currentPriority}`)}
                            {' → '}
                            {t(`warranty_claims.priority.${aiSuggestion.priority.suggestedPriority}`)}
                          </StatusBadge>
                          <RiskSignalChips signals={aiSuggestion.risk?.signals ?? []} t={t} />
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{formatTriageMessage(aiSuggestion.priority.reason, t)}</p>
                      </div>
                      <div className="space-y-2">
                        {aiSuggestion.lines.map((suggestedLine) => {
                          const applied = appliedTriageLineIds.has(suggestedLine.lineId)
                          return (
                            <div
                              key={suggestedLine.lineId}
                              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-medium">
                                  {triageLineHeading(suggestedLine, lines, t)}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <StatusBadge variant={eligibilityBadgeVariant(suggestedLine.eligibility.status)}>
                                    {t(`warranty_claims.eligibility.${suggestedLine.eligibility.status}`)}
                                  </StatusBadge>
                                  <StatusBadge variant="info">
                                    {t(`warranty_claims.disposition.${suggestedLine.suggestedDisposition}`)}
                                  </StatusBadge>
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">{formatTriageMessage(suggestedLine.reason, t)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{formatTriageMessage(suggestedLine.eligibility.reason, t)}</p>
                              </div>
                              {applied ? (
                                <StatusBadge variant="success">
                                  {t('warranty_claims.triage.applied', 'Applied')}
                                  {': '}
                                  {t(`warranty_claims.disposition.${suggestedLine.suggestedDisposition}`)}
                                </StatusBadge>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => applyAiDisposition(suggestedLine.lineId, suggestedLine.suggestedDisposition)}
                                >
                                  {t('warranty_claims.triage.apply')}
                                </Button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <EmptyState
                        title={t('warranty_claims.triage.panelTitle')}
                        description={t('warranty_claims.triage.empty.description')}
                        variant="subtle"
                      />
                    </div>
                  )}
                </div>
                <div className="h-96 overflow-hidden rounded-lg border border-border bg-card">
                  <React.Suspense fallback={<LoadingMessage label={t('warranty_claims.detail.loading')} />}>
                    {/* Scope the conversation to this claim and remount on claim change so a
                        claim can never inherit another claim's transcript (WQA-007 / AI-01). */}
                    <LazyAiChat
                      key={`${AGENT_ID}:${claim.id}`}
                      agent={AGENT_ID}
                      pageContext={{ entityType: 'warranty_claims.claim', recordId: claim.id }}
                      className="h-full"
                      placeholder={t('warranty_claims.ai.chatPlaceholder')}
                      welcomeTitle={t('warranty_claims.ai.chatWelcomeTitle')}
                    />
                  </React.Suspense>
                </div>
                {lines.length ? (
                  <div className="space-y-3 xl:col-span-2">
                    {lines.map((line) => (
                      <div key={line.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {line.productName ?? line.sku ?? t('warranty_claims.detail.lines.unnamed', 'Unnamed line')}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[line.sku, line.serialNumber].filter(Boolean).join(' / ') || noValue}
                          </p>
                        </div>
                        <AiAssessButtons
                          claimId={claim.id}
                          line={line}
                          canManage={featureAccess.claimManage && claimMutable}
                          onRefresh={loadData}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
          </div>

          <ReturnLabelPanel claim={claim} canManage={featureAccess.claimManage} onRefresh={loadData} />

          {(() => {
            const showSalesReturn = featureAccess.claimManage
              && featureAccess.salesReturnsCreate
              && claim.orderId
              && !claim.salesReturnId
              && ['approved', 'awaiting_return', 'received', 'inspecting'].includes(currentStatus ?? '')
            const showReplacementOrder = featureAccess.claimManage
              && featureAccess.salesOrdersManage
              && claim.orderId
              && !claim.replacementOrderId
              && ['approved', 'awaiting_return', 'received', 'inspecting', 'resolved'].includes(currentStatus ?? '')
            const showCreditMemo = featureAccess.claimManage
              && featureAccess.salesCreditMemosManage
              && claim.orderId
              && !claim.creditMemoId
              && ['received', 'inspecting', 'resolved'].includes(currentStatus ?? '')
            if (!showSalesReturn && !showReplacementOrder && !showCreditMemo) return null
            return (
              <div className="flex flex-wrap items-center gap-2">
                {showSalesReturn ? (
                  <Button type="button" variant="outline" onClick={() => { void createSalesReturn() }}>
                    {t('warranty_claims.detail.createSalesReturn')}
                  </Button>
                ) : null}
                {showReplacementOrder ? (
                  <Button type="button" variant="outline" onClick={() => { void createReplacementOrder() }}>
                    {t('warranty_claims.detail.createReplacementOrder')}
                  </Button>
                ) : null}
                {showCreditMemo ? (
                  <Button type="button" variant="outline" onClick={() => { void createCreditMemo() }}>
                    {t('warranty_claims.detail.createCreditMemo')}
                  </Button>
                ) : null}
              </div>
            )
          })()}

          <VendorRecoverySuggestionsPanel
            claim={claim}
            canManage={featureAccess.claimManage}
            onGenerateSupplierRecovery={generateSupplierRecovery}
          />
        </div>
      </PageBody>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent
          className="max-w-lg"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void assignClaim()
            }
            if (event.key === 'Escape') {
              setAssignDialogOpen(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('warranty_claims.detail.assignDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="warranty-claim-assignee-search">
                {t('warranty_claims.detail.assignDialog.search')}
              </Label>
              <Input
                id="warranty-claim-assignee-search"
                value={assignSearch}
                onChange={(event) => setAssignSearch(event.target.value)}
                placeholder={t('warranty_claims.detail.assignDialog.searchPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="warranty-claim-assignee-select">
                {t('warranty_claims.detail.assignDialog.staff')}
              </Label>
              <Select value={selectedAssigneeUserId} onValueChange={setSelectedAssigneeUserId}>
                <SelectTrigger id="warranty-claim-assignee-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_SELECT_VALUE}>{t('warranty_claims.detail.unassigned')}</SelectItem>
                  {assignableOptions.map((staffMember) => (
                    <SelectItem key={staffMember.userId} value={staffMember.userId}>
                      {staffMember.email && staffMember.email !== staffMember.displayName
                        ? `${staffMember.displayName} (${staffMember.email})`
                        : staffMember.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignLoading ? (
                <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.assignDialog.loading')}</p>
              ) : null}
              {!assignLoading && assignableOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('warranty_claims.detail.assignDialog.empty')}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => { void assignClaim() }}>
              {t('warranty_claims.form.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            fields={lineDialog?.mode === 'edit' ? lineFields : lineFields.filter((field) => field.id !== 'lineStatus')}
            groups={lineDialog?.mode === 'edit'
              ? lineGroups
              : lineGroups.map((group) => ({ ...group, fields: (group.fields ?? []).filter((fieldId) => fieldId !== 'lineStatus') }))}
            initialValues={lineDialog?.mode === 'edit'
              ? {
                  ...lineDialog.line,
                  qtyClaimed: quantityInputValue(lineDialog.line.qtyClaimed),
                  qtyApproved: quantityInputValue(lineDialog.line.qtyApproved),
                  qtyReceived: quantityInputValue(lineDialog.line.qtyReceived),
                }
              : { claimId: claim.id, qtyClaimed: '1', lineStatus: 'pending', warrantyMonths: defaultWarrantyMonths ?? undefined }}
            submitLabel={t('warranty_claims.form.submit')}
            onSubmit={async (values) => {
              const payload: Record<string, unknown> = {
                claimId: claim.id,
                productId: nullableText(values.productId),
                variantId: nullableText(values.variantId),
                productName: nullableText(values.productName),
                sku: nullableText(values.sku),
                serialNumber: nullableText(values.serialNumber),
                purchaseDate: nullableText(values.purchaseDate),
                warrantyMonths: values.warrantyMonths === null || values.warrantyMonths === undefined || String(values.warrantyMonths).trim() === ''
                  ? null
                  : Number(values.warrantyMonths),
                faultCode: nullableText(values.faultCode),
                faultDescription: nullableText(values.faultDescription),
                qtyClaimed: values.qtyClaimed ?? 1,
                qtyApproved: values.qtyApproved ?? null,
                qtyReceived: values.qtyReceived ?? null,
                disposition: nullableText(values.disposition),
                creditAmount: values.creditAmount ?? null,
                restockingFee: values.restockingFee ?? null,
                coreChargeAmount: values.coreChargeAmount ?? null,
                coreCreditAmount: values.coreCreditAmount ?? null,
                conditionOnReceipt: nullableText(values.conditionOnReceipt),
                inspectionNotes: nullableText(values.inspectionNotes),
              }
              if (lineDialog?.mode === 'edit') {
                payload.lineStatus = nullableText(values.lineStatus) ?? 'pending'
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
