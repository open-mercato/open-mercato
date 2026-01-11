'use client'

import * as React from 'react'
import { useRef, useMemo, useCallback } from 'react'
import {
  DynamicTable,
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
import type { Quote } from './hooks/useQuoteWizard'

type QuoteWizardHeaderProps = {
  quote: Quote
  onChange: (updates: Partial<Quote>) => void
}

const DIRECTION_OPTIONS = [
  { value: '', label: 'Select' },
  { value: 'export', label: 'Export' },
  { value: 'import', label: 'Import' },
  { value: 'both', label: 'Both' },
]

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'PLN', label: 'PLN' },
  { value: 'CNY', label: 'CNY' },
]

export function QuoteWizardHeader({ quote, onChange }: QuoteWizardHeaderProps) {
  const tableRef = useRef<HTMLDivElement>(null)

  const columns = useMemo((): ColumnDef[] => [
    {
      data: 'clientName',
      title: 'Client (BCO)',
      width: 180,
      type: 'text',
    },
    {
      data: 'quoteNumber',
      title: 'Reference',
      width: 150,
      type: 'text',
    },
    {
      data: 'direction',
      title: 'Direction',
      width: 120,
      type: 'dropdown',
      source: DIRECTION_OPTIONS.map(o => o.label),
    },
    {
      data: 'originPortCode',
      title: 'Origin',
      width: 100,
      type: 'text',
    },
    {
      data: 'destinationPortCode',
      title: 'Destination',
      width: 100,
      type: 'text',
    },
    {
      data: 'currencyCode',
      title: 'Currency',
      width: 100,
      type: 'dropdown',
      source: CURRENCY_OPTIONS.map(o => o.label),
    },
  ], [])

  const tableData = useMemo(() => [{
    id: quote.id,
    clientName: quote.clientName || '',
    quoteNumber: quote.quoteNumber || '',
    direction: DIRECTION_OPTIONS.find(o => o.value === quote.direction)?.label || 'Select',
    originPortCode: quote.originPortCode || '',
    destinationPortCode: quote.destinationPortCode || '',
    currencyCode: quote.currencyCode || 'USD',
  }], [quote])

  const handleCellChange = useCallback((field: string, value: unknown) => {
    let finalValue = value

    // Handle direction dropdown
    if (field === 'direction') {
      const option = DIRECTION_OPTIONS.find(o => o.label === value)
      finalValue = option?.value || null
    }

    // Handle port codes - uppercase
    if (field === 'originPortCode' || field === 'destinationPortCode') {
      finalValue = typeof value === 'string' ? value.toUpperCase() : value
    }

    onChange({ [field]: finalValue })
  }, [onChange])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_START, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        } as CellSaveStartEvent)

        try {
          handleCellChange(payload.prop, payload.newValue)

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

  return (
    <div className="border-b px-4 py-2" style={{ height: 90 }}>
      <DynamicTable
        tableRef={tableRef}
        data={tableData}
        columns={columns}
        tableName="Quote Details"
        idColumnName="id"
        width="100%"
        height="100%"
        colHeaders={true}
        rowHeaders={false}
        stretchColumns={true}
        uiConfig={{
          hideToolbar: true,
          hideSearch: true,
          hideFilterButton: true,
          hideAddRowButton: true,
          hideBottomBar: true,
          hideActionsColumn: true,
        }}
      />
    </div>
  )
}
