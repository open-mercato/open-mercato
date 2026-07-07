"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Package } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
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
import { Input } from '@open-mercato/ui/primitives/input'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildInventoryMutationReferenceId, parseInventoryQuantity } from '../../lib/inventoryMutationUi'
import {
  BalanceLookupError,
  fetchBalanceAvailable,
  fetchLocationCapacitySnapshot,
  loadCatalogVariantOptions,
  loadLocationOptions,
  loadWarehouseOptions,
  resolveCatalogVariantLabel,
  resolveLocationLabel,
  resolveWarehouseLabel,
  type LocationCapacitySnapshot,
} from './inventoryMutationLoaders'
import type { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

const MOVE_REASON_CODES = ['transfer', 'replenishment', 'consolidation', 'correction', 'other'] as const

type MoveReasonCode = (typeof MOVE_REASON_CODES)[number]

type MoveFormValues = {
  catalogVariantId: string
  warehouseId: string
  fromLocationId: string
  toLocationId: string
  quantity: number
  reasonCode: MoveReasonCode | ''
  notes: string
}

type MoveInventoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: ReturnType<typeof useWmsInventoryMutationAccess>
  initialCatalogVariantId?: string
  initialWarehouseId?: string
  initialFromLocationId?: string
  initialLotId?: string
  initialAvailable?: number | null
  lockSourceContext?: boolean
  movementType?: 'putaway' | 'transfer'
}

const EMPTY_FORM: MoveFormValues = {
  catalogVariantId: '',
  warehouseId: '',
  fromLocationId: '',
  toLocationId: '',
  quantity: 1,
  reasonCode: '',
  notes: '',
}

