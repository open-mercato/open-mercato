'use client'

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import {
  DynamicTable,
  TableEvents,
  dispatch,
  useEventHandlers,
  type ColumnDef,
  type CellEditSaveEvent,
  type NewRowSaveEvent,
} from '@open-mercato/ui/backend/dynamic-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'

type ContractorAddress = {
  id: string
  purpose: string
  label?: string | null
  addressLine1: string
  addressLine2?: string | null
  city: string
  state?: string | null
  postalCode?: string | null
  countryCode: string
  isPrimary: boolean
  isActive: boolean
}

type ContractorAddressesTabProps = {
  contractorId: string
  addresses: ContractorAddress[]
  onUpdated: () => void
  autoFocusFirstCell?: boolean
}

const PURPOSE_OPTIONS = [
  { value: 'office', label: 'Office' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'billing', label: 'Billing' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'other', label: 'Other' },
]

const DeleteButton = ({ id, onDelete }: { id: string; onDelete: (id: string) => void }) => {
  if (!id) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onDelete(id)
      }}
      className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
      title="Delete"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}

export function ContractorAddressesTab({ contractorId, addresses, onUpdated, autoFocusFirstCell = false }: ContractorAddressesTabProps) {
  const tableRef = React.useRef<HTMLDivElement>(null)
  const t = useT()

  // Auto-focus first cell when requested
  React.useEffect(() => {
    if (autoFocusFirstCell && tableRef.current) {
      // Small delay to ensure the table is rendered
      const timer = setTimeout(() => {
        const firstCell = tableRef.current?.querySelector('td[data-row="0"][data-col="0"]') as HTMLElement
        if (firstCell) {
          // Simulate double-click to start editing
          const dblClickEvent = new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            view: window,
          })
          firstCell.dispatchEvent(dblClickEvent)
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [autoFocusFirstCell])

  const handleDelete = React.useCallback(async (id: string) => {
    if (!confirm(t('contractors.drawer.confirmDeleteAddress', 'Are you sure you want to delete this address?'))) {
      return
    }
    try {
      const response = await apiCall(`/api/contractors/addresses?id=${id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        flash(t('contractors.drawer.addressDeleted', 'Address deleted'), 'success')
        onUpdated()
      } else {
        const error = (response.result as { error?: string })?.error ?? 'Delete failed'
        flash(error, 'error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      flash(errorMessage, 'error')
    }
  }, [t, onUpdated])

  const columns: ColumnDef[] = React.useMemo(() => [
    { data: 'purpose', title: 'Purpose', type: 'dropdown', source: PURPOSE_OPTIONS, width: 130 },
    { data: 'label', title: 'Label', type: 'text', width: 100 },
    { data: 'addressLine1', title: 'Address Line 1', type: 'text', width: 200 },
    { data: 'addressLine2', title: 'Address Line 2', type: 'text', width: 150 },
    { data: 'city', title: 'City', type: 'text', width: 120 },
    { data: 'state', title: 'State', type: 'text', width: 100 },
    { data: 'postalCode', title: 'Postal Code', type: 'text', width: 100 },
    { data: 'countryCode', title: 'Country', type: 'text', width: 80 },
    { data: 'isPrimary', title: 'Primary', type: 'boolean', width: 70 },
    { data: 'isActive', title: 'Active', type: 'boolean', width: 70 },
  ], [])

  const actionsRenderer = React.useCallback((rowData: { id: string }) => {
    if (!rowData?.id) return null
    return <DeleteButton id={rowData.id} onDelete={handleDelete} />
  }, [handleDelete])

  const data = React.useMemo(() => {
    if (addresses.length === 0) {
      return [{
        id: '',
        purpose: '',
        label: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        postalCode: '',
        countryCode: '',
        isPrimary: false,
        isActive: true,
      }]
    }
    return addresses.map((addr) => ({
      id: addr.id,
      purpose: addr.purpose,
      label: addr.label ?? '',
      addressLine1: addr.addressLine1,
      addressLine2: addr.addressLine2 ?? '',
      city: addr.city,
      state: addr.state ?? '',
      postalCode: addr.postalCode ?? '',
      countryCode: addr.countryCode,
      isPrimary: addr.isPrimary,
      isActive: addr.isActive,
    }))
  }, [addresses])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        const { prop, newValue, oldValue, rowIndex, colIndex, id } = payload

        if (newValue === oldValue) return

        if (tableRef.current) {
          dispatch(tableRef.current, TableEvents.CELL_SAVE_START, { rowIndex, colIndex })
        }

        try {
          const finalValue = newValue === '' ? null : newValue

          const response = await apiCall(`/api/contractors/addresses?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [prop]: finalValue }),
          })

          if (response.ok) {
            flash(t('contractors.drawer.addressUpdated', 'Address updated'), 'success')
            if (tableRef.current) {
              dispatch(tableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
            }
            onUpdated()
          } else {
            const error = (response.result as { error?: string })?.error ?? 'Update failed'
            flash(error, 'error')
            if (tableRef.current) {
              dispatch(tableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error })
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          if (tableRef.current) {
            dispatch(tableRef.current, TableEvents.CELL_SAVE_ERROR, { rowIndex, colIndex, error: errorMessage })
          }
        }
      },

      [TableEvents.NEW_ROW_SAVE]: async (payload: NewRowSaveEvent) => {
        const { rowData, rowIndex } = payload

        const filteredRowData = Object.fromEntries(
          Object.entries(rowData).filter(([_, value]) => value !== '')
        )

        try {
          const response = await apiCall<{ id: string; error?: string }>('/api/contractors/addresses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...filteredRowData,
              contractorId,
            }),
          })

          if (response.ok && response.result) {
            flash(t('contractors.drawer.addressCreated', 'Address created'), 'success')
            if (tableRef.current) {
              dispatch(tableRef.current, TableEvents.NEW_ROW_SAVE_SUCCESS, {
                rowIndex,
                savedRowData: { ...rowData, id: response.result.id },
              })
            }
            onUpdated()
          } else {
            const error = response.result?.error ?? 'Creation failed'
            flash(error, 'error')
            if (tableRef.current) {
              dispatch(tableRef.current, TableEvents.NEW_ROW_SAVE_ERROR, { rowIndex, error })
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          if (tableRef.current) {
            dispatch(tableRef.current, TableEvents.NEW_ROW_SAVE_ERROR, { rowIndex, error: errorMessage })
          }
        }
      },
    },
    tableRef
  )

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-2">
        {t('contractors.drawer.addressesSection', 'Addresses')}
      </h3>
      <DynamicTable
        tableRef={tableRef}
        data={data}
        columns={columns}
        idColumnName="id"
        tableName="Addresses"
        height={Math.max(150, Math.min(300, 80 + data.length * 35))}
        colHeaders={true}
        rowHeaders={false}
        actionsRenderer={actionsRenderer}
        uiConfig={{
          hideToolbar: false,
          hideSearch: true,
          hideFilterButton: true,
          hideAddRowButton: false,
          hideBottomBar: true,
        }}
      />
    </div>
  )
}
