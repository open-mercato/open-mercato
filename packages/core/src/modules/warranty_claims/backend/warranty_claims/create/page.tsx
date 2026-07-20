"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { type TranslateFn, useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ClaimLineProductPicker,
  EntitlementChip,
  computeEntitlementPreview,
  type ClaimProductPick,
} from '../../components/productLookup'
import {
  loadOrderOptions as loadOrderOptionsShared,
  resolveOrderLabel,
} from '../../components/orderLookup'
import { EntitlementLookupBadge } from '../../components/EntitlementLookupBadge'
import { TroubleshootingWalker, type TroubleshootingWalkerGuide } from '../../components/TroubleshootingWalker'
import { resolveClaimTypeUiConfig } from '../../../lib/claimTypeConfig'
import { formatQuantity, parseQuantity } from '../../../lib/quantity'
import { localizeDictionaryLabel, type DictionaryLabelKind } from '../../../lib/dictionaryLabels'
import {
  parseGuideSteps,
  selectBestGuide,
  type TroubleshootingNode,
} from '../../../lib/troubleshooting'

type ClaimCreateLineValues = {
  productId?: string | null
  variantId?: string | null
  orderLineId?: string | null
  productName?: string | null
  sku?: string | null
  serialNumber?: string | null
  purchaseDate?: string | null
  warrantyMonths?: number | string | null
  faultCode?: string | null
  faultDescription?: string | null
  qtyClaimed?: number | string | null
}

type ClaimCreateFormValues = {
  claimType: string
  customerId?: string | null
  orderId?: string | null
  priority: string
  reasonCode?: string | null
  resolutionSummary?: string | null
  notes?: string | null
  lines?: ClaimCreateLineValues[]
}

type DictionaryListItem = {
  id?: string
  key?: string
}

type DictionaryEntriesResponse = {
  items?: unknown[]
}

type GeneralSettingsResponse = {
  result?: {
    defaultWarrantyMonths?: unknown
    default_warranty_months?: unknown
  }
}

type TroubleshootingGuideListResponse = {
  items?: unknown[]
}

type TroubleshootingGuideCandidate = {
  id: string
  title: string
  claimType: string | null
  reasonCode: string | null
  isActive: boolean
}

type TroubleshootingGuideDetail = TroubleshootingGuideCandidate & {
  steps: TroubleshootingNode | null
}

type SalesOrderLine = {
  id: string
  productId: string | null
  variantId: string | null
  sku: string | null
  name: string | null
  quantity: number | string | null
}

// Rows carry their position in the form's `lines` array so table actions can edit
// or drop the right entry after search and pagination have reordered what is shown.
type ClaimLineRow = ClaimCreateLineValues & {
  id: string
  index: number
  lineNo: number
}

type LineDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; index: number }

type LineEditorTranslations = {
  addLine: string
  removeLine: string
  productName: string
  sku: string
  serialNumber: string
  faultCode: string
  faultDescription: string
  qtyClaimed: string
  faultCodePlaceholder: string
}

// The sales list API caps a page at 100, so a large order needs several round trips.
// The hard cap keeps a pathological order from locking the dialog up forever; when it
// bites, the dialog says so instead of silently offering a partial list.
const ORDER_LINE_PAGE_SIZE = 100
const ORDER_LINE_MAX_FETCH = 2000
// Mirrors `lines: z.array(...).max(200)` in data/validators.ts.
const MAX_CLAIM_LINES = 200
const LINE_PAGE_SIZE = 20

const CLAIM_TYPES = ['warranty', 'return', 'core_return', 'vendor_recovery'] as const
const CLAIM_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const DICTIONARY_KEYS = {
  faultCodes: 'warranty_claims.warranty_claim_fault_code',
  claimReasons: 'warranty_claims.warranty_claim_reason',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function normalizeOption(item: unknown, t: TranslateFn): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const label =
    toStringOrNull(item.label) ??
    toStringOrNull(item.displayName) ??
    toStringOrNull(item.display_name) ??
    toStringOrNull(item.name) ??
    t('warranty_claims.form.customerUnnamed', 'Unnamed customer')
  const email = toStringOrNull(item.primaryEmail) ?? toStringOrNull(item.primary_email)
  return { value: id, label: email ? `${label} (${email})` : label }
}

function normalizeDictionaryOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const value = toStringOrNull(item.value)
  if (!value) return null
  const label = toStringOrNull(item.label) ?? value
  return { value, label }
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function normalizeTroubleshootingGuideCandidate(item: unknown): TroubleshootingGuideCandidate | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  const title = toStringOrNull(item.title)
  if (!id || !title) return null
  return {
    id,
    title,
    claimType: toStringOrNull(item.claimType) ?? toStringOrNull(item.claim_type),
    reasonCode: toStringOrNull(item.reasonCode) ?? toStringOrNull(item.reason_code),
    isActive: readBoolean(item.isActive ?? item.is_active),
  }
}

function normalizeTroubleshootingGuideDetail(item: unknown): TroubleshootingGuideDetail | null {
  const candidate = normalizeTroubleshootingGuideCandidate(item)
  if (!candidate || !isRecord(item)) return null
  return {
    ...candidate,
    steps: parseGuideSteps(item.steps),
  }
}

