"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Minus, PackageSearch, Plus, Warehouse } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { DateTimePicker } from '@open-mercato/ui/backend/inputs/DateTimePicker'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  buildInventoryMutationReferenceId,
  computeCycleCountVariance,
  formatSignedQuantity,
} from '../../lib/inventoryMutationUi'
import {
  BalanceLookupError,
  ScopeEstimateError,
  fetchBalanceOnHand,
  fetchCycleCountScopeEstimate,
  formatCycleCountZoneLabel,
  loadAssigneeOptions,
  loadBinLocationOptions,
  loadCatalogVariantOptions,
  loadLocationOptions,
  loadLotOptions,
  loadWarehouseOptions,
  loadZoneOptions,
  resolveAssigneeLabel,
  resolveCatalogVariantLabel,
  resolveLocationLabel,
  resolveLotLabel,
  resolveWarehouseLabel,
  resolveZoneLabel,
} from './inventoryMutationLoaders'
import type { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

type CycleCountWizardDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: ReturnType<typeof useWmsInventoryMutationAccess>
  initialCatalogVariantId?: string
  initialWarehouseId?: string
  initialLocationId?: string
  initialLotId?: string
}

type WizardStep = 1 | 2 | 3

type CycleCountFormState = {
  zoneId: string
  warehouseId: string
  fromLocationId: string
  toLocationId: string
  scheduledAt: string
  assigneeId: string
  expectedSkus: number
  locationId: string
  catalogVariantId: string
  lotId: string
  countedQuantity: number
  setupNotes: string
  countNotes: string
  reason: string
}

const EMPTY_FORM: CycleCountFormState = {
  zoneId: '',
  warehouseId: '',
  fromLocationId: '',
  toLocationId: '',
  scheduledAt: '',
  assigneeId: '',
  expectedSkus: 0,
  locationId: '',
  catalogVariantId: '',
  lotId: '',
  countedQuantity: 0,
  setupNotes: '',
  countNotes: '',
  reason: 'cycle_count',
}

