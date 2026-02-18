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
  onResolve: (resolution: 'accept_mine') => Promise<void> | void
}

export function RecordConflictDialog({
  open,
  onOpenChange,
  conflict,
  pending = false,
  t,
  onResolve,
}: RecordConflictDialogProps) {
  const conflictChanges = conflict?.changes ?? []

  const handleResolve = React.useCallback(async (resolution: 'accept_mine') => {
    await onResolve(resolution)
  }, [onResolve])

  const formatValue = React.useCallback((value: unknown): string => {
    if (value === null || value === undefined || value === '') {
      return t('record_locks.conflict.empty_value', '(empty)')
    }
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value)
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }, [t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(96vw,1100px)] sm:max-w-[1100px]">
        <DialogHeader>
          <DialogTitle>{t('record_locks.conflict.title', 'Conflict detected')}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t('record_locks.conflict.description', 'The record was changed by another user after you started editing.')}
        </p>

        {conflictChanges.length ? (
          <div className="mt-4 rounded-md border border-border/70">
            <div className="max-h-56 overflow-auto">
              <div className="grid min-w-[860px] grid-cols-[1.35fr_1fr_1fr_1fr] gap-2 border-b border-border/70 bg-muted/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>{t('record_locks.conflict.field', 'Field')}</span>
                <span>{t('record_locks.conflict.display_value', 'Display value')}</span>
                <span>{t('record_locks.conflict.incoming_value', 'Incoming value')}</span>
                <span>{t('record_locks.conflict.mine_value', 'Your value')}</span>
              </div>
              {conflictChanges.map((entry) => (
                <div key={entry.field} className="grid min-w-[860px] grid-cols-[1.35fr_1fr_1fr_1fr] gap-2 border-b border-border/50 px-3 py-2 text-xs last:border-b-0">
                  <div className="break-all font-medium text-foreground">{entry.field}</div>
                  <div className="break-words text-muted-foreground">{formatValue(entry.displayValue)}</div>
                  <div className="break-words text-muted-foreground">{formatValue(entry.incomingValue)}</div>
                  <div className="break-words text-foreground">{formatValue(entry.mineValue)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

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
        </div>
      </DialogContent>
    </Dialog>
  )
}
