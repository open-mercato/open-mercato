"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  fileName?: string | null
  onConfirm: () => void
  isDeleting?: boolean
}

export function AttachmentDeleteDialog({ open, onOpenChange, fileName, onConfirm, isDeleting }: Props) {
  const t = useT()
  const description = t(
    'attachments.library.confirm.delete',
    'Delete attachment "{{name}}"? This action cannot be undone.',
  ).replace('{{name}}', fileName || t('attachments.library.metadata.title', 'attachment'))

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (!isDeleting) onConfirm()
      }
    },
    [isDeleting, onConfirm, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('attachments.library.actions.delete', 'Delete')}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            {t('attachments.library.metadata.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {t('attachments.library.actions.delete', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