async function loadStaffTroubleshootingGuide(
  claimType: string | null,
  reasonCode: string | null,
): Promise<TroubleshootingWalkerGuide | null> {
  if (!claimType) return null
  const listParams = new URLSearchParams({
    isActive: 'true',
    page: '1',
    pageSize: '100',
    sortField: 'updatedAt',
    sortDir: 'desc',
  })
  const listCall = await apiCall<TroubleshootingGuideListResponse>(
    `/api/warranty_claims/troubleshooting-guides?${listParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  if (!listCall.ok) return null

  const candidates = (listCall.result?.items ?? [])
    .map(normalizeTroubleshootingGuideCandidate)
    .filter((guide): guide is TroubleshootingGuideCandidate => guide !== null)
  const selected = selectBestGuide(candidates, claimType, reasonCode)
  if (!selected) return null

  const detailParams = new URLSearchParams({
    ids: selected.id,
    page: '1',
    pageSize: '1',
  })
  const detailCall = await apiCall<TroubleshootingGuideListResponse>(
    `/api/warranty_claims/troubleshooting-guides?${detailParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  if (!detailCall.ok) return null

  const detail = normalizeTroubleshootingGuideDetail(detailCall.result?.items?.[0])
  if (!detail?.steps) return null
  return { title: detail.title, steps: detail.steps }
}

function readCatalogSnapshotName(value: unknown): string | null {
  if (!isRecord(value)) return null
  const product = isRecord(value.product) ? value.product : null
  const variant = isRecord(value.variant) ? value.variant : null
  return toStringOrNull(variant?.title) ?? toStringOrNull(product?.title) ?? null
}

function normalizeSalesOrderLine(item: unknown): SalesOrderLine | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const kind = toStringOrNull(item.kind)
  if (kind !== 'product') return null
  return {
    id,
    productId: toStringOrNull(item.product_id) ?? toStringOrNull(item.productId),
    variantId: toStringOrNull(item.product_variant_id) ?? toStringOrNull(item.productVariantId),
    sku: toStringOrNull(item.sku),
    name: toStringOrNull(item.name) ?? readCatalogSnapshotName(item.catalog_snapshot ?? item.catalogSnapshot),
    quantity: typeof item.quantity === 'number' || typeof item.quantity === 'string' ? item.quantity : null,
  }
}

function nullableText(value: unknown): string | null {
  const next = toStringOrNull(value)
  return next ?? null
}

function stringifyFieldValue(value: unknown): string {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return ''
}

function dateInputValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed
}

