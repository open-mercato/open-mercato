'use client'

import * as React from 'react'
import { useRef, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DynamicTable,
  TableSkeleton,
  TableEvents,
  dispatch,
  useEventHandlers,
} from '@open-mercato/ui/backend/dynamic-table'
import type {
  CellEditSaveEvent,
  CellSaveStartEvent,
  CellSaveSuccessEvent,
  CellSaveErrorEvent,
  NewRowSaveEvent,
  NewRowSaveSuccessEvent,
  NewRowSaveErrorEvent,
  ColumnDef,
} from '@open-mercato/ui/backend/dynamic-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { TableColumnConfig, TableConfigResponse } from './useTableConfig'

type OfferLine = {
  id: string
  lineNumber: number
  chargeName: string
  chargeCategory: string
  chargeUnit: string
  containerType?: string | null
  quantity: string
  currencyCode: string
  unitPrice: string
  amount: string
}

type OfferLinesTableProps = {
  offerId: string
}

export function OfferLinesTable({ offerId }: OfferLinesTableProps) {
  const tableRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  // Fetch table config
  const { data: tableConfig, isLoading: configLoading } = useQuery({
    queryKey: ['offer-lines-table-config'],
    queryFn: async () => {
      const response = await apiCall<TableConfigResponse>('/api/fms_quotes/offer-lines/table-config')
      if (!response.ok) throw new Error('Failed to load table configuration')
      return response.result
    },
    staleTime: 1000 * 60 * 5,
  })

  // Fetch offer lines data
  const { data: linesData, isLoading: dataLoading } = useQuery({
    queryKey: ['fms_offer_lines', offerId],
    queryFn: async () => {
      const response = await apiCall<{ items: OfferLine[]; total: number }>(
        `/api/fms_quotes/offer-lines?offerId=${offerId}`
      )
      if (!response.ok) throw new Error('Failed to load offer lines')
      return response.result ?? { items: [], total: 0 }
    },
    enabled: !!offerId,
  })

  const tableData = useMemo(() => {
    return (linesData?.items ?? []).map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      chargeName: line.chargeName,
      chargeCategory: line.chargeCategory,
      chargeUnit: line.chargeUnit,
      containerType: line.containerType || '',
      quantity: line.quantity,
      currencyCode: line.currencyCode,
      unitPrice: line.unitPrice,
      amount: line.amount,
    }))
  }, [linesData?.items])

  const columns = useMemo((): ColumnDef[] => {
    if (!tableConfig?.columns) return []
    return tableConfig.columns.map((col) => ({
      ...col,
      type: col.type === 'checkbox' ? 'boolean' : col.type,
    })) as ColumnDef[]
  }, [tableConfig])

  const invalidateLines = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['fms_offer_lines', offerId] })
  }, [queryClient, offerId])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_START, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        } as CellSaveStartEvent)

        try {
          const response = await apiCall<{ error?: string }>(
            `/api/fms_quotes/offer-lines/${payload.id}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [payload.prop]: payload.newValue }),
            }
          )

          if (response.ok) {
            flash('Line updated', 'success')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_SUCCESS, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
            } as CellSaveSuccessEvent)
          } else {
            const error = response.result?.error || 'Update failed'
            flash(error, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
              error,
            } as CellSaveErrorEvent)
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
            error: errorMessage,
          } as CellSaveErrorEvent)
        }
      },

      [TableEvents.NEW_ROW_SAVE]: async (payload: NewRowSaveEvent) => {
        const filteredRowData = Object.fromEntries(
          Object.entries(payload.rowData).filter(([_, value]) => value !== '')
        )

        try {
          const response = await apiCall<{ id: string; error?: string }>(
            '/api/fms_quotes/offer-lines',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ offerId, ...filteredRowData }),
            }
          )

          if (response.ok && response.result) {
            flash('Line created', 'success')
            dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_SUCCESS, {
              rowIndex: payload.rowIndex,
              savedRowData: {
                ...payload.rowData,
                id: response.result.id,
              },
            } as NewRowSaveSuccessEvent)
            invalidateLines()
          } else {
            const error = response.result?.error || 'Creation failed'
            flash(error, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              error,
            } as NewRowSaveErrorEvent)
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            error: errorMessage,
          } as NewRowSaveErrorEvent)
        }
      },
    },
    tableRef as React.RefObject<HTMLElement>
  )

  if (configLoading || dataLoading) {
    return <TableSkeleton rows={3} columns={8} />
  }

  if (!columns.length) {
    return (
      <div className="text-center py-4 text-sm text-gray-500">
        Failed to load table configuration
      </div>
    )
  }

  return (
    <DynamicTable
      tableRef={tableRef}
      data={tableData}
      columns={columns}
      tableName="Pricing Lines"
      idColumnName="id"
      height={250}
      colHeaders={true}
      rowHeaders={false}
      uiConfig={{
        hideToolbar: true,
        hideSearch: true,
        hideFilterButton: true,
        hideAddRowButton: false,
        hideBottomBar: true,
      }}
    />
  )
}