function parseQuantityInputForSubmit(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '-' || trimmed === '+') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export function MoveInventoryDialog({
  open,
  onOpenChange,
  access,
  initialCatalogVariantId,
  initialWarehouseId,
  initialFromLocationId,
  initialLotId,
  initialAvailable,
  lockSourceContext = false,
  movementType = 'transfer',
}: MoveInventoryDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const lotIdRef = React.useRef<string | undefined>(undefined)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-inventory-move',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )
  const moveFormSchema = React.useMemo(
    () =>
      z
        .object({
          catalogVariantId: z.string().uuid(),
          warehouseId: z.string().uuid(),
          fromLocationId: z.string().uuid(),
          toLocationId: z.string().uuid(),
          quantity: z.coerce.number().positive({
            message: t(
              'wms.backend.inventory.move.errors.quantityPositive',
              'Move quantity must be greater than zero.',
            ),
          }),
          reasonCode: z.enum(MOVE_REASON_CODES),
          notes: z.string().trim().max(500).optional(),
        })
        .superRefine((values, ctx) => {
          if (values.fromLocationId === values.toLocationId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['toLocationId'],
              message: t(
                'wms.backend.inventory.move.errors.sameLocation',
                'Destination must differ from the source location.',
              ),
            })
          }
        }),
    [t],
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState<MoveFormValues>(EMPTY_FORM)
  const [quantityInput, setQuantityInput] = React.useState('1')
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [available, setAvailable] = React.useState<number | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = React.useState(false)
  const [destAvailable, setDestAvailable] = React.useState<number | null>(null)
  const [loadingDestPreview, setLoadingDestPreview] = React.useState(false)
  const [destCapacity, setDestCapacity] = React.useState<LocationCapacitySnapshot | null>(null)
  const [loadingDestCapacity, setLoadingDestCapacity] = React.useState(false)
  const [optionLabelByValue, setOptionLabelByValue] = React.useState<Record<string, string>>({})

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

  const reasonLabel = React.useCallback(
    (code: MoveReasonCode) => {
      const fallbacks: Record<MoveReasonCode, string> = {
        transfer: 'Transfer',
        replenishment: 'Replenishment',
        consolidation: 'Consolidation',
        correction: 'Correction',
        other: 'Other',
      }
      return t(`wms.backend.inventory.move.reasons.${code}`, fallbacks[code])
    },
    [t],
  )

  const resetDialog = React.useCallback(() => {
    setForm(EMPTY_FORM)
    setQuantityInput('1')
    setFieldErrors({})
    setAvailable(null)
    setPreviewError(null)
    setLoadingPreview(false)
    setSubmitting(false)
    setOptionLabelByValue({})
    lotIdRef.current = undefined
  }, [])

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
    resetDialog()
  }, [onOpenChange, resetDialog])

  const patchForm = React.useCallback((patch: Partial<MoveFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setFieldErrors({})
  }, [])

  React.useEffect(() => {
    if (!open) {
      resetDialog()
      return
    }

    const catalogVariantId = initialCatalogVariantId?.trim() ?? ''
    const warehouseId = initialWarehouseId?.trim() ?? ''
    const fromLocationId = initialFromLocationId?.trim() ?? ''
    const lotId = initialLotId?.trim()
    lotIdRef.current = lotId || undefined
    if (!catalogVariantId && !warehouseId && !fromLocationId) return

    const presetQuantity =
      initialAvailable != null && initialAvailable > 0
        ? Math.min(1, initialAvailable)
        : 1

    setForm({
      ...EMPTY_FORM,
      catalogVariantId,
      warehouseId,
      fromLocationId,
      quantity: presetQuantity,
    })
    setQuantityInput(String(presetQuantity))
    setFieldErrors({})
    setPreviewError(null)
    if (initialAvailable != null) {
      setAvailable(parseInventoryQuantity(initialAvailable))
    }
  }, [
    initialAvailable,
    initialCatalogVariantId,
    initialFromLocationId,
    initialLotId,
    initialWarehouseId,
    open,
    resetDialog,
  ])

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
      ensureLabel(form.warehouseId, resolveWarehouseLabel),
      ensureLabel(form.fromLocationId, resolveLocationLabel),
      ensureLabel(form.toLocationId, resolveLocationLabel),
    ])

    return () => {
      cancelled = true
    }
  }, [
    form.catalogVariantId,
    form.fromLocationId,
    form.toLocationId,
    form.warehouseId,
    open,
    registerOptionLabels,
  ])

  const previewContextReady = Boolean(
    form.catalogVariantId.trim() &&
      form.warehouseId.trim() &&
      form.fromLocationId.trim(),
  )

  React.useEffect(() => {
    if (!open || !previewContextReady) {
      if (!open) return
      if (!previewContextReady) {
        setAvailable(null)
        setPreviewError(null)
        setLoadingPreview(false)
      }
      return
    }
    let cancelled = false
    setLoadingPreview(true)
    setPreviewError(null)
    void fetchBalanceAvailable({
      warehouseId: form.warehouseId.trim(),
      locationId: form.fromLocationId.trim(),
      catalogVariantId: form.catalogVariantId.trim(),
      lotId: lotIdRef.current,
    })
      .then((value) => {
        if (cancelled) return
        setAvailable(value)
        setPreviewError(null)
        setForm((current) => {
          const nextQuantity =
            value > 0 && current.quantity > value
              ? value
              : current.quantity > 0
                ? current.quantity
                : 1
          setQuantityInput(String(nextQuantity))
          return {
            ...current,
            quantity: nextQuantity,
          }
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setAvailable(null)
        if (error instanceof BalanceLookupError) {
          setPreviewError(
            t(
              'wms.backend.inventory.move.errors.previewBalance',
              'Failed to load available quantity.',
            ),
          )
          return
        }
        console.error('[MoveInventoryDialog] fetchBalanceAvailable failed', error)
        setPreviewError(
          t(
            'wms.backend.inventory.move.errors.previewBalance',
            'Failed to load available quantity.',
          ),
        )
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    form.catalogVariantId,
    form.fromLocationId,
    form.warehouseId,
    open,
    previewContextReady,
    t,
  ])

  const destPreviewContextReady = Boolean(
    form.catalogVariantId.trim() &&
      form.warehouseId.trim() &&
      form.toLocationId.trim(),
  )

  React.useEffect(() => {
    if (!open || !destPreviewContextReady) {
      setDestAvailable(null)
      setLoadingDestPreview(false)
      return
    }
    let cancelled = false
    setLoadingDestPreview(true)
    void fetchBalanceAvailable({
      warehouseId: form.warehouseId.trim(),
      locationId: form.toLocationId.trim(),
      catalogVariantId: form.catalogVariantId.trim(),
    })
      .then((value) => {
        if (cancelled) return
        setDestAvailable(value)
      })
      .catch(() => {
        if (cancelled) return
        setDestAvailable(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingDestPreview(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    destPreviewContextReady,
    form.catalogVariantId,
    form.toLocationId,
    form.warehouseId,
    open,
  ])

  React.useEffect(() => {
    if (!open || !form.warehouseId.trim() || !form.toLocationId.trim()) {
      setDestCapacity(null)
      setLoadingDestCapacity(false)
      return
    }
    let cancelled = false
    setLoadingDestCapacity(true)
    void fetchLocationCapacitySnapshot({
      warehouseId: form.warehouseId.trim(),
      locationId: form.toLocationId.trim(),
    })
      .then((snapshot) => {
        if (cancelled) return
        setDestCapacity(snapshot)
      })
      .catch(() => {
        if (cancelled) return
        setDestCapacity(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingDestCapacity(false)
      })
    return () => {
      cancelled = true
    }
  }, [form.toLocationId, form.warehouseId, open])

  const destCapacityExcess = React.useMemo(() => {
    if (destCapacity?.capacityUnits == null) return 0
    const quantity = parseQuantityInputForSubmit(quantityInput) ?? 0
    return Math.max(0, destCapacity.totalOnHand + quantity - destCapacity.capacityUnits)
  }, [destCapacity, quantityInput])

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      const quantity = parseQuantityInputForSubmit(quantityInput)
      if (quantity == null) {
        setFieldErrors({
          quantity: t(
            'wms.backend.inventory.move.errors.quantityPositive',
            'Move quantity must be greater than zero.',
          ),
        })
        return
      }

      const parsed = moveFormSchema.safeParse({
        ...form,
        quantity,
        notes: form.notes.trim() || undefined,
      })
      if (!parsed.success) {
        const nextErrors: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? 'form')
          if (!nextErrors[key]) nextErrors[key] = issue.message
        }
        setFieldErrors(nextErrors)
        return
      }

      if (available != null && parsed.data.quantity > available + 0.000001) {
        setFieldErrors({
          quantity: t(
            'wms.backend.inventory.move.errors.insufficientAvailable',
            'Quantity exceeds available stock at the source location.',
          ),
        })
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

      setSubmitting(true)
      try {
        const reason = reasonLabel(parsed.data.reasonCode)
        const notes = parsed.data.notes?.trim()
        const payload: Record<string, unknown> = {
          organizationId: access.organizationId,
          tenantId: access.tenantId,
          warehouseId: parsed.data.warehouseId,
          fromLocationId: parsed.data.fromLocationId,
          toLocationId: parsed.data.toLocationId,
          catalogVariantId: parsed.data.catalogVariantId,
          quantity: parsed.data.quantity,
          reason,
          reasonCode: parsed.data.reasonCode,
          referenceType: 'manual',
          referenceId: buildInventoryMutationReferenceId(),
          performedBy: access.userId,
          type: movementType,
        }
        if (lotIdRef.current) payload.lotId = lotIdRef.current
        if (notes) payload.metadata = { notes }

        await runMutation({
          operation: async () => {
            const call = await apiCall<{ ok?: boolean; movementId?: string }>(
              '/api/wms/inventory/move',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              },
            )
            if (!call.ok) {
              await raiseCrudError(
                call.response,
                t('wms.backend.inventory.move.errors.submit', 'Failed to move inventory.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: payload,
        })

        flash(t('wms.backend.inventory.move.flash.success', 'Inventory moved'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['wms-inventory-console'] })
        await queryClient.invalidateQueries({ queryKey: ['wms-sku-detail'] })
        await queryClient.invalidateQueries({ queryKey: ['wms-location-detail'] })
        await queryClient.invalidateQueries({ queryKey: ['wms-lot-detail'] })
        closeDialog()
      } finally {
        setSubmitting(false)
      }
    },
    [
      access,
      available,
      closeDialog,
      form,
      moveFormSchema,
      quantityInput,
      mutationContext,
      movementType,
      queryClient,
      reasonLabel,
      runMutation,
      t,
    ],
  )

  const sourceLocked = lockSourceContext
  const submitDisabled = submitting || access.loading || !access.scopeReady

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!submitDisabled) void handleSubmit()
      }
    },
    [closeDialog, handleSubmit, submitDisabled],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>
              {movementType === 'putaway'
                ? t('wms.backend.inventory.move.dialog.titlePutaway', 'Put away to final bin')
                : t('wms.backend.inventory.move.dialog.title', 'Move inventory')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'wms.backend.inventory.move.dialog.description',
                'Transfer available stock between locations within the same warehouse.',
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
            <FormField
              label={t('wms.backend.inventory.move.form.variant', 'Variant')}
              required
              error={fieldErrors.catalogVariantId}
            >
              <div className="relative [&_input]:pl-9">
                <Package
                  className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <ComboboxInput
                  value={form.catalogVariantId}
                  onChange={(next) => patchForm({ catalogVariantId: next.trim() })}
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
                    'wms.backend.inventory.move.form.variantPlaceholder',
                    'Search variant or SKU',
                  )}
                  allowCustomValues={false}
                  disabled={submitting || sourceLocked}
                />
              </div>
            </FormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label={t('wms.backend.inventory.move.form.warehouse', 'Warehouse')}
                required
                error={fieldErrors.warehouseId}
              >
                <ComboboxInput
                  value={form.warehouseId}
                  onChange={(next) => {
                    patchForm({
                      warehouseId: next.trim(),
                      fromLocationId: '',
                      toLocationId: '',
                    })
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
                    'wms.backend.inventory.move.form.warehousePlaceholder',
                    'Select warehouse',
                  )}
                  allowCustomValues={false}
                  disabled={submitting || sourceLocked}
                />
              </FormField>

              <FormField
                label={t('wms.backend.inventory.move.form.fromLocation', 'From location')}
                required
                error={fieldErrors.fromLocationId}
              >
                <ComboboxInput
                  value={form.fromLocationId}
                  onChange={(next) => patchForm({ fromLocationId: next.trim() })}
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
                    'wms.backend.inventory.move.form.fromLocationPlaceholder',
                    'Select source location',
                  )}
                  allowCustomValues={false}
                  disabled={submitting || !form.warehouseId || sourceLocked}
                />
              </FormField>
            </div>

            <FormField
              label={t('wms.backend.inventory.move.form.toLocation', 'To location')}
              required
              error={fieldErrors.toLocationId}
            >
              <ComboboxInput
                value={form.toLocationId}
                onChange={(next) => patchForm({ toLocationId: next.trim() })}
                loadSuggestions={async (query) => {
                  const scopedWarehouseId = form.warehouseId.trim() || initialWarehouseId?.trim() || ''
                  const options = await loadLocationOptions(scopedWarehouseId, query)
                  registerOptionLabels(options)
                  return options
                    .filter((option) => option.value !== form.fromLocationId)
                    .map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))
                }}
                resolveLabel={resolveOptionLabel}
                placeholder={t(
                  'wms.backend.inventory.move.form.toLocationPlaceholder',
                  'Select destination location',
                )}
                allowCustomValues={false}
                disabled={submitting || !form.warehouseId}
              />
            </FormField>

            <FormField
              label={t('wms.backend.inventory.move.form.quantity', 'Quantity')}
              required
              error={fieldErrors.quantity}
            >
              <Input
                type="number"
                inputMode="decimal"
                min="0.001"
                step="any"
                value={quantityInput}
                onChange={(event) => {
                  setQuantityInput(event.target.value)
                  setFieldErrors((current) => {
                    if (!current.quantity) return current
                    const next = { ...current }
                    delete next.quantity
                    return next
                  })
                }}
                disabled={submitting}
              />
            </FormField>

            <FormField
              label={t('wms.backend.inventory.move.form.reason', 'Reason')}
              required
              error={fieldErrors.reasonCode}
            >
              <Select
                value={form.reasonCode || undefined}
                onValueChange={(next) => patchForm({ reasonCode: next as MoveReasonCode })}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      'wms.backend.inventory.move.form.reasonPlaceholder',
                      'Select reason',
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {MOVE_REASON_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {reasonLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label={t('wms.backend.inventory.move.form.notes', 'Notes')}>
              <Textarea
                value={form.notes}
                onChange={(event) => patchForm({ notes: event.target.value })}
                placeholder={t(
                  'wms.backend.inventory.move.form.notesPlaceholder',
                  'Optional — context for auditors',
                )}
                rows={3}
                disabled={submitting}
              />
            </FormField>

            {previewContextReady ? (
              <div className="rounded-lg border bg-muted/40 px-4 py-3.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('wms.backend.inventory.move.preview.title', 'Source availability')}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  {previewError ? (
                    <p className="text-sm text-status-warning-fg">{previewError}</p>
                  ) : loadingPreview && available == null ? (
                    <p className="text-sm text-muted-foreground">
                      {t('wms.backend.inventory.move.preview.loading', 'Refreshing availability…')}
                    </p>
                  ) : available != null ? (
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {t('wms.backend.inventory.move.preview.availableLabel', 'Available')}{' '}
                      {available}
                    </p>
                  ) : null}
                </div>
                {destPreviewContextReady && form.toLocationId !== form.fromLocationId ? (
                  <div className="mt-2 border-t pt-2">
                    <p className="text-xs text-muted-foreground mb-1">
                      {t('wms.backend.inventory.move.preview.destTitle', 'Destination current stock')}
                    </p>
                    {loadingDestPreview && destAvailable == null ? (
                      <p className="text-sm text-muted-foreground">
                        {t('wms.backend.inventory.move.preview.destLoading', 'Loading destination…')}
                      </p>
                    ) : destAvailable != null ? (
                      <p className="text-sm tabular-nums text-muted-foreground">
                        {destAvailable}{' '}
                        {t('wms.backend.inventory.move.preview.destUnit', 'units already here')}
                      </p>
                    ) : (
                      <p className="text-sm tabular-nums text-muted-foreground">
                        {t('wms.backend.inventory.move.preview.destEmpty', '0 units (empty bin)')}
                      </p>
                    )}
                    {loadingDestCapacity && destCapacity == null ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t(
                          'wms.backend.inventory.move.preview.capacityLoading',
                          'Loading destination capacity…',
                        )}
                      </p>
                    ) : destCapacity?.capacityUnits != null ? (
                      <p
                        className={`mt-1 text-sm tabular-nums ${
                          destCapacityExcess > 0 ? 'text-status-warning-fg' : 'text-muted-foreground'
                        }`}
                      >
                        {t(
                          'wms.backend.inventory.move.preview.capacity',
                          '{used} / {capacity} units used · {remaining} remaining',
                          {
                            used: destCapacity.totalOnHand,
                            capacity: destCapacity.capacityUnits,
                            remaining: destCapacity.capacityUnits - destCapacity.totalOnHand,
                          },
                        )}
                      </p>
                    ) : destCapacity ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t(
                          'wms.backend.inventory.move.preview.capacityUnset',
                          'No capacity limit set for this location.',
                        )}
                      </p>
                    ) : null}
                    {destCapacityExcess > 0 ? (
                      <p className="mt-1 text-sm text-status-warning-fg">
                        {t(
                          'wms.backend.inventory.move.preview.capacityExceeded',
                          'This move would exceed the destination capacity by {quantity} unit(s).',
                          { quantity: destCapacityExcess },
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter className="border-t px-6 py-4 sm:justify-between">
            <p className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1.5">
              <KbdShortcut keys={['⌘', 'Enter']} />
              <span>/</span>
              <KbdShortcut keys={['Ctrl', 'Enter']} />
              <span>{t('wms.backend.inventory.move.dialog.shortcutSave', 'to save')}</span>
            </p>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={submitDisabled} data-testid="wms-inventory-move-submit">
                {t('wms.backend.inventory.move.dialog.submit', 'Move stock')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
