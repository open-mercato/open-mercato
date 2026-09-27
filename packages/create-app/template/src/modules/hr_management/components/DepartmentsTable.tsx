"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useDepartmentOptions, useEmployeeLabels } from './hrOptions'

const RESOURCE = 'hr_management/departments'
const CREATE_HREF = '/backend/hr/departments/create'
const editHref = (id: string) => `/backend/hr/departments/${id}/edit`

export type DepartmentRow = {
  id: string
  name: string
  code?: string | null
  description?: string | null
  parent_department_id?: string | null
  manager_employee_id?: string | null
  is_active: boolean
  updated_at?: string | null
  updatedAt?: string | null
}

/**
 * The department list.
 *
 * The tree is short by construction (a handful of departments per tenant), so the whole tree is
 * fetched once and every parent label comes from it — the same list the form filters to keep a
 * department from becoming its own ancestor.
 */
export default function DepartmentsTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [page, setPage] = React.useState(1)

  const isActiveFilter = typeof values.isActive === 'string' ? values.isActive : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'name',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (isActiveFilter) out.isActive = isActiveFilter
    // The route filters on `name`, which is the only text an operator can search a tree by.
    if (search.trim().length > 0) out.name = search.trim()
    return out
  }, [page, sorting, isActiveFilter, search])

  const query = useQuery({
    queryKey: ['hr-departments', params, scopeVersion],
    queryFn: () => fetchCrudList<DepartmentRow>(RESOURCE, params),
  })

  const { labels: departmentLabels } = useDepartmentOptions()
  const { labels: employeeLabels } = useEmployeeLabels()

  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<DepartmentRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('hr_management.departments.columns.name', 'Department'),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{row.original.name}</span>
          {row.original.description && row.original.description.trim().length > 0 ? (
            <span className="text-xs text-muted-foreground">{row.original.description}</span>
          ) : null}
        </div>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'code',
      header: t('hr_management.departments.columns.code', 'Code'),
      cell: ({ getValue }) => {
        const value = getValue() as string | null
        return value && value.length > 0
          ? <span className="font-mono text-xs">{value}</span>
          : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      id: 'parent',
      header: t('hr_management.departments.columns.parent', 'Parent'),
      cell: ({ row }) => {
        const parentId = row.original.parent_department_id
        if (!parentId) return <span className="text-xs text-muted-foreground">{t('hr_management.departments.topLevel', 'Top level')}</span>
        return <span className="text-sm">{departmentLabels.get(parentId) ?? '—'}</span>
      },
    },
    {
      id: 'manager',
      header: t('hr_management.departments.columns.manager', 'Manager'),
      cell: ({ row }) => {
        const managerId = row.original.manager_employee_id
        if (!managerId) return <span className="text-xs text-muted-foreground">—</span>
        return <span className="text-sm">{employeeLabels.get(managerId) ?? '—'}</span>
      },
    },
    {
      id: 'is_active',
      header: t('hr_management.departments.columns.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={row.original.is_active ? 'success' : 'neutral'} dot>
          {row.original.is_active
            ? t('hr_management.departments.status.active', 'Active')
            : t('hr_management.departments.status.inactive', 'Inactive')}
        </StatusBadge>
      ),
      meta: { priority: 2 },
    },
  ], [t, departmentLabels, employeeLabels])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('hr_management.departments.error.load', 'Could not load departments.')}</div>
  }

  return (
    <DataTable
      title={t('hr_management.departments.page.title', 'Departments')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('hr_management.departments.actions.create', 'New department')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('hr_management.departments.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      // `searchAlign` only takes physical sides, so the inline end is expressed here.
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'isActive',
          label: t('hr_management.departments.filters.status', 'Status'),
          type: 'select',
          options: [
            { value: 'true', label: t('hr_management.departments.status.active', 'Active') },
            { value: 'false', label: t('hr_management.departments.status.inactive', 'Inactive') },
          ],
        },
      ]}
      filterValues={values}
      onFiltersApply={(next: FilterValues) => {
        setValues(next)
        setPage(1)
      }}
      onFiltersClear={() => {
        setValues({})
        setPage(1)
      }}
      entityId="hr_management:hr_department"
      sortable
      sorting={sorting}
      onSortingChange={(next) => {
        setSorting(next)
        setPage(1)
      }}
      pagination={{
        page,
        pageSize: 50,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        totalIsCapped: data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={query.isLoading}
    />
  )
}
