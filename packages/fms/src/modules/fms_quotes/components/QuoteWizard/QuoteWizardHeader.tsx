'use client'

import * as React from 'react'
import { useRef, useMemo, useCallback } from 'react'
import {
  DynamicTable,
  TableEvents,
  dispatch,
  useEventHandlers,
  createMultiSelectEntitySearchEditor,
} from '@open-mercato/ui/backend/dynamic-table'
import type {
  CellEditSaveEvent,
  CellSaveStartEvent,
  CellSaveSuccessEvent,
  CellSaveErrorEvent,
  ColumnDef,
  MultiSelectSelectedItem,
} from '@open-mercato/ui/backend/dynamic-table'
import { Badge } from '@open-mercato/ui/primitives/badge'
import type { Quote, PortRef } from './hooks/useQuoteWizard'

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

  // Port multi-select editor config
  const portEditorConfig = useMemo(() => ({
    entityType: 'fms_locations:fms_location',
    extractValue: (r: { recordId: string }) => r.recordId,
    extractLabel: (r: { presenter?: { title?: string } }) => r.presenter?.title || '',
    extractItem: (r: { recordId: string; presenter?: { title?: string }; fields?: Record<string, unknown> }) => ({
      id: r.recordId,
      label: r.presenter?.title || '',
      locode: r.fields?.locode as string | undefined,
      name: r.fields?.name as string | undefined,
    }),
    placeholder: 'Search ports...',
    minQueryLength: 2,
  }), [])

  // Port renderer
  const portRenderer = useCallback((value: unknown) => {
    const ports = Array.isArray(value) ? value : []
    if (ports.length === 0) {
      return <span className="text-gray-400">-</span>
    }
    return (
      <span className="flex gap-1 overflow-hidden">
        {ports.map((port: PortRef | MultiSelectSelectedItem) => {
          const portAny = port as PortRef & { label?: string }
          return (
            <Badge key={port.id} variant="outline" className="text-xs">
              {portAny.locode || portAny.label || portAny.name || port.id}
            </Badge>
          )
        })}
      </span>
    )
  }, [])

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
      data: 'originPorts',
      title: 'Origin',
      width: 180,
      renderer: portRenderer,
      editor: createMultiSelectEntitySearchEditor(portEditorConfig),
    },
    {
      data: 'destinationPorts',
      title: 'Destination',
      width: 180,
      renderer: portRenderer,
      editor: createMultiSelectEntitySearchEditor(portEditorConfig),
    },
    {
      data: 'currencyCode',
      title: 'Currency',
      width: 100,
      type: 'dropdown',
      source: CURRENCY_OPTIONS.map(o => o.label),
    },
  ], [portEditorConfig, portRenderer])

  const tableData = useMemo(() => [{
    id: quote.id,
    clientName: quote.clientName || '',
    quoteNumber: quote.quoteNumber || '',
    direction: DIRECTION_OPTIONS.find(o => o.value === quote.direction)?.label || 'Select',
    originPorts: quote.originPorts || [],
    destinationPorts: quote.destinationPorts || [],
    currencyCode: quote.currencyCode || 'USD',
  }], [quote])

  const handleCellChange = useCallback((field: string, value: unknown) => {
    // Handle multi-select ports - send IDs array to API
    if (field === 'originPorts' || field === 'destinationPorts') {
      const idsField = field === 'originPorts' ? 'originPortIds' : 'destinationPortIds'
      const ports = Array.isArray(value) ? value : []
      const ids = ports.map((p: PortRef | MultiSelectSelectedItem) => p.id)
      onChange({ [idsField]: ids })
      return
    }

    let finalValue = value

    // Handle direction dropdown
    if (field === 'direction') {
      const option = DIRECTION_OPTIONS.find(o => o.label === value)
      finalValue = option?.value || null
    }

    onChange({ [field]: finalValue })
  }, [onChange])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        console.log('[QuoteWizardHeader] CELL_EDIT_SAVE received:', {
          prop: payload.prop,
          newValue: payload.newValue,
          oldValue: payload.oldValue,
        })

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
