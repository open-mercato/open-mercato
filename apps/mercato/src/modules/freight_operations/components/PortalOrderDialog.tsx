"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { CARGO_UNIT_VALUES, TRUCK_TYPE_VALUES } from '../lib/freightEnums'

const CONTEXT_ID = 'freight_operations.portal_orders.create'

function toIsoDate(value: string): string | undefined {
  if (!value.trim()) return undefined
  return `${value.trim()}T12:00:00.000Z`
}

export function PortalOrderDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const t = useT()
  const [cargoDescription, setCargoDescription] = React.useState('')
  const [pickupLocation, setPickupLocation] = React.useState('')
  const [dropoffLocation, setDropoffLocation] = React.useState('')
  const [requestedPickupAt, setRequestedPickupAt] = React.useState('')
  const [requestedDeliveryAt, setRequestedDeliveryAt] = React.useState('')
  const [truckTypeRequired, setTruckTypeRequired] = React.useState('other')
  const [cargoQuantity, setCargoQuantity] = React.useState('')
  const [cargoUnit, setCargoUnit] = React.useState('trip')
  const [cargoWeightKg, setCargoWeightKg] = React.useState('')
  const [cargoVolumeM3, setCargoVolumeM3] = React.useState('')
  const [cargoHazardous, setCargoHazardous] = React.useState(false)
  const [cargoRefrigerated, setCargoRefrigerated] = React.useState(false)
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!open) return
    setCargoDescription('')
    setPickupLocation('')
    setDropoffLocation('')
    setRequestedPickupAt('')
    setRequestedDeliveryAt('')
    setTruckTypeRequired('other')
    setCargoQuantity('')
    setCargoUnit('trip')
    setCargoWeightKg('')
    setCargoVolumeM3('')
    setCargoHazardous(false)
    setCargoRefrigerated(false)
    setNotes('')
    setError(null)
  }, [open])

  const submit = React.useCallback(async () => {
    if (!cargoDescription.trim() || !pickupLocation.trim() || !dropoffLocation.trim()) {
      setError(t('freight_operations.portal.orders.form.required', 'Cargo, pickup and drop-off are required.'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await runMutation({
        operation: () => apiCallOrThrow('/api/portal/freight/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            cargoDescription: cargoDescription.trim(),
            pickupLocation: pickupLocation.trim(),
            dropoffLocation: dropoffLocation.trim(),
            ...(toIsoDate(requestedPickupAt) ? { requestedPickupAt: toIsoDate(requestedPickupAt) } : {}),
            ...(toIsoDate(requestedDeliveryAt) ? { requestedDeliveryAt: toIsoDate(requestedDeliveryAt) } : {}),
            truckTypeRequired,
            ...(cargoQuantity.trim() ? { cargoQuantity: cargoQuantity.trim() } : {}),
            cargoUnit,
            ...(cargoWeightKg.trim() ? { cargoWeightKg: cargoWeightKg.trim() } : {}),
            ...(cargoVolumeM3.trim() ? { cargoVolumeM3: cargoVolumeM3.trim() } : {}),
            cargoHazardous,
            cargoRefrigerated,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          }),
        }, {
          errorMessage: t('freight_operations.portal.orders.form.error', 'Unable to submit the order.'),
        }),
        mutationPayload: { operation: 'portal_orders.create', cargoDescription: cargoDescription.trim() },
        context: {
          formId: CONTEXT_ID,
          resourceKind: 'freight_operations:freight_order',
          retryLastMutation,
        },
      })
      flash(t('freight_operations.portal.orders.form.success', 'Order submitted for review.'), 'success')
      onOpenChange(false)
      onCreated()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : t('freight_operations.portal.orders.form.error', 'Unable to submit the order.'),
      )
    } finally {
      setSaving(false)
    }
  }, [
    cargoDescription,
    cargoHazardous,
    cargoQuantity,
    cargoRefrigerated,
    cargoUnit,
    cargoVolumeM3,
    cargoWeightKg,
    dropoffLocation,
    notes,
    onCreated,
    onOpenChange,
    pickupLocation,
    requestedDeliveryAt,
    requestedPickupAt,
    retryLastMutation,
    runMutation,
    t,
    truckTypeRequired,
  ])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
    disabled: saving,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.portal.orders.form.title', 'Request a transport order')}</DialogTitle>
          <DialogDescription>
            {t(
              'freight_operations.portal.orders.form.description',
              'Describe the shipment and preferred dates. Our team will review and confirm the order.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pe-1">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t('freight_operations.orders.form.fields.cargoDescription', 'Cargo description')}
            </span>
            <Input value={cargoDescription} onChange={(event) => setCargoDescription(event.target.value)} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.orders.form.fields.pickupLocation', 'Pickup location')}
              </span>
              <Input value={pickupLocation} onChange={(event) => setPickupLocation(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.orders.form.fields.dropoffLocation', 'Drop-off location')}
              </span>
              <Input value={dropoffLocation} onChange={(event) => setDropoffLocation(event.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.orders.form.fields.requestedPickup', 'Requested pickup')}
              </span>
              <Input
                type="date"
                value={requestedPickupAt}
                onChange={(event) => setRequestedPickupAt(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.orders.form.fields.requestedDelivery', 'Requested delivery')}
              </span>
              <Input
                type="date"
                value={requestedDeliveryAt}
                onChange={(event) => setRequestedDeliveryAt(event.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>{t('freight_operations.orders.form.fields.truckType', 'Truck type')}</Label>
              <Select value={truckTypeRequired} onValueChange={setTruckTypeRequired}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRUCK_TYPE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`freight_operations.orders.truck_type.${value}`, value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('freight_operations.orders.form.fields.cargoUnit', 'Quantity unit')}</Label>
              <Select value={cargoUnit} onValueChange={setCargoUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARGO_UNIT_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`freight_operations.orders.cargo_unit.${value}`, value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.orders.form.fields.cargoQuantity', 'Quantity')}
              </span>
              <Input
                inputMode="decimal"
                value={cargoQuantity}
                onChange={(event) => setCargoQuantity(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.orders.form.fields.cargoWeight', 'Cargo weight (kg)')}
              </span>
              <Input
                inputMode="decimal"
                value={cargoWeightKg}
                onChange={(event) => setCargoWeightKg(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.orders.form.fields.cargoVolume', 'Cargo volume (m³)')}
              </span>
              <Input
                inputMode="decimal"
                value={cargoVolumeM3}
                onChange={(event) => setCargoVolumeM3(event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={cargoHazardous}
                onCheckedChange={(checked) => setCargoHazardous(checked === true)}
              />
              {t('freight_operations.orders.form.fields.cargoHazardous', 'Hazardous cargo')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={cargoRefrigerated}
                onCheckedChange={(checked) => setCargoRefrigerated(checked === true)}
              />
              {t('freight_operations.orders.form.fields.cargoRefrigerated', 'Refrigerated cargo')}
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t('freight_operations.orders.form.fields.notes', 'Notes')}
            </span>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }} disabled={saving}>
            {t('freight_operations.portal.orders.form.submit', 'Submit order')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
