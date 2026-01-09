'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@/lib/i18n/context'

type ContractorRole = {
  id: string
  roleTypeId: string
  roleTypeName: string
  roleTypeCode: string
  roleTypeColor?: string | null
  roleTypeCategory: string
  isActive: boolean
  effectiveFrom?: string | null
  effectiveTo?: string | null
  settings?: Record<string, unknown> | null
}

type RoleType = {
  id: string
  code: string
  name: string
  category: string
  color?: string | null
}

type ContractorRolesTabProps = {
  contractorId: string
  roles: ContractorRole[]
  onUpdated: () => void
}

export function ContractorRolesTab({ contractorId, roles, onUpdated }: ContractorRolesTabProps) {
  const tableRef = React.useRef<HTMLDivElement>(null)
  const t = useT()

  // Fetch available role types
  const { data: roleTypes, isLoading: roleTypesLoading } = useQuery({
    queryKey: ['contractor-role-types'],
    queryFn: async () => {
      const response = await apiCall<{ items: RoleType[] }>('/api/contractors/role-types')
      if (!response.ok) throw new Error('Failed to load role types')
      return response.result?.items ?? []
    },
  })

  const roleTypeOptions = React.useMemo(() =>
    (roleTypes ?? []).map((rt) => ({
      value: rt.id,
      label: rt.name,
    })),
    [roleTypes]
  )

  const columns: ColumnDef[] = React.useMemo(() => [
    {
      data: 'roleTypeId',
      title: 'Role Type',
      type: 'dropdown',
      source: roleTypeOptions,
      width: 180,
      renderer: (value: string) => {
        const roleType = roleTypes?.find((rt) => rt.id === value)
        return roleType?.name ?? value
      },
    },
    { data: 'roleTypeCategory', title: 'Category', type: 'text', readOnly: true, width: 100 },
    { data: 'effectiveFrom', title: 'Effective From', type: 'date', width: 120 },
    { data: 'effectiveTo', title: 'Effective To', type: 'date', width: 120 },
    { data: 'isActive', title: 'Active', type: 'checkbox', width: 70 },
  ], [roleTypeOptions, roleTypes])

  const data = React.useMemo(() =>
    roles.map((role) => ({
      id: role.id,
      roleTypeId: role.roleTypeId,
      roleTypeName: role.roleTypeName,
      roleTypeCategory: role.roleTypeCategory,
      effectiveFrom: role.effectiveFrom?.split('T')[0] ?? '',
      effectiveTo: role.effectiveTo?.split('T')[0] ?? '',
      isActive: role.isActive,
    })),
    [roles]
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

          const response = await apiCall(`/api/contractors/roles?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [prop]: finalValue }),
          })

          if (response.ok) {
            flash(t('contractors.drawer.roleUpdated', 'Role updated'), 'success')
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
          const response = await apiCall<{ id: string; error?: string }>('/api/contractors/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...filteredRowData,
              contractorId,
            }),
          })

          if (response.ok && response.result) {
            flash(t('contractors.drawer.roleCreated', 'Role assigned'), 'success')
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

  if (roleTypesLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-2">
        {t('contractors.drawer.rolesSection', 'Roles')}
      </h3>
      <DynamicTable
        tableRef={tableRef}
        data={data}
        columns={columns}
        idColumnName="id"
        tableName="Roles"
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
