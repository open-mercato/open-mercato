"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { handleSectionMutationError } from './optimisticLock'

export type ReturnEditRecord = {
  id: string
  reason: string | null
  notes: string | null
  returnedAt: string | null
  updatedAt: string | null
}

type ReturnEditFormValues = {
  id: string
  updatedAt: string | null
  reason: string
  notes: string
  returnedAt: string
}

type ReturnEditDialogProps = {
  open: boolean
  returnRecord: ReturnEditRecord | null
  orderId: string
  organizationId: string | null
  tenantId: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export function ReturnEditDialog({
  open,
  returnRecord,
  orderId,
  organizationId,
  tenantId,
  onClose,
  onSaved,
}: ReturnEditDialogProps) {
  const t = useT()
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)

  const initialValues = React.useMemo<ReturnEditFormValues>(
    () => ({
      id: returnRecord?.id ?? '',
      // Drives CrudForm's automatic optimistic-lock header derivation.
      updatedAt: returnRecord?.updatedAt ?? null,
      reason: returnRecord?.reason ?? '',
      notes: returnRecord?.notes ?? '',
      returnedAt: toDateInputValue(returnRecord?.returnedAt),
    }),
    [returnRecord],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'reason',
        label: t('sales.returns.reason', 'Reason'),
        type: 'text',
        placeholder: t('sales.returns.reason.placeholder', 'Optional'),
      },
      {
        id: 'returnedAt',
        label: t('sales.returns.returnedAt', 'Returned at'),
        type: 'date',
      },
      {
        id: 'notes',
        label: t('sales.returns.notes', 'Notes'),
        type: 'textarea',
        placeholder: t('sales.returns.notes.placeholder', 'Optional'),
      },
    ],
    [t],
  )

  const handleSubmit = React.useCallback(
    async (values: ReturnEditFormValues) => {
      if (!returnRecord) return
      const reason = typeof values.reason === 'string' ? values.reason.trim() : ''
      const notes = typeof values.notes === 'string' ? values.notes.trim() : ''
      const returnedAt = typeof values.returnedAt === 'string' ? values.returnedAt.trim() : ''
      try {
        const result = await updateCrud(
          'sales/returns',
          {
            id: returnRecord.id,
            orderId,
            ...(organizationId ? { organizationId } : {}),
            ...(tenantId ? { tenantId } : {}),
            reason,
            notes,
            ...(returnedAt ? { returnedAt } : {}),
          },
          {
            errorMessage: t('sales.returns.errors.update', 'Failed to update return.'),
          },
        )
        if (result.ok) {
          flash(t('sales.returns.updated', 'Return updated.'), 'success')
          onClose()
          await onSaved()
        }
      } catch (err) {
        if (handleSectionMutationError(err, t, () => void onSaved())) {
          onClose()
          return
        }
        throw err
      }
    },
    [onClose, onSaved, orderId, organizationId, returnRecord, t, tenantId],
  )

  const handleSubmitForm = React.useCallback(
    () => dialogContentRef.current?.querySelector('form')?.requestSubmit(),
    [],
  )
  const handleKeyDown = useDialogKeyHandler({
    onConfirm: handleSubmitForm,
    onCancel: onClose,
  })

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl" onKeyDown={handleKeyDown} ref={dialogContentRef}>
        <DialogHeader>
          <DialogTitle>{t('sales.returns.edit.title', 'Edit return')}</DialogTitle>
        </DialogHeader>
        <CrudForm<ReturnEditFormValues>
          embedded
          fields={fields}
          entityId={E.sales.sales_return}
          initialValues={initialValues}
          submitLabel={t('sales.returns.edit.submit', 'Save changes')}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
