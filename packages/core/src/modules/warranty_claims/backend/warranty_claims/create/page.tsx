"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
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

type LineEditorTranslations = {
  addLine: string
  removeLine: string
  lineLabel: (number: number) => string
  productName: string
  sku: string
  serialNumber: string
  faultCode: string
  faultDescription: string
  qtyClaimed: string
  faultCodePlaceholder: string
}

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

function normalizeOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const label =
    toStringOrNull(item.label) ??
    toStringOrNull(item.displayName) ??
    toStringOrNull(item.display_name) ??
    toStringOrNull(item.name) ??
    id
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

function LineItemsEditor({
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
  const [orderDialogOpen, setOrderDialogOpen] = React.useState(false)
  const [orderLines, setOrderLines] = React.useState<SalesOrderLine[]>([])
  const [selectedOrderLineIds, setSelectedOrderLineIds] = React.useState<Set<string>>(new Set())
  const [orderPurchaseDate, setOrderPurchaseDate] = React.useState<string | null>(null)
  const [orderLinesLoading, setOrderLinesLoading] = React.useState(false)
  const [hideOrderImport, setHideOrderImport] = React.useState(false)
  const lastLineRef = React.useRef<HTMLDivElement | null>(null)

  const updateLine = React.useCallback((index: number, patch: Partial<ClaimCreateLineValues>) => {
    const next = lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line))
    setLines(next)
  }, [lines, setLines])

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

  const addLine = React.useCallback(() => {
    setLines([...lines, createDefaultLine()])
  }, [lines, setLines])

  const removeLine = React.useCallback((index: number) => {
    if (lines.length <= 1) return
    setLines(lines.filter((_, lineIndex) => lineIndex !== index))
  }, [lines, setLines])

  const updateLinePurchaseDate = React.useCallback((index: number, purchaseDate: string) => {
    const current = lines[index]
    const patch: Partial<ClaimCreateLineValues> = { purchaseDate }
    if (current && purchaseDate && defaultWarrantyMonths !== null && isWarrantyMonthsEmpty(current.warrantyMonths)) {
      patch.warrantyMonths = defaultWarrantyMonths
    }
    updateLine(index, patch)
  }, [defaultWarrantyMonths, lines, updateLine])

  const openOrderImportDialog = React.useCallback(async () => {
    if (!orderId) return
    setOrderDialogOpen(true)
    setOrderLinesLoading(true)
    setOrderLines([])
    setSelectedOrderLineIds(new Set())
    setOrderPurchaseDate(null)
    const encodedOrderId = encodeURIComponent(orderId)
    try {
      const [linesCall, orderCall] = await Promise.all([
        apiCall<{ items?: unknown[] }>(`/api/sales/order-lines?orderId=${encodedOrderId}&pageSize=100`),
        apiCall<{ items?: unknown[] }>(`/api/sales/orders?id=${encodedOrderId}&pageSize=1`),
      ])
      if (linesCall.status === 403 || orderCall.status === 403) {
        setHideOrderImport(true)
        setOrderDialogOpen(false)
        return
      }
      if (!linesCall.ok || !orderCall.ok) {
        flash(t('warranty_claims.form.addFromOrder.error'), 'error')
        setOrderDialogOpen(false)
        return
      }
      const nextLines = Array.isArray(linesCall.result?.items)
        ? linesCall.result.items.map(normalizeSalesOrderLine).filter((line): line is SalesOrderLine => line !== null)
        : []
      const order = Array.isArray(orderCall.result?.items) ? orderCall.result.items[0] : null
      const placedAt = isRecord(order)
        ? toStringOrNull(order.placed_at) ?? toStringOrNull(order.placedAt)
        : null
      setOrderLines(nextLines)
      setSelectedOrderLineIds(new Set(nextLines.map((line) => line.id)))
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
    const nextRows = selectedRows.map((line): ClaimCreateLineValues => ({
      ...createDefaultLine(),
      productId: line.productId,
      variantId: line.variantId,
      sku: line.sku ?? '',
      productName: line.name ?? '',
      qtyClaimed: line.quantity ?? 1,
      orderLineId: line.id,
      purchaseDate: orderPurchaseDate ?? '',
      warrantyMonths: orderPurchaseDate && defaultWarrantyMonths !== null ? defaultWarrantyMonths : '',
    }))
    setLines([...lines.filter(lineHasContentBeyondQuantity), ...nextRows])
    setOrderDialogOpen(false)
    flash(t('warranty_claims.form.addFromOrder.added', '{count} line(s) added from order', { count: String(nextRows.length) }), 'success')
    requestAnimationFrame(() => {
      lastLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [defaultWarrantyMonths, lines, orderLines, orderPurchaseDate, selectedOrderLineIds, setLines, t])

  const toggleOrderLine = React.useCallback((lineId: string, selected: boolean) => {
    setSelectedOrderLineIds((current) => {
      const next = new Set(current)
      if (selected) next.add(lineId)
      else next.delete(lineId)
      return next
    })
  }, [])

  return (
    <div className="space-y-4">
      {orderId && !hideOrderImport ? (
        <Button type="button" variant="outline" onClick={() => { void openOrderImportDialog() }}>
          <Plus className="size-4" aria-hidden="true" />
          {t('warranty_claims.form.addFromOrder')}
        </Button>
      ) : null}
      {lines.map((line, index) => {
        const rowNumber = index + 1
        const rowId = `warranty-claim-line-${rowNumber}`
        const warrantyStatus = computeEntitlementPreview(
          dateFromInputValue(line.purchaseDate),
          parseWarrantyMonths(line.warrantyMonths),
        )
        return (
          <div
            key={rowId}
            ref={index === lines.length - 1 ? lastLineRef : undefined}
            className="space-y-4 border-t border-border pt-4 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">{translations.lineLabel(rowNumber)}</h3>
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={translations.removeLine}
                disabled={lines.length <= 1}
                onClick={() => removeLine(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <ClaimLineProductPicker
                  value={{
                    productId: line.productId,
                    productName: line.productName,
                    sku: line.sku,
                    variantId: line.variantId,
                  }}
                  onPick={(pick: ClaimProductPick) => updateLine(index, {
                    productId: pick.productId,
                    variantId: pick.variantId,
                    sku: pick.sku,
                    productName: pick.productName,
                  })}
                  onClear={() => updateLine(index, { productId: null, variantId: null })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${rowId}-productName`}>{translations.productName}</Label>
                <Input
                  id={`${rowId}-productName`}
                  value={stringifyFieldValue(line.productName)}
                  onChange={(event) => updateLine(index, { productName: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${rowId}-sku`}>{translations.sku}</Label>
                <Input
                  id={`${rowId}-sku`}
                  value={stringifyFieldValue(line.sku)}
                  onChange={(event) => updateLine(index, { sku: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${rowId}-serialNumber`}>{translations.serialNumber}</Label>
                <Input
                  id={`${rowId}-serialNumber`}
                  value={stringifyFieldValue(line.serialNumber)}
                  onChange={(event) => updateLine(index, { serialNumber: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${rowId}-qtyClaimed`}>{translations.qtyClaimed}</Label>
                <Input
                  id={`${rowId}-qtyClaimed`}
                  type="number"
                  min={1}
                  step="1"
                  value={stringifyFieldValue(line.qtyClaimed)}
                  onChange={(event) => updateLine(index, { qtyClaimed: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${rowId}-purchaseDate`}>{t('warranty_claims.form.purchaseDate')}</Label>
                <Input
                  id={`${rowId}-purchaseDate`}
                  type="date"
                  value={dateInputValue(line.purchaseDate)}
                  onChange={(event) => updateLinePurchaseDate(index, event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${rowId}-warrantyMonths`}>{t('warranty_claims.form.warrantyMonths')}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={`${rowId}-warrantyMonths`}
                    type="number"
                    min={0}
                    step="1"
                    value={stringifyFieldValue(line.warrantyMonths)}
                    onChange={(event) => updateLine(index, { warrantyMonths: event.target.value })}
                    className="min-w-28 flex-1"
                  />
                  <EntitlementChip status={warrantyStatus} t={t} />
                  <EntitlementLookupBadge
                    claim={{ orderId }}
                    lines={[{
                      productId: nullableText(line.productId),
                      sku: nullableText(line.sku),
                      serialNumber: nullableText(line.serialNumber),
                      purchaseDate: normalizeDateOnly(line.purchaseDate),
                    }]}
                  />
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor={`${rowId}-faultCode`}>{translations.faultCode}</Label>
                <Select
                  value={nullableText(line.faultCode) ?? ''}
                  onValueChange={(next) => updateLine(index, { faultCode: next })}
                >
                  <SelectTrigger id={`${rowId}-faultCode`}>
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
                <Label htmlFor={`${rowId}-faultDescription`}>{translations.faultDescription}</Label>
                <Textarea
                  id={`${rowId}-faultDescription`}
                  rows={4}
                  value={stringifyFieldValue(line.faultDescription)}
                  onChange={(event) => updateLine(index, { faultDescription: event.target.value })}
                />
              </div>
            </div>
          </div>
        )
      })}
      {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
      <Button type="button" variant="outline" onClick={addLine}>
        <Plus className="size-4" aria-hidden="true" />
        {translations.addLine}
      </Button>
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
            {orderLines.map((line) => {
              const checked = selectedOrderLineIds.has(line.id)
              const label = line.name ?? line.sku ?? line.id
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
                      <span>{t('warranty_claims.form.addFromOrder.quantity', undefined, { quantity: String(line.quantity ?? '') })}</span>
                    </div>
                  </div>
                </div>
              )
            })}
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
    return items.map(normalizeOption).filter((option): option is CrudFieldOption => option !== null)
  }, [])

  const loadOrderOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    return loadOrderOptionsShared(query, {
      customerId: selectedCustomerId,
      onAccessChange: setOrderAccessDenied,
    })
  }, [selectedCustomerId])

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
    lineLabel: (number: number) => t('warranty_claims.form.lines.lineLabel', 'Line {number}', { number }),
    productName: t('warranty_claims.form.productName'),
    sku: t('warranty_claims.form.sku'),
    serialNumber: t('warranty_claims.form.serialNumber'),
    faultCode: t('warranty_claims.form.faultCode'),
    faultDescription: t('warranty_claims.form.faultDescription'),
    qtyClaimed: t('warranty_claims.form.qtyClaimed'),
    faultCodePlaceholder: t('warranty_claims.form.faultCode.placeholder', 'Select fault code'),
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'claimType',
      label: t('warranty_claims.form.claimType'),
      type: 'select',
      required: true,
      options: CLAIM_TYPES.map((claimType) => ({
        value: claimType,
        label: t(`warranty_claims.claimType.${claimType}`),
      })),
    },
    {
      id: 'customerId',
      label: t('warranty_claims.form.customerId'),
      type: 'combobox',
      loadOptions: loadCustomerOptions,
      allowCustomValues: false,
      placeholder: t('warranty_claims.form.customerId.placeholder'),
      seedOptions: [],
    },
    {
      id: 'orderId',
      label: t('warranty_claims.form.orderId'),
      type: 'combobox',
      loadOptions: loadOrderOptions,
      allowCustomValues: false,
      placeholder: t('warranty_claims.form.orderId.placeholder'),
      description: orderAccessDenied ? t('warranty_claims.form.orderId.noAccess') : undefined,
      seedOptions: [],
      resolveLabel: resolveOrderLabel,
    },
    {
      id: 'priority',
      label: t('warranty_claims.form.priority'),
      type: 'select',
      required: true,
      options: CLAIM_PRIORITIES.map((priority) => ({
        value: priority,
        label: t(`warranty_claims.priority.${priority}`),
      })),
    },
    {
      id: 'reasonCode',
      label: t('warranty_claims.form.reasonCode'),
      type: 'select',
      loadOptions: () => loadDictionaryOptions(DICTIONARY_KEYS.claimReasons, 'reason'),
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
      fields: ['claimType', 'customerId', 'orderId', 'priority', 'reasonCode', 'notes', 'resolutionSummary'],
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
