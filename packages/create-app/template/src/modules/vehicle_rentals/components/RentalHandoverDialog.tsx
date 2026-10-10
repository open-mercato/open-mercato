"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useTransportReference } from './rentalOptions'

const CONTEXT_ID = 'vehicle_rentals.contracts.handover'
const ENTITY_ID = 'vehicle_rentals:rental_contract'

export type RentalCheckTarget = {
  id: string
  rentalNumber: string
  rentalType: string
  vehicleId?: string | null
  driverId?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

/**
 * The handover opens the rental: the odometer reading agreed by both parties and
 * the vehicle's condition are written as the handover check, and the contract
 * goes `active`. The vehicle is only decided here — a contract may be drafted
 * before the fleet is assigned.
 */
export function RentalHandoverDialog({
  target,
  onOpenChange,
  onDone,
}: {
  target: RentalCheckTarget | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const t = useT()
  const open = target !== null
  const { vehicleOptions, driverOptions } = useTransportReference()
  const [vehicleId, setVehicleId] = React.useState('')
  const [driverId, setDriverId] = React.useState('')
  const [odoStartKm, setOdoStartKm] = React.useState('')
  const [fuelLevel, setFuelLevel] = React.useState('')
  const [hasDamage, setHasDamage] = React.useState(false)
  const [conditionNotes, setConditionNotes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!target) return
    setVehicleId(target.vehicleId ?? '')
    setDriverId(target.driverId ?? '')
    setOdoStartKm('')
    setFuelLevel('')
    setHasDamage(false)
    setConditionNotes('')
    setError(null)
  }, [target])

  const needsDriver = target?.rentalType === 'with_driver'

  const submit = React.useCallback(async () => {
    if (!target) return
    if (!vehicleId) {
      setError(t('vehicle_rentals.contracts.handover.vehicleRequired', 'Choose the vehicle being handed over.'))
      return
    }
    const parsedOdo = Number(odoStartKm)
    if (!Number.isFinite(parsedOdo) || parsedOdo < 0 || odoStartKm.trim() === '') {
      setError(t('vehicle_rentals.contracts.handover.odoRequired', 'Record the odometer reading at handover.'))
      return
    }
    if (needsDriver && !driverId) {
      setError(t('vehicle_rentals.contracts.handover.driverRequired', 'This rental is with a driver — name the driver.'))
      return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(target.updatedAt ?? target.updated_at ?? null),
          () => apiCallOrThrow('/api/vehicle_rentals/contracts/handover', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: target.id,
              vehicleId,
              ...(driverId ? { driverId } : {}),
              odoStartKm: parsedOdo,
              ...(fuelLevel.trim() ? { fuelLevel: Number(fuelLevel) } : {}),
              hasDamage,
              ...(conditionNotes.trim() ? { conditionNotes: conditionNotes.trim() } : {}),
            }),
          }, { errorMessage: t('vehicle_rentals.errors.handover_failed', 'Unable to hand over the vehicle.') }),
        ),
        mutationPayload: { operation: 'rentals.handover', id: target.id, updatedAt: target.updatedAt ?? null },
        context: { formId: CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: target.id, retryLastMutation },
      })
      flash(t('vehicle_rentals.contracts.handover.success', 'Vehicle handed over — the rental is now on hire.'), 'success')
      onDone()
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('vehicle_rentals.errors.handover_failed', 'Unable to hand over the vehicle.'))
    }
  }, [conditionNotes, driverId, fuelLevel, hasDamage, needsDriver, odoStartKm, onDone, retryLastMutation, runMutation, t, target, vehicleId])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('vehicle_rentals.contracts.handover.title', 'Vehicle handover')}</DialogTitle>
          <DialogDescription>
            {t('vehicle_rentals.contracts.handover.description', 'Records the odometer and condition agreed at handover for {rental}. The reading decides the mileage billed at return.', {
              rental: target?.rentalNumber ?? '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('vehicle_rentals.contracts.form.fields.vehicle', 'Vehicle')}</span>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger aria-label={t('vehicle_rentals.contracts.form.fields.vehicle', 'Vehicle')}>
                  <SelectValue placeholder={t('vehicle_rentals.contracts.handover.vehiclePlaceholder', 'Choose a vehicle')} />
                </SelectTrigger>
                <SelectContent>
                  {vehicleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {needsDriver ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">{t('vehicle_rentals.contracts.form.fields.driver', 'Driver')}</span>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger aria-label={t('vehicle_rentals.contracts.form.fields.driver', 'Driver')}>
                    <SelectValue placeholder={t('vehicle_rentals.contracts.handover.driverPlaceholder', 'Choose a driver')} />
                  </SelectTrigger>
                  <SelectContent>
                    {driverOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('vehicle_rentals.contracts.handover.odo', 'Odometer (km)')}</span>
              <Input type="number" value={odoStartKm} onChange={(event) => setOdoStartKm(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('vehicle_rentals.contracts.handover.fuel', 'Fuel level (%)')}</span>
              <Input type="number" min={0} max={100} value={fuelLevel} onChange={(event) => setFuelLevel(event.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={hasDamage} onCheckedChange={(checked) => setHasDamage(checked === true)} />
            {t('vehicle_rentals.contracts.handover.hasDamage', 'Existing damage noted')}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('vehicle_rentals.contracts.handover.condition', 'Condition notes')}</span>
            <Textarea value={conditionNotes} onChange={(event) => setConditionNotes(event.target.value)} rows={3} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('vehicle_rentals.contracts.handover.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }}>
            {t('vehicle_rentals.contracts.handover.submit', 'Hand over')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
