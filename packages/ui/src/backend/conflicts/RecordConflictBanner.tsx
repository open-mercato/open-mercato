"use client"
import * as React from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { dismissRecordConflict, useRecordConflict } from './store'

const MODAL_PLACEMENT_CLASS: Record<string, string> = {
  'dialog-content': 'mr-6',
  'drawer-content': 'm-4 mr-14',
  'sheet-content': 'm-4 mr-14',
}

const OPEN_MODAL_CONTENT_SELECTOR = Object.keys(MODAL_PLACEMENT_CLASS)
  .map((slot) => `[data-slot="${slot}"][data-state="open"]`)
  .join(', ')

function findTopmostOpenModalContent(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const candidates = document.querySelectorAll<HTMLElement>(OPEN_MODAL_CONTENT_SELECTOR)
  return candidates.length > 0 ? candidates[candidates.length - 1] : null
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

function useTopmostOpenModalContent(active: boolean): HTMLElement | null {
  const [container, setContainer] = React.useState<HTMLElement | null>(null)

  useIsomorphicLayoutEffect(() => {
    if (!active || typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      setContainer(null)
      return
    }
    const sync = () => setContainer(findTopmostOpenModalContent())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    })
    return () => observer.disconnect()
  }, [active])

  return active ? container : null
}

/**
 * Persistent, error-styled bar that surfaces an optimistic-lock conflict
 * ("this record was modified by someone else"). Rendered once in `AppShell`
 * next to the undo `LastOperationBanner`, it is the unified, clearly-visible
 * surface for the conflict across every form (CrudForm, useGuardedMutation,
 * and custom pages all push through `conflicts/store`). Unlike the undo bar it
 * does NOT auto-dismiss — the user resolves it by refreshing or dismissing.
 *
 * While a modal dialog, drawer or sheet is open the inline bar sits under its
 * overlay (blurred and outside the focus/pointer trap), so the bar is portaled
 * into the topmost open modal content instead, keeping Refresh reachable.
 */
export function RecordConflictBanner() {
  const t = useT()
  const conflict = useRecordConflict()
  const modalContainer = useTopmostOpenModalContent(Boolean(conflict))

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

  const banner = (
    <div
      role="alert"
      data-testid="record-conflict-banner"
      data-placement={modalContainer ? 'modal' : 'page'}
      className={cn(
        modalContainer
          ? cn('sticky top-0 z-sticky order-first shrink-0', MODAL_PLACEMENT_CLASS[modalContainer.dataset.slot ?? ''])
          : 'mb-4',
        'flex items-center justify-between gap-3 rounded-md border border-status-error-border bg-status-error-bg pl-3 pr-2 py-2 text-sm text-status-error-text shadow-xs sm:pr-3',
      )}
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

  return modalContainer ? createPortal(banner, modalContainer) : banner
}
