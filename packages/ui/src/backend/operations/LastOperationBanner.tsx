"use client"
import * as React from 'react'
import { Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '../../primitives/button'
import { apiCall } from '../utils/apiCall'
import { flash } from '../FlashMessages'
import { useLastOperation, markUndoSuccess, dismissOperation, operationStackConstants } from './store'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function LastOperationBanner() {
  const t = useT()
  const operation = useLastOperation()
  const [pendingToken, setPendingToken] = React.useState<string | null>(null)
  const router = useRouter()

  const undoToken = operation?.undoToken ?? null
  const isPending = undoToken !== null && pendingToken === undoToken

  React.useEffect(() => {
    if (!undoToken || isPending) return
    const timer = setTimeout(() => {
      dismissOperation(undoToken)
    }, operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [undoToken, isPending])

  if (!operation) return null

  const rawLabel = operation.actionLabel ?? operation.commandId
  const translatedLabel = t(rawLabel)
  const label = translatedLabel === rawLabel ? rawLabel : translatedLabel

  async function handleUndo() {
    const undoToken = operation?.undoToken
    if (!undoToken || isPending) return
    const tokens = operation.bulkUndoTokens && operation.bulkUndoTokens.length > 0
      ? operation.bulkUndoTokens
      : [undoToken]
    setPendingToken(undoToken)
    const completed: string[] = []
    try {
      for (const token of tokens.slice().reverse()) {
        const call = await apiCall<Record<string, unknown>>('/api/audit_logs/audit-logs/actions/undo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ undoToken: token }),
        })
        if (!call.ok) {
          const message =
            (call.result && typeof call.result.error === 'string' && call.result.error) ||
            ''
          throw new Error(message || t('audit_logs.banner.undo_failed', 'Failed to undo'))
        }
        completed.push(token)
      }
      markUndoSuccess(tokens)
      flash(t('audit_logs.banner.undo_success'), 'success')
      router.refresh()
      if (typeof window !== 'undefined') {
        try {
          const isJSDOM = typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
            ? navigator.userAgent.toLowerCase().includes('jsdom')
            : false
          if (!isJSDOM && typeof window.location?.reload === 'function') {
            window.location.reload()
          }
        } catch {
          // noop in non-browser or jsdom environments
        }
      }
    } catch (err) {
      if (completed.length > 0) markUndoSuccess(completed)
      const message = err instanceof Error && err.message ? err.message : t('audit_logs.banner.undo_error')
      flash(message, 'error')
    } finally {
      setPendingToken(null)
    }
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-status-warning-border bg-status-warning-bg pl-3 pr-2 py-2 text-sm text-status-warning-text shadow-xs sm:pr-3">
      <div className="min-w-0 truncate">
        <span className="font-medium text-status-warning-text">
          {t('audit_logs.banner.last_operation')}
        </span>
        <span className="ml-2 truncate text-status-warning-text">
          {label}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { void handleUndo() }}
        disabled={isPending}
        className="border-status-warning-border bg-status-warning-bg text-status-warning-text hover:bg-status-warning-border hover:text-status-warning-text px-2.5 sm:px-3"
      >
        <Undo2 className="mr-1 size-4" aria-hidden="true" />
        {isPending ? t('audit_logs.actions.undoing') : t('audit_logs.banner.undo')}
      </Button>
    </div>
  )
}
