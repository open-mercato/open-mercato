"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
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
import { formatRentalAmount, formatRentalDate } from './rentalOptions'
import type { RentalCheckTarget } from './RentalHandoverDialog'

const CONTEXT_ID = 'vehicle_rentals.contracts.return'
const ENTITY_ID = 'vehicle_rentals:rental_contract'

/**
 * The return closes the rental. The closing reading minus the handover reading
 * is the mileage; what exceeds the included kilometres is charged at the
 * contract's extra-km rate — the dialog shows that arithmetic before the
 * operator commits to it.
 */
export function RentalReturnDialog({
  target,
  onOpenChange,
  onDone,
}: {
  target: (RentalCheckTarget & { odoStartKm?: number | null; includedKm?: number | null; extraKmRate?: string | null; currencyCode?: string }) | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const t = useT()
  const open = target !== null
  const [odoEndKm, setOdoEndKm] = React.useState('')
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
    setOdoEndKm('')
    setFuelLevel('')
    setHasDamage(false)
    setConditionNotes('')
    setError(null)
  }, [target])

  const usage = React.useMemo(() => {
    const parsed = Number(odoEndKm)
    if (!Number.isFinite(parsed) || odoEndKm.trim() === '' || target?.odoStartKm === null || target?.odoStartKm === undefined) return null
    const driven = parsed - target.odoStartKm
    if (driven < 0) return null
    const extra = target.includedKm === null || target.includedKm === undefined ? null : Math.max(0, driven - target.includedKm)
    const extraAmount = extra !== null && target.extraKmRate ? extra * Number(target.extraKmRate) : null
    return { driven, extra, extraAmount }
  }, [odoEndKm, target])

  const submit = React.useCallback(async () => {
    if (!target) return
    const parsedOdo = Number(odoEndKm)
    if (!Number.isFinite(parsedOdo) || parsedOdo < 0 || odoEndKm.trim() === '') {
      setError(t('vehicle_rentals.contracts.return.odoRequired', 'Record the odometer reading at return.'))
      return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(target.updatedAt ?? target.updated_at ?? null),
          () => apiCallOrThrow('/api/vehicle_rentals/contracts/return', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: target.id,
              odoEndKm: parsedOdo,
              ...(fuelLevel.trim() ? { fuelLevel: Number(fuelLevel) } : {}),
              hasDamage,
              ...(conditionNotes.trim() ? { conditionNotes: conditionNotes.trim() } : {}),
            }),
          }, { errorMessage: t('vehicle_rentals.errors.return_failed', 'Unable to return the vehicle.') }),
        ),
        mutationPayload: { operation: 'rentals.return', id: target.id, updatedAt: target.updatedAt ?? null },
        context: { formId: CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: target.id, retryLastMutation },
      })
      flash(t('vehicle_rentals.contracts.return.success', 'Vehicle returned — the rental is closed.'), 'success')
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('vehicle_rentals.errors.return_failed', 'Unable to return the vehicle.'))
    }
  }, [conditionNotes, fuelLevel, hasDamage, odoEndKm, onDone, retryLastMutation, runMutation, t, target])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('vehicle_rentals.contracts.return.title', 'Vehicle return')}</DialogTitle>
          <DialogDescription>
            {t('vehicle_rentals.contracts.return.description', 'Closes the rental for {rental} and bills the mileage past the included kilometres.', {
              rental: target?.rentalNumber ?? '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('vehicle_rentals.contracts.return.odo', 'Odometer (km)')}</span>
              <Input type="number" value={odoEndKm} onChange={(event) => setOdoEndKm(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('vehicle_rentals.contracts.handover.fuel', 'Fuel level (%)')}</span>
              <Input type="number" min={0} max={100} value={fuelLevel} onChange={(event) => setFuelLevel(event.target.value)} />
            </label>
          </div>

          {usage ? (
            <div className="rounded-md border border-border bg-card p-3 text-sm">
              <p>
                {t('vehicle_rentals.contracts.return.usage', 'Driven: {km} km', { km: usage.driven })}
                {usage.extra !== null
                  ? ` · ${t('vehicle_rentals.contracts.return.extraKm', 'extra: {km} km', { km: usage.extra })}`
                  : ''}
              </p>
              {usage.extraAmount !== null ? (
                <p className="text-muted-foreground">
                  {t('vehicle_rentals.contracts.return.extraAmount', 'Extra mileage charge (net): {amount}', {
                    amount: formatRentalAmount(usage.extraAmount, target?.currencyCode ?? 'SAR'),
                  })}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {t('vehicle_rentals.contracts.return.handoverReading', 'Handover reading: {km} km · {date}', {
                  km: String(target?.odoStartKm ?? '—'),
                  date: formatRentalDate((target as unknown as Record<string, unknown>)?.startAt as string ?? null),
                })}
              </p>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={hasDamage} onCheckedChange={(checked) => setHasDamage(checked === true)} />
            {t('vehicle_rentals.contracts.return.hasDamage', 'New damage noted')}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('vehicle_rentals.contracts.return.condition', 'Condition notes')}</span>
            <Textarea value={conditionNotes} onChange={(event) => setConditionNotes(event.target.value)} rows={3} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('vehicle_rentals.contracts.return.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }}>
            {t('vehicle_rentals.contracts.return.submit', 'Record return')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
