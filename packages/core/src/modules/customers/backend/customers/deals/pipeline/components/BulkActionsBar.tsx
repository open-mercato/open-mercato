"use client"

import * as React from 'react'
import { BulkActionBar } from '@open-mercato/ui/blocks/bulk-action-bar'
import type { BlockAction } from '@open-mercato/ui/blocks/contracts/shared'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

type BulkActionsBarProps = {
  count: number
  totalLabel: string | null
  onChangeStage?: () => void
  onChangeOwner?: () => void
  onExportCsv: () => void
  onDelete?: () => void
  onClear: () => void
}

const CHANGE_STAGE_KEY = 'change-stage'
const CHANGE_OWNER_KEY = 'change-owner'
const EXPORT_CSV_KEY = 'export-csv'
const DELETE_KEY = 'delete'
const VISIBLE_ACTIONS = 4

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

  const actions = React.useMemo<BlockAction[]>(() => {
    const available: BlockAction[] = []
    if (onChangeStage) {
      available.push({
        key: CHANGE_STAGE_KEY,
        label: translateWithFallback(t, 'customers.deals.kanban.bulk.changeStage', 'Change stage'),
        icon: 'workflow',
      })
    }
    if (onChangeOwner) {
      available.push({
        key: CHANGE_OWNER_KEY,
        label: translateWithFallback(t, 'customers.deals.kanban.bulk.changeOwner', 'Change owner'),
        icon: 'user-circle-2',
      })
    }
    available.push({
      key: EXPORT_CSV_KEY,
      label: translateWithFallback(t, 'customers.deals.kanban.bulk.exportCsv', 'Export CSV'),
      icon: 'download',
    })
    if (onDelete) {
      available.push({
        key: DELETE_KEY,
        label: translateWithFallback(t, 'customers.deals.kanban.bulk.delete', 'Delete'),
        icon: 'trash-2',
        tone: 'destructive',
      })
    }
    return available
  }, [onChangeOwner, onChangeStage, onDelete, t])

  const handleAction = React.useCallback(
    (actionKey: string): void => {
      if (actionKey === CHANGE_STAGE_KEY) onChangeStage?.()
      else if (actionKey === CHANGE_OWNER_KEY) onChangeOwner?.()
      else if (actionKey === EXPORT_CSV_KEY) onExportCsv()
      else if (actionKey === DELETE_KEY) onDelete?.()
    },
    [onChangeStage, onChangeOwner, onExportCsv, onDelete],
  )

  const summary = totalLabel
    ? translateWithFallback(t, 'customers.deals.kanban.bulk.totalValue', 'Total {value}', { value: totalLabel })
    : undefined

  return (
    <BulkActionBar
      selectedCount={count}
      summary={summary}
      actions={actions}
      maxVisibleActions={VISIBLE_ACTIONS}
      destructivePlacement="inline"
      onAction={handleAction}
      onClear={onClear}
      ariaLabel={translateWithFallback(t, 'customers.deals.kanban.bulk.aria.bar', 'Bulk actions')}
      className="z-toast! max-w-4xl"
    />
  )
}

export default BulkActionsBar
