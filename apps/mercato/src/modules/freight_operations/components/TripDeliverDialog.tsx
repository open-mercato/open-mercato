"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
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
import type { FreightTripRow } from './FreightTripsTable'

const ENTITY_ID = 'freight_operations:freight_trip'
const CONTEXT_ID = 'freight_operations.trips.deliver'

export function TripDeliverDialog({
  trip,
  onOpenChange,
  onDelivered,
}: {
  /** `null` keeps the dialog closed; the row it acts on is carried alongside. */
  trip: FreightTripRow | null
  onOpenChange: (open: boolean) => void
  onDelivered: () => void
}) {
  const t = useT()
  const open = trip !== null
  const [podReference, setPodReference] = React.useState('')
  const [receivedBy, setReceivedBy] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!trip) return
    setPodReference(trip.pod_reference ?? '')
    setReceivedBy('')
    setError(null)
  }, [trip])

  const submit = React.useCallback(async () => {
    if (!trip) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(trip.updatedAt ?? trip.updated_at ?? null),
          () => apiCallOrThrow('/api/freight_operations/trips/deliver', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: trip.id,
              ...(podReference.trim() ? { podReference: podReference.trim() } : {}),
              ...(receivedBy.trim() ? { podReceivedByName: receivedBy.trim() } : {}),
            }),
          }, { errorMessage: t('freight_operations.trips.actions.deliver.error', 'Unable to record the delivery.') }),
        ),
        mutationPayload: { operation: 'trips.deliver', id: trip.id, updatedAt: trip.updatedAt ?? null },
        context: { formId: CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: trip.id, retryLastMutation },
      })
      flash(t('freight_operations.trips.actions.deliver.success', 'Delivery recorded.'), 'success')
      onDelivered()
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('freight_operations.trips.actions.deliver.error', 'Unable to record the delivery.'))
    }
  }, [onDelivered, podReference, receivedBy, retryLastMutation, runMutation, t, trip])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.trips.deliver.title', 'Record delivery')}</DialogTitle>
          <DialogDescription>
            {t('freight_operations.trips.deliver.description', 'Record the proof of delivery for {trip}. When billing requires a POD, one of the two fields must be filled.', {
              trip: trip?.trip_number ?? '',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('freight_operations.trips.deliver.podReference', 'POD reference')}</span>
            <Input
              value={podReference}
              onChange={(event) => setPodReference(event.target.value)}
              placeholder={t('freight_operations.trips.deliver.podReferencePlaceholder', 'Delivery note number')}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('freight_operations.trips.deliver.receivedBy', 'Received by')}</span>
            <Input
              value={receivedBy}
              onChange={(event) => setReceivedBy(event.target.value)}
              placeholder={t('freight_operations.trips.deliver.receivedByPlaceholder', 'Name of the person who signed')}
            />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('freight_operations.trips.deliver.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }}>
            {t('freight_operations.trips.actions.deliver.label', 'Record delivery')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
