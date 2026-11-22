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
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const RESOURCE = 'freight_operations/delivery-notes'
const ENTITY_ID = 'freight_operations:freight_delivery_note'
const CONTEXT_ID = 'freight_operations.delivery_notes.create'

type CreateDeliveryNoteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  freightOrderId?: string | null
  freightTripId?: string | null
  sourceLabel?: string | null
  requiresCargoDescription?: boolean
  onCreated: () => void
}

export function CreateDeliveryNoteDialog({
  open,
  onOpenChange,
  freightOrderId,
  freightTripId,
  sourceLabel,
  requiresCargoDescription = false,
  onCreated,
}: CreateDeliveryNoteDialogProps) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const [cargoDescription, setCargoDescription] = React.useState('')
  const [consigneeName, setConsigneeName] = React.useState('')
  const [consigneePhone, setConsigneePhone] = React.useState('')
  const [consigneeAddress, setConsigneeAddress] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setCargoDescription('')
    setConsigneeName('')
    setConsigneePhone('')
    setConsigneeAddress('')
    setNotes('')
    setError(null)
  }, [open])

  const submit = React.useCallback(async () => {
    if (requiresCargoDescription && cargoDescription.trim().length === 0) {
      setError(t('freight_operations.delivery_notes.create.cargoRequired', 'Enter the cargo description.'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      if (freightOrderId) payload.freightOrderId = freightOrderId
      if (freightTripId) payload.freightTripId = freightTripId
      if (cargoDescription.trim()) payload.cargoDescription = cargoDescription.trim()
      if (consigneeName.trim()) payload.consigneeName = consigneeName.trim()
      if (consigneePhone.trim()) payload.consigneePhone = consigneePhone.trim()
      if (consigneeAddress.trim()) payload.consigneeAddress = consigneeAddress.trim()
      if (notes.trim()) payload.notes = notes.trim()
      await runMutation({
        operation: () => createCrud(RESOURCE, payload, {
          errorMessage: t('freight_operations.delivery_notes.create.error', 'Unable to create the delivery note.'),
        }),
        mutationPayload: { operation: 'delivery_notes.create', ...payload },
        context: {
          formId: CONTEXT_ID,
          resourceKind: ENTITY_ID,
          retryLastMutation,
        },
      })
      flash(t('freight_operations.delivery_notes.create.success', 'Delivery note created.'), 'success')
      onOpenChange(false)
      onCreated()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : t('freight_operations.delivery_notes.create.error', 'Unable to create the delivery note.'),
      )
    } finally {
      setIsSaving(false)
    }
  }, [
    cargoDescription,
    consigneeAddress,
    consigneeName,
    consigneePhone,
    freightOrderId,
    freightTripId,
    notes,
    onCreated,
    onOpenChange,
    requiresCargoDescription,
    retryLastMutation,
    runMutation,
    t,
  ])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
    disabled: isSaving,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.delivery_notes.create.title', 'New delivery note')}</DialogTitle>
          <DialogDescription>
            {sourceLabel
              ? t(
                  'freight_operations.delivery_notes.create.descriptionWithSource',
                  'Create a draft delivery note for {source}. The cargo and route are copied from the source.',
                  { source: sourceLabel },
                )
              : t(
                  'freight_operations.delivery_notes.create.description',
                  'Create a draft delivery note. The cargo and route are copied from the source.',
                )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t('freight_operations.delivery_notes.fields.cargoDescription', 'Cargo description')}
            </span>
            <Input
              value={cargoDescription}
              onChange={(event) => setCargoDescription(event.target.value)}
              placeholder={requiresCargoDescription
                ? t('freight_operations.delivery_notes.create.cargoPlaceholderRequired', 'Required for this trip')
                : t('freight_operations.delivery_notes.create.cargoPlaceholderOptional', 'Leave blank to use the order cargo')}
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.delivery_notes.fields.consigneeName', 'Consignee')}
              </span>
              <Input value={consigneeName} onChange={(event) => setConsigneeName(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t('freight_operations.delivery_notes.fields.consigneePhone', 'Consignee phone')}
              </span>
              <Input value={consigneePhone} onChange={(event) => setConsigneePhone(event.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t('freight_operations.delivery_notes.fields.consigneeAddress', 'Delivery address')}
            </span>
            <Textarea
              value={consigneeAddress}
              onChange={(event) => setConsigneeAddress(event.target.value)}
              rows={2}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t('freight_operations.delivery_notes.fields.notes', 'Notes')}
            </span>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }} disabled={isSaving}>
            {t('freight_operations.delivery_notes.create.submit', 'Create delivery note')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
