"use client"

import * as React from 'react'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { FilterBar, type FilterDef, type FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { documentHistoryFilterStateToQuery } from '../hooks/document-queries'
import { useDocumentHistory } from '../hooks/history/useDocumentHistory'
import { useDocumentHistoryFilters } from '../hooks/history/useDocumentHistoryFilters'
import { useUserDisplayNames } from '../hooks/users/useUserDisplayNames'
import { downloadBlob } from '../utils'
import { requestStoredDocument } from './document-request'
import {
  HISTORY_SORT_FIELD_BY_COLUMN,
  buildHistoryColumns,
  historyColumnForSortField,
  type HistoryColumnId,
} from './HistoryListTableColumns'
import type { GeneratedDocumentDto } from '../services/generation-history-service'

export type HistoryListProps = {
  resourceKind?: string
  resourceId?: string
  pageSize?: number
  columns?: HistoryColumnId[]
  showFilters?: boolean
}

const ORGANIZATION_PAGE_SIZE = 20
const RESOURCE_PAGE_SIZE = 10

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function HistoryList({ resourceKind, resourceId, pageSize, columns, showFilters }: HistoryListProps) {
  const t = useT()
  const resourceMode = resourceKind !== undefined || resourceId !== undefined
  const effectivePageSize = pageSize ?? (resourceMode ? RESOURCE_PAGE_SIZE : ORGANIZATION_PAGE_SIZE)
  const filtersVisible = showFilters ?? !resourceMode

  const initial = React.useMemo(() => ({ pageSize: effectivePageSize }), [effectivePageSize])
  const { state, setFilters, setSort, setPage, clampToTotal, reset } = useDocumentHistoryFilters(initial)
  const query = React.useMemo(
    () => documentHistoryFilterStateToQuery(state, { resourceKind, resourceId }),
    [state, resourceKind, resourceId],
  )
  const history = useDocumentHistory(query, { requireResource: resourceMode })
  const total = history.data?.total

  React.useEffect(() => {
    if (typeof total === 'number') clampToTotal(total)
  }, [total, clampToTotal])

  const generatedByIds = React.useMemo(() => (history.data?.items ?? []).map((item) => item.generatedBy), [history.data])
  const userDisplayNames = useUserDisplayNames(generatedByIds)
  const tableColumns = React.useMemo(() => buildHistoryColumns(t, columns, userDisplayNames), [t, columns, userDisplayNames])

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      { id: 'templateId', label: t('document_generators.history.filters.templateId'), type: 'text' },
      { id: 'generatedBy', label: t('document_generators.history.filters.generatedById'), type: 'text' },
      { id: 'generatedAt', label: t('document_generators.history.filters.generatedAt'), type: 'dateRange' },
    ],
    [t],
  )
  const filterValues = React.useMemo<FilterValues>(
    () => ({
      templateId: state.templateId || undefined,
      generatedBy: state.generatedBy || undefined,
      generatedAt: state.generatedFrom || state.generatedTo ? { from: state.generatedFrom, to: state.generatedTo } : undefined,
    }),
    [state.templateId, state.generatedBy, state.generatedFrom, state.generatedTo],
  )

  const handleApply = React.useCallback(
    (values: FilterValues) => {
      const range = values.generatedAt as { from?: unknown; to?: unknown } | undefined
      setFilters({
        templateId: toText(values.templateId),
        generatedBy: toText(values.generatedBy),
        generatedFrom: toText(range?.from),
        generatedTo: toText(range?.to),
      })
    },
    [setFilters],
  )
  const handleClear = React.useCallback(() => setFilters({ templateId: '', generatedBy: '', generatedFrom: '', generatedTo: '' }), [setFilters])

  const sorting = React.useMemo<SortingState>(() => {
    const column = historyColumnForSortField(state.sort)
    return column ? [{ id: column, desc: state.sortDirection === 'desc' }] : []
  }, [state.sort, state.sortDirection])

  const handleSortingChange = React.useCallback(
    (next: SortingState) => {
      const first = next[0]
      const field = first ? HISTORY_SORT_FIELD_BY_COLUMN[first.id as HistoryColumnId] : undefined
      setSort(field ?? null, first?.desc ? 'desc' : 'asc')
    },
    [setSort],
  )

  const handleDownload = React.useCallback(async (historyId: string) => {
    try {
      const { blob, filename } = await requestStoredDocument({ historyId, translate: t })
      downloadBlob(blob, filename)
    } catch (error) {
      flash(error instanceof Error ? error.message : t('document_generators.generate.error'), 'error')
    }
  }, [t])

  const renderRowActions = React.useCallback((row: GeneratedDocumentDto) => (
    row.attachmentId
      ? <RowActions items={[{ id: 'download', label: t('document_generators.history.download'), onSelect: () => { void handleDownload(row.id) } }]} />
      : null
  ), [handleDownload, t])

  const items = history.data?.items ?? []
  const totalPages = Math.max(1, Math.ceil((history.data?.total ?? 0) / state.pageSize))

  return (
    <div className="space-y-4">
      {filtersVisible ? (
        <FilterBar filters={filterDefs} values={filterValues} onApply={handleApply} onClear={handleClear} />
      ) : null}
      <DataTable
        title={resourceMode ? undefined : t('document_generators.history.title')}
        columns={tableColumns}
        data={items}
        sortable
        manualSorting
        sorting={sorting}
        onSortingChange={handleSortingChange}
        rowActions={renderRowActions}
        isLoading={history.isFetching}
        error={history.isError ? t('document_generators.history.error') : null}
        emptyState={<p className="py-6 text-center text-sm text-muted-foreground">{t('document_generators.history.empty')}</p>}
        pagination={{
          page: state.page,
          pageSize: state.pageSize,
          total: history.data?.total ?? 0,
          totalPages,
          totalIsCapped: history.data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
      />
    </div>
  )
}
