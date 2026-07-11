"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, Minus, Package, Plus } from 'lucide-react'
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
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildInventoryMutationReferenceId } from '../../lib/inventoryMutationUi'
import {
  loadCatalogVariantOptions,
  loadInventoryProfileForVariant,
  loadLocationOptions,
  loadLotNumberOptions,
  loadWarehouseOptions,
  resolveCatalogVariantLabel,
  resolveLocationLabel,
  resolveLotNumberFromId,
  resolveWarehouseLabel,
} from './inventoryMutationLoaders'
import type { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

const RECEIVE_REFERENCE_TYPES = ['manual', 'po', 'so', 'rma', 'transfer', 'qc'] as const
type ReceiveReferenceType = (typeof RECEIVE_REFERENCE_TYPES)[number]

type ReceiveFormValues = {
  catalogVariantId: string
  warehouseId: string
  locationId: string
  lotNumber: string
  quantity: number
  referenceType: ReceiveReferenceType
  notes: string
  serialNumber: string
}

type ReceiveInventoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: ReturnType<typeof useWmsInventoryMutationAccess>
  initialCatalogVariantId?: string
  initialWarehouseId?: string
  initialLocationId?: string
  initialLotId?: string
  onSuccess?: (ctx: { catalogVariantId: string; warehouseId: string; locationId: string; quantity: number }) => void
}

const EMPTY_FORM: ReceiveFormValues = {
  catalogVariantId: '',
  warehouseId: '',
  locationId: '',
  lotNumber: '',
  quantity: 1,
  referenceType: 'manual',
  notes: '',
  serialNumber: '',
}

