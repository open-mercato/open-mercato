'use client'

import * as React from 'react'
import { useInjectionDataWidgets } from './useInjectionDataWidgets'
import type {
  InjectionColumnDefinition,
  InjectionRowActionDefinition,
  InjectionBulkActionDefinition,
  InjectionFilterDefinition,
} from '@open-mercato/shared/modules/widgets/injection'

export type InjectedTableExtensions = {
  columns: InjectionColumnDefinition[]
  rowActions: InjectionRowActionDefinition[]
  bulkActions: InjectionBulkActionDefinition[]
  filters: InjectionFilterDefinition[]
  isLoading: boolean
}

const EMPTY: InjectedTableExtensions = {
  columns: [],
  rowActions: [],
  bulkActions: [],
  filters: [],
  isLoading: false,
}

export function useInjectedTableExtensions(
  tableId: string | undefined,
): InjectedTableExtensions {
  const columnsSpot = tableId ? `data-table:${tableId}:columns` : ''
  const rowActionsSpot = tableId ? `data-table:${tableId}:row-actions` : ''
  const bulkActionsSpot = tableId ? `data-table:${tableId}:bulk-actions` : ''
  const filtersSpot = tableId ? `data-table:${tableId}:filters` : ''

  const { widgets: columnWidgets, isLoading: colLoading } = useInjectionDataWidgets(columnsSpot as any)
  const { widgets: rowActionWidgets, isLoading: raLoading } = useInjectionDataWidgets(rowActionsSpot as any)
  const { widgets: bulkActionWidgets, isLoading: baLoading } = useInjectionDataWidgets(bulkActionsSpot as any)
  const { widgets: filterWidgets, isLoading: fLoading } = useInjectionDataWidgets(filtersSpot as any)

  const columns = React.useMemo(() => {
    if (!tableId) return []
    const result: InjectionColumnDefinition[] = []
    for (const w of columnWidgets) {
      if ('columns' in w && Array.isArray((w as any).columns)) {
        result.push(...(w as any).columns)
      }
    }
    return result
  }, [tableId, columnWidgets])

  const rowActions = React.useMemo(() => {
    if (!tableId) return []
    const result: InjectionRowActionDefinition[] = []
    for (const w of rowActionWidgets) {
      if ('rowActions' in w && Array.isArray((w as any).rowActions)) {
        result.push(...(w as any).rowActions)
      }
    }
    return result
  }, [tableId, rowActionWidgets])

  const bulkActions = React.useMemo(() => {
    if (!tableId) return []
    const result: InjectionBulkActionDefinition[] = []
    for (const w of bulkActionWidgets) {
      if ('bulkActions' in w && Array.isArray((w as any).bulkActions)) {
        result.push(...(w as any).bulkActions)
      }
    }
    return result
  }, [tableId, bulkActionWidgets])

  const filters = React.useMemo(() => {
    if (!tableId) return []
    const result: InjectionFilterDefinition[] = []
    for (const w of filterWidgets) {
      if ('filters' in w && Array.isArray((w as any).filters)) {
        result.push(...(w as any).filters)
      }
    }
    return result
  }, [tableId, filterWidgets])

  if (!tableId) return EMPTY

  return {
    columns,
    rowActions,
    bulkActions,
    filters,
    isLoading: colLoading || raLoading || baLoading || fLoading,
  }
}
