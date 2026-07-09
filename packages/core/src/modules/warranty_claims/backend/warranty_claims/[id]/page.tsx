"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Copy, Info, MessageSquare, RefreshCw, UserRound } from 'lucide-react'
import { hasFeature } from '@open-mercato/shared/security/features'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import type { TranslateFn, TranslateParams } from '@open-mercato/shared/lib/i18n/context'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { AiChat } from '@open-mercato/ui/ai/AiChat'
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
import { useAiChatSessions } from '@open-mercato/ui/ai/AiChatSessions'
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
} from '@open-mercato/core/modules/customers/components/detail/assignableStaff'
import { CLAIM_STATUS_TRANSITIONS } from '../../../data/constants'
import {
  ClaimPriorityBadge,
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
import { EntitlementLookupBadge } from '../../components/EntitlementLookupBadge'
import { ReceivingPanel } from '../../components/ReceivingPanel'
import { ReturnLabelPanel } from '../../components/ReturnLabelPanel'
import { VendorRecoverySuggestionsPanel } from '../../components/VendorRecoverySuggestionsPanel'
import { resolveClaimTypeUiConfig } from '../../../lib/claimTypeConfig'
import { localizeDictionaryLabel, type DictionaryLabelKind } from '../../../lib/dictionaryLabels'

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
const RECEIVING_CAPABLE_CLAIM_STATUSES = new Set<string>([
  'received',
  'inspecting',
  'awaiting_return',
  'approved',
])
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

function getUserDisplayName(record: Record<string, unknown>): string | null {
  const displayName = toStringOrNull(record.display_name) ?? toStringOrNull(record.displayName)
  if (displayName) return displayName
  return toStringOrNull(record.email)
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

function formatTimelineBody(event: ClaimEvent, t: TranslateFn, userNames: Record<string, string>): string | null {
  if (event.body) return event.body
  const payload = event.payload
  const action = payload ? toStringOrNull(payload.action) : null
  if (event.kind === 'system' && action === 'sla_paused') return t('warranty_claims.timeline.slaPaused')
  if (event.kind === 'system' && action === 'sla_resumed') return t('warranty_claims.timeline.slaResumed')
  if (event.kind === 'system' && action === 'auto_approved') return t('warranty_claims.timeline.autoApproved')
  if (event.kind === 'assignment') {
    const assigneeUserId = payload ? toStringOrNull(payload.assigneeUserId) : null
    if (!assigneeUserId) return t('warranty_claims.timeline.unassigned')
    return t('warranty_claims.timeline.assignedTo', { name: userNames[assigneeUserId] ?? assigneeUserId })
  }
  const from = payload ? toStringOrNull(payload.from) ?? toStringOrNull(payload.fromStatus) : null
  const to = payload ? toStringOrNull(payload.to) ?? toStringOrNull(payload.toStatus) : null
  if (event.kind === 'status_changed' && from && to) {
    return `${t(`warranty_claims.status.${from}`)} → ${t(`warranty_claims.status.${to}`)}`
  }
  return null
}

function resolveTimelineActor(event: ClaimEvent, claim: ClaimRecord, userNames: Record<string, string>, t: TranslateFn): string {
  if (event.actorUserId) return userNames[event.actorUserId] ?? event.actorUserId
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

function normalizeClaimChannel(value: string | null | undefined): ClaimChannel | null {
  return value === 'staff' || value === 'portal' || value === 'api' ? value : null
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

function InlineQtyApprovedCell({
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
  const currentValue = line.qtyApproved ?? ''
  const [draft, setDraft] = React.useState(currentValue)

  React.useEffect(() => {
    setDraft(currentValue)
  }, [currentValue])

  const save = React.useCallback(() => {
    const nextValue = draft.trim().length ? draft.trim() : null
    const previousValue = line.qtyApproved ?? null
    if (nextValue === previousValue) return
    void onSave(line, 'qtyApproved', nextValue)
  }, [draft, line, onSave])

  return (
    <Input
      type="number"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      aria-label={label}
      className="w-28"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(currentValue)
          event.currentTarget.blur()
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          save()
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
      <SelectTrigger aria-label={label} className="w-40">
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
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const currentUserId = useCurrentUserId()
  const [claim, setClaim] = React.useState<ClaimRecord | null>(null)
  const [lines, setLines] = React.useState<ClaimLine[]>([])
  const [events, setEvents] = React.useState<ClaimEvent[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<TabId>('lines')
  const [lineDialog, setLineDialog] = React.useState<{ mode: 'create' } | { mode: 'edit'; line: ClaimLine } | null>(null)
  const [defaultWarrantyMonths, setDefaultWarrantyMonths] = React.useState<number | null>(null)
  const [featureAccess, setFeatureAccess] = React.useState({
    claimManage: false,
    receivingManage: false,
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
          features: ['warranty_claims.claim.manage', 'warranty_claims.receiving.manage'],
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
          receivingManage: allGranted || hasFeature(granted, 'warranty_claims.receiving.manage'),
        })
      })
      .catch(() => {
        if (!cancelled) {
          setFeatureAccess({ claimManage: false, receivingManage: false })
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
  const [userNames, setUserNames] = React.useState<Record<string, string>>({})
  const resolvedUserIdsRef = React.useRef<Set<string>>(new Set())
  const [assignDialogOpen, setAssignDialogOpen] = React.useState(false)
  const [assignSearch, setAssignSearch] = React.useState('')
  const [assignOptions, setAssignOptions] = React.useState<AssignableStaffMember[]>([])
  const [assignLoading, setAssignLoading] = React.useState(false)
  const [selectedAssigneeUserId, setSelectedAssigneeUserId] = React.useState<string>(UNASSIGNED_SELECT_VALUE)
  const sessions = useAiChatSessions()
  const chatSession = sessions.getActiveSession(AGENT_ID)

  React.useEffect(() => {
    if (!chatSession) sessions.ensureSession(AGENT_ID)
  }, [chatSession, sessions])

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
    try {
      const [claimPayload, linesPayload, eventsPayload, riskPayload, statsPayload] = await Promise.all([
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
      ])
      const nextClaim = (claimPayload.items ?? []).map(normalizeClaim).find((item): item is ClaimRecord => item !== null) ?? null
      if (!nextClaim) {
        setClaim(null)
        setLines([])
        setEvents([])
        setRiskAssessment(EMPTY_RISK_ASSESSMENT)
        setError(t('warranty_claims.errors.notFound'))
        return
      }
      setClaim(nextClaim)
      setLines((linesPayload.items ?? []).map(normalizeLine).filter((item): item is ClaimLine => item !== null))
      setEvents((eventsPayload.items ?? []).map(normalizeEvent).filter((item): item is ClaimEvent => item !== null))
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

  React.useEffect(() => {
    const unresolvedIds = new Set<string>()
    if (claim?.assigneeUserId && !resolvedUserIdsRef.current.has(claim.assigneeUserId)) {
      unresolvedIds.add(claim.assigneeUserId)
    }
    for (const event of events) {
      if (event.actorUserId && !resolvedUserIdsRef.current.has(event.actorUserId)) {
        unresolvedIds.add(event.actorUserId)
      }
      if (event.kind === 'assignment') {
        const assigneeUserId = toStringOrNull(event.payload?.assigneeUserId)
        if (assigneeUserId && !resolvedUserIdsRef.current.has(assigneeUserId)) {
          unresolvedIds.add(assigneeUserId)
        }
      }
    }
    if (!unresolvedIds.size) return

    for (const userId of unresolvedIds) resolvedUserIdsRef.current.add(userId)

    const controller = new AbortController()
    readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `/api/auth/users?ids=${[...unresolvedIds].map(encodeURIComponent).join(',')}`,
      { signal: controller.signal },
      {
        fallback: { items: [] },
        errorMessage: t('warranty_claims.detail.error.loadUsers'),
      },
    )
      .then((data) => {
        const nextNames: Record<string, string> = {}
        for (const user of data.items ?? []) {
          const userId = toStringOrNull(user.id)
          const displayName = getUserDisplayName(user)
          if (userId && displayName) nextNames[userId] = displayName
        }
        if (Object.keys(nextNames).length) {
          setUserNames((current) => ({ ...current, ...nextNames }))
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [claim?.assigneeUserId, events, t])

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

  const currentStatus = typeof claim?.status === 'string' ? claim.status : 'draft'
  const nextStatuses = React.useMemo(() => {
    if (!claim || !(currentStatus in CLAIM_STATUS_TRANSITIONS)) return []
    return CLAIM_STATUS_TRANSITIONS[currentStatus as ClaimStatus] ?? []
  }, [claim, currentStatus])

  const noValue = t('warranty_claims.common.noValue')
  const linesEditable = LINE_EDITABLE_CLAIM_STATUSES.has(currentStatus)
  const allowedDispositions = React.useMemo(
    () => resolveClaimTypeUiConfig(claim?.claimType).allowedDispositions,
    [claim?.claimType],
  )
  const currentLineDisposition = lineDialog?.mode === 'edit' ? lineDialog.line.disposition : null
  const riskSignals = riskAssessment.signals
  const assigneeDisplayName = claim?.assigneeUserId
    ? userNames[claim.assigneeUserId] ?? '—'
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
        displayName: userNames[claim.assigneeUserId] ?? claim.assigneeUserId,
        email: null,
        teamName: null,
      })
    }
    return Array.from(byUserId.values())
  }, [assignOptions, claim?.assigneeUserId, userNames])

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
    let conflictSurfaced = false
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
            const errorObject = buildConflictError(call, t('warranty_claims.detail.error.action'), t)
            if (surfaceRecordConflict(errorObject, t, { onRefresh: loadData })) {
              conflictSurfaced = true
              return call
            }
            throw errorObject
          }
          return call
        },
        context: mutationContext,
        mutationPayload: body,
      })
      if (conflictSurfaced) return
      flash(t(successKey), 'success')
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
    let conflictSurfaced = false
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
          if (!call.ok) {
            const errorObject = buildConflictError(call, t('warranty_claims.detail.error.action'), t)
            if (surfaceRecordConflict(errorObject, t, { onRefresh: loadData })) {
              conflictSurfaced = true
              return call
            }
            throw errorObject
          }
          return call
        },
        context: mutationContext,
        mutationPayload: payload,
      })
      if (conflictSurfaced) return false
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
      const call = await apiCall('/api/warranty_claims/ai/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: claim.id }),
      })
      if (isDraftReplyNotConfigured(call.result) || (call.status === 422 && isDraftReplyNotConfigured(call.result))) {
        setDraftReplyHidden(true)
        return
      }
      if (!call.ok) {
        flash(t(readErrorKey(call.result) ?? 'warranty_claims.ai.draftError'), 'error')
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
  }, [claim, t])

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
      fields: ['creditAmount', 'restockingFee', 'coreChargeAmount', 'coreCreditAmount'],
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
      header: t('warranty_claims.form.lineNo'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.lineNo ?? noValue}</span>,
    },
    {
      accessorKey: 'lineStatus',
      header: t('warranty_claims.form.lineStatus'),
      cell: ({ row }) => (
        <InlineLineSelectCell
          line={row.original}
          field="lineStatus"
          value={row.original.lineStatus}
          label={t('warranty_claims.form.lineStatus')}
          options={buildLineStatusOptions(row.original.lineStatus, t)}
          disabled={!linesEditable}
          onSave={saveLineInlineField}
        />
      ),
    },
    {
      accessorKey: 'productName',
      header: t('warranty_claims.form.productName'),
      cell: ({ row }) => (
        <div className="space-y-1">
          <div className="font-medium">{row.original.productName ?? noValue}</div>
          <div className="text-xs text-muted-foreground">{row.original.sku ?? noValue}</div>
          <AiAssessButtons
            claimId={claim?.id ?? ''}
            line={row.original}
            canManage={featureAccess.claimManage}
            onRefresh={loadData}
          />
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
      cell: ({ row }) => (
        <InlineQtyApprovedCell
          line={row.original}
          disabled={!linesEditable}
          label={t('warranty_claims.form.qtyApproved')}
          onSave={saveLineInlineField}
        />
      ),
    },
    {
      accessorKey: 'qtyReceived',
      header: t('warranty_claims.form.qtyReceived'),
      cell: ({ row }) => row.original.qtyReceived ?? noValue,
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
          disabled={!linesEditable}
          onSave={saveLineInlineField}
        />
      ),
    },
    {
      accessorKey: 'creditAmount',
      header: t('warranty_claims.form.creditAmount'),
      cell: ({ row }) => formatAmount(row.original.creditAmount, claim?.currencyCode ?? null, noValue),
    },
  ], [allowedDispositions, claim?.currencyCode, claim?.id, featureAccess.claimManage, linesEditable, loadData, noValue, saveLineInlineField, t])

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
  const claimChannel = normalizeClaimChannel(claim.channel)

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">{claim.claimNumber ?? claim.id}</h1>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={t('warranty_claims.detail.copyLink')}
                    onClick={() => {
                      void navigator.clipboard.writeText(window.location.href)
                      flash(t('warranty_claims.detail.linkCopied'), 'success')
                    }}
                  >
                    <Copy className="size-4" aria-hidden />
                  </Button>
                  <StatusBadge variant="neutral">{t(`warranty_claims.claimType.${claim.claimType ?? 'warranty'}`)}</StatusBadge>
                  {claimChannel ? <StatusBadge variant="neutral">{t(`warranty_claims.channel.${claimChannel}`)}</StatusBadge> : null}
                  <ClaimStatusBadge status={claim.status} />
                  <ClaimPriorityBadge priority={claim.priority} />
                  {claim.awaitingStaffReply ? (
                    <StatusBadge variant="warning">{t('warranty_claims.detail.badge.customerReplied')}</StatusBadge>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span>{t('warranty_claims.detail.customer')}: {claim.customerName ?? noValue}</span>
                  <span>
                    {t('warranty_claims.list.column.order')}:{' '}
                    {claim.orderId ? (
                      <Link
                        href={`/backend/sales/documents/${claim.orderId}`}
                        className="text-foreground underline-offset-4 hover:underline"
                      >
                        {claim.orderNumber ?? t('warranty_claims.detail.viewOrder')}
                      </Link>
                    ) : noValue}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <UserRound className="size-4" aria-hidden />
                    <span>{t('warranty_claims.detail.assignee')}: {assigneeDisplayName}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-2 py-1 text-xs"
                      onClick={openAssignDialog}
                    >
                      {t('warranty_claims.detail.reassign')}
                    </Button>
                    {currentUserId && claim.assigneeUserId !== currentUserId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-2 py-1 text-xs"
                        onClick={() => { void assignToMe() }}
                      >
                        {t('warranty_claims.detail.assignToMe')}
                      </Button>
                    ) : null}
                  </span>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span>{t('warranty_claims.list.column.slaDueAt')}:</span>
                    <ClaimSlaIndicator
                      slaDueAt={claim.slaDueAt}
                      slaPausedAt={claim.slaPausedAt}
                      submittedAt={claim.submittedAt}
                      status={claim.status}
                      atRiskThresholdPct={slaAtRiskThresholdPct}
                    />
                    <RiskSignalChips signals={riskSignals} t={t} />
                  </span>
                  <EntitlementLookupBadge claim={claim} lines={lines} />
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

          <ReturnLabelPanel claim={claim} canManage={featureAccess.claimManage} onRefresh={loadData} />

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

          <VendorRecoverySuggestionsPanel
            claim={claim}
            canManage={featureAccess.claimManage}
            onGenerateSupplierRecovery={generateSupplierRecovery}
          />

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 border-b border-border">
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-tab-id={tab.id}
                  data-active={activeTab === tab.id ? 'true' : 'false'}
                  onClick={() => setActiveTab(tab.id)}
                  className={`h-auto rounded-none border-b-2 px-3 py-2 text-sm font-medium transition-colors hover:bg-transparent ${
                    activeTab === tab.id
                      ? 'border-accent-indigo text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </Button>
              ))}
            </div>

            {activeTab === 'lines' ? (
              <div className="space-y-4">
                <ReceivingPanel
                  claimId={claim.id}
                  lines={lines}
                  canManage={featureAccess.receivingManage}
                  receivingCapable={RECEIVING_CAPABLE_CLAIM_STATUSES.has(currentStatus)}
                  onRefresh={loadData}
                />
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
              </div>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={commentVisibility} onValueChange={(next) => setCommentVisibility(next === 'customer' ? 'customer' : 'internal')}>
                          <SelectTrigger className="w-48" aria-label={t('warranty_claims.detail.visibility.label')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="internal">{t('warranty_claims.detail.visibility.internal')}</SelectItem>
                            <SelectItem value="customer">{t('warranty_claims.detail.visibility.customer')}</SelectItem>
                          </SelectContent>
                        </Select>
                        {!draftReplyHidden ? (
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
                <div className="space-y-3">
                  {events.length ? events.map((event) => {
                    const Icon = eventIcon(event.kind)
                    const body = formatTimelineBody(event, t, userNames)
                    const actor = resolveTimelineActor(event, claim, userNames, t)
                    return (
                      <div key={event.id} className="flex gap-3 rounded-lg border border-border bg-card p-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
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
              <div className="grid gap-4 xl:grid-cols-2">
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
                                  #{suggestedLine.lineNo}
                                  {' '}
                                  {suggestedLine.productName ?? suggestedLine.sku ?? suggestedLine.serialNumber ?? suggestedLine.lineId}
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
                  {chatSession ? (
                    <AiChat
                      key={chatSession.id}
                      agent={AGENT_ID}
                      conversationId={chatSession.conversationId}
                      pageContext={{ entityType: 'warranty_claims.claim', recordId: claim.id }}
                      className="h-full"
                      placeholder={t('warranty_claims.ai.chatPlaceholder')}
                      welcomeTitle={t('warranty_claims.ai.chatWelcomeTitle')}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
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
              ? { ...lineDialog.line }
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
