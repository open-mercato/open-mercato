"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Plus, Send, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader } from '@open-mercato/ui/portal/components/PortalCard'
import { localizeDictionaryLabel } from '@open-mercato/core/modules/warranty_claims/lib/dictionaryLabels'
import {
  TroubleshootingWalker,
  type TroubleshootingWalkerGuide,
} from '../../../../../backend/components/TroubleshootingWalker'

type Props = { params: { orgSlug: string } }

type WizardStepId = 'order' | 'items' | 'details' | 'review'

type LineDraft = {
  localId: string
  orderLineId?: string
  productId?: string
  productName?: string
  sku: string
  serialNumber: string
  faultCode: string
  faultDescription: string
  qtyClaimed: string
}

type PortalClaimLineInput = {
  orderLineId?: string
  productId?: string
  productName?: string
  sku?: string
  serialNumber?: string
  faultCode?: string
  faultDescription: string
  qtyClaimed: number
}

type PortalIntakePayload = {
  orderId?: string
  reasonCode: string
  notes?: string
  lines: PortalClaimLineInput[]
}

type PortalCreateResponse = {
  ok: boolean
  claimId?: string
  error?: string
}

type PortalOption = {
  value: string
  label: string
}

type PortalOptions = {
  reasons: PortalOption[]
  faultCodes: PortalOption[]
}

type PortalOptionsResponse = {
  ok: boolean
  result?: PortalOptions
  error?: string
}

type WarrantyStatus = 'in_warranty' | 'out_of_warranty' | 'unknown'

type PortalOrder = {
  id: string
  orderNumber: string
  placedAt: string | null
  currencyCode: string | null
  grandTotalGrossAmount: string | number | null
}

type PortalOrdersResponse = {
  ok: boolean
  items: PortalOrder[]
  total: number
  page: number
  pageSize: number
  error?: string
}

type PortalOrderLine = {
  orderLineId: string
  productId: string | null
  variantId: string | null
  sku: string | null
  name: string | null
  quantity: string | number | null
  estimatedWarrantyStatus: WarrantyStatus
}

type PortalOrderLinesResponse = {
  ok: boolean
  order: {
    id: string
    placedAt: string | null
  }
  items: PortalOrderLine[]
  error?: string
}

type PortalTroubleshootingResponse = {
  guide: (TroubleshootingWalkerGuide & { id: string }) | null
}

const WIZARD_STEP_IDS: WizardStepId[] = ['order', 'items', 'details', 'review']
const EMPTY_SELECT_VALUE = '__empty__'

let lineId = 0

function createLineDraft(): LineDraft {
  lineId += 1
  return {
    localId: `claim-line-${lineId}`,
    sku: '',
    serialNumber: '',
    faultCode: '',
    faultDescription: '',
    qtyClaimed: '1',
  }
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function isPositiveQuantity(value: string): boolean {
  const qtyClaimed = Number(value)
  return Number.isFinite(qtyClaimed) && qtyClaimed > 0
}

function parsePositiveNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

function defaultQuantity(value: string | number | null | undefined): string {
  return String(parsePositiveNumber(value) ?? 1)
}

function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatQuantity(value: string | number | null | undefined, fallback: string): string {
  const parsed = parsePositiveNumber(value)
  return parsed === null ? fallback : parsed.toLocaleString()
}

function formatOrderTotal(value: string | number | null, currencyCode: string | null, fallback: string): string {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return fallback
  if (currencyCode && /^[A-Z]{3}$/.test(currencyCode)) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(parsed)
  }
  return currencyCode ? `${parsed.toLocaleString()} ${currencyCode}` : parsed.toLocaleString()
}

function optionLabel(options: PortalOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}

function isBlankLineDraft(line: LineDraft): boolean {
  return !line.orderLineId
    && !line.productId
    && !optionalText(line.productName ?? '')
    && !optionalText(line.sku)
    && !optionalText(line.serialNumber)
    && !optionalText(line.faultCode)
    && !optionalText(line.faultDescription)
    && (!optionalText(line.qtyClaimed) || line.qtyClaimed === '1')
}

function warrantyStatusVariant(status: WarrantyStatus): StatusBadgeVariant {
  if (status === 'in_warranty') return 'success'
  if (status === 'out_of_warranty') return 'error'
  return 'neutral'
}

