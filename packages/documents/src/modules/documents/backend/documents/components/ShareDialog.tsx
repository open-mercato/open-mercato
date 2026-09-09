"use client"

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
import { ShareDialogAddForm } from './ShareDialogAddForm'
import { ShareDialogList } from './ShareDialogList'
import { useShareDialog } from './useShareDialog'

type ShareDialogProps = {
  documentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Explicit live share capability. Omission retains the pre-capability public
   * component contract; new in-app callers must always pass the server value.
   * Server authorization remains authoritative for every mutation.
   * @default true
   */
  canManage?: boolean
}

export function ShareDialog({
  documentId,
  open,
  onOpenChange,
  canManage = true,
}: ShareDialogProps) {
  const t = useT()
  const dialog = useShareDialog({ documentId, open, canManage })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !dialog.isSubmitting) {
            event.preventDefault()
            void dialog.addShare()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('documents.share.dialog.title')}</DialogTitle>
          <DialogDescription>{t('documents.share.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ShareDialogAddForm
            documentId={documentId}
            principalType={dialog.principalType}
            principalId={dialog.principalId}
            permission={dialog.permission}
            canManage={canManage}
            isSubmitting={dialog.isSubmitting}
            onPrincipalTypeChange={dialog.changePrincipalType}
            onPrincipalIdChange={dialog.setPrincipalId}
            onPermissionChange={dialog.setPermission}
            onSubmit={dialog.addShare}
          />
          <ShareDialogList
            shares={dialog.shares}
            isLoading={dialog.isLoading}
            error={dialog.error}
            canManage={canManage}
            pendingShareIds={dialog.pendingShareIds}
            onRetry={() => void dialog.reload()}
            onPermissionChange={dialog.changePermission}
            onRemove={dialog.removeShare}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('documents.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
