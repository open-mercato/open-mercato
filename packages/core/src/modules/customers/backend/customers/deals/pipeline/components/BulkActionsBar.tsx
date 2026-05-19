"use client"

import * as React from 'react'
import { Download, Trash2, Workflow, UserCircle2, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

type BulkActionsBarProps = {
  count: number
  totalLabel: string | null
  onChangeStage: () => void
  onChangeOwner: () => void
  onExportCsv: () => void
  onDelete: () => void
  onClear: () => void
}

export function BulkActionsBar({
  count,
  totalLabel,
  onChangeStage,
  onChangeOwner,
  onExportCsv,
  onDelete,
  onClear,
}: BulkActionsBarProps): React.ReactElement | null {
  const t = useT()
  // Global ESC clears the selection — matches the Gmail/Asana/Notion convention. The
  // listener is only mounted while at least one deal is selected so we don't intercept
  // ESC anywhere else on the kanban (e.g. inside dialogs/popovers, which all stopPropagation
  // before their own ESC handlers fire). `count` is the only thing that gates "is the bar
  // currently rendered?", and `onClear` is the page-level handler that empties the Set.
  React.useEffect(() => {
    if (count === 0) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Defer if the focus is inside an editable surface — typing ESC to abort a value
      // edit shouldn't also clear the bulk selection.
      const active = document.activeElement as HTMLElement | null
      if (active) {
        const tag = active.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return
      }
      event.preventDefault()
      onClear()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [count, onClear])

  if (count === 0) return null

  return (
    <div
      role="region"
      aria-label={translateWithFallback(
        t,
        'customers.deals.kanban.bulk.aria.bar',
        'Bulk actions',
      )}
      className="fixed bottom-6 left-1/2 z-toast flex w-[min(960px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-background shadow-xl"
    >
      <IconButton
        variant="ghost"
        size="xs"
        onClick={onClear}
        aria-label={translateWithFallback(
          t,
          'customers.deals.kanban.bulk.aria.clear',
          'Clear selection',
        )}
        className="inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </IconButton>

      <span className="inline-flex size-7 items-center justify-center rounded-md bg-background/10 text-xs font-semibold">
        {count}
      </span>
      <span className="text-sm font-medium">
        {translateWithFallback(
          t,
          'customers.deals.kanban.bulk.selectedCount',
          'selected',
        )}
      </span>
      {totalLabel ? (
        <span className="hidden text-sm text-background/80 sm:inline">
          ·{' '}
          {translateWithFallback(
            t,
            'customers.deals.kanban.bulk.totalValue',
            'Total {value}',
            { value: totalLabel },
          )}
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onChangeStage}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm transition-colors hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
        >
          <Workflow className="size-4" aria-hidden="true" />
          <span>
            {translateWithFallback(
              t,
              'customers.deals.kanban.bulk.changeStage',
              'Change stage',
            )}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onChangeOwner}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm transition-colors hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
        >
          <UserCircle2 className="size-4" aria-hidden="true" />
          <span>
            {translateWithFallback(
              t,
              'customers.deals.kanban.bulk.changeOwner',
              'Change owner',
            )}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onExportCsv}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm transition-colors hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
        >
          <Download className="size-4" aria-hidden="true" />
          <span>
            {translateWithFallback(
              t,
              'customers.deals.kanban.bulk.exportCsv',
              'Export CSV',
            )}
          </span>
        </Button>
        <Button
          variant="destructive-ghost"
          size="sm"
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm text-status-error-text transition-colors hover:bg-status-error-bg/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          <span>
            {translateWithFallback(
              t,
              'customers.deals.kanban.bulk.delete',
              'Delete',
            )}
          </span>
        </Button>
      </div>
    </div>
  )
}

export default BulkActionsBar