function warrantyStatusLabelKey(status: WarrantyStatus): string {
  if (status === 'in_warranty') return 'warranty_claims.portal.entitlement.inWarranty'
  if (status === 'out_of_warranty') return 'warranty_claims.portal.entitlement.outOfWarranty'
  return 'warranty_claims.portal.value.notAvailable'
}

export default function WarrantyClaimPortalNewPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const guardedMutation = useGuardedMutation<Record<string, unknown>>({
    contextId: 'warranty_claims.portal.claim.create',
    blockedMessage: t('warranty_claims.portal.new.blocked'),
  })
  const [currentStep, setCurrentStep] = React.useState<WizardStepId>('order')
  const [noOrder, setNoOrder] = React.useState(false)
  const [manualOrderEntry, setManualOrderEntry] = React.useState(false)
  const [orderReference, setOrderReference] = React.useState('')
  const [orderSearchInput, setOrderSearchInput] = React.useState('')
  const [debouncedOrderSearch, setDebouncedOrderSearch] = React.useState('')
  const [orders, setOrders] = React.useState<PortalOrder[]>([])
  const [ordersLoading, setOrdersLoading] = React.useState(false)
  const [ordersUnavailable, setOrdersUnavailable] = React.useState(false)
  const [selectedOrderId, setSelectedOrderId] = React.useState('')
  const [selectedOrderNumber, setSelectedOrderNumber] = React.useState('')
  const [selectedOrderPlacedAt, setSelectedOrderPlacedAt] = React.useState<string | null>(null)
  const [orderLines, setOrderLines] = React.useState<PortalOrderLine[]>([])
  const [orderLinesLoading, setOrderLinesLoading] = React.useState(false)
  const [orderLinesUnavailable, setOrderLinesUnavailable] = React.useState(false)
  const [selectedOrderLineIds, setSelectedOrderLineIds] = React.useState<Set<string>>(() => new Set())
  const [selectedOrderLineQty, setSelectedOrderLineQty] = React.useState<Record<string, string>>({})
  const [reasonCode, setReasonCode] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [lines, setLines] = React.useState<LineDraft[]>(() => [createLineDraft()])
  const [portalOptions, setPortalOptions] = React.useState<PortalOptions>({ reasons: [], faultCodes: [] })
  const [troubleshootingGuide, setTroubleshootingGuide] = React.useState<TroubleshootingWalkerGuide | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!loading && !user) {
      router.replace(`/${params.orgSlug}/portal/login`)
    }
  }, [loading, user, router, params.orgSlug])

  React.useEffect(() => {
    if (!user) return
    let cancelled = false
    apiCall<PortalOptionsResponse>('/api/warranty_claims/portal/options')
      .then((result) => {
        if (cancelled) return
        const options = result.result?.ok ? result.result.result : null
        setPortalOptions({
          reasons: options?.reasons ?? [],
          faultCodes: options?.faultCodes ?? [],
        })
      })
      .catch(() => {
        if (!cancelled) setPortalOptions({ reasons: [], faultCodes: [] })
      })
    return () => {
      cancelled = true
    }
  }, [user])

  React.useEffect(() => {
    if (!user) {
      setTroubleshootingGuide(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ claimType: 'warranty' })
      const trimmedReason = reasonCode.trim()
      if (trimmedReason) params.set('reasonCode', trimmedReason)
      void apiCall<PortalTroubleshootingResponse>(
        `/api/warranty_claims/portal/troubleshooting?${params.toString()}`,
        undefined,
        { fallback: { guide: null } },
      )
        .then((result) => {
          if (cancelled) return
          setTroubleshootingGuide(result.ok ? result.result?.guide ?? null : null)
        })
        .catch(() => {
          if (!cancelled) setTroubleshootingGuide(null)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [reasonCode, user])

  React.useEffect(() => {
    if (currentStep !== 'order') return
    const timer = window.setTimeout(() => {
      setDebouncedOrderSearch(orderSearchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [currentStep, orderSearchInput])

  React.useEffect(() => {
    if (!user || currentStep !== 'order' || ordersUnavailable) return
    let cancelled = false
    setOrdersLoading(true)
    const search = encodeURIComponent(debouncedOrderSearch)
    apiCall<PortalOrdersResponse>(`/api/warranty_claims/portal/orders?search=${search}&page=1`)
      .then((result) => {
        if (cancelled) return
        const payload = result.ok ? result.result : null
        if (!payload?.ok) {
          setOrders([])
          setOrdersUnavailable(true)
          setManualOrderEntry(true)
          return
        }
        setOrders(payload.items)
      })
      .catch(() => {
        if (!cancelled) {
          setOrders([])
          setOrdersUnavailable(true)
          setManualOrderEntry(true)
        }
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentStep, debouncedOrderSearch, ordersUnavailable, user])

  React.useEffect(() => {
    if (!user || currentStep !== 'items' || !selectedOrderId) {
      if (!selectedOrderId) {
        setOrderLines([])
        setSelectedOrderLineIds(new Set())
        setSelectedOrderLineQty({})
      }
      return
    }
    let cancelled = false
    setOrderLinesLoading(true)
    setOrderLinesUnavailable(false)
    apiCall<PortalOrderLinesResponse>(
      `/api/warranty_claims/portal/orders/lines?orderId=${encodeURIComponent(selectedOrderId)}`,
    )
      .then((result) => {
        if (cancelled) return
        const payload = result.ok ? result.result : null
        if (!payload?.ok || payload.items.length === 0) {
          setOrderLines([])
          setSelectedOrderLineIds(new Set())
          setSelectedOrderLineQty({})
          setOrderLinesUnavailable(true)
          return
        }
        setOrderLines(payload.items)
        setSelectedOrderLineIds(new Set())
        setSelectedOrderLineQty(Object.fromEntries(
          payload.items.map((line) => [line.orderLineId, defaultQuantity(line.quantity)]),
        ))
      })
      .catch(() => {
        if (!cancelled) {
          setOrderLines([])
          setSelectedOrderLineIds(new Set())
          setSelectedOrderLineQty({})
          setOrderLinesUnavailable(true)
        }
      })
      .finally(() => {
        if (!cancelled) setOrderLinesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentStep, selectedOrderId, user])

  const currentStepIndex = WIZARD_STEP_IDS.indexOf(currentStep)

  const hasValidLines = React.useMemo(() => {
    return lines.length > 0 && lines.every((line) => line.faultDescription.trim().length > 0 && isPositiveQuantity(line.qtyClaimed))
  }, [lines])

  const hasReason = reasonCode.trim().length > 0

  const wizardSteps = React.useMemo<StepIndicatorStep[]>(() => {
    const labels: Record<WizardStepId, string> = {
      order: t('warranty_claims.portal.wizard.order'),
      items: t('warranty_claims.portal.wizard.items'),
      details: t('warranty_claims.portal.wizard.details'),
      review: t('warranty_claims.portal.wizard.reviewSubmit'),
    }
    return WIZARD_STEP_IDS.map((stepId, index) => ({
      id: stepId,
      label: labels[stepId],
      status: index < currentStepIndex ? 'complete' : index === currentStepIndex ? 'current' : 'pending',
    }))
  }, [currentStepIndex, t])

  const updateLine = React.useCallback((localId: string, patch: Partial<LineDraft>) => {
    setLines((current) => current.map((line) => (line.localId === localId ? { ...line, ...patch } : line)))
  }, [])

  const addLine = React.useCallback(() => {
    setLines((current) => [...current, createLineDraft()])
  }, [])

  const removeLine = React.useCallback((localId: string) => {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.localId !== localId) : current))
  }, [])

  const pruneImportedLineDrafts = React.useCallback(() => {
    setLines((current) => {
      const kept = current.filter((line) => !line.orderLineId)
      return kept.length ? kept : [createLineDraft()]
    })
  }, [])

  const clearSelectedOrder = React.useCallback(() => {
    setSelectedOrderId('')
    setSelectedOrderNumber('')
    setSelectedOrderPlacedAt(null)
    setOrderLines([])
    setSelectedOrderLineIds(new Set())
    setSelectedOrderLineQty({})
    pruneImportedLineDrafts()
  }, [pruneImportedLineDrafts])

  const selectListedOrder = React.useCallback((orderId: string) => {
    const order = orders.find((candidate) => candidate.id === orderId)
    if (!order) return
    setSelectedOrderId(order.id)
    setSelectedOrderNumber(order.orderNumber)
    setSelectedOrderPlacedAt(order.placedAt)
    setManualOrderEntry(false)
    setNoOrder(false)
    setOrderReference('')
    setOrderLines([])
    setSelectedOrderLineIds(new Set())
    setSelectedOrderLineQty({})
    pruneImportedLineDrafts()
  }, [orders, pruneImportedLineDrafts])

  const handleManualOrderChange = React.useCallback((checked: boolean | 'indeterminate') => {
    const nextManualOrderEntry = checked === true
    setManualOrderEntry(nextManualOrderEntry)
    if (nextManualOrderEntry) {
      setNoOrder(false)
      clearSelectedOrder()
    } else {
      setOrderReference('')
    }
  }, [clearSelectedOrder])

  const handleNoOrderChange = React.useCallback((checked: boolean | 'indeterminate') => {
    const nextNoOrder = checked === true
    setNoOrder(nextNoOrder)
    if (nextNoOrder) {
      setManualOrderEntry(false)
      setOrderReference('')
      clearSelectedOrder()
    }
  }, [clearSelectedOrder])

  const toggleOrderLine = React.useCallback((orderLineId: string, checked: boolean | 'indeterminate') => {
    setSelectedOrderLineIds((current) => {
      const next = new Set(current)
      if (checked === true) next.add(orderLineId)
      else next.delete(orderLineId)
      return next
    })
  }, [])

  const updateSelectedOrderLineQty = React.useCallback((orderLineId: string, qtyClaimed: string) => {
    setSelectedOrderLineQty((current) => ({ ...current, [orderLineId]: qtyClaimed }))
  }, [])

  const selectedOrderLinesReady = React.useMemo(() => {
    if (selectedOrderLineIds.size === 0) return false
    return Array.from(selectedOrderLineIds).every((orderLineId) => isPositiveQuantity(selectedOrderLineQty[orderLineId] ?? ''))
  }, [selectedOrderLineIds, selectedOrderLineQty])

  const addSelectedOrderLines = React.useCallback(() => {
    const selectedLines = orderLines.filter((line) => selectedOrderLineIds.has(line.orderLineId))
    const nextDrafts = selectedLines
      .map((line): LineDraft | null => {
        const qtyClaimed = selectedOrderLineQty[line.orderLineId] ?? defaultQuantity(line.quantity)
        if (!isPositiveQuantity(qtyClaimed)) return null
        return {
          ...createLineDraft(),
          orderLineId: line.orderLineId,
          productId: line.productId ?? undefined,
          productName: line.name ?? undefined,
          sku: line.sku ?? '',
          qtyClaimed,
        }
      })
      .filter((line): line is LineDraft => line !== null)
    if (!nextDrafts.length) return
    setLines((current) => {
      const base = current.length === 1 && isBlankLineDraft(current[0]!) ? [] : current
      return [...base, ...nextDrafts]
    })
    setSelectedOrderLineIds(new Set())
  }, [orderLines, selectedOrderLineIds, selectedOrderLineQty])

  const selectValue = React.useCallback((value: string) => value || EMPTY_SELECT_VALUE, [])

  const handleSelectChange = React.useCallback((setValue: (value: string) => void) => {
    return (value: string) => setValue(value === EMPTY_SELECT_VALUE ? '' : value)
  }, [])

  const validateStep = React.useCallback((step: WizardStepId): boolean => {
    if (step === 'items') {
      if (lines.length < 1) {
        setError(t('warranty_claims.portal.validation.lineRequired'))
        return false
      }
      for (const line of lines) {
        if (!line.faultDescription.trim()) {
          setError(t('warranty_claims.portal.validation.faultDescriptionRequired'))
          return false
        }
        if (!isPositiveQuantity(line.qtyClaimed)) {
          setError(t('warranty_claims.portal.validation.qtyPositive'))
          return false
        }
      }
    }
    if (step === 'details' && !reasonCode.trim()) {
      setError(t('warranty_claims.portal.validation.reasonRequired'))
      return false
    }
    setError(null)
    return true
  }, [lines, reasonCode, t])

  const buildPayload = React.useCallback((): PortalIntakePayload | null => {
    if (!validateStep('items') || !validateStep('details')) return null

    const normalizedLines: PortalClaimLineInput[] = lines.map((line) => ({
      orderLineId: optionalText(line.orderLineId ?? ''),
      productId: optionalText(line.productId ?? ''),
      productName: optionalText(line.productName ?? ''),
      sku: optionalText(line.sku),
      serialNumber: optionalText(line.serialNumber),
      faultCode: optionalText(line.faultCode),
      faultDescription: line.faultDescription.trim(),
      qtyClaimed: Number(line.qtyClaimed),
    }))

    return {
      orderId: noOrder ? undefined : selectedOrderId || optionalText(orderReference),
      reasonCode: reasonCode.trim(),
      notes: optionalText(notes),
      lines: normalizedLines,
    }
  }, [lines, noOrder, notes, orderReference, reasonCode, selectedOrderId, validateStep])

  const goToStep = React.useCallback((stepId: string) => {
    if (!WIZARD_STEP_IDS.includes(stepId as WizardStepId)) return
    const nextIndex = WIZARD_STEP_IDS.indexOf(stepId as WizardStepId)
    if (nextIndex <= currentStepIndex) {
      setCurrentStep(stepId as WizardStepId)
      setError(null)
    }
  }, [currentStepIndex])

  const goBack = React.useCallback(() => {
    if (currentStepIndex <= 0) return
    setCurrentStep(WIZARD_STEP_IDS[currentStepIndex - 1]!)
    setError(null)
  }, [currentStepIndex])

  const goNext = React.useCallback(() => {
    if (!validateStep(currentStep)) return
    if (currentStepIndex >= WIZARD_STEP_IDS.length - 1) return
    setCurrentStep(WIZARD_STEP_IDS[currentStepIndex + 1]!)
  }, [currentStep, currentStepIndex, validateStep])

  const submitClaim = React.useCallback(async () => {
    if (submitting) return
    setError(null)
    const payload = buildPayload()
    if (!payload) return

    setSubmitting(true)
    try {
      const mutationPayload: Record<string, unknown> = { ...payload }
      const result = await guardedMutation.runMutation({
        operation: () => apiCall<PortalCreateResponse>('/api/warranty_claims/portal/claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        }),
        context: {
          moduleId: 'warranty_claims',
          entityId: 'warranty_claims.claim',
          operation: 'portal_create',
        },
        mutationPayload,
      })

      if (!result.ok || !result.result?.claimId) {
        setError(result.status === 404
          ? t('warranty_claims.errors.orderNotOwned')
          : t('warranty_claims.portal.new.error'))
        return
      }

      flash(t('warranty_claims.portal.new.success'), 'success')
      router.push(`/${params.orgSlug}/portal/claims/${result.result.claimId}`)
    } catch {
      setError(t('warranty_claims.portal.new.error'))
    } finally {
      setSubmitting(false)
    }
  }, [buildPayload, guardedMutation, params.orgSlug, router, submitting, t])

  const handleSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (currentStep === 'review') {
      void submitClaim()
      return
    }
    goNext()
  }, [currentStep, goNext, submitClaim])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter') return
    const target = event.target
    if (target instanceof HTMLTextAreaElement) return
    event.preventDefault()
    if (currentStep === 'review') {
      void submitClaim()
      return
    }
    goNext()
  }, [currentStep, goNext, submitClaim])

  const reasonOptions = portalOptions.reasons
  const faultCodeOptions = portalOptions.faultCodes
  const reasonLabel = React.useCallback((value: string) => (
    localizeDictionaryLabel(t, 'reason', value, optionLabel(reasonOptions, value))
  ), [reasonOptions, t])
  const faultCodeLabel = React.useCallback((value: string) => (
    localizeDictionaryLabel(t, 'fault', value, optionLabel(faultCodeOptions, value))
  ), [faultCodeOptions, t])
  const selectedReasonLabel = reasonCode ? reasonLabel(reasonCode) : t('warranty_claims.portal.value.notAvailable')

  const renderReasonField = () => (
    <FormField label={t('warranty_claims.form.reasonCode')} required>
      {reasonOptions.length > 0 ? (
        <Select value={selectValue(reasonCode)} onValueChange={handleSelectChange(setReasonCode)} disabled={submitting}>
          <SelectTrigger>
            <SelectValue placeholder={t('warranty_claims.portal.new.reasonChoose')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EMPTY_SELECT_VALUE}>{t('warranty_claims.portal.new.reasonChoose')}</SelectItem>
            {reasonCode && !reasonOptions.some((option) => option.value === reasonCode) ? (
              <SelectItem value={reasonCode}>{reasonLabel(reasonCode)}</SelectItem>
            ) : null}
            {reasonOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{reasonLabel(option.value)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value)}
          disabled={submitting}
          required
        />
      )}
    </FormField>
  )

  const renderFaultCodeField = (line: LineDraft) => (
    <FormField label={t('warranty_claims.form.faultCode')}>
      {faultCodeOptions.length > 0 ? (
        <Select
          value={selectValue(line.faultCode)}
          onValueChange={handleSelectChange((value) => updateLine(line.localId, { faultCode: value }))}
          disabled={submitting}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('warranty_claims.portal.new.faultCodeChoose')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EMPTY_SELECT_VALUE}>{t('warranty_claims.portal.new.faultCodeChoose')}</SelectItem>
            {line.faultCode && !faultCodeOptions.some((option) => option.value === line.faultCode) ? (
              <SelectItem value={line.faultCode}>{faultCodeLabel(line.faultCode)}</SelectItem>
            ) : null}
            {faultCodeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{faultCodeLabel(option.value)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={line.faultCode}
          onChange={(event) => updateLine(line.localId, { faultCode: event.target.value })}
          disabled={submitting}
        />
      )}
    </FormField>
  )

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (!user) return null

  return (
    <form className="flex flex-col gap-8" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <PortalPageHeader
        label={t('warranty_claims.portal.nav')}
        title={t('warranty_claims.portal.new.title')}
        description={t('warranty_claims.portal.new.description')}
        action={
          <Button asChild variant="outline">
            <Link href={`/${params.orgSlug}/portal/claims`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('warranty_claims.portal.new.back')}
            </Link>
          </Button>
        }
      />

      {error ? (
        <ErrorMessage label={error} />
      ) : null}

      <StepIndicator steps={wizardSteps} onStepClick={goToStep} />

      {currentStep === 'order' ? (
        <PortalCard>
          <PortalCardHeader
            label={t('warranty_claims.portal.wizard.order')}
            title={t('warranty_claims.portal.new.orderTitle')}
            description={t('warranty_claims.portal.new.orderDescription')}
          />
          {ordersUnavailable ? (
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                label={t('warranty_claims.portal.new.orderReference')}
                description={t('warranty_claims.portal.new.orderReferenceHelp')}
              >
                <Input
                  value={orderReference}
                  onChange={(event) => setOrderReference(event.target.value)}
                  disabled={submitting || noOrder}
                />
              </FormField>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <CheckboxField
                  checked={noOrder}
                  onCheckedChange={handleNoOrderChange}
                  disabled={submitting}
                  label={t('warranty_claims.portal.new.noOrder')}
                  description={t('warranty_claims.portal.new.noOrderDescription')}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <FormField label={t('warranty_claims.portal.new.orderSearch')}>
                <Input
                  type="search"
                  value={orderSearchInput}
                  onChange={(event) => setOrderSearchInput(event.target.value)}
                  disabled={submitting}
                  placeholder={t('warranty_claims.portal.new.orderSearchPlaceholder')}
                />
              </FormField>
              {ordersLoading && orders.length === 0 ? (
                <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 py-8">
                  <Spinner />
                </div>
              ) : null}
              {orders.length > 0 ? (
                <RadioGroup value={selectedOrderId} onValueChange={selectListedOrder}>
                  {orders.map((order) => {
                    const selected = selectedOrderId === order.id
                    return (
                      <div
                        key={order.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                          selected ? 'border-accent-indigo bg-accent/50' : 'border-border bg-background hover:bg-muted/30'
                        }`}
                        onClick={() => {
                          if (!submitting) selectListedOrder(order.id)
                        }}
                      >
                        <Radio
                          value={order.id}
                          disabled={submitting}
                          aria-label={order.orderNumber}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">{order.orderNumber}</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>{formatDate(order.placedAt, t('warranty_claims.portal.value.notAvailable'))}</span>
                            <span>{formatOrderTotal(order.grandTotalGrossAmount, order.currencyCode, t('warranty_claims.portal.value.notAvailable'))}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </RadioGroup>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <CheckboxField
                    checked={manualOrderEntry}
                    onCheckedChange={handleManualOrderChange}
                    disabled={submitting}
                    label={t('warranty_claims.portal.new.orderNotListed')}
                    description={t('warranty_claims.portal.new.orderNotListedDescription')}
                  />
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <CheckboxField
                    checked={noOrder}
                    onCheckedChange={handleNoOrderChange}
                    disabled={submitting}
                    label={t('warranty_claims.portal.new.noOrder')}
                    description={t('warranty_claims.portal.new.noOrderDescription')}
                  />
                </div>
              </div>
              {manualOrderEntry ? (
                <FormField
                  label={t('warranty_claims.portal.new.orderReference')}
                  description={t('warranty_claims.portal.new.orderReferenceHelp')}
                >
                  <Input
                    value={orderReference}
                    onChange={(event) => setOrderReference(event.target.value)}
                    disabled={submitting || noOrder}
                  />
                </FormField>
              ) : null}
            </div>
          )}
        </PortalCard>
      ) : null}

      {currentStep === 'items' ? (
        <PortalCard>
          <PortalCardHeader
            label={t('warranty_claims.portal.wizard.items')}
            title={t('warranty_claims.portal.new.linesTitle')}
            description={t('warranty_claims.portal.new.linesDescription')}
            action={
              <Button type="button" variant="outline" onClick={addLine} disabled={submitting}>
                <Plus className="size-4" aria-hidden="true" />
                {t('warranty_claims.portal.new.addLine')}
              </Button>
            }
          />
          <div className="flex flex-col gap-4">
            {selectedOrderId && !orderLinesUnavailable ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{t('warranty_claims.portal.new.orderLinesTitle')}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedOrderNumber}
                      {selectedOrderPlacedAt ? ` - ${formatDate(selectedOrderPlacedAt, t('warranty_claims.portal.value.notAvailable'))}` : ''}
                    </p>
                  </div>
                  {orderLinesLoading ? <Spinner /> : null}
                </div>
                {orderLines.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {orderLines.map((orderLine) => {
                      const checked = selectedOrderLineIds.has(orderLine.orderLineId)
                      const label = orderLine.name ?? orderLine.sku ?? t('warranty_claims.portal.value.unnamedLine')
                      return (
                        <div key={orderLine.orderLineId} className="rounded-lg border border-border bg-background p-4">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => toggleOrderLine(orderLine.orderLineId, value)}
                              disabled={submitting}
                              aria-label={label}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground">{label}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {orderLine.sku ?? t('warranty_claims.portal.value.notAvailable')}
                                    {' - '}
                                    {formatQuantity(orderLine.quantity, t('warranty_claims.portal.value.notAvailable'))}
                                  </p>
                                </div>
                                {orderLine.estimatedWarrantyStatus !== 'unknown' ? (
                                  <StatusBadge variant={warrantyStatusVariant(orderLine.estimatedWarrantyStatus)} dot>
                                    {t(warrantyStatusLabelKey(orderLine.estimatedWarrantyStatus))}
                                  </StatusBadge>
                                ) : null}
                              </div>
                              <FormField className="mt-3 max-w-40" label={t('warranty_claims.portal.new.qtyToClaim')}>
                                <Input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={selectedOrderLineQty[orderLine.orderLineId] ?? defaultQuantity(orderLine.quantity)}
                                  onChange={(event) => updateSelectedOrderLineQty(orderLine.orderLineId, event.target.value)}
                                  disabled={submitting || !checked}
                                />
                              </FormField>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addSelectedOrderLines}
                        disabled={submitting || !selectedOrderLinesReady}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        {t('warranty_claims.portal.new.addSelectedItems')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {lines.map((line, index) => (
              <div key={line.localId} className="rounded-lg border border-border bg-background p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    {t('warranty_claims.portal.new.lineLabel', { number: index + 1 })}
                  </h3>
                  <IconButton
                    type="button"
                    variant="ghost"
                    aria-label={t('warranty_claims.portal.new.removeLine')}
                    onClick={() => removeLine(line.localId)}
                    disabled={submitting || lines.length === 1}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label={t('warranty_claims.portal.new.productOrSku')}>
                    <Input
                      value={line.sku}
                      onChange={(event) => updateLine(line.localId, { sku: event.target.value })}
                      disabled={submitting}
                    />
                  </FormField>
                  <FormField label={t('warranty_claims.form.serialNumber')}>
                    <Input
                      value={line.serialNumber}
                      onChange={(event) => updateLine(line.localId, { serialNumber: event.target.value })}
                      disabled={submitting}
                    />
                  </FormField>
                  {renderFaultCodeField(line)}
                  <FormField label={t('warranty_claims.form.qtyClaimed')} required>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={line.qtyClaimed}
                      onChange={(event) => updateLine(line.localId, { qtyClaimed: event.target.value })}
                      disabled={submitting}
                      required
                    />
                  </FormField>
                  <FormField className="md:col-span-2" label={t('warranty_claims.form.faultDescription')} required>
                    <Textarea
                      value={line.faultDescription}
                      onChange={(event) => updateLine(line.localId, { faultDescription: event.target.value })}
                      disabled={submitting}
                      required
                      maxLength={4000}
                      showCount
                    />
                  </FormField>
                </div>
              </div>
            ))}
          </div>
        </PortalCard>
      ) : null}

      {currentStep === 'details' ? (
        <PortalCard>
          <PortalCardHeader
            label={t('warranty_claims.portal.wizard.details')}
            title={t('warranty_claims.portal.new.detailsTitle')}
            description={t('warranty_claims.portal.new.detailsDescription')}
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
              {troubleshootingGuide ? (
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <TroubleshootingWalker
                    guide={troubleshootingGuide}
                    onResolve={(result) => {
                      if (result.reasonCode) setReasonCode(result.reasonCode)
                    }}
                  />
                </div>
              ) : null}
              {renderReasonField()}
              <FormField label={t('warranty_claims.form.notes')}>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  disabled={submitting}
                  maxLength={8000}
                  showCount
                />
              </FormField>
            </div>
            <Alert status="information" style="lighter">
              <AlertDescription>{t('warranty_claims.portal.new.attachmentsDeferred')}</AlertDescription>
            </Alert>
          </div>
        </PortalCard>
      ) : null}

      {currentStep === 'review' ? (
        <PortalCard>
          <PortalCardHeader
            label={t('warranty_claims.portal.wizard.reviewSubmit')}
            title={t('warranty_claims.portal.new.reviewTitle')}
            description={t('warranty_claims.portal.new.reviewDescription')}
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
              {lines.map((line, index) => (
                <div key={line.localId} className="rounded-lg border border-border bg-background p-4">
                  <h3 className="text-sm font-semibold">{t('warranty_claims.portal.new.lineLabel', { number: index + 1 })}</h3>
                  <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('warranty_claims.portal.new.productOrSku')}</dt>
                      <dd className="mt-1 font-medium">
                        {optionalText(line.productName ?? '') ?? optionalText(line.sku) ?? t('warranty_claims.portal.value.notAvailable')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('warranty_claims.form.serialNumber')}</dt>
                      <dd className="mt-1 font-medium">{line.serialNumber.trim() || t('warranty_claims.portal.value.notAvailable')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('warranty_claims.form.faultCode')}</dt>
                      <dd className="mt-1 font-medium">{line.faultCode ? faultCodeLabel(line.faultCode) : t('warranty_claims.portal.value.notAvailable')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('warranty_claims.form.qtyClaimed')}</dt>
                      <dd className="mt-1 font-medium">{line.qtyClaimed}</dd>
                    </div>
                    <div className="md:col-span-2">
                      <dt className="text-xs text-muted-foreground">{t('warranty_claims.form.faultDescription')}</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm font-medium">{line.faultDescription.trim()}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <h3 className="mb-3 text-sm font-semibold">{t('warranty_claims.portal.new.summaryTitle')}</h3>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('warranty_claims.portal.new.reviewOrder')}</dt>
                  <dd className="text-right font-medium">
                    {noOrder
                      ? t('warranty_claims.portal.new.noOrder')
                      : selectedOrderNumber || orderReference.trim() || t('warranty_claims.portal.value.notAvailable')}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('warranty_claims.form.reasonCode')}</dt>
                  <dd className="text-right font-medium">{selectedReasonLabel}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('warranty_claims.portal.new.reviewLines')}</dt>
                  <dd className="font-medium">{lines.length}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('warranty_claims.portal.new.reviewNotes')}</dt>
                  <dd className="font-medium">
                    {notes.trim() ? t('warranty_claims.portal.value.yes') : t('warranty_claims.portal.value.no')}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </PortalCard>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Button asChild variant="outline">
            <Link href={`/${params.orgSlug}/portal/claims`}>
              {t('warranty_claims.portal.new.cancel')}
            </Link>
          </Button>
          {currentStepIndex > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              disabled={submitting}
              aria-label={t('warranty_claims.portal.new.previousStep')}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('warranty_claims.portal.new.previousStep')}
            </Button>
          ) : null}
        </div>
        {currentStep === 'review' ? (
          <Button type="submit" disabled={submitting || !hasValidLines || !hasReason} aria-label={t('warranty_claims.portal.submit')}>
            <Send className="size-4" aria-hidden="true" />
            {submitting ? t('warranty_claims.portal.new.submitting') : t('warranty_claims.portal.submit')}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={goNext}
            disabled={submitting}
            aria-label={t('warranty_claims.portal.new.nextStep')}
          >
            {t('warranty_claims.portal.new.nextStep')}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </form>
  )
}
