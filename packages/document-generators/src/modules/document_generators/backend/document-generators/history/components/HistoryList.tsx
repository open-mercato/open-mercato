'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import { useDocumentHistory } from '../../../../hooks/history/useDocumentHistory'
import { useDocumentHistoryFilters } from '../../../../hooks/history/useDocumentHistoryFilters'
import { buildHistoryListTableColumns } from './HistoryListTableColumns'

const PAGE_SIZE = 20

export function HistoryList() {
  const t = useT()
  const historyState = useDocumentHistoryFilters(PAGE_SIZE)
  const historyQuery = useDocumentHistory(historyState.query)
  const items = historyQuery.data?.items ?? []
  const total = historyQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const errorMessage = historyQuery.error
    ? t('document_generators.history.error', 'Failed to load generation history.')
    : null
  const columns = React.useMemo(() => buildHistoryListTableColumns(t), [t])

  return (
    <div className="space-y-4">
      <FilterBar {...historyState.filterBarProps} />
      <DataTable
        columns={columns}
        data={items}
        isLoading={historyQuery.isFetching}
        error={errorMessage}
        emptyState={t('document_generators.history.empty', 'No documents have been generated yet.')}
        pagination={{
          page: historyState.page,
          pageSize: PAGE_SIZE,
          total,
          totalPages,
          onPageChange: historyState.setPage,
        }}
        sortable
        manualSorting
        sorting={historyState.sorting}
        onSortingChange={historyState.setSorting}
        disableRowClick
      />
    </div>
  )
}
