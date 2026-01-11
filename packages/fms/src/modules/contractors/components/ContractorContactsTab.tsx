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

type ContractorContact = {
  id: string
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  isPrimary: boolean
  isActive: boolean
}

type ContractorContactsTabProps = {
  contractorId: string
  contacts: ContractorContact[]
  onUpdated: () => void
}

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

export function ContractorContactsTab({ contractorId, contacts, onUpdated }: ContractorContactsTabProps) {
  const tableRef = React.useRef<HTMLDivElement>(null)
  const t = useT()

  const handleDelete = React.useCallback(async (id: string) => {
    if (!confirm(t('contractors.drawer.confirmDeleteContact', 'Are you sure you want to delete this contact?'))) {
      return
    }
    try {
      const response = await apiCall(`/api/contractors/contacts?id=${id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        flash(t('contractors.drawer.contactDeleted', 'Contact deleted'), 'success')
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
    { data: 'firstName', title: 'First Name', type: 'text', width: 140 },
    { data: 'lastName', title: 'Last Name', type: 'text', width: 140 },
    { data: 'email', title: 'Email', type: 'text', width: 200 },
    { data: 'phone', title: 'Phone', type: 'text', width: 120 },
    { data: 'isPrimary', title: 'Primary', type: 'boolean', width: 70 },
    { data: 'isActive', title: 'Active', type: 'boolean', width: 70 },
  ], [])

  const actionsRenderer = React.useCallback((rowData: { id: string }) => {
    if (!rowData?.id) return null
    return <DeleteButton id={rowData.id} onDelete={handleDelete} />
  }, [handleDelete])

  const data = React.useMemo(() => {
    if (contacts.length === 0) {
      return [{
        id: '',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        isPrimary: false,
        isActive: true,
      }]
    }
    return contacts.map((contact) => ({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      isPrimary: contact.isPrimary,
      isActive: contact.isActive,
    }))
  }, [contacts])

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
        columns={columns}
        idColumnName="id"
        tableName="Contacts"
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
