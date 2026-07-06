"use client"
import * as React from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { dismissRecordConflict, useRecordConflict } from './store'

/**
 * Persistent, error-styled bar that surfaces an optimistic-lock conflict
 * ("this record was modified by someone else"). Rendered once in `AppShell`
 * next to the undo `LastOperationBanner`, it is the unified, clearly-visible
 * surface for the conflict across every form (CrudForm, useGuardedMutation,
 * and custom pages all push through `conflicts/store`). Unlike the undo bar it
 * does NOT auto-dismiss — the user resolves it by refreshing or dismissing.
 */
export function RecordConflictBanner() {
  const t = useT()
  const conflict = useRecordConflict()

  const handleRefresh = React.useCallback(() => {
    const onRefresh = conflict?.onRefresh ?? null
    dismissRecordConflict()
    if (onRefresh) {
      onRefresh()
      return
    }
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      try {
        const isJSDOM = typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
          ? navigator.userAgent.toLowerCase().includes('jsdom')
          : false
        if (!isJSDOM) window.location.reload()
      } catch {
        // noop in non-browser / jsdom environments
      }
    }
  }, [conflict])

  if (!conflict) return null

  return (
    <div
      role="alert"
      data-testid="record-conflict-banner"
      className="mb-4 flex items-center justify-between gap-3 rounded-md border border-status-error-border bg-status-error-bg pl-3 pr-2 py-2 text-sm text-status-error-text shadow-xs sm:pr-3"
    >
      <div className="min-w-0">
        <span className="font-medium text-status-error-text">
          {conflict.title ?? t('ui.forms.conflict.title', 'Record changed')}
        </span>
        <span className="ml-2 text-status-error-text">{conflict.message}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="border-status-error-border bg-status-error-bg text-status-error-text hover:bg-status-error-border hover:text-status-error-text px-2.5 sm:px-3"
        >
          <RefreshCw className="mr-1 size-4" aria-hidden="true" />
          {t('ui.forms.conflict.refresh', 'Refresh')}
        </Button>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('ui.forms.conflict.dismiss', 'Dismiss')}
          onClick={() => dismissRecordConflict()}
        >
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}
