"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmailAttachmentsList } from './EmailAttachmentsList'

export type EmailAttachmentsDialogProps = {
  /** The email whose attachments are shown; `null` closes the dialog. */
  email: { id: string; subject?: string | null } | null
  onClose: () => void
}

/**
 * The processing log's "Show attachments" dialog. The list is mounted only while the dialog is
 * open, so the log page issues no attachment request on load.
 */
export function EmailAttachmentsDialog({ email, onClose }: EmailAttachmentsDialogProps) {
  const t = useT()
  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      onClose()
    }
  }, [onClose])

  return (
    <Dialog open={email !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('inbox_ops.attachments.title', 'Attachments')}</DialogTitle>
          <DialogDescription>{email?.subject || t('inbox_ops.attachments.dialogDescription', 'Files received with this email')}</DialogDescription>
        </DialogHeader>
        {email ? <EmailAttachmentsList emailId={email.id} /> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
