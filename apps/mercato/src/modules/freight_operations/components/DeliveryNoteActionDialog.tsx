"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DeliveryNoteActionMode, FreightDeliveryNoteRow } from './deliveryNoteOptions'

const ENTITY_ID = 'freight_operations:freight_delivery_note'
const CONTEXT_ID = 'freight_operations.delivery_notes.action'

type DeliveryNoteActionDialogProps = {
  note: FreightDeliveryNoteRow | null
  mode: DeliveryNoteActionMode | null
  onOpenChange: (open: boolean) => void
  onCompleted: () => void
}

const ACTION_TITLE_FALLBACKS: Record<DeliveryNoteActionMode, string> = {
  issue: 'Issue delivery note',
  deliver: 'Record delivery',
  cancel: 'Cancel delivery note',
  waybill: 'Record Bayan Naql waybill',
  waybill_cancel: 'Cancel Bayan Naql waybill',
}

const ACTION_DESCRIPTION_FALLBACKS: Record<DeliveryNoteActionMode, string> = {
  issue: 'The seller, driver and vehicle are frozen into the document when it is issued.',
  deliver: 'Record who received the goods. A POD reference is required.',
  cancel: 'Cancelling a delivery note is refused while an external waybill is still recorded.',
  waybill: 'Enter the waybill number issued on the TGA Bayan platform.',
  waybill_cancel: 'Mark the external Bayan Naql waybill as cancelled.',
}

const ACTION_BUTTON_FALLBACKS: Record<DeliveryNoteActionMode, string> = {
  issue: 'Issue',
  deliver: 'Record delivery',
  cancel: 'Cancel note',
  waybill: 'Record waybill',
  waybill_cancel: 'Cancel waybill',
}

const ENDPOINTS: Record<DeliveryNoteActionMode, string> = {
  issue: '/api/freight_operations/delivery-notes/issue',
  deliver: '/api/freight_operations/delivery-notes/deliver',
  cancel: '/api/freight_operations/delivery-notes/cancel',
  waybill: '/api/freight_operations/delivery-notes/record-waybill',
  waybill_cancel: '/api/freight_operations/delivery-notes/record-waybill',
}

