"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { DealForm, type DealFormBaseValues, type DealFormSubmitPayload } from './DealForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type DealDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  onOpenChange: (next: boolean) => void
  initialValues?: Partial<DealFormBaseValues & Record<string, unknown>>
  onSubmit: (payload: DealFormSubmitPayload) => Promise<void>
  isSubmitting?: boolean
  titles?: {
    create?: string
    edit?: string
  }
  submitLabels?: {
    create?: string
    edit?: string
  }
  cancelLabel?: string
}

export function DealDialog({
  open,
  mode,
  onOpenChange,
  initialValues,
  onSubmit,
  isSubmitting,
  titles,
  submitLabels,
  cancelLabel,
}: DealDialogProps) {
  const t = useT()

  const dialogTitle =
    mode === 'edit'
      ? titles?.edit ?? t('customers.people.detail.deals.editTitle', 'Edit deal')
      : titles?.create ?? t('customers.people.detail.deals.addTitle', 'Add deal')

  const resolvedSubmitLabel =
    mode === 'edit'
      ? submitLabels?.edit ?? t('customers.people.detail.deals.update', 'Update deal (⌘/Ctrl + Enter)')
      : submitLabels?.create ?? t('customers.people.detail.deals.save', 'Save deal (⌘/Ctrl + Enter)')

  const resolvedCancelLabel = cancelLabel ?? t('customers.people.detail.deals.cancel', 'Cancel')

  const handleCancel = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl w-full">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <DealForm
          mode={mode}
          initialValues={initialValues}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          submitLabel={resolvedSubmitLabel}
          cancelLabel={resolvedCancelLabel}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  )
}

export default DealDialog
