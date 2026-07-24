"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { Minus, Package, Plus } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flashMutationError } from '../../lib/flashMutationError'
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
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildInventoryMutationReferenceId } from '../../lib/inventoryMutationUi'
import {
  BalanceLookupError,
  ensureLotIdForInventoryMutation,
  fetchBalanceOnHand,
  fetchVariantReorderPoint,
  findLotIdByNumber,
  InventoryLotMutationError,
  loadCatalogVariantOptions,
  loadLocationOptions,
  loadLotNumberOptions,
  loadWarehouseOptions,
  resolveCatalogVariantLabel,
  resolveLocationLabel,
  resolveLotNumberFromId,
  resolveWarehouseLabel,
} from './inventoryMutationLoaders'
import type { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

const ADJUST_REASON_CODES = ['damaged', 'shrinkage', 'found', 'correction', 'other'] as const

type AdjustReasonCode = (typeof ADJUST_REASON_CODES)[number]

type AdjustFormValues = {
  catalogVariantId: string
  warehouseId: string
  locationId: string
  lotNumber: string
  delta: number
  reasonCode: AdjustReasonCode | ''
  notes: string
  serialNumber: string
}

type AdjustInventoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: ReturnType<typeof useWmsInventoryMutationAccess>
  initialCatalogVariantId?: string
  initialWarehouseId?: string
  initialLocationId?: string
  initialLotId?: string
}

const EMPTY_FORM: AdjustFormValues = {
  catalogVariantId: '',
  warehouseId: '',
  locationId: '',
  lotNumber: '',
  delta: 1,
  reasonCode: '',
  notes: '',
  serialNumber: '',
}

function parseDeltaInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '-' || trimmed === '+') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function AdjustInventoryDialog({
  open,
  onOpenChange,
  access,
  initialCatalogVariantId,
  initialWarehouseId,
  initialLocationId,
  initialLotId,
}: AdjustInventoryDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const formRef = React.useRef<HTMLFormElement>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-inventory-adjust',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )
  const adjustFormSchema = React.useMemo(
    () =>
      z.object({
        catalogVariantId: z.string().uuid(),
        warehouseId: z.string().uuid(),
        locationId: z.string().uuid(),
        lotNumber: z.string().trim().max(120).optional(),
        delta: z.coerce.number().refine((value) => value !== 0, {
          message: t(
            'wms.backend.inventory.adjust.errors.deltaZero',
            'Inventory delta must be non-zero.',
          ),
        }),
        reasonCode: z.enum(ADJUST_REASON_CODES),
        notes: z.string().trim().max(500).optional(),
        serialNumber: z.string().trim().max(120).optional(),
      }),
    [t],
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState<AdjustFormValues>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [onHand, setOnHand] = React.useState<number | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [reorderPoint, setReorderPoint] = React.useState(0)
  const [loadingPreview, setLoadingPreview] = React.useState(false)
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
    (code: AdjustReasonCode) => {
      const fallbacks: Record<AdjustReasonCode, string> = {
        damaged: 'Damaged',
        shrinkage: 'Shrinkage',
        found: 'Found stock',
        correction: 'Correction',
        other: 'Other',
      }
      return t(`wms.backend.inventory.adjust.reasons.${code}`, fallbacks[code])
    },
    [t],
  )

  const resetDialog = React.useCallback(() => {
    setForm(EMPTY_FORM)
    setFieldErrors({})
    setOnHand(null)
    setPreviewError(null)
    setReorderPoint(0)
    setLoadingPreview(false)
    setSubmitting(false)
    setOptionLabelByValue({})
  }, [])

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
    resetDialog()
  }, [onOpenChange, resetDialog])

  const patchForm = React.useCallback((patch: Partial<AdjustFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setFieldErrors({})
  }, [])

  React.useEffect(() => {
    if (!open) return
    const catalogVariantId = initialCatalogVariantId?.trim()
    const warehouseId = initialWarehouseId?.trim()
    const locationId = initialLocationId?.trim()
    const lotId = initialLotId?.trim()
    if (!catalogVariantId && !warehouseId && !locationId && !lotId) return
    setForm((current) => ({
      ...current,
      ...(catalogVariantId ? { catalogVariantId } : {}),
      ...(warehouseId ? { warehouseId, locationId: locationId ?? '' } : {}),
      ...(locationId ? { locationId } : {}),
    }))
    if (!lotId) return
    let cancelled = false
    void resolveLotNumberFromId(lotId).then((lotNumber) => {
      if (cancelled || !lotNumber) return
      setForm((current) => ({ ...current, lotNumber }))
      registerOptionLabels([{ value: lotNumber, label: lotNumber }])
    })
    return () => {
      cancelled = true
    }
  }, [
    initialCatalogVariantId,
    initialLocationId,
    initialLotId,
    initialWarehouseId,
    open,
    registerOptionLabels,
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
      ensureLabel(form.locationId, resolveLocationLabel),
    ])

    return () => {
      cancelled = true
    }
  }, [
    form.catalogVariantId,
    form.locationId,
    form.warehouseId,
    open,
    registerOptionLabels,
  ])

  React.useEffect(() => {
    if (!open) return
    const variantId = form.catalogVariantId.trim()
    if (!variantId) {
      setReorderPoint(0)
      return
    }
    let cancelled = false
    void fetchVariantReorderPoint(variantId).then((value) => {
      if (!cancelled) setReorderPoint(value)
    })
    return () => {
      cancelled = true
    }
  }, [form.catalogVariantId, open])

  const previewContextReady = Boolean(
    form.catalogVariantId.trim() &&
      form.warehouseId.trim() &&
      form.locationId.trim(),
  )

  React.useEffect(() => {
    if (!open) return
    const warehouseId = form.warehouseId.trim()
    const locationId = form.locationId.trim()
    const catalogVariantId = form.catalogVariantId.trim()
    const lotNumber = form.lotNumber.trim()
    if (!warehouseId || !locationId || !catalogVariantId) {
      setOnHand(null)
      setPreviewError(null)
      setLoadingPreview(false)
      return
    }
    let cancelled = false
    setLoadingPreview(true)
    setPreviewError(null)
    void (async () => {
      try {
        const lotId = lotNumber
          ? await findLotIdByNumber(catalogVariantId, lotNumber)
          : null
        if (cancelled) return
        const value = await fetchBalanceOnHand({
          warehouseId,
          locationId,
          catalogVariantId,
          lotId,
        })
        if (!cancelled) {
          setOnHand(value)
          setPreviewError(null)
        }
      } catch (error: unknown) {
        if (cancelled) return
        setOnHand(null)
        if (error instanceof BalanceLookupError) {
          setPreviewError(
            t(
              'wms.backend.inventory.adjust.errors.previewBalance',
              'Failed to load balance preview.',
            ),
          )
          return
        }
        console.error('[AdjustInventoryDialog] fetchBalanceOnHand failed', error)
        setPreviewError(
          t(
            'wms.backend.inventory.adjust.errors.previewBalance',
            'Failed to load balance preview.',
          ),
        )
      } finally {
        if (!cancelled) setLoadingPreview(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    form.catalogVariantId,
    form.locationId,
    form.lotNumber,
    form.warehouseId,
    open,
    t,
  ])

  const projectedOnHand =
    onHand != null && form.delta !== 0 ? onHand + form.delta : null
  const showBelowReorder =
    projectedOnHand != null && reorderPoint > 0 && projectedOnHand <= reorderPoint

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      const parsed = adjustFormSchema.safeParse({
        ...form,
        lotNumber: form.lotNumber.trim() || undefined,
        notes: form.notes.trim() || undefined,
        serialNumber: form.serialNumber.trim() || undefined,
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
      const lotNumber = parsed.data.lotNumber?.trim()
      let lotId: string | undefined
      if (lotNumber) {
        try {
          lotId = await ensureLotIdForInventoryMutation({
            catalogVariantId: parsed.data.catalogVariantId,
            lotNumber,
            organizationId: access.organizationId,
            tenantId: access.tenantId,
          })
        } catch (error: unknown) {
          const message =
            error instanceof InventoryLotMutationError
              ? error.message
              : t(
                  'wms.backend.inventory.adjust.errors.lot',
                  'Failed to resolve inventory lot.',
                )
          setFieldErrors({ lotNumber: message })
          return
        }
      }
      const payload: Record<string, unknown> = {
        organizationId: access.organizationId,
        tenantId: access.tenantId,
        warehouseId: parsed.data.warehouseId,
        locationId: parsed.data.locationId,
        catalogVariantId: parsed.data.catalogVariantId,
        delta: parsed.data.delta,
        reason,
        reasonCode: parsed.data.reasonCode,
        referenceType: 'manual',
        referenceId: buildInventoryMutationReferenceId(),
        performedBy: access.userId,
      }
        if (lotId) payload.lotId = lotId
        const serial = parsed.data.serialNumber?.trim()
        if (serial) payload.serialNumber = serial
        if (notes) payload.metadata = { notes }

        await runMutation({
          operation: async () => {
            const call = await apiCall<{ ok?: boolean; movementId?: string }>(
              '/api/wms/inventory/adjust',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              },
            )
            if (!call.ok) {
              await raiseCrudError(
                call.response,
                t('wms.backend.inventory.adjust.errors.submit', 'Failed to adjust inventory.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: payload,
        })

        flash(t('wms.backend.inventory.adjust.flash.success', 'Inventory adjusted'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['wms-inventory-console'] })
        await queryClient.invalidateQueries({ queryKey: ['wms-sku-detail'] })
        closeDialog()
      } catch (error) {
        flashMutationError(error, t('wms.backend.inventory.adjust.errors.submit', 'Failed to adjust inventory.'), t)
      } finally {
        setSubmitting(false)
      }
    },
    [
      access,
      adjustFormSchema,
      closeDialog,
      form,
      mutationContext,
      queryClient,
      reasonLabel,
      runMutation,
      t,
    ],
  )

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!submitting) void handleSubmit()
      }
    },
    [closeDialog, handleSubmit, submitting],
  )

  const adjustDelta = React.useCallback((step: -1 | 1) => {
    setForm((current) => {
      const next = current.delta + step
      return { ...current, delta: next === 0 ? step : next }
    })
    setFieldErrors({})
  }, [])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>
              {t('wms.backend.inventory.adjust.dialog.title', 'Adjust inventory')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'wms.backend.inventory.adjust.dialog.description',
                'Append a signed delta to the ledger',
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
            <FormField
              label={t('wms.backend.inventory.adjust.form.variant', 'Variant')}
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
                  onChange={(next) => {
                    patchForm({
                      catalogVariantId: next.trim(),
                      lotNumber: '',
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
                    'wms.backend.inventory.adjust.form.variantPlaceholder',
                    'Search variant or SKU',
                  )}
                  allowCustomValues={false}
                  disabled={submitting}
                />
              </div>
            </FormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label={t('wms.backend.inventory.adjust.form.warehouse', 'Warehouse')}
                required
                error={fieldErrors.warehouseId}
              >
                <ComboboxInput
                  value={form.warehouseId}
                  onChange={(next) => {
                    patchForm({
                      warehouseId: next.trim(),
                      locationId: '',
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
                    'wms.backend.inventory.adjust.form.warehousePlaceholder',
                    'Select warehouse',
                  )}
                  allowCustomValues={false}
                  disabled={submitting}
                />
              </FormField>

              <FormField
                label={t('wms.backend.inventory.adjust.form.location', 'Location')}
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
                    'wms.backend.inventory.adjust.form.locationPlaceholder',
                    'Select location',
                  )}
                  allowCustomValues={false}
                  disabled={submitting || !form.warehouseId}
                />
              </FormField>
            </div>

            <FormField
              label={t('wms.backend.inventory.adjust.form.lot', 'Lot')}
              error={fieldErrors.lotNumber}
            >
              <ComboboxInput
                value={form.lotNumber}
                onChange={(next) => patchForm({ lotNumber: next.trim() })}
                loadSuggestions={async (query) => {
                  const options = await loadLotNumberOptions(form.catalogVariantId, query)
                  registerOptionLabels(options)
                  return options.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))
                }}
                resolveLabel={resolveOptionLabel}
                placeholder={t(
                  'wms.backend.inventory.adjust.form.lotPlaceholder',
                  'Select lot (optional)',
                )}
                allowCustomValues
                disabled={submitting || !form.catalogVariantId}
              />
            </FormField>

            <FormField
              label={t('wms.backend.inventory.adjust.form.serial', 'Serial number')}
              error={fieldErrors.serialNumber}
            >
              <Input
                value={form.serialNumber}
                onChange={(event) => patchForm({ serialNumber: event.target.value })}
                placeholder={t(
                  'wms.backend.inventory.adjust.form.serialPlaceholder',
                  'Optional — for serial-tracked variants',
                )}
                disabled={submitting}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  'wms.backend.inventory.adjust.form.serialHelp',
                  'Use when the variant profile tracks serials.',
                )}
              </p>
            </FormField>

            <FormField
              label={t('wms.backend.inventory.adjust.form.delta', 'Adjustment')}
              required
              error={fieldErrors.delta}
            >
              <div className="flex w-32 items-center gap-2 rounded-md border bg-background p-2 shadow-xs">
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('wms.backend.inventory.adjust.form.decrease', 'Decrease quantity')}
                  onClick={() => adjustDelta(-1)}
                  disabled={submitting}
                >
                  <Minus className="size-4" />
                </IconButton>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={String(form.delta)}
                  onChange={(event) => {
                    const parsed = parseDeltaInput(event.target.value)
                    if (parsed == null) return
                    patchForm({ delta: parsed })
                  }}
                  className="h-8 w-auto min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                  inputClassName="text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  disabled={submitting}
                />
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('wms.backend.inventory.adjust.form.increase', 'Increase quantity')}
                  onClick={() => adjustDelta(1)}
                  disabled={submitting}
                >
                  <Plus className="size-4" />
                </IconButton>
              </div>
            </FormField>

            <FormField
              label={t('wms.backend.inventory.adjust.form.reason', 'Reason')}
              required
              error={fieldErrors.reasonCode}
            >
              <Select
                value={form.reasonCode || undefined}
                onValueChange={(next) =>
                  patchForm({ reasonCode: next as AdjustReasonCode })
                }
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      'wms.backend.inventory.adjust.form.reasonPlaceholder',
                      'Select reason',
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {ADJUST_REASON_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {reasonLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label={t('wms.backend.inventory.adjust.form.notes', 'Notes')}>
              <Textarea
                value={form.notes}
                onChange={(event) => patchForm({ notes: event.target.value })}
                placeholder={t(
                  'wms.backend.inventory.adjust.form.notesPlaceholder',
                  'Optional — context for auditors',
                )}
                rows={3}
                disabled={submitting}
              />
            </FormField>

            {previewContextReady ? (
              <div className="rounded-lg border bg-muted/40 px-4 py-3.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('wms.backend.inventory.adjust.preview.title', 'Balance preview')}
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  {previewError ? (
                    <p className="text-sm text-status-warning-fg">{previewError}</p>
                  ) : loadingPreview && onHand == null ? (
                    <p className="text-sm text-muted-foreground">
                      {t('wms.backend.inventory.adjust.preview.loading', 'Refreshing balance…')}
                    </p>
                  ) : onHand != null && projectedOnHand != null ? (
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {t('wms.backend.inventory.adjust.preview.onHandLabel', 'On hand')}{' '}
                      {onHand}
                      {' → '}
                      {projectedOnHand}
                    </p>
                  ) : onHand != null ? (
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {t('wms.backend.inventory.adjust.preview.onHandLabel', 'On hand')}{' '}
                      {onHand}
                    </p>
                  ) : null}
                  {showBelowReorder ? (
                    <StatusBadge variant="warning">
                      {t(
                        'wms.backend.inventory.adjust.preview.belowReorder',
                        'Below reorder',
                      )}
                    </StatusBadge>
                  ) : null}
                </div>
                {loadingPreview && onHand != null ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('wms.backend.inventory.adjust.preview.loading', 'Refreshing balance…')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter bordered={false} className="border-t px-6 py-4 sm:justify-between">
            <p className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1.5">
              <KbdShortcut keys={['⌘', 'Enter']} />
              <span>/</span>
              <KbdShortcut keys={['Ctrl', 'Enter']} />
              <span>{t('wms.backend.inventory.adjust.dialog.shortcutSave', 'to save')}</span>
            </p>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {t('wms.backend.inventory.adjust.dialog.submit', 'Save adjustment')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
