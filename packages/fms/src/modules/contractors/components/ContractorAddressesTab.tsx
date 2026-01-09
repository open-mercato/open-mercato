'use client'

import * as React from 'react'
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
}

const PURPOSE_OPTIONS = [
  { value: 'office', label: 'Office' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'billing', label: 'Billing' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'other', label: 'Other' },
]

const COLUMNS: ColumnDef[] = [
  { data: 'purpose', title: 'Purpose', type: 'dropdown', source: PURPOSE_OPTIONS, width: 110 },
  { data: 'label', title: 'Label', type: 'text', width: 100 },
  { data: 'addressLine1', title: 'Address Line 1', type: 'text', width: 180 },
  { data: 'addressLine2', title: 'Address Line 2', type: 'text', width: 150 },
  { data: 'city', title: 'City', type: 'text', width: 120 },
  { data: 'state', title: 'State', type: 'text', width: 80 },
  { data: 'postalCode', title: 'Postal Code', type: 'text', width: 100 },
  { data: 'countryCode', title: 'Country', type: 'text', width: 80 },
  { data: 'isPrimary', title: 'Primary', type: 'checkbox', width: 70 },
  { data: 'isActive', title: 'Active', type: 'checkbox', width: 70 },
]

export function ContractorAddressesTab({ contractorId, addresses, onUpdated }: ContractorAddressesTabProps) {
  const tableRef = React.useRef<HTMLDivElement>(null)
  const t = useT()

  const data = React.useMemo(() =>
    addresses.map((addr) => ({
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
    })),
    [addresses]
  )

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
        columns={COLUMNS}
        idColumnName="id"
        tableName="Addresses"
        height={Math.min(300, 80 + data.length * 35)}
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
    </div>
  )
}
