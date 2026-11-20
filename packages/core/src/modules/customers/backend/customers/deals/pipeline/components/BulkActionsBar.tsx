"use client"

import * as React from 'react'
import { Download, Trash2, Workflow, UserCircle2, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

const COUNT_MARKER = '\uE000'
const ON_BAR_ICON_BUTTON = 'hover:bg-white/10'
const ON_BAR_DELETE_BUTTON = 'text-destructive hover:bg-destructive/10'
const DARK_SURFACE_TOKENS = 'dark'

function splitAroundCount(text: string): { before: string; after: string } {
  const index = text.indexOf(COUNT_MARKER)
  if (index === -1) return { before: '', after: text.trim() }
  return {
    before: text.slice(0, index).trim(),
    after: text.slice(index + COUNT_MARKER.length).trim(),
  }
}

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

  const selectedLabel = splitAroundCount(
    translateWithFallback(t, 'customers.deals.kanban.bulk.selectedCount', '{count} selected', {
      count: COUNT_MARKER,
    }),
  )

  const changeStageLabel = translateWithFallback(t, 'customers.deals.kanban.bulk.changeStage', 'Change stage')
  const changeOwnerLabel = translateWithFallback(t, 'customers.deals.kanban.bulk.changeOwner', 'Change owner')
  const exportLabel = translateWithFallback(t, 'customers.deals.kanban.bulk.exportCsv', 'Export CSV')
  const deleteLabel = translateWithFallback(t, 'customers.deals.kanban.bulk.delete', 'Delete')

  return (
    <div
      role="region"
      aria-label={translateWithFallback(t, 'customers.deals.kanban.bulk.aria.bar', 'Bulk actions')}
      className={`${DARK_SURFACE_TOKENS} sticky bottom-4 z-sticky flex w-full flex-wrap items-center gap-2 rounded-lg bg-neutral-700 px-3 py-2 text-white shadow-lg sm:gap-x-3`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <IconButton
          variant="modifiable"
          size="sm"
          type="button"
          onClick={onClear}
          aria-label={translateWithFallback(t, 'customers.deals.kanban.bulk.aria.clear', 'Clear selection')}
          className={ON_BAR_ICON_BUTTON}
        >
          <X aria-hidden="true" />
        </IconButton>
        <span className="inline-flex items-center gap-1.5 text-sm" data-testid="kanban-bulk-selected-count">
          {selectedLabel.before ? <span>{selectedLabel.before}</span> : null}
          <span className="tabular-nums">{count}</span>
          {selectedLabel.after ? <span>{selectedLabel.after}</span> : null}
        </span>
        {totalLabel ? (
          <span className="hidden pl-2 text-sm text-neutral-300 sm:inline" data-testid="kanban-bulk-total">
            {translateWithFallback(t, 'customers.deals.kanban.bulk.totalValue', 'Total {value}', { value: totalLabel })}
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <SimpleTooltip content={changeOwnerLabel}>
          <IconButton
            variant="modifiable"
            type="button"
            onClick={onChangeOwner}
            aria-label={changeOwnerLabel}
            className={ON_BAR_ICON_BUTTON}
          >
            <UserCircle2 aria-hidden="true" />
          </IconButton>
        </SimpleTooltip>
        <SimpleTooltip content={exportLabel}>
          <IconButton
            variant="modifiable"
            type="button"
            onClick={onExportCsv}
            aria-label={exportLabel}
            className={ON_BAR_ICON_BUTTON}
          >
            <Download aria-hidden="true" />
          </IconButton>
        </SimpleTooltip>
        <SimpleTooltip content={deleteLabel}>
          <IconButton
            variant="modifiable"
            type="button"
            onClick={onDelete}
            aria-label={deleteLabel}
            className={ON_BAR_DELETE_BUTTON}
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
        </SimpleTooltip>
        <Button
          size="sm"
          type="button"
          onClick={onChangeStage}
          className="ml-2 w-8 bg-white text-neutral-900 shadow-none hover:bg-neutral-100 has-[>svg]:px-0 sm:w-auto sm:has-[>svg]:px-2.5"
        >
          <Workflow aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{changeStageLabel}</span>
        </Button>
      </div>
    </div>
  )
}
