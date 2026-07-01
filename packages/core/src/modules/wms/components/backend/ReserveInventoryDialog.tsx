"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError, readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
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
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildInventoryMutationReferenceId } from '../../lib/inventoryMutationUi'
import {
  loadCatalogVariantOptions,
  loadInventoryProfileForVariant,
  loadLotNumberOptions,
  loadWarehouseOptions,
  resolveCatalogVariantLabel,
  resolveLotNumberFromId,
  resolveWarehouseLabel,
} from './inventoryMutationLoaders'
import type { WmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

const RESERVE_SOURCE_TYPES = ['manual', 'order', 'transfer'] as const
type ReserveSourceType = (typeof RESERVE_SOURCE_TYPES)[number]

type ReserveInventoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: WmsInventoryMutationAccess
  initialWarehouseId?: string
  initialCatalogVariantId?: string
}

const reserveSuccessSchema = z.object({
  ok: z.literal(true),
  reservationId: z.string().uuid(),
  allocatedBuckets: z.array(
    z.object({
      locationId: z.string().uuid(),
      lotId: z.string().uuid().nullable(),
      quantity: z.string(),
    }),
  ),
})

export function ReserveInventoryDialog({
  open,
  onOpenChange,
  access,
  initialWarehouseId = '',
  initialCatalogVariantId = '',
}: ReserveInventoryDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-inventory-reserve',
  })
  const mutationContext = React.useMemo(() => ({ retryLastMutation }), [retryLastMutation])

  const [warehouseId, setWarehouseId] = React.useState(initialWarehouseId)
  const [warehouseLabelCache, setWarehouseLabelCache] = React.useState<Record<string, string>>({})
  const [catalogVariantId, setCatalogVariantId] = React.useState(initialCatalogVariantId)
  const [variantLabelCache, setVariantLabelCache] = React.useState<Record<string, string>>({})
  const [lotId, setLotId] = React.useState('')
  const [lotLabelCache, setLotLabelCache] = React.useState<Record<string, string>>({})
  const [serialNumber, setSerialNumber] = React.useState('')
  const [quantity, setQuantity] = React.useState<string>('1')
  const [sourceType, setSourceType] = React.useState<ReserveSourceType>('manual')
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [trackingProfile, setTrackingProfile] = React.useState<{
    trackLot: boolean
    trackSerial: boolean
  } | null>(null)

  const resetDialog = React.useCallback(() => {
    setWarehouseId(initialWarehouseId)
    setCatalogVariantId(initialCatalogVariantId)
    setLotId('')
    setSerialNumber('')
    setQuantity('1')
    setSourceType('manual')
    setSubmitting(false)
    setFieldErrors({})
    setTrackingProfile(null)
  }, [initialWarehouseId, initialCatalogVariantId])

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
    resetDialog()
  }, [onOpenChange, resetDialog])

  React.useEffect(() => {
    if (open) resetDialog()
  }, [open, resetDialog])

  React.useEffect(() => {
    if (!open || !catalogVariantId.trim()) {
      setTrackingProfile(null)
      return
    }
    let cancelled = false
    void loadInventoryProfileForVariant(catalogVariantId.trim()).then((profile) => {
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
  }, [catalogVariantId, open])

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      setFieldErrors({})

      const nextErrors: Record<string, string> = {}
      if (!warehouseId.trim()) {
        nextErrors.warehouseId = t(
          'wms.backend.inventory.reserve.errors.warehouseRequired',
          'Select a warehouse.',
        )
      }
      if (!catalogVariantId.trim()) {
        nextErrors.catalogVariantId = t(
          'wms.backend.inventory.reserve.errors.variantRequired',
          'Select a variant.',
        )
      }
      const qty = Number(quantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        nextErrors.quantity = t(
          'wms.backend.inventory.reserve.errors.quantityInvalid',
          'Enter a positive quantity.',
        )
      }
      if (trackingProfile?.trackLot && !lotId.trim()) {
        nextErrors.lotId = t(
          'wms.backend.inventory.reserve.errors.lotRequired',
          'Select a lot for this variant.',
        )
      }
      if (trackingProfile?.trackSerial && !serialNumber.trim()) {
        nextErrors.serialNumber = t(
          'wms.backend.inventory.reserve.errors.serialRequired',
          'Enter a serial number for this variant.',
        )
      }
      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors(nextErrors)
        return
      }

      setSubmitting(true)
      try {
        const body: Record<string, unknown> = {
          organizationId: access.organizationId,
          tenantId: access.tenantId,
          warehouseId: warehouseId.trim(),
          catalogVariantId: catalogVariantId.trim(),
          quantity: qty,
          sourceType,
          sourceId: buildInventoryMutationReferenceId(),
        }
        if (lotId.trim()) body.lotId = lotId.trim()
        const serial = serialNumber.trim()
        if (serial) body.serialNumber = serial

        await runMutation({
          operation: async () => {
            const call = await apiCall<z.infer<typeof reserveSuccessSchema>>(
              '/api/wms/inventory/reserve',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              },
            )
            if (!call.ok) {
              const errorBody = await readJsonSafe<{ error?: string }>(call.response.clone(), null)
              if (errorBody?.error === 'insufficient_stock') {
                throw new Error(
                  t(
                    'wms.backend.inventory.reserve.errors.insufficientStock',
                    'Not enough available stock to fulfil this reservation.',
                  ),
                )
              }
              await raiseCrudError(
                call.response,
                t('wms.backend.inventory.reserve.errors.failed', 'Failed to reserve inventory.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: body,
        })

        flash(
          t('wms.backend.inventory.reserve.success', 'Reservation created successfully.'),
          'success',
        )
        await queryClient.invalidateQueries({ queryKey: ['wms-inventory-console'] })
        closeDialog()
      } finally {
        setSubmitting(false)
      }
    },
    [
      access.organizationId,
      access.tenantId,
      catalogVariantId,
      closeDialog,
      lotId,
      mutationContext,
      quantity,
      queryClient,
      runMutation,
      serialNumber,
      sourceType,
      t,
      trackingProfile,
      warehouseId,
    ],
  )

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

  const isMutating = submitting

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {t('wms.backend.inventory.reserve.title', 'Reserve inventory')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'wms.backend.inventory.reserve.description',
              'Commit stock from available inventory. The system allocates using the configured rotation strategy.',
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-2">
            <FormField
              label={t('wms.backend.inventory.reserve.fields.warehouse', 'Warehouse')}
              required
              error={fieldErrors.warehouseId}
            >
              <ComboboxInput
                value={warehouseId}
                onChange={(next) => {
                  setWarehouseId(next.trim())
                  setFieldErrors((e) => ({ ...e, warehouseId: '' }))
                }}
                loadSuggestions={async (query) => {
                  const options = await loadWarehouseOptions(query)
                  setWarehouseLabelCache((c) => {
                    const updated = { ...c }
                    for (const o of options) updated[o.value] = o.label
                    return updated
                  })
                  return options
                }}
                resolveLabel={async (value) => {
                  if (warehouseLabelCache[value]) return warehouseLabelCache[value]
                  const label = await resolveWarehouseLabel(value)
                  if (label) setWarehouseLabelCache((c) => ({ ...c, [value]: label }))
                  return label ?? value
                }}
                placeholder={t(
                  'wms.backend.inventory.reserve.fields.warehousePlaceholder',
                  'Select warehouse…',
                )}
                allowCustomValues={false}
                disabled={isMutating}
              />
            </FormField>

            <FormField
              label={t('wms.backend.inventory.reserve.fields.variant', 'Variant / SKU')}
              required
              error={fieldErrors.catalogVariantId}
            >
              <ComboboxInput
                value={catalogVariantId}
                onChange={(next) => {
                  setCatalogVariantId(next.trim())
                  setLotId('')
                  setSerialNumber('')
                  setFieldErrors((e) => ({ ...e, catalogVariantId: '' }))
                }}
                loadSuggestions={async (query) => {
                  const options = await loadCatalogVariantOptions(query)
                  setVariantLabelCache((c) => {
                    const updated = { ...c }
                    for (const o of options) updated[o.value] = o.label
                    return updated
                  })
                  return options
                }}
                resolveLabel={async (value) => {
                  if (variantLabelCache[value]) return variantLabelCache[value]
                  const label = await resolveCatalogVariantLabel(value)
                  if (label) setVariantLabelCache((c) => ({ ...c, [value]: label }))
                  return label ?? value
                }}
                placeholder={t(
                  'wms.backend.inventory.reserve.fields.variantPlaceholder',
                  'Search SKU or name…',
                )}
                allowCustomValues={false}
                disabled={isMutating}
              />
            </FormField>

            <FormField
              label={t('wms.backend.inventory.reserve.fields.quantity', 'Quantity')}
              required
              error={fieldErrors.quantity}
            >
              <Input
                type="number"
                min="0.001"
                step="any"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value)
                  setFieldErrors((err) => ({ ...err, quantity: '' }))
                }}
                placeholder="1"
                disabled={isMutating}
              />
            </FormField>

            <FormField
              label={t('wms.backend.inventory.reserve.fields.sourceType', 'Reservation type')}
            >
              <Select
                value={sourceType}
                onValueChange={(v) => setSourceType(v as ReserveSourceType)}
                disabled={isMutating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">
                    {t('wms.backend.inventory.reserve.sourceType.manual', 'Manual hold')}
                  </SelectItem>
                  <SelectItem value="order">
                    {t('wms.backend.inventory.reserve.sourceType.order', 'Order')}
                  </SelectItem>
                  <SelectItem value="transfer">
                    {t('wms.backend.inventory.reserve.sourceType.transfer', 'Transfer')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {catalogVariantId.trim() ? (
              <FormField
                label={t(
                  'wms.backend.inventory.reserve.fields.lot',
                  trackingProfile?.trackLot ? 'Lot' : 'Lot (optional)',
                )}
                required={trackingProfile?.trackLot === true}
                error={fieldErrors.lotId}
              >
                <ComboboxInput
                  value={lotId}
                  onChange={(next) => {
                    setLotId(next.trim())
                    setFieldErrors((e) => ({ ...e, lotId: '' }))
                  }}
                  loadSuggestions={async (query) => {
                    const options = await loadLotNumberOptions(catalogVariantId.trim(), query)
                    setLotLabelCache((c) => {
                      const updated = { ...c }
                      for (const o of options) updated[o.value] = o.label
                      return updated
                    })
                    return options
                  }}
                  resolveLabel={async (value) => {
                    if (lotLabelCache[value]) return lotLabelCache[value]
                    const label = await resolveLotNumberFromId(value)
                    if (label) setLotLabelCache((c) => ({ ...c, [value]: label }))
                    return label ?? value
                  }}
                  placeholder={t(
                    trackingProfile?.trackLot
                      ? 'wms.backend.inventory.reserve.fields.lotRequiredPlaceholder'
                      : 'wms.backend.inventory.reserve.fields.lotPlaceholder',
                    trackingProfile?.trackLot
                      ? 'Select lot…'
                      : 'Any lot (system selects)…',
                  )}
                  allowCustomValues={false}
                  clearable={!trackingProfile?.trackLot}
                  disabled={isMutating}
                />
              </FormField>
            ) : null}

            {catalogVariantId.trim() && trackingProfile?.trackSerial ? (
              <FormField
                label={t('wms.backend.inventory.reserve.fields.serial', 'Serial number')}
                required
                error={fieldErrors.serialNumber}
              >
                <Input
                  value={serialNumber}
                  onChange={(e) => {
                    setSerialNumber(e.target.value)
                    setFieldErrors((err) => ({ ...err, serialNumber: '' }))
                  }}
                  placeholder={t(
                    'wms.backend.inventory.reserve.fields.serialPlaceholder',
                    'Enter serial number…',
                  )}
                  disabled={isMutating}
                />
              </FormField>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={isMutating}
            >
              {t('wms.backend.inventory.reserve.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isMutating}
            >
              <ShieldCheck className="size-4" />
              {isMutating
                ? t('wms.backend.inventory.reserve.submitting', 'Reserving…')
                : t('wms.backend.inventory.reserve.submit', 'Reserve')}
              {!isMutating && <KbdShortcut keys={['⌘', '↵']} />}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
