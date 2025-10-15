"use client"
import * as React from 'react'
import { Undo2 } from 'lucide-react'
import { Button } from '../primitives/button'
import { apiFetch } from '../utils/api'
import { flash } from '../FlashMessages'
import { useLastOperation, markUndoSuccess } from './store'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function LastOperationBanner() {
  const t = useT()
  const operation = useLastOperation()
  const [pendingToken, setPendingToken] = React.useState<string | null>(null)

  if (!operation) return null

  const label = operation.actionLabel || operation.commandId
  const isPending = pendingToken === operation.undoToken

  async function handleUndo() {
    if (!operation.undoToken || isPending) return
    setPendingToken(operation.undoToken)
    try {
      const res = await apiFetch('/api/audit_logs/audit-logs/actions/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undoToken: operation.undoToken }),
      })
      if (!res.ok) {
        const message = await res.text().catch(() => '')
        throw new Error(message || 'Failed to undo')
      }
      markUndoSuccess(operation.undoToken)
      flash(t('audit_logs.banner.undo_success'), 'success')
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t('audit_logs.banner.undo_error')
      flash(message, 'error')
    } finally {
      setPendingToken(null)
    }
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
      <div className="min-w-0 truncate">
        <span className="font-medium text-foreground">
          {t('audit_logs.banner.last_operation')}
        </span>
        <span className="ml-2 truncate text-foreground">
          {label}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { void handleUndo() }}
        disabled={isPending}
      >
        <Undo2 className="mr-1 size-4" aria-hidden="true" />
        {isPending ? t('audit_logs.actions.undoing') : t('audit_logs.banner.undo')}
      </Button>
    </div>
  )
}
