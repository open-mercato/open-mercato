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
import type { PendingActionConfirmation } from '../types'

type DialogsProps = {
  pendingActionConfirmation: PendingActionConfirmation | null
  setPendingActionConfirmation: (value: PendingActionConfirmation | null) => void
  executingActionId: string | null
  handleConfirmPendingAction: () => Promise<void>
  handleActionConfirmDialogKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  deleteConfirmationOpen: boolean
  setDeleteConfirmationOpen: (value: boolean) => void
  updatingState: boolean
  handleDelete: () => Promise<void>
  handleDeleteDialogKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

export function MessageDetailDialogs(props: DialogsProps) {
  const t = useT()

  return (
    <>
      <Dialog
        open={Boolean(props.pendingActionConfirmation)}
        onOpenChange={(open) => {
          if (!open) props.setPendingActionConfirmation(null)
        }}
      >
        <DialogContent className="sm:max-w-md" onKeyDown={props.handleActionConfirmDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('messages.confirm.actionTitle', 'Confirm action')}</DialogTitle>
            <DialogDescription>
              {props.pendingActionConfirmation?.action.confirmMessage
                || t('messages.confirm.action', 'Are you sure you want to continue?')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.setPendingActionConfirmation(null)}
              disabled={props.executingActionId !== null}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant={props.pendingActionConfirmation?.action.variant === 'destructive' ? 'destructive' : 'default'}
              onClick={() => void props.handleConfirmPendingAction()}
              disabled={props.executingActionId !== null}
            >
              {props.executingActionId === props.pendingActionConfirmation?.action.id
                ? t('messages.actions.executing', 'Executing...')
                : t(
                  props.pendingActionConfirmation?.action.labelKey || props.pendingActionConfirmation?.action.label || 'messages.confirm.actionConfirm',
                  props.pendingActionConfirmation?.action.label || t('messages.confirm.actionConfirm', 'Confirm'),
                )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={props.deleteConfirmationOpen}
        onOpenChange={props.setDeleteConfirmationOpen}
      >
        <DialogContent className="sm:max-w-md" onKeyDown={props.handleDeleteDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('messages.confirm.deleteTitle', 'Delete message')}</DialogTitle>
            <DialogDescription>
              {t('messages.confirm.delete', 'Delete this message from your view?')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.setDeleteConfirmationOpen(false)}
              disabled={props.updatingState}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void props.handleDelete()}
              disabled={props.updatingState}
            >
              {t('messages.actions.delete', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