function CycleCountStepIndicator({ step }: { step: WizardStep }) {
  const steps = [1, 2, 3] as const

  return (
    <div
      className="flex items-center gap-1.5 pt-1"
      aria-label={`Step ${step} of 3`}
    >
      {steps.map((stepNumber, index) => {
        const completed = stepNumber < step
        const current = stepNumber === step

        return (
          <React.Fragment key={stepNumber}>
            {index > 0 ? (
              <div
                className={cn(
                  'h-0.5 w-4 shrink-0',
                  stepNumber <= step ? 'bg-foreground' : 'bg-border',
                )}
                aria-hidden="true"
              />
            ) : null}
            <div
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                completed || current
                  ? 'bg-foreground text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
              aria-current={current ? 'step' : undefined}
            >
              {completed ? <Check className="size-3" aria-hidden="true" /> : stepNumber}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function SummaryPanel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-muted/40 px-4 py-3.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  )
}

export function CycleCountWizardDialog({
  open,
  onOpenChange,
  access,
  initialCatalogVariantId,
  initialWarehouseId,
  initialLocationId,
  initialLotId,
}: CycleCountWizardDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const formRef = React.useRef<HTMLFormElement>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-inventory-cycle-count',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  const [step, setStep] = React.useState<WizardStep>(1)
  const [form, setForm] = React.useState<CycleCountFormState>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [systemOnHand, setSystemOnHand] = React.useState(0)
  const [loadingBalance, setLoadingBalance] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [linesPosted, setLinesPosted] = React.useState(0)
  const [autoAdjust, setAutoAdjust] = React.useState(true)
  const [referenceId] = React.useState(() => buildInventoryMutationReferenceId())
  const [optionLabelByValue, setOptionLabelByValue] = React.useState<Record<string, string>>({})
  const [loadingScopeEstimate, setLoadingScopeEstimate] = React.useState(false)
  const [scopeStats, setScopeStats] = React.useState<{ expectedSkus: number; binCount: number } | null>(
    null,
  )
  const [expectedSkusTouched, setExpectedSkusTouched] = React.useState(false)
  const [zoneSuggestions, setZoneSuggestions] = React.useState<Array<{ value: string; label: string }>>([])
  const [assigneeCanListUsers, setAssigneeCanListUsers] = React.useState(true)
  const [scopeEstimateError, setScopeEstimateError] = React.useState<string | null>(null)
  const [balanceError, setBalanceError] = React.useState<string | null>(null)

  const registerOptionLabels = React.useCallback(
    (options: Array<{ value: string; label: string }>) => {
      setOptionLabelByValue((current) => {
        let changed = false
        const next = { ...current }
        for (const option of options) {
          const value = option.value.trim()
          const label = option.label.trim()
          if (!value || !label || next[value] === label) continue
          next[value] = label
          changed = true
        }
        return changed ? next : current
      })
    },
    [],
  )

  const resolveOptionLabel = React.useCallback(
    (value: string) => optionLabelByValue[value] ?? value,
    [optionLabelByValue],
  )
  const optionLabelByValueRef = React.useRef(optionLabelByValue)
  optionLabelByValueRef.current = optionLabelByValue
  const zoneWarehouseByZoneIdRef = React.useRef<Record<string, string>>({})

  const rememberZoneWarehouseOptions = React.useCallback(
    (options: Array<{ value: string; warehouseId?: string }>) => {
      for (const option of options) {
        const zoneId = option.value.trim()
        const warehouseId = option.warehouseId?.trim()
        if (!zoneId || !warehouseId) continue
        zoneWarehouseByZoneIdRef.current[zoneId] = warehouseId
      }
    },
    [],
  )

  const variance = computeCycleCountVariance(systemOnHand, form.countedQuantity)

  const setupSchema = React.useMemo(
    () =>
      z.object({
        warehouseId: z.string().uuid(),
        zoneId: z.string().uuid(),
        fromLocationId: z.string().uuid().optional().or(z.literal('')),
        toLocationId: z.string().uuid().optional().or(z.literal('')),
        assigneeId: z.string().uuid(),
        expectedSkus: z.coerce.number().int().min(1),
        setupNotes: z.string().trim().max(500).optional(),
      }),
    [],
  )

  const countSchema = React.useMemo(
    () =>
      z.object({
        warehouseId: z.string().uuid(),
        locationId: z.string().uuid(),
        catalogVariantId: z.string().uuid(),
        lotId: z.string().uuid().optional().or(z.literal('')),
        countedQuantity: z.coerce.number().min(0),
        countNotes: z.string().trim().max(500).optional(),
      }),
    [],
  )

  const commitSchema = React.useMemo(
    () =>
      z.object({
        reason: z.string().trim().min(1).max(500),
      }),
    [],
  )

  const resetWizard = React.useCallback(() => {
    setStep(1)
    setForm(EMPTY_FORM)
    setFieldErrors({})
    setSystemOnHand(0)
    setLoadingBalance(false)
    setSubmitting(false)
    setAutoAdjust(true)
    setOptionLabelByValue({})
    zoneWarehouseByZoneIdRef.current = {}
    setLoadingScopeEstimate(false)
    setScopeStats(null)
    setExpectedSkusTouched(false)
    setZoneSuggestions([])
    setAssigneeCanListUsers(true)
    setScopeEstimateError(null)
    setBalanceError(null)
    setLinesPosted(0)
  }, [])

  const resetToStep2 = React.useCallback(() => {
    setStep(2)
    setForm((current) => ({
      ...current,
      locationId: '',
      catalogVariantId: '',
      lotId: '',
      countedQuantity: 0,
      countNotes: '',
      reason: 'cycle_count',
    }))
    setFieldErrors({})
    setSystemOnHand(0)
    setLoadingBalance(false)
    setBalanceError(null)
    setAutoAdjust(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
    resetWizard()
  }, [onOpenChange, resetWizard])

  const patchForm = React.useCallback((patch: Partial<CycleCountFormState>) => {
    setForm((current) => ({ ...current, ...patch }))
    setFieldErrors({})
  }, [])

  React.useEffect(() => {
    if (!open) return
    const catalogVariantId = initialCatalogVariantId?.trim()
    const warehouseId = initialWarehouseId?.trim()
    const locationId = initialLocationId?.trim()
    const lotId = initialLotId?.trim()
    setForm((current) => ({
      ...current,
      scheduledAt: current.scheduledAt.trim() || new Date().toISOString(),
      assigneeId: current.assigneeId.trim() || access.userId?.trim() || '',
      ...(catalogVariantId ? { catalogVariantId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(lotId ? { lotId } : {}),
      ...(locationId
        ? {
            locationId,
            fromLocationId: locationId,
            toLocationId: locationId,
          }
        : {}),
    }))
  }, [access.userId, initialCatalogVariantId, initialLocationId, initialLotId, initialWarehouseId, open])

  const assigneeFallback = React.useMemo(() => {
    const userId = access.userId?.trim()
    if (!userId) return null
    const label = resolveOptionLabel(userId)
    return { userId, label: label === userId ? userId : label }
  }, [access.userId, resolveOptionLabel])

  React.useEffect(() => {
    if (!open || !assigneeFallback) return
    let cancelled = false
    void loadAssigneeOptions(undefined, assigneeFallback).then((result) => {
      if (cancelled) return
      setAssigneeCanListUsers(result.canListUsers)
      registerOptionLabels(result.options)
    })
    return () => {
      cancelled = true
    }
  }, [assigneeFallback, open, registerOptionLabels])

  React.useEffect(() => {
    if (!open) return
    const warehouseId = form.warehouseId.trim()
    if (!warehouseId) {
      setZoneSuggestions([])
      return
    }

    let cancelled = false
    void loadZoneOptions(warehouseId)
      .then((options) => {
        if (cancelled) return
        rememberZoneWarehouseOptions(options)
        registerOptionLabels(options)
        setZoneSuggestions(
          options.map((option) => ({
            value: option.value,
            label: option.label,
          })),
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setZoneSuggestions([])
        console.error('[CycleCountWizardDialog] loadZoneOptions failed', error)
      })

    return () => {
      cancelled = true
    }
  }, [form.warehouseId, open, registerOptionLabels, rememberZoneWarehouseOptions])

  const loadZoneSuggestions = React.useCallback(
    async (query?: string) => {
      const warehouseId = form.warehouseId.trim()
      if (!warehouseId) return []
      const options = await loadZoneOptions(warehouseId, query)
      rememberZoneWarehouseOptions(options)
      registerOptionLabels(options)
      if (!query?.trim()) {
        setZoneSuggestions(
          options.map((option) => ({
            value: option.value,
            label: option.label,
          })),
        )
      }
      return options.map((option) => ({
        value: option.value,
        label: option.label,
      }))
    },
    [form.warehouseId, registerOptionLabels, rememberZoneWarehouseOptions],
  )

  const scheduledAtValue = React.useMemo(() => {
    const raw = form.scheduledAt.trim()
    if (!raw) return new Date()
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }, [form.scheduledAt])

  const scheduleImmediate = React.useMemo(() => {
    const deltaMs = Math.abs(scheduledAtValue.getTime() - Date.now())
    return deltaMs <= 5 * 60 * 1000
  }, [scheduledAtValue])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false

    const ensureLabel = async (value: string, resolve: (id: string) => Promise<string | null>) => {
      const id = value.trim()
      if (!id || optionLabelByValueRef.current[id]) return
      const label = await resolve(id)
      if (cancelled || !label) return
      registerOptionLabels([{ value: id, label }])
    }

    void Promise.all([
      ensureLabel(form.catalogVariantId, resolveCatalogVariantLabel),
      ensureLabel(form.zoneId, resolveZoneLabel),
      ensureLabel(form.warehouseId, resolveWarehouseLabel),
      ensureLabel(form.fromLocationId, resolveLocationLabel),
      ensureLabel(form.toLocationId, resolveLocationLabel),
      ensureLabel(form.locationId, resolveLocationLabel),
      ensureLabel(form.lotId, resolveLotLabel),
      ensureLabel(form.assigneeId, resolveAssigneeLabel),
    ])

    return () => {
      cancelled = true
    }
  }, [
    form.assigneeId,
    form.catalogVariantId,
    form.fromLocationId,
    form.locationId,
    form.lotId,
    form.toLocationId,
    form.warehouseId,
    form.zoneId,
    open,
    registerOptionLabels,
  ])

  React.useEffect(() => {
    if (!open || step !== 1) return
    const warehouseId = form.warehouseId.trim()
    if (!warehouseId) {
      setScopeStats(null)
      setScopeEstimateError(null)
      if (!expectedSkusTouched) patchForm({ expectedSkus: 0 })
      return
    }

    let cancelled = false
    setLoadingScopeEstimate(true)
    setScopeEstimateError(null)
    void fetchCycleCountScopeEstimate({
      warehouseId,
      fromLocationId: form.fromLocationId.trim() || null,
      toLocationId: form.toLocationId.trim() || null,
    })
      .then((estimate) => {
        if (cancelled) return
        setScopeStats(estimate)
        setScopeEstimateError(null)
        if (!expectedSkusTouched) {
          patchForm({ expectedSkus: Math.max(1, estimate.expectedSkus) })
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setScopeStats(null)
        if (error instanceof ScopeEstimateError) {
          setScopeEstimateError(
            t(
              'wms.backend.inventory.cycleCount.errors.scopeEstimate',
              'Failed to estimate count scope.',
            ),
          )
          return
        }
        console.error('[CycleCountWizardDialog] fetchCycleCountScopeEstimate failed', error)
        setScopeEstimateError(
          t(
            'wms.backend.inventory.cycleCount.errors.scopeEstimate',
            'Failed to estimate count scope.',
          ),
        )
      })
      .finally(() => {
        if (!cancelled) setLoadingScopeEstimate(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    expectedSkusTouched,
    form.fromLocationId,
    form.toLocationId,
    form.warehouseId,
    open,
    patchForm,
    step,
  ])

  React.useEffect(() => {
    if (!open || !form.zoneId.trim() || !scopeStats) return
    const baseLabel = optionLabelByValueRef.current[form.zoneId.trim()]
    if (!baseLabel || baseLabel.includes('SKUs')) return
    registerOptionLabels([
      {
        value: form.zoneId.trim(),
        label: formatCycleCountZoneLabel(baseLabel, scopeStats),
      },
    ])
  }, [form.zoneId, open, registerOptionLabels, scopeStats])

  React.useEffect(() => {
    if (!open || step < 2) return
    const warehouseId = form.warehouseId.trim()
    const locationId = form.locationId.trim()
    const catalogVariantId = form.catalogVariantId.trim()
    if (!warehouseId || !locationId || !catalogVariantId) {
      setSystemOnHand(0)
      setBalanceError(null)
      return
    }

    let cancelled = false
    setLoadingBalance(true)
    setBalanceError(null)
    void fetchBalanceOnHand({
      warehouseId,
      locationId,
      catalogVariantId,
      lotId: form.lotId.trim() || null,
    })
      .then((value) => {
        if (!cancelled) {
          setSystemOnHand(value)
          setBalanceError(null)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setSystemOnHand(0)
        if (error instanceof BalanceLookupError) {
          setBalanceError(
            t('wms.backend.inventory.cycleCount.errors.balance', 'Failed to load system on-hand.'),
          )
          return
        }
        console.error('[CycleCountWizardDialog] fetchBalanceOnHand failed', error)
        setBalanceError(
          t('wms.backend.inventory.cycleCount.errors.balance', 'Failed to load system on-hand.'),
        )
      })
      .finally(() => {
        if (!cancelled) setLoadingBalance(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    form.catalogVariantId,
    form.locationId,
    form.lotId,
    form.warehouseId,
    open,
    step,
  ])

  const applyValidationErrors = React.useCallback((issues: z.ZodIssue[]) => {
    const nextErrors: Record<string, string> = {}
    for (const issue of issues) {
      const key = String(issue.path[0] ?? 'form')
      if (!nextErrors[key]) nextErrors[key] = issue.message
    }
    setFieldErrors(nextErrors)
  }, [])

  const handleSetupContinue = React.useCallback(() => {
    const parsed = setupSchema.safeParse({
      warehouseId: form.warehouseId,
      zoneId: form.zoneId,
      fromLocationId: form.fromLocationId.trim() || undefined,
      toLocationId: form.toLocationId.trim() || undefined,
      assigneeId: form.assigneeId,
      expectedSkus: form.expectedSkus,
      setupNotes: form.setupNotes.trim() || undefined,
    })
    if (!parsed.success) {
      applyValidationErrors(parsed.error.issues)
      return
    }
    const zoneWarehouseId = zoneWarehouseByZoneIdRef.current[parsed.data.zoneId.trim()]
    if (zoneWarehouseId && zoneWarehouseId !== parsed.data.warehouseId) {
      setFieldErrors({
        zoneId: t(
          'wms.backend.inventory.cycleCount.errors.zoneWarehouse',
          'Selected zone does not belong to this warehouse.',
        ),
      })
      return
    }
    const nextLocationId = form.fromLocationId.trim() || form.locationId.trim()
    if (nextLocationId && nextLocationId !== form.locationId.trim()) {
      patchForm({ locationId: nextLocationId })
    }
    setStep(2)
  }, [
    applyValidationErrors,
    form.assigneeId,
    form.expectedSkus,
    form.fromLocationId,
    form.locationId,
    form.setupNotes,
    form.toLocationId,
    form.warehouseId,
    form.zoneId,
    patchForm,
    setupSchema,
    t,
  ])

  const handleCountContinue = React.useCallback(async () => {
    const parsed = countSchema.safeParse({
      ...form,
      lotId: form.lotId.trim() || undefined,
      countNotes: form.countNotes.trim() || undefined,
    })
    if (!parsed.success) {
      applyValidationErrors(parsed.error.issues)
      return
    }

    setLoadingBalance(true)
    try {
      const onHand = await fetchBalanceOnHand({
        warehouseId: parsed.data.warehouseId,
        locationId: parsed.data.locationId,
        catalogVariantId: parsed.data.catalogVariantId,
        lotId: parsed.data.lotId ?? null,
      })
      setSystemOnHand(onHand)
      setStep(3)
    } catch (error) {
      console.error('[CycleCountWizardDialog] fetchBalanceOnHand failed', error)
      flash(
        t('wms.backend.inventory.cycleCount.errors.balance', 'Failed to load system on-hand.'),
        'error',
      )
    } finally {
      setLoadingBalance(false)
    }
  }, [applyValidationErrors, countSchema, form, t])

  const handlePost = React.useCallback(async () => {
    const parsed = commitSchema.safeParse({ reason: form.reason })
    if (!parsed.success) {
      applyValidationErrors(parsed.error.issues)
      return
    }

    if (!form.warehouseId || !form.locationId || !form.catalogVariantId) {
      flash(
        t('wms.backend.inventory.cycleCount.errors.scope', 'Complete setup and select a count location.'),
        'error',
      )
      return
    }

    if (!access.scopeReady || !access.organizationId || !access.tenantId || !access.userId) {
      flash(
        t(
          'wms.backend.inventory.mutations.errors.scope',
          'Select an organization and sign in before posting inventory changes.',
        ),
        'error',
      )
      return
    }

    if (!autoAdjust && variance !== 0) {
      flash(
        t(
          'wms.backend.inventory.cycleCount.errors.autoAdjustRequired',
          'Enable auto-adjust to commit a variance.',
        ),
        'error',
      )
      return
    }

    setSubmitting(true)
    try {
      const notes = [form.setupNotes.trim(), form.countNotes.trim()].filter(Boolean).join(' · ')
      const setupMetadata = {
        zoneId: form.zoneId.trim() || null,
        fromLocationId: form.fromLocationId.trim() || null,
        toLocationId: form.toLocationId.trim() || null,
        scheduledAt: form.scheduledAt.trim() || null,
        assigneeId: form.assigneeId.trim() || null,
        expectedSkus: form.expectedSkus,
      }
      const payload: Record<string, unknown> = {
        organizationId: access.organizationId,
        tenantId: access.tenantId,
        warehouseId: form.warehouseId,
        locationId: form.locationId,
        catalogVariantId: form.catalogVariantId,
        countedQuantity: form.countedQuantity,
        autoAdjust,
        reason: parsed.data.reason,
        referenceId,
        performedBy: form.assigneeId.trim() || access.userId,
      }
      if (form.lotId.trim()) payload.lotId = form.lotId.trim()
      if (notes || Object.values(setupMetadata).some((value) => value !== null && value !== 0)) {
        payload.metadata = { notes: notes || undefined, setup: setupMetadata }
      }

      await runMutation({
        operation: async () => {
          const call = await apiCall<{
            ok?: boolean
            adjustmentDelta?: string
            movementId?: string | null
          }>('/api/wms/inventory/cycle-count', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!call.ok) {
            await raiseCrudError(
              call.response,
              t('wms.backend.inventory.cycleCount.errors.submit', 'Failed to post cycle count.'),
            )
          }
          return call.result ?? {}
        },
        context: mutationContext,
        mutationPayload: payload,
      })

      const deltaLabel = formatSignedQuantity(variance)
      flash(
        t('wms.backend.inventory.cycleCount.flash.success', 'Cycle count posted ({delta})', {
          delta: deltaLabel,
        }),
        'success',
      )
      await queryClient.invalidateQueries({ queryKey: ['wms-inventory-console'] })
      await queryClient.invalidateQueries({ queryKey: ['wms-sku-detail'] })
      setLinesPosted((n) => n + 1)
      resetToStep2()
    } finally {
      setSubmitting(false)
    }
  }, [
    access,
    applyValidationErrors,
    autoAdjust,
    commitSchema,
    form,
    mutationContext,
    queryClient,
    referenceId,
    resetToStep2,
    runMutation,
    t,
    variance,
  ])

  const handlePrimaryAction = React.useCallback(() => {
    if (step === 1) {
      handleSetupContinue()
      return
    }
    if (step === 2) {
      void handleCountContinue()
      return
    }
    void handlePost()
  }, [handleCountContinue, handlePost, handleSetupContinue, step])

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (submitting || loadingBalance) return
        handlePrimaryAction()
      }
    },
    [closeDialog, handlePrimaryAction, loadingBalance, submitting],
  )

  const adjustCounted = React.useCallback((delta: -1 | 1) => {
    setForm((current) => ({
      ...current,
      countedQuantity: Math.max(0, current.countedQuantity + delta),
    }))
    setFieldErrors({})
  }, [])

  const adjustExpectedSkus = React.useCallback((delta: -1 | 1) => {
    setExpectedSkusTouched(true)
    setForm((current) => ({
      ...current,
      expectedSkus: Math.max(1, current.expectedSkus + delta),
    }))
    setFieldErrors({})
  }, [])

  const stepSubtitle = React.useMemo(() => {
    if (step === 1) {
      return t(
        'wms.backend.inventory.cycleCount.steps.setup.subtitle',
        'Step 1 of 3 · Set scope and expectations',
      )
    }
    if (step === 2) {
      if (linesPosted > 0) {
        return t(
          'wms.backend.inventory.cycleCount.steps.counting.subtitleWithPosted',
          'Step 2 of 3 · {count} line(s) posted — count next SKU',
          { count: linesPosted },
        )
      }
      return t(
        'wms.backend.inventory.cycleCount.steps.counting.subtitle',
        'Step 2 of 3 · Scan and tally items',
      )
    }
    return t(
      'wms.backend.inventory.cycleCount.steps.review.subtitle',
      'Step 3 of 3 · Review variances and commit',
    )
  }, [linesPosted, step, t])

  const shortcutHint = React.useMemo(() => {
    if (step === 1) {
      return t('wms.backend.inventory.cycleCount.steps.setup.shortcut', 'to start')
    }
    if (step === 2) {
      return t('wms.backend.inventory.cycleCount.steps.counting.shortcut', 'to continue')
    }
    return t('wms.backend.inventory.cycleCount.steps.review.shortcut', 'to commit')
  }, [step, t])

  const variantScanLabel = form.catalogVariantId
    ? resolveOptionLabel(form.catalogVariantId)
    : t(
        'wms.backend.inventory.cycleCount.form.variantScanPlaceholder',
        'Select a variant to begin scanning',
      )

  const locationLabel = form.locationId ? resolveOptionLabel(form.locationId) : '—'
  const variantLabel = form.catalogVariantId ? resolveOptionLabel(form.catalogVariantId) : '—'
  const lotLabel = form.lotId ? resolveOptionLabel(form.lotId) : '—'

  const primaryDisabled = submitting || (step === 2 && loadingBalance)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>
              {t('wms.backend.inventory.cycleCount.dialog.title', 'Cycle count')}
            </DialogTitle>
            <DialogDescription>{stepSubtitle}</DialogDescription>
            <CycleCountStepIndicator step={step} />
          </DialogHeader>
        </div>

        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault()
            handlePrimaryAction()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex max-h-[min(70vh,640px)] flex-col gap-5 overflow-y-auto px-6 py-6">
            {step === 1 ? (
              <>
                <FormField
                  label={t('wms.backend.inventory.cycleCount.form.warehouse', 'Warehouse')}
                  required
                  error={fieldErrors.warehouseId}
                >
                  <ComboboxInput
                    value={form.warehouseId}
                    onChange={(next) => {
                      patchForm({
                        warehouseId: next.trim(),
                        zoneId: '',
                        fromLocationId: '',
                        toLocationId: '',
                        locationId: '',
                      })
                      setExpectedSkusTouched(false)
                      setScopeStats(null)
                      setZoneSuggestions([])
                    }}
                    loadSuggestions={async (query) => {
                      const options = await loadWarehouseOptions(query)
                      registerOptionLabels(options)
                      return options.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))
                    }}
                    resolveLabel={resolveOptionLabel}
                    placeholder={t(
                      'wms.backend.inventory.cycleCount.form.warehousePlaceholder',
                      'Select warehouse',
                    )}
                    allowCustomValues={false}
                    disabled={loadingBalance || submitting}
                  />
                </FormField>

                <FormField
                  label={t('wms.backend.inventory.cycleCount.form.zone', 'Zone')}
                  required
                  error={fieldErrors.zoneId}
                >
                  <div className="relative [&_input]:pl-9">
                    <Warehouse
                      className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <ComboboxInput
                      key={form.warehouseId || 'cycle-count-zone'}
                      value={form.zoneId}
                      onChange={(next) => {
                        const zoneId = next.trim()
                        patchForm({
                          zoneId,
                          fromLocationId: '',
                          toLocationId: '',
                          locationId: '',
                        })
                        setExpectedSkusTouched(false)
                        setScopeStats(null)
                      }}
                      suggestions={zoneSuggestions}
                      loadSuggestions={loadZoneSuggestions}
                      resolveLabel={(value) => {
                        const label = resolveOptionLabel(value)
                        if (value === form.zoneId.trim() && scopeStats) {
                          const base = label.includes(' · ') ? label.split(' · ')[0] ?? label : label
                          return formatCycleCountZoneLabel(base, scopeStats)
                        }
                        return label
                      }}
                      placeholder={
                        form.warehouseId.trim()
                          ? t(
                              'wms.backend.inventory.cycleCount.form.zonePlaceholder',
                              'Select zone',
                            )
                          : t(
                              'wms.backend.inventory.cycleCount.form.zonePlaceholderDisabled',
                              'Select warehouse first',
                            )
                      }
                      allowCustomValues={false}
                      disabled={loadingBalance || submitting || !form.warehouseId.trim()}
                    />
                  </div>
                  {form.warehouseId.trim() ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {form.zoneId.trim() && scopeStats
                        ? t(
                            'wms.backend.inventory.cycleCount.form.zoneScopeHint',
                            '{warehouse} · {expectedSkus} SKUs · {binCount} bins in scope',
                            {
                              warehouse: resolveOptionLabel(form.warehouseId),
                              expectedSkus: scopeStats.expectedSkus,
                              binCount: scopeStats.binCount,
                            },
                          )
                        : t(
                            'wms.backend.inventory.cycleCount.form.zoneWarehouseHint',
                            'Functional zone within {warehouse}',
                            { warehouse: resolveOptionLabel(form.warehouseId) },
                          )}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(
                        'wms.backend.inventory.cycleCount.form.zoneSelectWarehouse',
                        'Select a warehouse to choose a zone.',
                      )}
                    </p>
                  )}
                </FormField>

                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField
                    label={t('wms.backend.inventory.cycleCount.form.fromBin', 'From bin')}
                    error={fieldErrors.fromLocationId}
                  >
                    <ComboboxInput
                      value={form.fromLocationId}
                      onChange={(next) => {
                        patchForm({ fromLocationId: next.trim() })
                        setExpectedSkusTouched(false)
                      }}
                      loadSuggestions={async (query) => {
                        const options = await loadBinLocationOptions(form.warehouseId, query)
                        registerOptionLabels(options)
                        return options.map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))
                      }}
                      resolveLabel={resolveOptionLabel}
                      placeholder={t(
                        'wms.backend.inventory.cycleCount.form.fromBinPlaceholder',
                        'Start bin',
                      )}
                      allowCustomValues={false}
                      disabled={loadingBalance || submitting || !form.warehouseId.trim()}
                    />
                  </FormField>

                  <FormField
                    label={t('wms.backend.inventory.cycleCount.form.toBin', 'To bin')}
                    error={fieldErrors.toLocationId}
                  >
                    <ComboboxInput
                      value={form.toLocationId}
                      onChange={(next) => {
                        patchForm({ toLocationId: next.trim() })
                        setExpectedSkusTouched(false)
                      }}
                      loadSuggestions={async (query) => {
                        const options = await loadBinLocationOptions(form.warehouseId, query)
                        registerOptionLabels(options)
                        return options.map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))
                      }}
                      resolveLabel={resolveOptionLabel}
                      placeholder={t(
                        'wms.backend.inventory.cycleCount.form.toBinPlaceholder',
                        'End bin',
                      )}
                      allowCustomValues={false}
                      disabled={loadingBalance || submitting || !form.warehouseId.trim()}
                    />
                  </FormField>
                </div>

                <FormField
                  label={t('wms.backend.inventory.cycleCount.form.schedule', 'Schedule')}
                  error={fieldErrors.scheduledAt}
                >
                  <DateTimePicker
                    value={scheduledAtValue}
                    onChange={(next) => {
                      patchForm({ scheduledAt: next ? next.toISOString() : '' })
                    }}
                    placeholder={t(
                      'wms.backend.inventory.cycleCount.form.schedulePlaceholder',
                      'Pick date and time',
                    )}
                    disabled={loadingBalance || submitting}
                  />
                  {scheduleImmediate ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(
                        'wms.backend.inventory.cycleCount.form.scheduleImmediate',
                        'Immediate start',
                      )}
                    </p>
                  ) : null}
                </FormField>

                <FormField
                  label={t('wms.backend.inventory.cycleCount.form.expectedSkus', 'Expected SKUs')}
                  required
                  error={fieldErrors.expectedSkus}
                >
                  <div className="flex w-28 items-center gap-2 rounded-md border bg-background p-2 shadow-xs">
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t(
                        'wms.backend.inventory.cycleCount.form.decreaseExpectedSkus',
                        'Decrease expected SKUs',
                      )}
                      onClick={() => adjustExpectedSkus(-1)}
                      disabled={loadingBalance || submitting || loadingScopeEstimate}
                    >
                      <Minus className="size-4" />
                    </IconButton>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={String(form.expectedSkus)}
                      onChange={(event) => {
                        const parsed = Number(event.target.value)
                        if (!Number.isFinite(parsed) || parsed < 1) return
                        setExpectedSkusTouched(true)
                        patchForm({ expectedSkus: Math.floor(parsed) })
                      }}
                      className="h-8 border-0 bg-transparent px-0 text-center shadow-none focus-visible:ring-0"
                      disabled={loadingBalance || submitting || loadingScopeEstimate}
                    />
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t(
                        'wms.backend.inventory.cycleCount.form.increaseExpectedSkus',
                        'Increase expected SKUs',
                      )}
                      onClick={() => adjustExpectedSkus(1)}
                      disabled={loadingBalance || submitting || loadingScopeEstimate}
                    >
                      <Plus className="size-4" />
                    </IconButton>
                  </div>
                  {loadingScopeEstimate ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(
                        'wms.backend.inventory.cycleCount.form.expectedSkusLoading',
                        'Estimating scope…',
                      )}
                    </p>
                  ) : null}
                  {scopeEstimateError ? (
                    <p className="mt-1 text-xs text-status-warning-fg">{scopeEstimateError}</p>
                  ) : null}
                </FormField>

                <FormField
                  label={t('wms.backend.inventory.cycleCount.form.assignee', 'Assignee')}
                  required
                  error={fieldErrors.assigneeId}
                >
                  {assigneeCanListUsers ? (
                    <ComboboxInput
                      value={form.assigneeId}
                      onChange={(next) => patchForm({ assigneeId: next.trim() })}
                      loadSuggestions={async (query) => {
                        const result = await loadAssigneeOptions(query, assigneeFallback ?? undefined)
                        setAssigneeCanListUsers(result.canListUsers)
                        registerOptionLabels(result.options)
                        return result.options.map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))
                      }}
                      resolveLabel={resolveOptionLabel}
                      placeholder={t(
                        'wms.backend.inventory.cycleCount.form.assigneePlaceholder',
                        'Select assignee',
                      )}
                      allowCustomValues={false}
                      disabled={loadingBalance || submitting}
                    />
                  ) : (
                    <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
                      {resolveOptionLabel(form.assigneeId) || form.assigneeId}
                    </div>
                  )}
                  {!assigneeCanListUsers ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(
                        'wms.backend.inventory.cycleCount.form.assigneeLocked',
                        'Only the current user can be assigned without user-directory access.',
                      )}
                    </p>
                  ) : null}
                </FormField>

                <FormField label={t('wms.backend.inventory.cycleCount.form.setupNotes', 'Notes')}>
                  <Textarea
                    value={form.setupNotes}
                    onChange={(event) => patchForm({ setupNotes: event.target.value })}
                    placeholder={t(
                      'wms.backend.inventory.cycleCount.form.setupNotesPlaceholder',
                      'Optional — pre-count instructions',
                    )}
                    rows={3}
                    disabled={loadingBalance || submitting}
                  />
                </FormField>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <FormField
                  label={t(
                    'wms.backend.inventory.cycleCount.form.currentlyScanning',
                    'Currently scanning',
                  )}
                >
                  <div className="relative rounded-md bg-muted/50 px-3 py-2.5 pl-9 text-sm text-muted-foreground">
                    <PackageSearch
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {variantScanLabel}
                  </div>
                </FormField>

                <FormField
                  label={t('wms.backend.inventory.cycleCount.form.variant', 'Variant / SKU')}
                  required
                  error={fieldErrors.catalogVariantId}
                >
                  <ComboboxInput
                    value={form.catalogVariantId}
                    onChange={(next) => {
                      patchForm({
                        catalogVariantId: next.trim(),
                        lotId: '',
                      })
                    }}
                    loadSuggestions={async (query) => {
                      const options = await loadCatalogVariantOptions(query)
                      registerOptionLabels(options)
                      return options.map((option) => ({
                        value: option.value,
                        label: option.label,
                        description: option.description,
                      }))
                    }}
                    resolveLabel={resolveOptionLabel}
                    placeholder={t(
                      'wms.backend.inventory.cycleCount.form.variantPlaceholder',
                      'Search variant or SKU',
                    )}
                    allowCustomValues={false}
                    disabled={loadingBalance || submitting}
                  />
                </FormField>

                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField
                    label={t('wms.backend.inventory.cycleCount.form.location', 'Location')}
                    required
                    error={fieldErrors.locationId}
                  >
                    <ComboboxInput
                      value={form.locationId}
                      onChange={(next) => patchForm({ locationId: next.trim() })}
                      loadSuggestions={async (query) => {
                        const options = await loadLocationOptions(form.warehouseId, query)
                        registerOptionLabels(options)
                        return options.map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))
                      }}
                      resolveLabel={resolveOptionLabel}
                      placeholder={t(
                        'wms.backend.inventory.cycleCount.form.locationPlaceholder',
                        'Select location',
                      )}
                      allowCustomValues={false}
                      disabled={loadingBalance || submitting || !form.warehouseId}
                    />
                  </FormField>

                  <FormField
                    label={t('wms.backend.inventory.cycleCount.form.lot', 'Lot')}
                    error={fieldErrors.lotId}
                  >
                    <ComboboxInput
                      value={form.lotId}
                      onChange={(next) => patchForm({ lotId: next.trim() })}
                      loadSuggestions={async (query) => {
                        const options = await loadLotOptions(form.catalogVariantId, query)
                        registerOptionLabels(options)
                        return options.map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))
                      }}
                      resolveLabel={resolveOptionLabel}
                      placeholder={t(
                        'wms.backend.inventory.cycleCount.form.lotPlaceholder',
                        'Select lot (optional)',
                      )}
                      allowCustomValues={false}
                      disabled={loadingBalance || submitting || !form.catalogVariantId}
                    />
                  </FormField>
                </div>

                <FormField
                  label={t('wms.backend.inventory.cycleCount.form.counted', 'Counted')}
                  required
                  error={fieldErrors.countedQuantity}
                >
                  <div className="flex w-28 items-center gap-2 rounded-md border bg-background p-2 shadow-xs">
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t(
                        'wms.backend.inventory.cycleCount.form.decrease',
                        'Decrease quantity',
                      )}
                      onClick={() => adjustCounted(-1)}
                      disabled={loadingBalance || submitting}
                    >
                      <Minus className="size-4" />
                    </IconButton>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={String(form.countedQuantity)}
                      onChange={(event) => {
                        const parsed = Number(event.target.value)
                        if (!Number.isFinite(parsed) || parsed < 0) return
                        patchForm({ countedQuantity: parsed })
                      }}
                      className="h-8 border-0 bg-transparent px-0 text-center shadow-none focus-visible:ring-0"
                      disabled={loadingBalance || submitting}
                    />
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t(
                        'wms.backend.inventory.cycleCount.form.increase',
                        'Increase quantity',
                      )}
                      onClick={() => adjustCounted(1)}
                      disabled={loadingBalance || submitting}
                    >
                      <Plus className="size-4" />
                    </IconButton>
                  </div>
                </FormField>

                <FormField label={t('wms.backend.inventory.cycleCount.form.countNotes', 'Notes')}>
                  <Textarea
                    value={form.countNotes}
                    onChange={(event) => patchForm({ countNotes: event.target.value })}
                    placeholder={t(
                      'wms.backend.inventory.cycleCount.form.countNotesPlaceholder',
                      'Optional — defects, packaging notes',
                    )}
                    rows={3}
                    disabled={loadingBalance || submitting}
                  />
                </FormField>

                {form.catalogVariantId && form.locationId ? (
                  <SummaryPanel
                    title={t('wms.backend.inventory.cycleCount.review.progress.title', 'Progress')}
                  >
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {t(
                          'wms.backend.inventory.cycleCount.review.progress.summary',
                          'System {system} · Counted {counted}',
                          {
                            system: systemOnHand,
                            counted: form.countedQuantity,
                          },
                        )}
                      </p>
                      {variance === 0 ? (
                        <StatusBadge variant="success">
                          {t('wms.backend.inventory.cycleCount.review.progress.match', 'Match')}
                        </StatusBadge>
                      ) : (
                        <StatusBadge variant="info">
                          {formatSignedQuantity(variance)}
                        </StatusBadge>
                      )}
                    </div>
                    {loadingBalance ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t(
                          'wms.backend.inventory.cycleCount.review.progress.loading',
                          'Refreshing balance…',
                        )}
                      </p>
                    ) : null}
                    {balanceError ? (
                      <p className="mt-1 text-xs text-status-warning-fg">{balanceError}</p>
                    ) : null}
                  </SummaryPanel>
                ) : null}
              </>
            ) : null}

            {step === 3 ? (
              <>
                <FormField
                  label={t(
                    'wms.backend.inventory.cycleCount.review.totalCounted',
                    'Total counted',
                  )}
                >
                  <div className="rounded-md bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
                    {t(
                      'wms.backend.inventory.cycleCount.review.totalCountedSummary',
                      '{counted} units · {location} · {variant}',
                      {
                        counted: form.countedQuantity,
                        location: locationLabel,
                        variant: variantLabel,
                      },
                    )}
                  </div>
                </FormField>

                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField
                    label={t('wms.backend.inventory.cycleCount.review.matches', 'Matches')}
                  >
                    <div className="rounded-md border bg-background px-3 py-2.5 text-sm text-foreground">
                      {variance === 0
                        ? t(
                            'wms.backend.inventory.cycleCount.review.matchesWithinTolerance',
                            'Within tolerance',
                          )
                        : t('wms.backend.inventory.cycleCount.review.matchesNone', 'No match')}
                    </div>
                  </FormField>

                  <FormField
                    label={t('wms.backend.inventory.cycleCount.review.variances', 'Variances')}
                  >
                    <div className="rounded-md border bg-background px-3 py-2.5 text-sm text-foreground">
                      {variance === 0
                        ? t('wms.backend.inventory.cycleCount.review.variancesNone', 'None')
                        : formatSignedQuantity(variance)}
                    </div>
                  </FormField>
                </div>

                {variance !== 0 ? (
                  <FormField
                    label={t('wms.backend.inventory.cycleCount.review.varianceDetail', 'Variance')}
                  >
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        {locationLabel} · {variantLabel}
                        {form.lotId ? ` · ${lotLabel}` : ''}
                      </p>
                      <div className="rounded-md border bg-background px-3 py-2.5 text-sm text-foreground">
                        {t(
                          'wms.backend.inventory.cycleCount.review.varianceLine',
                          'Counted {counted} vs expected {expected} · {delta}',
                          {
                            counted: form.countedQuantity,
                            expected: systemOnHand,
                            delta: formatSignedQuantity(variance),
                          },
                        )}
                      </div>
                    </div>
                  </FormField>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t(
                      'wms.backend.inventory.cycleCount.review.noVariance',
                      'Counts match the ledger. Posting will not create a movement.',
                    )}
                  </p>
                )}

                <FormField
                  label={t(
                    'wms.backend.inventory.cycleCount.form.autoAdjust',
                    'Auto-adjust on commit',
                  )}
                  required={variance !== 0}
                >
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={autoAdjust}
                      onCheckedChange={setAutoAdjust}
                      disabled={submitting || variance === 0}
                    />
                    <p className="text-sm font-medium text-foreground">
                      {variance === 0
                        ? t(
                            'wms.backend.inventory.cycleCount.form.autoAdjustNoVariance',
                            'No ledger write required — counts match.',
                          )
                        : autoAdjust
                          ? t(
                              'wms.backend.inventory.cycleCount.form.autoAdjustHint',
                              'Yes — writes a cycle-count movement on commit',
                            )
                          : t(
                              'wms.backend.inventory.cycleCount.form.autoAdjustHintOff',
                              'No — ledger unchanged on commit',
                            )}
                    </p>
                  </div>
                </FormField>

                <FormField
                  label={t('wms.backend.inventory.cycleCount.form.reason', 'Reason')}
                  required
                  error={fieldErrors.reason}
                >
                  <Textarea
                    value={form.reason}
                    onChange={(event) => patchForm({ reason: event.target.value })}
                    placeholder={t(
                      'wms.backend.inventory.cycleCount.form.reasonPlaceholder',
                      'Required for variances — auditor context',
                    )}
                    rows={3}
                    disabled={submitting}
                  />
                </FormField>

                <SummaryPanel
                  title={t(
                    'wms.backend.inventory.cycleCount.review.commitSummary.title',
                    'Commit summary',
                  )}
                >
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {variance === 0 || !autoAdjust
                        ? t(
                            'wms.backend.inventory.cycleCount.review.commitSummary.noMovement',
                            'No movement · ledger unchanged',
                          )
                        : t(
                            'wms.backend.inventory.cycleCount.review.commitSummary.movement',
                            '{delta} net · 1 ledger write',
                            { delta: formatSignedQuantity(variance) },
                          )}
                    </p>
                    <StatusBadge variant="success">
                      {t('wms.backend.inventory.cycleCount.review.commitSummary.ready', 'Ready')}
                    </StatusBadge>
                  </div>
                </SummaryPanel>
              </>
            ) : null}
          </div>

          <DialogFooter className="border-t px-6 py-4 sm:justify-between">
            <p className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1.5">
              <KbdShortcut keys={['⌘', 'Enter']} />
              <span>/</span>
              <KbdShortcut keys={['Ctrl', 'Enter']} />
              <span>{shortcutHint}</span>
            </p>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              {step === 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDialog}
                  disabled={loadingBalance || submitting}
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep((current) => (current === 3 ? 2 : 1))}
                  disabled={loadingBalance || submitting}
                >
                  {t('wms.backend.inventory.cycleCount.steps.back', 'Back')}
                </Button>
              )}
              {step === 2 && linesPosted > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDialog}
                  disabled={loadingBalance || submitting}
                >
                  {t(
                    'wms.backend.inventory.cycleCount.steps.counting.finish',
                    'Finish session ({count})',
                    { count: linesPosted },
                  )}
                </Button>
              ) : null}
              <Button type="submit" disabled={primaryDisabled}>
                {step === 1
                  ? t(
                      'wms.backend.inventory.cycleCount.steps.setup.submit',
                      'Start counting',
                    )
                  : step === 2
                    ? t(
                        'wms.backend.inventory.cycleCount.steps.counting.submit',
                        'Review variances',
                      )
                    : t(
                        'wms.backend.inventory.cycleCount.steps.review.submit',
                        'Commit & count next',
                      )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
