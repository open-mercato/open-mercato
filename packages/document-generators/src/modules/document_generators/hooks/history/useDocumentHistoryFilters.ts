'use client'

import * as React from 'react'
import {
  applyDocumentHistoryFilters,
  applyDocumentHistoryPage,
  applyDocumentHistorySort,
  createDocumentHistoryFilterState,
  resolveLastValidDocumentHistoryPage,
  type DocumentHistoryFilterPatch,
  type DocumentHistoryFilterState,
  type DocumentHistorySortDirection,
} from '../document-queries'

export function useDocumentHistoryFilters(initial: Partial<DocumentHistoryFilterState> = {}) {
  const [state, setState] = React.useState<DocumentHistoryFilterState>(() => createDocumentHistoryFilterState(initial))

  const setFilters = React.useCallback(
    (patch: DocumentHistoryFilterPatch) => setState((current) => applyDocumentHistoryFilters(current, patch)),
    [],
  )
  const setSort = React.useCallback(
    (sort: string | null | undefined, direction: DocumentHistorySortDirection) =>
      setState((current) => applyDocumentHistorySort(current, sort, direction)),
    [],
  )
  const setPage = React.useCallback(
    (page: number) => setState((current) => applyDocumentHistoryPage(current, page)),
    [],
  )
  const clampToTotal = React.useCallback(
    (total: number) =>
      setState((current) => {
        const valid = resolveLastValidDocumentHistoryPage(current.page, total, current.pageSize)
        return valid === current.page ? current : { ...current, page: valid }
      }),
    [],
  )
  const reset = React.useCallback(() => setState(createDocumentHistoryFilterState(initial)), [initial])

  return { state, setFilters, setSort, setPage, clampToTotal, reset }
}
