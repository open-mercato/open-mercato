"use client"

import * as React from 'react'
import Link from 'next/link'
import { ChevronRight, RotateCcw, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

/**
 * Action-launcher dialog for the kanban board:
 *   - "Configure card fields"
 *   - "Manage pipeline stages"
 *   - "Reset column widths" (only enabled when at least one lane has been resized)
 *   - "Reset to default" (clears filters, restores columns)
 *
 * NOTE: a hardcoded "Saved views" radio group used to live here (Domyślny widok / Mój
 * pipeline / Closing this month / Stuck deals). Selecting an item only updated a local
 * activeViewId — no filters changed, nothing persisted. The reviewer flagged it as
 * misleading, and the perspectives-backed implementation is not in scope for this PR.
 * We removed the section entirely; once a real saved-view system lands, restore it with
 * actual filter application and persistence.
 */
type CustomizeViewDialogProps = {
  open: boolean
  /** Number of lanes the user has manually resized — displayed alongside the reset action */
  resizedLanesCount?: number
  onClose: () => void
  onResetToDefault: () => void
  onConfigureCardFields: () => void
  /** Clear all per-stage width overrides so every lane falls back to its default width */
  onResetColumnWidths?: () => void
}

export function CustomizeViewDialog({
  open,
  resizedLanesCount = 0,
  onClose,
  onResetToDefault,
  onConfigureCardFields,
  onResetColumnWidths,
}: CustomizeViewDialogProps): React.ReactElement {
  const t = useT()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>
              {translateWithFallback(t, 'customers.deals.kanban.customize.title', 'Customize view')}
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" type="button" onClick={onResetToDefault}>
                <RotateCcw className="size-3" aria-hidden="true" />
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.customize.reset',
                  'Reset to default',
                )}
              </Button>
              <button
                type="button"
                onClick={onClose}
                aria-label={translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')}
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-1">
            <span className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
              {translateWithFallback(t, 'customers.deals.kanban.customize.actions', 'Actions')}
            </span>
            <button
              type="button"
              onClick={onConfigureCardFields}
              className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {translateWithFallback(
                    t,
                    'customers.deals.kanban.customize.configCols',
                    'Configure card fields',
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {translateWithFallback(
                    t,
                    'customers.deals.kanban.customize.configCols.help',
                    'Show / hide / reorder',
                  )}
                </span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </button>
            <Link
              href="/backend/config/customers/pipeline-stages"
              className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => onClose()}
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {translateWithFallback(
                    t,
                    'customers.deals.kanban.customize.manageStages',
                    'Manage pipeline stages',
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {translateWithFallback(
                    t,
                    'customers.deals.kanban.customize.manageStages.help',
                    'Edit names, colors, required fields',
                  )}
                </span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </Link>
            {onResetColumnWidths ? (
              <button
                type="button"
                disabled={resizedLanesCount === 0}
                onClick={() => {
                  onResetColumnWidths()
                  onClose()
                }}
                className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {translateWithFallback(
                      t,
                      'customers.deals.kanban.customize.resetWidths',
                      'Reset column widths',
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {resizedLanesCount > 0
                      ? translateWithFallback(
                          t,
                          'customers.deals.kanban.customize.resetWidths.helpCount',
                          'Restore the default width on {count} resized column(s)',
                          { count: resizedLanesCount },
                        )
                      : translateWithFallback(
                          t,
                          'customers.deals.kanban.customize.resetWidths.helpEmpty',
                          'No columns have been resized yet',
                        )}
                  </span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onResetToDefault()
                onClose()
              }}
              className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {translateWithFallback(
                    t,
                    'customers.deals.kanban.customize.resetDefault',
                    'Reset to default',
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {translateWithFallback(
                    t,
                    'customers.deals.kanban.customize.resetDefault.help',
                    'Clear filters and restore columns',
                  )}
                </span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </button>
          </section>
        </div>

        <div className="flex items-center justify-end border-t border-border pt-3">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            {translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CustomizeViewDialog