export function ReceiveInventoryDialog({
  open,
  onOpenChange,
  access,
  initialCatalogVariantId,
  initialWarehouseId,
  initialLocationId,
  initialLotId,
  onSuccess,
}: ReceiveInventoryDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const formRef = React.useRef<HTMLFormElement>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-inventory-receive',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  const receiveFormSchema = React.useMemo(
    () =>
      z.object({
        catalogVariantId: z.string().uuid(),
        warehouseId: z.string().uuid(),
        locationId: z.string().uuid(),
        lotNumber: z.string().trim().max(120).optional(),
        quantity: z.coerce.number().positive({
          message: t('wms.backend.inventory.receive.errors.quantityPositive', 'Quantity must be greater than zero.'),
        }),
        referenceType: z.enum(RECEIVE_REFERENCE_TYPES),
        notes: z.string().trim().max(500).optional(),
        serialNumber: z.string().trim().max(120).optional(),
      }),
    [t],
  )

  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState<ReceiveFormValues>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [optionLabelByValue, setOptionLabelByValue] = React.useState<Record<string, string>>({})
  const [trackingProfile, setTrackingProfile] = React.useState<{
    trackLot: boolean
    trackSerial: boolean
  } | null>(null)

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

  const resetDialog = React.useCallback(() => {
    setForm(EMPTY_FORM)
    setFieldErrors({})
    setSubmitting(false)
    setOptionLabelByValue({})
    setTrackingProfile(null)
  }, [])

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
    resetDialog()
  }, [onOpenChange, resetDialog])

  const patchForm = React.useCallback((patch: Partial<ReceiveFormValues>) => {
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
    if (!open || !form.catalogVariantId.trim()) {
      setTrackingProfile(null)
      return
    }
    let cancelled = false
    void loadInventoryProfileForVariant(form.catalogVariantId.trim()).then((profile) => {
      if (cancelled) return
      if (!profile) {
        setTrackingProfile(null)
        return
      }
      setTrackingProfile({
        trackLot: profile.track_lot === true,
        trackSerial: profile.track_serial === true,
      })
    })
    return () => {
      cancelled = true
    }
  }, [form.catalogVariantId, open])

  const referenceTypeLabel = React.useCallback(
    (code: ReceiveReferenceType) => {
      const fallbacks: Record<ReceiveReferenceType, string> = {
        manual: 'Manual receipt',
        po: 'Purchase order',
        so: 'Sales return',
        rma: 'RMA / return',
        transfer: 'Transfer',
        qc: 'QC release',
      }
      return t(`wms.backend.inventory.receive.referenceTypes.${code}`, fallbacks[code])
    },
    [t],
  )

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      const parsed = receiveFormSchema.safeParse({
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

      const lotNumber = parsed.data.lotNumber?.trim()
      const serial = parsed.data.serialNumber?.trim()
      const nextErrors: Record<string, string> = {}
      if (trackingProfile?.trackLot && !lotNumber) {
        nextErrors.lotNumber = t(
          'wms.backend.inventory.receive.errors.lotRequired',
          'Lot number is required for this variant.',
        )
      }
      if (trackingProfile?.trackSerial && !serial) {
        nextErrors.serialNumber = t(
          'wms.backend.inventory.receive.errors.serialRequired',
          'Serial number is required for this variant.',
        )
      }
      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors(nextErrors)
        return
      }

      setSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          organizationId: access.organizationId,
          tenantId: access.tenantId,
          warehouseId: parsed.data.warehouseId,
          locationId: parsed.data.locationId,
          catalogVariantId: parsed.data.catalogVariantId,
          quantity: parsed.data.quantity,
          referenceType: parsed.data.referenceType,
          referenceId: buildInventoryMutationReferenceId(),
          performedBy: access.userId,
        }
        if (lotNumber) payload.lotNumber = lotNumber
        if (serial) payload.serialNumber = serial
        const notes = parsed.data.notes?.trim()
        if (notes) payload.reason = notes

        await runMutation({
          operation: async () => {
            const call = await apiCall<{ ok?: boolean; movementId?: string }>(
              '/api/wms/inventory/receive',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              },
            )
            if (!call.ok) {
              await raiseCrudError(
                call.response,
                t('wms.backend.inventory.receive.errors.submit', 'Failed to receive inventory.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: payload,
        })

        flash(t('wms.backend.inventory.receive.flash.success', 'Inventory received'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['wms-inventory-console'] })
        await queryClient.invalidateQueries({ queryKey: ['wms-sku-detail'] })
        onSuccess?.({
          catalogVariantId: parsed.data.catalogVariantId,
          warehouseId: parsed.data.warehouseId,
          locationId: parsed.data.locationId,
          quantity: parsed.data.quantity,
        })
        closeDialog()
      } catch (error) {
        flash(
          error instanceof Error
            ? error.message
            : t('wms.backend.inventory.receive.errors.submit', 'Failed to receive inventory.'),
          'error',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [
      access,
      closeDialog,
      form,
      mutationContext,
      onSuccess,
      queryClient,
      receiveFormSchema,
      runMutation,
      t,
      trackingProfile,
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

  const adjustQuantity = React.useCallback((step: 1 | -1) => {
    setForm((current) => {
      const next = current.quantity + step
      return { ...current, quantity: next < 1 ? 1 : next }
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
              {t('wms.backend.inventory.receive.dialog.title', 'Receive inventory')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'wms.backend.inventory.receive.dialog.description',
                'Record inbound stock as a receipt movement',
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
            <FormField
              label={t('wms.backend.inventory.receive.form.variant', 'Variant')}
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
                    'wms.backend.inventory.receive.form.variantPlaceholder',
                    'Search variant or SKU',
                  )}
                  allowCustomValues={false}
                  disabled={submitting}
                />
              </div>
            </FormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label={t('wms.backend.inventory.receive.form.warehouse', 'Warehouse')}
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
                    'wms.backend.inventory.receive.form.warehousePlaceholder',
                    'Select warehouse',
                  )}
                  allowCustomValues={false}
                  disabled={submitting}
                />
              </FormField>

              <FormField
                label={t('wms.backend.inventory.receive.form.location', 'Location')}
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
                    'wms.backend.inventory.receive.form.locationPlaceholder',
                    'Select location',
                  )}
                  allowCustomValues={false}
                  disabled={submitting || !form.warehouseId}
                />
              </FormField>
            </div>

            <FormField
              label={t('wms.backend.inventory.receive.form.lot', 'Lot')}
              required={trackingProfile?.trackLot === true}
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
                  trackingProfile?.trackLot
                    ? 'wms.backend.inventory.receive.form.lotRequiredPlaceholder'
                    : 'wms.backend.inventory.receive.form.lotPlaceholder',
                  trackingProfile?.trackLot
                    ? 'Enter lot number'
                    : 'Select or create lot (optional)',
                )}
                allowCustomValues
                disabled={submitting || !form.catalogVariantId}
              />
            </FormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label={t('wms.backend.inventory.receive.form.quantity', 'Quantity received')}
                required
                error={fieldErrors.quantity}
              >
                <div className="flex w-full items-center gap-2 rounded-md border bg-background p-2 shadow-xs">
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('wms.backend.inventory.receive.form.decrease', 'Decrease quantity')}
                    onClick={() => adjustQuantity(-1)}
                    disabled={submitting || form.quantity <= 1}
                  >
                    <Minus className="size-4" />
                  </IconButton>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={String(form.quantity)}
                    onChange={(event) => {
                      const parsed = Number(event.target.value.trim())
                      if (Number.isFinite(parsed) && parsed > 0) {
                        patchForm({ quantity: parsed })
                      }
                    }}
                    className="h-8 border-0 bg-transparent px-0 text-center shadow-none focus-visible:ring-0"
                    disabled={submitting}
                  />
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('wms.backend.inventory.receive.form.increase', 'Increase quantity')}
                    onClick={() => adjustQuantity(1)}
                    disabled={submitting}
                  >
                    <Plus className="size-4" />
                  </IconButton>
                </div>
              </FormField>

              <FormField
                label={t('wms.backend.inventory.receive.form.referenceType', 'Receipt type')}
                required
                error={fieldErrors.referenceType}
              >
                <Select
                  value={form.referenceType}
                  onValueChange={(next) => patchForm({ referenceType: next as ReceiveReferenceType })}
                  disabled={submitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECEIVE_REFERENCE_TYPES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {referenceTypeLabel(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField
              label={t('wms.backend.inventory.receive.form.serial', 'Serial number')}
              required={trackingProfile?.trackSerial === true}
              error={fieldErrors.serialNumber}
            >
              <Input
                value={form.serialNumber}
                onChange={(event) => patchForm({ serialNumber: event.target.value })}
                placeholder={t(
                  trackingProfile?.trackSerial
                    ? 'wms.backend.inventory.receive.form.serialRequiredPlaceholder'
                    : 'wms.backend.inventory.receive.form.serialPlaceholder',
                  trackingProfile?.trackSerial
                    ? 'Enter serial number'
                    : 'Optional — for serial-tracked variants',
                )}
                disabled={submitting}
              />
            </FormField>

            <FormField
              label={t('wms.backend.inventory.receive.form.notes', 'Notes')}
              error={fieldErrors.notes}
            >
              <Textarea
                value={form.notes}
                onChange={(event) => patchForm({ notes: event.target.value })}
                placeholder={t(
                  'wms.backend.inventory.receive.form.notesPlaceholder',
                  'Optional notes or reference number',
                )}
                rows={2}
                disabled={submitting}
              />
            </FormField>
          </div>

          <DialogFooter className="flex-row items-center justify-between border-t px-6 py-4">
            <p className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1.5">
              <KbdShortcut keys={['⌘', 'Enter']} />
              <span>/</span>
              <KbdShortcut keys={['Ctrl', 'Enter']} />
              <span>{t('wms.backend.inventory.receive.form.shortcut', 'to receive')}</span>
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('wms.backend.inventory.receive.form.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                <ArrowDown className="size-4" />
                {submitting
                  ? t('wms.backend.inventory.receive.form.submitting', 'Receiving…')
                  : t('wms.backend.inventory.receive.form.submit', 'Receive')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
