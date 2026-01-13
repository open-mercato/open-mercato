'use client'

import * as React from 'react'
import { useRef, useMemo, useCallback } from 'react'
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
  ColumnDef,
} from '@open-mercato/ui/backend/dynamic-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus, Trash2 } from 'lucide-react'
import type { QuoteLine } from './hooks/useCalculations'

type QuoteWizardLinesTableProps = {
  lines: QuoteLine[]
  isLoading: boolean
  onLineUpdate: (lineId: string, field: string, value: unknown) => void
  onRemoveLine: (lineId: string) => void
  onAddProduct: () => void
}

export function QuoteWizardLinesTable({
  lines,
  isLoading,
  onLineUpdate,
  onRemoveLine,
  onAddProduct,
}: QuoteWizardLinesTableProps) {
  const tableRef = useRef<HTMLDivElement>(null)

  const columns = useMemo((): ColumnDef[] => [
    {
      data: 'lineNumber',
      title: '#',
      width: 40,
      type: 'numeric',
      readOnly: true,
    },
    {
      data: 'chargeCode',
      title: 'Charge',
      width: 70,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'productName',
      title: 'Product',
      width: 150,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'providerName',
      title: 'Provider',
      width: 120,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'containerSize',
      title: 'Type',
      width: 60,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'quantity',
      title: 'Qty',
      width: 60,
      type: 'numeric',
    },
    {
      data: 'unitCost',
      title: 'Cost',
      width: 90,
      type: 'numeric',
      readOnly: true,
      sticky: 'right',
    },
    {
      data: 'marginPercent',
      title: 'Margin%',
      width: 80,
      type: 'numeric',
      sticky: 'right',
    },
    {
      data: 'unitSales',
      title: 'Sales',
      width: 90,
      type: 'numeric',
      sticky: 'right',
    },
    {
      data: 'currencyCode',
      title: 'Ccy',
      width: 50,
      type: 'text',
      readOnly: true,
      sticky: 'right',
    },
  ], [])

  const tableData = useMemo(() => {
    return lines.map((line, index) => ({
      id: line.id,
      lineNumber: index + 1,
      chargeCode: line.chargeCode || '',
      productName: line.productName,
      providerName: line.providerName || '',
      containerSize: line.containerSize || '',
      quantity: line.quantity,
      unitCost: line.unitCost,
      marginPercent: line.marginPercent,
      unitSales: line.unitSales,
      currencyCode: line.currencyCode,
    }))
  }, [lines])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_START, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        } as CellSaveStartEvent)

        try {
          onLineUpdate(payload.id as string, payload.prop, payload.newValue)

          dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_SUCCESS, {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
          } as CellSaveSuccessEvent)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Update failed'
          dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
            error: errorMessage,
          } as CellSaveErrorEvent)
        }
      },
    },
    tableRef as React.RefObject<HTMLElement>
  )

  const handleRemoveLine = useCallback(
    (lineId: string) => {
      if (confirm('Remove this line from the quote?')) {
        onRemoveLine(lineId)
      }
    },
    [onRemoveLine]
  )

  if (isLoading) {
    return <TableSkeleton rows={5} columns={10} />
  }

  // Calculate a reasonable table height based on line count
  const tableHeight = Math.min(Math.max(lines.length * 40 + 100, 200), 400)

  // Add Product button for toolbar
  const addProductButton = (
    <Button onClick={onAddProduct} size="sm" variant="outline">
      <Plus className="h-4 w-4 mr-1" />
      Add Product
    </Button>
  )

  // Empty state
  if (lines.length === 0) {
    return (
      <div className="flex flex-col">
        <div style={{ height: tableHeight }}>
          <DynamicTable
            tableRef={tableRef}
            data={[]}
            columns={columns}
            tableName="Quote Lines"
            idColumnName="id"
            width="100%"
            height="100%"
            colHeaders={true}
            rowHeaders={false}
            stretchColumns={true}
            uiConfig={{
              hideSearch: true,
              hideFilterButton: true,
              hideAddRowButton: true,
              hideBottomBar: true,
              enableFullscreen: true,
              topBarEnd: addProductButton,
            }}
          />
        </div>
        <div className="flex flex-col items-center justify-center border rounded-lg bg-muted/20 p-8 mt-2">
          <p className="text-muted-foreground mb-4">
            No products added yet. Click "Add Product" to search and add products to this quote.
          </p>
          <Button onClick={onAddProduct} variant="default">
            <Plus className="h-4 w-4 mr-1" />
            Add Product
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: tableHeight }}>
      <DynamicTable
        tableRef={tableRef}
        data={tableData}
        columns={columns}
        tableName="Quote Lines"
        idColumnName="id"
        width="100%"
        height="100%"
        colHeaders={true}
        rowHeaders={false}
        stretchColumns={true}
        uiConfig={{
          hideSearch: true,
          hideFilterButton: true,
          hideAddRowButton: true,
          hideBottomBar: true,
          enableFullscreen: true,
          topBarEnd: addProductButton,
        }}
        actionsRenderer={(rowData: Record<string, unknown>) => (
          <button
            onClick={() => handleRemoveLine(rowData.id as string)}
            className="p-1 text-muted-foreground hover:text-red-600 transition-colors"
            title="Remove line"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      />
    </div>
  )
}