function dateFromInputValue(value: unknown): Date | null {
  const dateValue = dateInputValue(value)
  if (!dateValue) return null
  const date = new Date(`${dateValue}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseWarrantyMonths(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function isWarrantyMonthsEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  return typeof value === 'string' && !value.trim()
}

function normalizeDateOnly(value: unknown): string | null {
  const normalized = dateInputValue(value)
  return normalized || null
}

function assignStringIfSet(payload: Record<string, unknown>, key: string, value: unknown): void {
  const normalized = nullableText(value)
  if (normalized) payload[key] = normalized
}

function readDefaultWarrantyMonths(value: unknown): number | null {
  if (!isRecord(value)) return null
  const settings = isRecord(value.result) ? value.result : value
  const months = parseWarrantyMonths(settings.defaultWarrantyMonths ?? settings.default_warranty_months)
  return months
}

function matchesLineSearch(line: ClaimCreateLineValues, term: string): boolean {
  if (!term) return true
  const haystack = [line.productName, line.sku, line.serialNumber]
    .map((value) => nullableText(value) ?? '')
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

type OrderLinesFetch =
  | { status: 'ok'; lines: SalesOrderLine[]; truncated: boolean }
  | { status: 'forbidden' }
  | { status: 'error' }

// Pages through the whole order so a 250-line order is fully offered. A page that
// comes back short means the order is exhausted; anything else stops at the hard cap
// and reports back that the list is partial.
async function loadAllOrderProductLines(orderId: string): Promise<OrderLinesFetch> {
  const encodedOrderId = encodeURIComponent(orderId)
  const collected: SalesOrderLine[] = []
  for (let page = 1; ; page += 1) {
    const call = await apiCall<{ items?: unknown[] }>(
      `/api/sales/order-lines?orderId=${encodedOrderId}&page=${page}&pageSize=${ORDER_LINE_PAGE_SIZE}`,
    )
    if (call.status === 403) return { status: 'forbidden' }
    if (!call.ok) {
      return page === 1 ? { status: 'error' } : { status: 'ok', lines: collected, truncated: true }
    }
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    for (const item of items) {
      const line = normalizeSalesOrderLine(item)
      if (line) collected.push(line)
    }
    if (items.length < ORDER_LINE_PAGE_SIZE) return { status: 'ok', lines: collected, truncated: false }
    if (page * ORDER_LINE_PAGE_SIZE >= ORDER_LINE_MAX_FETCH) {
      return { status: 'ok', lines: collected, truncated: true }
    }
  }
}

function createDefaultLine(): ClaimCreateLineValues {
  return {
    productId: null,
    variantId: null,
    orderLineId: null,
    productName: '',
    sku: '',
    serialNumber: '',
    purchaseDate: '',
    warrantyMonths: '',
    faultCode: null,
    faultDescription: '',
    qtyClaimed: 1,
  }
}

function normalizeLineValue(value: unknown): ClaimCreateLineValues {
  if (!isRecord(value)) return createDefaultLine()
  return {
    productId: nullableText(value.productId),
    variantId: nullableText(value.variantId),
    orderLineId: nullableText(value.orderLineId),
    productName: stringifyFieldValue(value.productName),
    sku: stringifyFieldValue(value.sku),
    serialNumber: stringifyFieldValue(value.serialNumber),
    purchaseDate: dateInputValue(value.purchaseDate),
    warrantyMonths: typeof value.warrantyMonths === 'number' || typeof value.warrantyMonths === 'string' ? value.warrantyMonths : '',
    faultCode: nullableText(value.faultCode),
    faultDescription: stringifyFieldValue(value.faultDescription),
    qtyClaimed: typeof value.qtyClaimed === 'number' || typeof value.qtyClaimed === 'string' ? value.qtyClaimed : '',
  }
}

function readLineValues(value: unknown): ClaimCreateLineValues[] {
  if (!Array.isArray(value)) return [createDefaultLine()]
  const rows = value.map(normalizeLineValue)
  return rows.length ? rows : [createDefaultLine()]
}

function readSubmittedLineValues(value: unknown): ClaimCreateLineValues[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeLineValue)
}

function lineHasContentBeyondQuantity(line: ClaimCreateLineValues): boolean {
  return Boolean(
    nullableText(line.productId) ||
    nullableText(line.variantId) ||
    nullableText(line.orderLineId) ||
    nullableText(line.productName) ||
    nullableText(line.sku) ||
    nullableText(line.serialNumber) ||
    normalizeDateOnly(line.purchaseDate) ||
    parseWarrantyMonths(line.warrantyMonths) !== null ||
    nullableText(line.faultCode) ||
    nullableText(line.faultDescription),
  )
}

function lineHasContent(line: ClaimCreateLineValues): boolean {
  return Boolean(
    nullableText(line.productId) ||
    nullableText(line.variantId) ||
    nullableText(line.orderLineId) ||
    nullableText(line.productName) ||
    nullableText(line.sku) ||
    nullableText(line.serialNumber) ||
    normalizeDateOnly(line.purchaseDate) ||
    parseWarrantyMonths(line.warrantyMonths) !== null ||
    nullableText(line.faultCode) ||
    nullableText(line.faultDescription) ||
    parsePositiveNumber(line.qtyClaimed) !== null,
  )
}

function normalizeLinePayload(line: ClaimCreateLineValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    qtyClaimed: parsePositiveNumber(line.qtyClaimed) ?? 1,
  }
  assignStringIfSet(payload, 'productId', line.productId)
  assignStringIfSet(payload, 'variantId', line.variantId)
  assignStringIfSet(payload, 'orderLineId', line.orderLineId)
  assignStringIfSet(payload, 'productName', line.productName)
  assignStringIfSet(payload, 'sku', line.sku)
  assignStringIfSet(payload, 'serialNumber', line.serialNumber)
  assignStringIfSet(payload, 'faultCode', line.faultCode)
  assignStringIfSet(payload, 'faultDescription', line.faultDescription)
  const purchaseDate = normalizeDateOnly(line.purchaseDate)
  if (purchaseDate) payload.purchaseDate = purchaseDate
  const warrantyMonths = parseWarrantyMonths(line.warrantyMonths)
  if (warrantyMonths !== null) payload.warrantyMonths = warrantyMonths
  return payload
}

function CustomerSelectionObserver({
  value,
  onChange,
}: {
  value: unknown
  onChange: (customerId: string | null) => void
}) {
  const customerId = nullableText(value)
  React.useEffect(() => {
    onChange(customerId)
  }, [customerId, onChange])
  return null
}

function ClaimTypeSelectionObserver({
  value,
  onChange,
}: {
  value: unknown
  onChange: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const claimType = nullableText(value) ?? 'warranty'
  React.useEffect(() => {
    onChange((current) => (current === claimType ? current : claimType))
  }, [claimType, onChange])
  return null
}

function ReasonCodeSelectionObserver({
  value,
  onChange,
}: {
  value: unknown
  onChange: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const reasonCode = nullableText(value)
  React.useEffect(() => {
    onChange((current) => (current === reasonCode ? current : reasonCode))
  }, [reasonCode, onChange])
  return null
}

function GuidedTroubleshootingSection({
  claimType,
  reasonCode,
  onResolve,
  t,
}: {
  claimType: string | null
  reasonCode: string | null
  onResolve: (result: { resolution?: string; reasonCode?: string }) => void
  t: TranslateFn
}) {
  const [guide, setGuide] = React.useState<TroubleshootingWalkerGuide | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!claimType) {
      setGuide(null)
      setLoading(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      void loadStaffTroubleshootingGuide(claimType, reasonCode)
        .then((nextGuide) => {
          if (!cancelled) setGuide(nextGuide)
        })
        .catch(() => {
          if (!cancelled) setGuide(null)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [claimType, reasonCode])

  if (!guide && !loading) return null

  return (
    <CollapsibleSection
      title={t('warranty_claims.form.troubleshooting.title', 'Guided troubleshooting')}
      defaultCollapsed
      contentClassName="rounded-lg border border-border bg-muted/30 p-4"
    >
      {loading && !guide ? (
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          {t('warranty_claims.form.troubleshooting.loading', 'Loading guide...')}
        </span>
      ) : (
        <TroubleshootingWalker guide={guide} onResolve={onResolve} />
      )}
    </CollapsibleSection>
  )
}

export function LineItemsEditor({
  value,
  setLines,
  orderId,
  defaultWarrantyMonths,
  error,
  faultCodeOptions,
  translations,
  t,
}: {
  value: unknown
  setLines: (lines: ClaimCreateLineValues[]) => void
  orderId: string | null
  defaultWarrantyMonths: number | null
  error?: string
  faultCodeOptions: CrudFieldOption[]
  translations: LineEditorTranslations
  t: TranslateFn
}) {
  const lines = readLineValues(value)
  const noValue = t('warranty_claims.common.noValue')
  const [orderDialogOpen, setOrderDialogOpen] = React.useState(false)
  const [orderLines, setOrderLines] = React.useState<SalesOrderLine[]>([])
  const [selectedOrderLineIds, setSelectedOrderLineIds] = React.useState<Set<string>>(new Set())
  const [orderPurchaseDate, setOrderPurchaseDate] = React.useState<string | null>(null)
  const [orderLinesLoading, setOrderLinesLoading] = React.useState(false)
  const [orderLinesTruncated, setOrderLinesTruncated] = React.useState(false)
  const [orderLineSearch, setOrderLineSearch] = React.useState('')
  const [hideOrderImport, setHideOrderImport] = React.useState(false)
  const [lineSearch, setLineSearch] = React.useState('')
  const [linePage, setLinePage] = React.useState(1)
  const [lineDialog, setLineDialog] = React.useState<LineDialogState | null>(null)
  const [lineDraft, setLineDraft] = React.useState<ClaimCreateLineValues>(createDefaultLine)
  const editorRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (defaultWarrantyMonths === null) return
    let changed = false
    const next = lines.map((line) => {
      if (!normalizeDateOnly(line.purchaseDate) || !isWarrantyMonthsEmpty(line.warrantyMonths)) return line
      changed = true
      return { ...line, warrantyMonths: defaultWarrantyMonths }
    })
    if (changed) setLines(next)
  }, [defaultWarrantyMonths, lines, setLines])

  // Search and paging run over the whole array but only a page's worth of rows ever
  // reaches the table, so an order with hundreds of lines never renders at once.
  const searchTerm = lineSearch.trim().toLowerCase()
  const rows = lines.map((line, index): ClaimLineRow => ({
    ...line,
    id: `claim-line-${index}`,
    index,
    lineNo: index + 1,
  }))
  const filteredRows = searchTerm ? rows.filter((row) => matchesLineSearch(row, searchTerm)) : rows
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / LINE_PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, linePage), totalPages)
  const pageRows = filteredRows.slice((currentPage - 1) * LINE_PAGE_SIZE, currentPage * LINE_PAGE_SIZE)

  const exceedsLineCap = React.useCallback((currentCount: number, addingCount: number): boolean => {
    if (currentCount + addingCount <= MAX_CLAIM_LINES) return false
    flash(
      t('warranty_claims.form.lines.error.maxLines', 'A claim can hold at most {max} lines. Remove some lines or select fewer.', {
        max: String(MAX_CLAIM_LINES),
      }),
      'error',
    )
    return true
  }, [t])

  // Freshly added lines must be visible even when a filter is active, so drop the
  // search term and jump to the page that now holds them.
  const revealLastPage = React.useCallback((total: number) => {
    setLineSearch('')
    setLinePage(Math.max(1, Math.ceil(total / LINE_PAGE_SIZE)))
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [])

  const handleSearchChange = React.useCallback((next: string) => {
    setLineSearch(next)
    setLinePage(1)
  }, [])

  const updateDraft = React.useCallback((patch: Partial<ClaimCreateLineValues>) => {
    setLineDraft((current) => ({ ...current, ...patch }))
  }, [])

  const updateDraftPurchaseDate = React.useCallback((purchaseDate: string) => {
    setLineDraft((current) => {
      const next: ClaimCreateLineValues = { ...current, purchaseDate }
      if (purchaseDate && defaultWarrantyMonths !== null && isWarrantyMonthsEmpty(current.warrantyMonths)) {
        next.warrantyMonths = defaultWarrantyMonths
      }
      return next
    })
  }, [defaultWarrantyMonths])

  const openCreateDialog = React.useCallback(() => {
    if (exceedsLineCap(lines.length, 1)) return
    setLineDraft(createDefaultLine())
    setLineDialog({ mode: 'create' })
  }, [exceedsLineCap, lines.length])

  const openEditDialog = React.useCallback((row: ClaimLineRow) => {
    setLineDraft(lines[row.index] ?? createDefaultLine())
    setLineDialog({ mode: 'edit', index: row.index })
  }, [lines])

  const submitLineDialog = React.useCallback(() => {
    if (!lineDialog) return
    if (lineDialog.mode === 'edit') {
      setLines(lines.map((line, index) => (index === lineDialog.index ? lineDraft : line)))
      setLineDialog(null)
      return
    }
    const nextLines = [...lines, lineDraft]
    setLines(nextLines)
    setLineDialog(null)
    revealLastPage(nextLines.length)
  }, [lineDialog, lineDraft, lines, revealLastPage, setLines])

  const removeLine = React.useCallback((index: number) => {
    if (lines.length <= 1) return
    setLines(lines.filter((_, lineIndex) => lineIndex !== index))
    setLinePage((current) => Math.min(current, Math.max(1, Math.ceil((filteredRows.length - 1) / LINE_PAGE_SIZE))))
  }, [filteredRows.length, lines, setLines])

  const faultCodeLabels = React.useMemo(() => {
    const labels = new Map<string, string>()
    for (const option of faultCodeOptions) labels.set(option.value, option.label)
    return labels
  }, [faultCodeOptions])

  const columns = React.useMemo<ColumnDef<ClaimLineRow>[]>(() => [
    {
      accessorKey: 'lineNo',
      header: t('warranty_claims.form.lineNo'),
      meta: { maxWidth: '80px' },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.lineNo}</span>,
    },
    {
      accessorKey: 'productName',
      header: translations.productName,
      meta: { maxWidth: '240px' },
      cell: ({ row }) => (
        <span className="font-medium">
          {nullableText(row.original.productName) ?? nullableText(row.original.sku) ?? noValue}
        </span>
      ),
    },
    {
      accessorKey: 'serialNumber',
      header: translations.serialNumber,
      meta: { maxWidth: '180px' },
      cell: ({ row }) => nullableText(row.original.serialNumber) ?? noValue,
    },
    {
      accessorKey: 'qtyClaimed',
      header: t('warranty_claims.lines.header.qtyClaimed'),
      meta: { maxWidth: '120px' },
      cell: ({ row }) => formatQuantity(parseQuantity(stringifyFieldValue(row.original.qtyClaimed)), noValue),
    },
    {
      accessorKey: 'faultCode',
      header: translations.faultCode,
      meta: { maxWidth: '200px' },
      cell: ({ row }) => {
        const faultCode = nullableText(row.original.faultCode)
        if (!faultCode) return noValue
        return faultCodeLabels.get(faultCode) ?? faultCode
      },
    },
  ], [faultCodeLabels, noValue, t, translations.faultCode, translations.productName, translations.serialNumber])

  const openOrderImportDialog = React.useCallback(async () => {
    if (!orderId) return
    setOrderDialogOpen(true)
    setOrderLinesLoading(true)
    setOrderLines([])
    setSelectedOrderLineIds(new Set())
    setOrderPurchaseDate(null)
    setOrderLinesTruncated(false)
    setOrderLineSearch('')
    const encodedOrderId = encodeURIComponent(orderId)
    try {
      const [linesFetch, orderCall] = await Promise.all([
        loadAllOrderProductLines(orderId),
        apiCall<{ items?: unknown[] }>(`/api/sales/orders?id=${encodedOrderId}&pageSize=1`),
      ])
      if (linesFetch.status === 'forbidden' || orderCall.status === 403) {
        setHideOrderImport(true)
        setOrderDialogOpen(false)
        return
      }
      if (linesFetch.status === 'error' || !orderCall.ok) {
        flash(t('warranty_claims.form.addFromOrder.error'), 'error')
        setOrderDialogOpen(false)
        return
      }
      const order = Array.isArray(orderCall.result?.items) ? orderCall.result.items[0] : null
      const placedAt = isRecord(order)
        ? toStringOrNull(order.placed_at) ?? toStringOrNull(order.placedAt)
        : null
      setOrderLines(linesFetch.lines)
      setOrderLinesTruncated(linesFetch.truncated)
      setSelectedOrderLineIds(new Set(linesFetch.lines.map((line) => line.id)))
      setOrderPurchaseDate(placedAt ? placedAt.slice(0, 10) : null)
    } finally {
      setOrderLinesLoading(false)
    }
  }, [orderId, t])

  const insertSelectedOrderLines = React.useCallback(() => {
    const selectedRows = orderLines.filter((line) => selectedOrderLineIds.has(line.id))
    if (!selectedRows.length) {
      setOrderDialogOpen(false)
      return
    }
    const retainedLines = lines.filter(lineHasContentBeyondQuantity)
    if (exceedsLineCap(retainedLines.length, selectedRows.length)) return
    const nextRows = selectedRows.map((line): ClaimCreateLineValues => ({
      ...createDefaultLine(),
      productId: line.productId,
      variantId: line.variantId,
      sku: line.sku ?? '',
      productName: line.name ?? '',
      qtyClaimed: parseQuantity(line.quantity) ?? 1,
      orderLineId: line.id,
      purchaseDate: orderPurchaseDate ?? '',
      warrantyMonths: orderPurchaseDate && defaultWarrantyMonths !== null ? defaultWarrantyMonths : '',
    }))
    const nextLines = [...retainedLines, ...nextRows]
    setLines(nextLines)
    setOrderDialogOpen(false)
    flash(t('warranty_claims.form.addFromOrder.added', '{count} line(s) added from order', { count: String(nextRows.length) }), 'success')
    revealLastPage(nextLines.length)
  }, [defaultWarrantyMonths, exceedsLineCap, lines, orderLines, orderPurchaseDate, revealLastPage, selectedOrderLineIds, setLines, t])

  const visibleOrderLines = React.useMemo(() => {
    const term = orderLineSearch.trim().toLowerCase()
    if (!term) return orderLines
    return orderLines.filter((line) => `${line.name ?? ''} ${line.sku ?? ''}`.toLowerCase().includes(term))
  }, [orderLineSearch, orderLines])

  // Select-all applies to what the filter is currently showing, so a filtered
  // selection never silently pulls in rows the user cannot see.
  const toggleAllVisibleOrderLines = React.useCallback((selected: boolean) => {
    setSelectedOrderLineIds((current) => {
      const next = new Set(current)
      for (const line of visibleOrderLines) {
        if (selected) next.add(line.id)
        else next.delete(line.id)
      }
      return next
    })
  }, [visibleOrderLines])

  const toggleOrderLine = React.useCallback((lineId: string, selected: boolean) => {
    setSelectedOrderLineIds((current) => {
      const next = new Set(current)
      if (selected) next.add(lineId)
      else next.delete(lineId)
      return next
    })
  }, [])

  const draftWarrantyStatus = computeEntitlementPreview(
    dateFromInputValue(lineDraft.purchaseDate),
    parseWarrantyMonths(lineDraft.warrantyMonths),
  )
  const draftDialogId = 'warranty-claim-line-draft'

  return (
    <div className="space-y-4" ref={editorRef}>
      <DataTable<ClaimLineRow>
        embedded
        columns={columns}
        data={pageRows}
        stickyActionsColumn
        searchValue={lineSearch}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('warranty_claims.form.lines.search', 'Search product, SKU or serial number')}
        pagination={{
          page: currentPage,
          pageSize: LINE_PAGE_SIZE,
          total: filteredRows.length,
          totalPages,
          onPageChange: setLinePage,
        }}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {orderId && !hideOrderImport ? (
              <Button type="button" variant="outline" onClick={() => { void openOrderImportDialog() }}>
                <Plus className="size-4" aria-hidden="true" />
                {t('warranty_claims.form.addFromOrder')}
              </Button>
            ) : null}
            <Button type="button" onClick={openCreateDialog}>
              <Plus className="size-4" aria-hidden="true" />
              {translations.addLine}
            </Button>
          </div>
        )}
        emptyState={(
          <EmptyState
            title={searchTerm
              ? t('warranty_claims.form.lines.empty.noMatches', 'No claim lines match your search')
              : t('warranty_claims.form.lines.empty.title', 'No claim lines yet')}
            description={searchTerm
              ? undefined
              : t('warranty_claims.form.lines.empty.description', 'Add a claim line or import them from the linked order.')}
            variant="subtle"
          />
        )}
        rowActions={(row) => {
          const items: RowActionItem[] = [
            {
              id: 'edit',
              label: t('warranty_claims.form.lines.edit', 'Edit line'),
              onSelect: () => openEditDialog(row),
            },
          ]
          if (lines.length > 1) {
            items.push({
              id: 'delete',
              label: translations.removeLine,
              destructive: true,
              onSelect: () => removeLine(row.index),
            })
          }
          return <RowActions items={items} />
        }}
      />
      {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
      <Dialog open={lineDialog !== null} onOpenChange={(open) => { if (!open) setLineDialog(null) }}>
        <DialogContent
          className="sm:max-w-3xl"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              submitLineDialog()
            }
            if (event.key === 'Escape') {
              setLineDialog(null)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {lineDialog?.mode === 'edit'
                ? t('warranty_claims.form.lines.edit', 'Edit line')
                : translations.addLine}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <ClaimLineProductPicker
                value={{
                  productId: lineDraft.productId,
                  productName: lineDraft.productName,
                  sku: lineDraft.sku,
                  variantId: lineDraft.variantId,
                }}
                onPick={(pick: ClaimProductPick) => updateDraft({
                  productId: pick.productId,
                  variantId: pick.variantId,
                  sku: pick.sku,
                  productName: pick.productName,
                })}
                onClear={() => updateDraft({ productId: null, variantId: null })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${draftDialogId}-productName`}>{translations.productName}</Label>
              <Input
                id={`${draftDialogId}-productName`}
                value={stringifyFieldValue(lineDraft.productName)}
                onChange={(event) => updateDraft({ productName: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${draftDialogId}-sku`}>{translations.sku}</Label>
              <Input
                id={`${draftDialogId}-sku`}
                value={stringifyFieldValue(lineDraft.sku)}
                onChange={(event) => updateDraft({ sku: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${draftDialogId}-serialNumber`}>{translations.serialNumber}</Label>
              <Input
                id={`${draftDialogId}-serialNumber`}
                value={stringifyFieldValue(lineDraft.serialNumber)}
                onChange={(event) => updateDraft({ serialNumber: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${draftDialogId}-qtyClaimed`}>{translations.qtyClaimed}</Label>
              <Input
                id={`${draftDialogId}-qtyClaimed`}
                type="number"
                min={1}
                step="1"
                value={stringifyFieldValue(lineDraft.qtyClaimed)}
                onChange={(event) => updateDraft({ qtyClaimed: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${draftDialogId}-purchaseDate`}>{t('warranty_claims.form.purchaseDate')}</Label>
              <Input
                id={`${draftDialogId}-purchaseDate`}
                type="date"
                value={dateInputValue(lineDraft.purchaseDate)}
                onChange={(event) => updateDraftPurchaseDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${draftDialogId}-warrantyMonths`}>{t('warranty_claims.form.warrantyMonths')}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`${draftDialogId}-warrantyMonths`}
                  type="number"
                  min={0}
                  step="1"
                  value={stringifyFieldValue(lineDraft.warrantyMonths)}
                  onChange={(event) => updateDraft({ warrantyMonths: event.target.value })}
                  className="min-w-28 flex-1"
                />
                <EntitlementChip status={draftWarrantyStatus} t={t} />
                <EntitlementLookupBadge
                  claim={{ orderId }}
                  lines={[{
                    productId: nullableText(lineDraft.productId),
                    sku: nullableText(lineDraft.sku),
                    serialNumber: nullableText(lineDraft.serialNumber),
                    purchaseDate: normalizeDateOnly(lineDraft.purchaseDate),
                  }]}
                />
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`${draftDialogId}-faultCode`}>{translations.faultCode}</Label>
              <Select
                value={nullableText(lineDraft.faultCode) ?? ''}
                onValueChange={(next) => updateDraft({ faultCode: next })}
              >
                <SelectTrigger id={`${draftDialogId}-faultCode`}>
                  <SelectValue placeholder={translations.faultCodePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {faultCodeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`${draftDialogId}-faultDescription`}>{translations.faultDescription}</Label>
              <Textarea
                id={`${draftDialogId}-faultDescription`}
                rows={4}
                value={stringifyFieldValue(lineDraft.faultDescription)}
                onChange={(event) => updateDraft({ faultDescription: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLineDialog(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={submitLineDialog}>
              {t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={orderDialogOpen} onOpenChange={setOrderDialogOpen}>
        <DialogContent
          className="sm:max-w-2xl"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              if (selectedOrderLineIds.size) insertSelectedOrderLines()
            }
            if (event.key === 'Escape') {
              setOrderDialogOpen(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('warranty_claims.form.addFromOrder')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {orderLinesLoading ? (
              <p className="text-sm text-muted-foreground">{t('warranty_claims.form.addFromOrder.loading')}</p>
            ) : null}
            {!orderLinesLoading && orderLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('warranty_claims.form.addFromOrder.empty')}</p>
            ) : null}
            {!orderLinesLoading && orderLines.length ? (
              <div className="space-y-2">
                <Input
                  type="search"
                  value={orderLineSearch}
                  onChange={(event) => setOrderLineSearch(event.target.value)}
                  placeholder={t('warranty_claims.form.addFromOrder.search', 'Filter by product or SKU')}
                  aria-label={t('warranty_claims.form.addFromOrder.search', 'Filter by product or SKU')}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {t('warranty_claims.form.addFromOrder.count', '{shown} of {total} lines', {
                      shown: String(visibleOrderLines.length),
                      total: String(orderLines.length),
                    })}
                    {orderLinesTruncated
                      ? ` — ${t('warranty_claims.form.addFromOrder.truncated', 'first {limit} only', { limit: String(ORDER_LINE_MAX_FETCH) })}`
                      : ''}
                    {/* Selection survives filter changes, so it must be visible: otherwise
                        rows picked under an earlier filter silently push the claim over
                        the line cap and the insert appears to do nothing. */}
                    {selectedOrderLineIds.size
                      ? ` — ${t('warranty_claims.form.addFromOrder.selected', '{count} selected', { count: String(selectedOrderLineIds.size) })}`
                      : ''}
                  </span>
                  <span className="flex gap-3">
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => toggleAllVisibleOrderLines(true)}
                    >
                      {t('warranty_claims.form.addFromOrder.selectAll', 'Select all')}
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => toggleAllVisibleOrderLines(false)}
                    >
                      {t('warranty_claims.form.addFromOrder.clear', 'Clear')}
                    </Button>
                  </span>
                </div>
              </div>
            ) : null}
            <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {visibleOrderLines.map((line) => {
              const checked = selectedOrderLineIds.has(line.id)
              const label = line.name ?? line.sku ?? t('warranty_claims.form.lines.unnamed', 'Unnamed line')
              return (
                <div key={line.id} className="flex items-start gap-3 rounded-md border border-border p-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => toggleOrderLine(line.id, next === true)}
                    aria-label={t('warranty_claims.form.addFromOrder.selectLine', undefined, { name: label })}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{line.sku ?? t('warranty_claims.common.noValue')}</span>
                      <span>{t('warranty_claims.form.addFromOrder.quantity', undefined, { quantity: formatQuantity(line.quantity, t('warranty_claims.common.noValue')) })}</span>
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOrderDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={insertSelectedOrderLines} disabled={!selectedOrderLineIds.size}>
              {t('warranty_claims.form.addFromOrder.confirm', 'Add selected lines')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function CreateWarrantyClaimPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedCustomerId, setSelectedCustomerId] = React.useState<string | null>(null)
  const [selectedClaimType, setSelectedClaimType] = React.useState<string | null>(searchParams.get('claimType') ?? 'warranty')
  const [selectedReasonCode, setSelectedReasonCode] = React.useState<string | null>(null)
  const [orderAccessDenied, setOrderAccessDenied] = React.useState(false)
  const [faultCodeOptions, setFaultCodeOptions] = React.useState<CrudFieldOption[]>([])
  const [defaultWarrantyMonths, setDefaultWarrantyMonths] = React.useState<number | null>(null)

  const loadDictionaryOptions = React.useCallback(async (dictionaryKey: string, kind: DictionaryLabelKind): Promise<CrudFieldOption[]> => {
    const dictionaries = await readApiResultOrThrow<{ items?: DictionaryListItem[] }>(
      '/api/dictionaries',
      undefined,
      {
        fallback: { items: [] },
        errorMessage: t('warranty_claims.form.error.dictionaryLoad'),
      },
    )
    const dictionary = (dictionaries.items ?? []).find((item) => item.key === dictionaryKey)
    if (!dictionary?.id) return []
    const entries = await readApiResultOrThrow<DictionaryEntriesResponse>(
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
        value: option.value,
        label: localizeDictionaryLabel(t, kind, option.value, option.label),
      }))
  }, [t])

  const loadCustomerOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '20' })
    const trimmed = query?.trim()
    if (trimmed) params.set('search', trimmed)
    const [people, companies] = await Promise.all([
      apiCall<{ items?: unknown[] }>(`/api/customers/people?${params.toString()}`, undefined, { fallback: { items: [] } }),
      apiCall<{ items?: unknown[] }>(`/api/customers/companies?${params.toString()}`, undefined, { fallback: { items: [] } }),
    ])
    const items = [
      ...(Array.isArray(people.result?.items) ? people.result.items : []),
      ...(Array.isArray(companies.result?.items) ? companies.result.items : []),
    ]
    return items.map((item) => normalizeOption(item, t)).filter((option): option is CrudFieldOption => option !== null)
  }, [t])

  const loadOrderOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    return loadOrderOptionsShared(query, {
      customerId: selectedCustomerId,
      onAccessChange: setOrderAccessDenied,
      fallbackLabel: t('warranty_claims.form.orderUnavailable', 'Order unavailable'),
    })
  }, [selectedCustomerId, t])

  React.useEffect(() => {
    let cancelled = false
    void loadDictionaryOptions(DICTIONARY_KEYS.faultCodes, 'fault')
      .then((options) => {
        if (!cancelled) setFaultCodeOptions(options)
      })
      .catch(() => {
        if (!cancelled) setFaultCodeOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [loadDictionaryOptions])

  React.useEffect(() => {
    let cancelled = false
    void apiCall<GeneralSettingsResponse>('/api/warranty_claims/settings-general')
      .then((response) => {
        if (cancelled || !response.ok) return
        setDefaultWarrantyMonths(readDefaultWarrantyMonths(response.result))
      })
      .catch(() => {
        if (!cancelled) setDefaultWarrantyMonths(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const lineTranslations = React.useMemo<LineEditorTranslations>(() => ({
    addLine: t('warranty_claims.form.lines.add', 'Add line'),
    removeLine: t('warranty_claims.form.lines.remove', 'Remove line'),
    productName: t('warranty_claims.form.productName'),
    sku: t('warranty_claims.form.sku'),
    serialNumber: t('warranty_claims.form.serialNumber'),
    faultCode: t('warranty_claims.form.faultCode'),
    faultDescription: t('warranty_claims.form.faultDescription'),
    qtyClaimed: t('warranty_claims.form.qtyClaimed'),
    faultCodePlaceholder: t('warranty_claims.form.faultCode.placeholder', 'Select fault code'),
  }), [t])

  // Short selects share a row (three thirds), the two record lookups share the
  // next (two halves); only the free-text fields span the full width. Ordered so
  // each row fills the 6-column grid instead of stacking one control per screen row.
  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'claimType',
      label: t('warranty_claims.form.claimType'),
      type: 'select',
      required: true,
      layout: 'third',
      options: CLAIM_TYPES.map((claimType) => ({
        value: claimType,
        label: t(`warranty_claims.claimType.${claimType}`),
      })),
    },
    {
      id: 'priority',
      label: t('warranty_claims.form.priority'),
      type: 'select',
      required: true,
      layout: 'third',
      options: CLAIM_PRIORITIES.map((priority) => ({
        value: priority,
        label: t(`warranty_claims.priority.${priority}`),
      })),
    },
    {
      id: 'reasonCode',
      label: t('warranty_claims.form.reasonCode'),
      type: 'select',
      layout: 'third',
      loadOptions: () => loadDictionaryOptions(DICTIONARY_KEYS.claimReasons, 'reason'),
    },
    {
      id: 'customerId',
      label: t('warranty_claims.form.customerId'),
      type: 'combobox',
      layout: 'half',
      loadOptions: loadCustomerOptions,
      allowCustomValues: false,
      placeholder: t('warranty_claims.form.customerId.placeholder'),
      seedOptions: [],
    },
    {
      id: 'orderId',
      label: t('warranty_claims.form.orderId'),
      type: 'combobox',
      layout: 'half',
      loadOptions: loadOrderOptions,
      allowCustomValues: false,
      placeholder: t('warranty_claims.form.orderId.placeholder'),
      description: orderAccessDenied ? t('warranty_claims.form.orderId.noAccess') : undefined,
      seedOptions: [],
      resolveLabel: (value: string) => resolveOrderLabel(value, t('warranty_claims.form.orderUnavailable', 'Order unavailable')),
    },
    {
      id: 'notes',
      label: t('warranty_claims.form.notes'),
      type: 'textarea',
      rows: 4,
      layout: 'full',
    },
    {
      id: 'resolutionSummary',
      label: t('warranty_claims.form.resolutionSummary', 'Resolution summary'),
      type: 'textarea',
      rows: 3,
      layout: 'full',
    },
  ], [loadCustomerOptions, loadDictionaryOptions, loadOrderOptions, orderAccessDenied, resolveOrderLabel, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'header',
      title: t('warranty_claims.form.header'),
      // Render order lives here, not in the field definitions. Keep the three
      // thirds adjacent and the two halves adjacent so each grid row fills.
      fields: ['claimType', 'priority', 'reasonCode', 'customerId', 'orderId', 'notes', 'resolutionSummary'],
      component: ({ values }) => (
        <>
          <CustomerSelectionObserver value={values.customerId} onChange={setSelectedCustomerId} />
          <ClaimTypeSelectionObserver value={values.claimType} onChange={setSelectedClaimType} />
          <ReasonCodeSelectionObserver value={values.reasonCode} onChange={setSelectedReasonCode} />
        </>
      ),
    },
    {
      id: 'troubleshooting',
      title: t('warranty_claims.form.troubleshooting.title', 'Guided troubleshooting'),
      bare: true,
      component: ({ setValue }) => (
        <GuidedTroubleshootingSection
          claimType={selectedClaimType}
          reasonCode={selectedReasonCode}
          t={t}
          onResolve={(result) => {
            if (result.reasonCode) setValue('reasonCode', result.reasonCode)
            if (result.resolution) setValue('resolutionSummary', result.resolution)
          }}
        />
      ),
    },
    {
      id: 'line',
      title: t(resolveClaimTypeUiConfig(selectedClaimType).lineHeaderKey),
      component: ({ values, setValue, errors }) => (
        <LineItemsEditor
          value={values.lines}
          setLines={(lines) => setValue('lines', lines)}
          orderId={nullableText(values.orderId)}
          defaultWarrantyMonths={defaultWarrantyMonths}
          error={errors.lines}
          faultCodeOptions={faultCodeOptions}
          translations={lineTranslations}
          t={t}
        />
      ),
    },
  ], [defaultWarrantyMonths, faultCodeOptions, lineTranslations, selectedClaimType, selectedReasonCode, t])

  const initialValues = React.useMemo<Partial<ClaimCreateFormValues>>(() => ({
    claimType: searchParams.get('claimType') ?? 'warranty',
    orderId: searchParams.get('orderId') ?? '',
    priority: 'normal',
    lines: [createDefaultLine()],
  }), [searchParams])

  return (
    <Page>
      <PageBody>
        <CrudForm<ClaimCreateFormValues>
          title={t('warranty_claims.create.title')}
          backHref="/backend/warranty_claims"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('warranty_claims.form.submit')}
          cancelHref="/backend/warranty_claims"
          onSubmit={async (values) => {
            const lines = readSubmittedLineValues(values.lines).filter(lineHasContent)
            if (!lines.length) {
              const message = t('warranty_claims.form.lines.error.required', 'Add at least one claim line.')
              throw createCrudFormError(message, { lines: message })
            }
            const payload: Record<string, unknown> = {
              claimType: values.claimType,
              channel: 'staff',
              priority: values.priority || 'normal',
              customerId: nullableText(values.customerId),
              orderId: nullableText(values.orderId),
              reasonCode: nullableText(values.reasonCode),
              resolutionSummary: nullableText(values.resolutionSummary),
              notes: nullableText(values.notes),
              lines: lines.map(normalizeLinePayload),
            }
            const { result } = await createCrud<{ id?: string | null }>('warranty_claims', payload, {
              errorMessage: t('warranty_claims.create.error'),
            })
            const id = result?.id ?? null
            flash(t('warranty_claims.create.success'), 'success')
            router.push(id ? `/backend/warranty_claims/${id}` : '/backend/warranty_claims')
          }}
        />
      </PageBody>
    </Page>
  )
}
