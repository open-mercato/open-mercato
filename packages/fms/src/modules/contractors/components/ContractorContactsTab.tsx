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

type ContractorContact = {
  id: string
  firstName: string
  lastName: string
  jobTitle?: string | null
  department?: string | null
  email?: string | null
  phone?: string | null
  mobile?: string | null
  isPrimary: boolean
  isActive: boolean
  notes?: string | null
}

type ContractorContactsTabProps = {
  contractorId: string
  contacts: ContractorContact[]
  onUpdated: () => void
}

const COLUMNS: ColumnDef[] = [
  { data: 'firstName', title: 'First Name', type: 'text', width: 120 },
  { data: 'lastName', title: 'Last Name', type: 'text', width: 120 },
  { data: 'jobTitle', title: 'Job Title', type: 'text', width: 130 },
  { data: 'department', title: 'Department', type: 'text', width: 110 },
  { data: 'email', title: 'Email', type: 'text', width: 180 },
  { data: 'phone', title: 'Phone', type: 'text', width: 120 },
  { data: 'mobile', title: 'Mobile', type: 'text', width: 120 },
  { data: 'isPrimary', title: 'Primary', type: 'checkbox', width: 70 },
  { data: 'isActive', title: 'Active', type: 'checkbox', width: 70 },
]

export function ContractorContactsTab({ contractorId, contacts, onUpdated }: ContractorContactsTabProps) {
  const tableRef = React.useRef<HTMLDivElement>(null)
  const t = useT()

  const data = React.useMemo(() =>
    contacts.map((contact) => ({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      jobTitle: contact.jobTitle ?? '',
      department: contact.department ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      mobile: contact.mobile ?? '',
      isPrimary: contact.isPrimary,
      isActive: contact.isActive,
    })),
    [contacts]
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

          const response = await apiCall(`/api/contractors/contacts?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [prop]: finalValue }),
          })

          if (response.ok) {
            flash(t('contractors.drawer.contactUpdated', 'Contact updated'), 'success')
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
          const response = await apiCall<{ id: string; error?: string }>('/api/contractors/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...filteredRowData,
              contractorId,
            }),
          })

          if (response.ok && response.result) {
            flash(t('contractors.drawer.contactCreated', 'Contact created'), 'success')
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
        {t('contractors.drawer.contactsSection', 'Contacts')}
      </h3>
      <DynamicTable
        tableRef={tableRef}
        data={data}
        columns={COLUMNS}
        idColumnName="id"
        tableName="Contacts"
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