export function DeliveryNoteActionDialog({
  note,
  mode,
  onOpenChange,
  onCompleted,
}: DeliveryNoteActionDialogProps) {
  const t = useT()
  const open = note !== null && mode !== null
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [receivedByName, setReceivedByName] = React.useState('')
  const [receivedByIdNumber, setReceivedByIdNumber] = React.useState('')
  const [podReference, setPodReference] = React.useState('')
  const [popReference, setPopReference] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [waybillNumber, setWaybillNumber] = React.useState('')
  const [waybillUrl, setWaybillUrl] = React.useState('')
  const [waybillNotes, setWaybillNotes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!note || !mode) return
    setReceivedByName(note.received_by_name ?? '')
    setReceivedByIdNumber(note.received_by_id_number ?? '')
    setPodReference(note.pod_reference ?? '')
    setPopReference(note.pop_reference ?? '')
    setReason('')
    setWaybillNumber(note.external_waybill_number ?? '')
    setWaybillUrl(note.external_waybill_url ?? '')
    setWaybillNotes(note.external_waybill_notes ?? '')
    setError(null)
  }, [mode, note])

  const submit = React.useCallback(async () => {
    if (!note || !mode) return
    if (mode === 'deliver' && receivedByName.trim().length === 0) {
      setError(t('freight_operations.delivery_notes.deliver.receivedByRequired', 'Enter the name of the person who received the goods.'))
      return
    }
    if (mode === 'deliver' && podReference.trim().length === 0) {
      setError(t('freight_operations.delivery_notes.deliver.podRequired', 'Enter a proof of delivery reference.'))
      return
    }
    if (mode === 'cancel' && reason.trim().length === 0) {
      setError(t('freight_operations.delivery_notes.cancel.reasonRequired', 'Enter the cancellation reason.'))
      return
    }
    if (mode === 'waybill' && waybillNumber.trim().length === 0) {
      setError(t('freight_operations.delivery_notes.waybill.numberRequired', 'Enter the Bayan Naql waybill number.'))
      return
    }

    const payloadByMode: Record<DeliveryNoteActionMode, Record<string, unknown>> = {
      issue: { id: note.id },
      deliver: {
        id: note.id,
        receivedByName: receivedByName.trim(),
        ...(receivedByIdNumber.trim() ? { receivedByIdNumber: receivedByIdNumber.trim() } : {}),
        podReference: podReference.trim(),
        ...(popReference.trim() ? { popReference: popReference.trim() } : {}),
      },
      cancel: { id: note.id, reason: reason.trim() },
      waybill: {
        id: note.id,
        status: 'recorded',
        waybillNumber: waybillNumber.trim(),
        ...(waybillUrl.trim() ? { url: waybillUrl.trim() } : {}),
        ...(waybillNotes.trim() ? { notes: waybillNotes.trim() } : {}),
      },
      waybill_cancel: {
        id: note.id,
        status: 'cancelled',
        ...(waybillNotes.trim() ? { notes: waybillNotes.trim() } : {}),
      },
    }

    setIsSaving(true)
    setError(null)
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(note.updatedAt ?? note.updated_at ?? null),
          () => apiCallOrThrow(ENDPOINTS[mode], {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payloadByMode[mode]),
          }, {
            errorMessage: t(
              `freight_operations.delivery_notes.${mode}.error`,
              'Unable to update the delivery note.',
            ),
          }),
        ),
        mutationPayload: { operation: `delivery_notes.${mode}`, id: note.id, updatedAt: note.updatedAt ?? null },
        context: {
          formId: CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: note.id,
          retryLastMutation,
        },
      })
      flash(
        t(
          `freight_operations.delivery_notes.${mode}.success`,
          'Delivery note updated.',
        ),
        'success',
      )
      onOpenChange(false)
      onCompleted()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : t(`freight_operations.delivery_notes.${mode}.error`, 'Unable to update the delivery note.'),
      )
    } finally {
      setIsSaving(false)
    }
  }, [
    mode,
    note,
    onCompleted,
    onOpenChange,
    podReference,
    popReference,
    reason,
    receivedByIdNumber,
    receivedByName,
    retryLastMutation,
    runMutation,
    t,
    waybillNotes,
    waybillNumber,
    waybillUrl,
  ])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
    disabled: isSaving,
  })

  if (!mode) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {t(`freight_operations.delivery_notes.${mode}.title`, ACTION_TITLE_FALLBACKS[mode])}
          </DialogTitle>
          <DialogDescription>
            {t(`freight_operations.delivery_notes.${mode}.description`, ACTION_DESCRIPTION_FALLBACKS[mode])}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {mode === 'deliver' ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">
                  {t('freight_operations.delivery_notes.fields.receivedByName', 'Received by')}
                </span>
                <Input value={receivedByName} onChange={(event) => setReceivedByName(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">
                  {t('freight_operations.delivery_notes.fields.receivedByIdNumber', 'Receiver ID number')}
                </span>
                <Input
                  value={receivedByIdNumber}
                  onChange={(event) => setReceivedByIdNumber(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">
                  {t('freight_operations.delivery_notes.fields.podReference', 'POD reference')}
                </span>
                <Input value={podReference} onChange={(event) => setPodReference(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">
                  {t('freight_operations.delivery_notes.fields.popReference', 'Proof of pickup reference')}
                </span>
                <Input value={popReference} onChange={(event) => setPopReference(event.target.value)} />
              </label>
            </>
          ) : null}
          {mode === 'cancel' ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.delivery_notes.fields.cancellationReason', 'Cancellation reason')}
              </span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
            </label>
          ) : null}
          {mode === 'waybill' ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">
                  {t('freight_operations.delivery_notes.fields.waybillNumber', 'Bayan Naql waybill number')}
                </span>
                <Input value={waybillNumber} onChange={(event) => setWaybillNumber(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">
                  {t('freight_operations.delivery_notes.fields.waybillUrl', 'Waybill link')}
                </span>
                <Input value={waybillUrl} onChange={(event) => setWaybillUrl(event.target.value)} />
              </label>
            </>
          ) : null}
          {mode === 'waybill' || mode === 'waybill_cancel' ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.delivery_notes.fields.waybillNotes', 'Waybill notes')}
              </span>
              <Textarea
                value={waybillNotes}
                onChange={(event) => setWaybillNotes(event.target.value)}
                rows={2}
              />
            </label>
          ) : null}
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }} disabled={isSaving}>
            {t(`freight_operations.delivery_notes.${mode}.submit`, ACTION_BUTTON_FALLBACKS[mode])}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
