"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'

export function CalendarDiscardDialog({ open, onKeepEditing, onDiscard }: {
  open: boolean
  onKeepEditing(): void
  onDiscard(): void
}) {
  const t = useT()
  const keepEditingRef = React.useRef<HTMLButtonElement>(null)
  const handleKeyDown = useDialogKeyHandler({ onConfirm: onKeepEditing, onCancel: onKeepEditing })
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onKeepEditing() }}>
      <DialogContent onKeyDown={handleKeyDown} onOpenAutoFocus={(event) => {
        event.preventDefault()
        keepEditingRef.current?.focus()
      }}>
        <DialogTitle>{t('ui.forms.confirmUnsavedChanges')}</DialogTitle>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDiscard}>{t('customers.deals.detail.unsavedConfirm')}</Button>
          <Button type="button" ref={keepEditingRef} autoFocus onClick={onKeepEditing}>{t('customers.deals.detail.unsavedCancel')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
