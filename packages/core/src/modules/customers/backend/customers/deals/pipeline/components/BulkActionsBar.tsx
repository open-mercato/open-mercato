"use client"

import * as React from 'react'
import { Download, Trash2, Workflow, UserCircle2, X } from 'lucide-react'
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
      <button
        type="button"
        onClick={onClear}
        aria-label={translateWithFallback(
          t,
          'customers.deals.kanban.bulk.aria.clear',
          'Clear selection',
        )}
        className="inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>

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
        <button
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
        </button>
        <button
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
        </button>
        <button
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
        </button>
        <button
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
        </button>
      </div>
    </div>
  )
}

export default BulkActionsBar
