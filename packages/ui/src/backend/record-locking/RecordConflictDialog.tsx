'use client'

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import type { RecordLockConflict } from './useRecordLock'

export type RecordConflictDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  conflict: RecordLockConflict | null
  pending?: boolean
  t: TranslateFn
  onResolve: (resolution: 'accept_mine' | 'merged') => Promise<void> | void
}

export function RecordConflictDialog({
  open,
  onOpenChange,
  conflict,
  pending = false,
  t,
  onResolve,
}: RecordConflictDialogProps) {
  const allowMerge = Boolean(conflict?.resolutionOptions?.includes('merged'))

  const handleResolve = React.useCallback(async (resolution: 'accept_mine' | 'merged') => {
    await onResolve(resolution)
  }, [onResolve])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('record_locks.conflict.title', 'Conflict detected')}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t('record_locks.conflict.description', 'The record was changed by another user after you started editing.')}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              onOpenChange(false)
            }}
          >
            {t('record_locks.conflict.accept_incoming', 'Accept incoming')}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              void handleResolve('accept_mine')
            }}
          >
            {t('record_locks.conflict.accept_mine', 'Keep my changes')}
          </Button>
          {allowMerge ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                void handleResolve('merged')
              }}
            >
              {t('record_locks.conflict.merged', 'Merge changes')}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
