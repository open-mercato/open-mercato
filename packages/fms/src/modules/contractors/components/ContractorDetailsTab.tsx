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
} from '@open-mercato/ui/backend/dynamic-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import type { ContractorDetail } from './ContractorDrawer'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

type ContractorDetailsTabProps = {
  contractor: ContractorDetail
  onUpdated: () => void
  onDeleted?: () => void
  autoFocusFirstCell?: boolean
}

const DeleteButton = ({ onClick }: { onClick: () => void }) => {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
      title="Delete contractor"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}

const COLUMNS: ColumnDef[] = [
  { data: 'name', title: 'Name', type: 'text', width: 180 },
  { data: 'shortName', title: 'Short Name', type: 'text', width: 120 },
  { data: 'code', title: 'Code', type: 'text', width: 100 },
  { data: 'taxId', title: 'Tax ID', type: 'text', width: 120 },
  { data: 'legalName', title: 'Legal Name', type: 'text', width: 180 },
  { data: 'registrationNumber', title: 'Registration #', type: 'text', width: 130 },
  { data: 'isActive', title: 'Active', type: 'boolean', width: 80 },
  {
    data: 'createdAt',
    title: 'Created',
    type: 'text',
    readOnly: true,
    width: 160,
    renderer: (value) => {
      if (!value) return '-'
      return new Date(value).toLocaleString()
    },
  },
  {
    data: 'updatedAt',
    title: 'Updated',
    type: 'text',
    readOnly: true,
    width: 160,
    renderer: (value) => {
      if (!value) return '-'
      return new Date(value).toLocaleString()
    },
  },
]

export function ContractorDetailsTab({ contractor, onUpdated, onDeleted, autoFocusFirstCell = false }: ContractorDetailsTabProps) {
  const tableRef = React.useRef<HTMLDivElement>(null)
  const t = useT()
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)

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

  const handleDeleteConfirm = React.useCallback(async () => {
    setIsDeleting(true)
    try {
      const response = await apiCall(`/api/contractors/contractors/${contractor.id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        flash(t('contractors.drawer.contractorDeleted', 'Contractor deleted'), 'success')
        setDeleteDialogOpen(false)
        onDeleted?.()
      } else {
        const error = (response.result as { error?: string })?.error ?? 'Delete failed'
        flash(error, 'error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      flash(errorMessage, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [t, onDeleted, contractor.id])

  const actionsRenderer = React.useCallback((rowData: { id: string }) => {
    if (!rowData?.id) return null
    return <DeleteButton onClick={() => setDeleteDialogOpen(true)} />
  }, [])

  const data = React.useMemo(() => [{
    id: contractor.id,
    name: contractor.name,
    shortName: contractor.shortName ?? '',
    code: contractor.code ?? '',
    taxId: contractor.taxId ?? '',
    legalName: contractor.legalName ?? '',
    registrationNumber: contractor.registrationNumber ?? '',
    isActive: contractor.isActive,
    createdAt: contractor.createdAt,
    updatedAt: contractor.updatedAt,
  }], [contractor])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        const { prop, newValue, oldValue, rowIndex, colIndex } = payload

        if (newValue === oldValue) return

        if (tableRef.current) {
          dispatch(tableRef.current, TableEvents.CELL_SAVE_START, { rowIndex, colIndex })
        }

        try {
          const finalValue = newValue === '' ? null : newValue

          const response = await apiCall(`/api/contractors/contractors/${contractor.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [prop]: finalValue }),
          })

          if (response.ok) {
            flash(t('contractors.drawer.updated', 'Contractor updated'), 'success')
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
    },
    tableRef
  )

  return (
    <>
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          {t('contractors.drawer.detailsSection', 'Basic Information')}
        </h3>
        <DynamicTable
          tableRef={tableRef}
          data={data}
          columns={COLUMNS}
          idColumnName="id"
          tableName="Contractor Details"
          height={100}
          colHeaders={true}
          rowHeaders={false}
          actionsRenderer={actionsRenderer}
          uiConfig={{
            hideToolbar: true,
            hideSearch: true,
            hideFilterButton: true,
            hideAddRowButton: true,
            hideBottomBar: true,
          }}
        />
      </div>
      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />
    </>
  )
}
