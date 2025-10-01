"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import type { TodoListItem } from '@open-mercato/example/modules/example/types'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { BooleanIcon, EnumBadge, severityPreset } from '@open-mercato/ui/backend/ValueIcons'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList, buildCrudCsvUrl, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import Link from 'next/link'

type TodoRow = TodoListItem & { organization_name?: string }

type TodosResponse = {
  items: TodoListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type OrganizationsResponse = {
  items: Array<{ id: string; name: string }>
}

const columns: ColumnDef<TodoRow>[] = [
  { accessorKey: 'title', header: 'Title', meta: { priority: 1 } },
  { accessorKey: 'organization_name', header: 'Organization', enableSorting: false, meta: { priority: 3 } },
  { accessorKey: 'is_done', header: 'Done', meta: { priority: 2 },
    cell: ({ getValue }) => <BooleanIcon value={!!getValue()} /> },
  { accessorKey: 'cf_priority', header: 'Priority', meta: { priority: 4 } },
  {
    accessorKey: 'cf_severity',
    header: 'Severity',
    cell: ({ getValue }) => <EnumBadge value={getValue() as any} map={severityPreset} />,
    meta: { priority: 5 },
  },
  { accessorKey: 'cf_blocked', header: 'Blocked', meta: { priority: 6 },
    cell: ({ getValue }) => <BooleanIcon value={!!getValue()} /> },
  {
    accessorKey: 'cf_labels',
    header: 'Labels',
    cell: ({ getValue }) => {
      const vals = (getValue() as string[] | null) || []
      if (!Array.isArray(vals) || vals.length === 0) return <span className="text-xs text-muted-foreground">—</span>
      return (
        <span className="flex flex-wrap gap-1">
          {vals.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-accent/20">
              {v}
            </span>
          ))}
        </span>
      )
    },
    meta: { priority: 4 },
  },
]

export default function TodosTable() {
  const queryClient = useQueryClient()
  const [title, setTitle] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'title', desc: false }])
  const [page, setPage] = React.useState(1)

  // Custom field filters handled by DataTable (via customFieldFiltersEntityId)

  // Build query parameters
  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: '50',
      sortField: sorting[0]?.id || 'title',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })

    if (title) params.set('title', title)
    // Map dynamic filter values to query params
    Object.entries(values).forEach(([k, v]) => {
      if (k === 'created_at') {
        if ((v as any)?.from) params.set('createdFrom', (v as any).from)
        if ((v as any)?.to) params.set('createdTo', (v as any).to)
        return
      }
      if (k === 'is_done') {
        if (v === true || v === false) params.set('isDone', String(v))
        return
      }
      // custom fields: keys are already cf_<key> or cf_<key>In
      if (k.startsWith('cf_')) {
        if (Array.isArray(v)) params.set(k, (v as string[]).join(','))
        else if (v != null && v !== '') params.set(k, String(v))
      }
    })
    // organization and tenant filters removed per request
    
    return params.toString()
  }, [page, sorting, title, values])

  // Fetch todos
  const { data: todosData, isLoading, error } = useQuery<TodosResponse>({
    queryKey: ['todos', queryParams],
    queryFn: async () => fetchCrudList<TodoListItem>('example/todos', Object.fromEntries(new URLSearchParams(queryParams))),
  })

  // Get unique organization IDs from todos
  const organizationIds = React.useMemo(() => {
    if (!todosData?.items) return []
    const ids = todosData.items
      .map(todo => todo.organization_id)
      .filter((id): id is string => id != null)
    return [...new Set(ids)]
  }, [todosData?.items])

  // Fetch organizations
  const { data: orgsData } = useQuery<OrganizationsResponse>({
    queryKey: ['organizations', organizationIds],
    queryFn: async () => {
      if (organizationIds.length === 0) return { items: [] }
      const response = await apiFetch(`/api/example/organizations?ids=${organizationIds.join(',')}`)
      if (!response.ok) {
        throw new Error('Failed to fetch organizations')
      }
      return response.json()
    },
    enabled: organizationIds.length > 0,
  })

  // Create organization lookup map
  const orgMap = React.useMemo(() => {
    if (!orgsData?.items) return {}
    return orgsData.items.reduce((acc, org) => {
      acc[org.id] = org.name
      return acc
    }, {} as Record<string, string>)
  }, [orgsData?.items])

  // Merge todos with organization names
  const todosWithOrgNames = React.useMemo(() => {
    if (!todosData?.items) return []
    return todosData.items.map(todo => ({
      ...todo,
      organization_name: todo.organization_id ? orgMap[todo.organization_id] || 'Unknown' : 'No Organization'
    }))
  }, [todosData?.items, orgMap])

  const handleSortingChange = (newSorting: SortingState) => {
    setSorting(newSorting)
    setPage(1) // Reset to first page when sorting changes
  }

  const handleReset = () => {
    setTitle('')
    setValues({})
    setPage(1)
  }

  if (error) {
    return <div>Error: {error.message}</div>
  }

  return (
    <DataTable 
      title="Todos"
      actions={(
        <>
          <Button variant="outline" size="sm" onClick={() => {
            const url = buildCrudCsvUrl('example/todos', Object.fromEntries(new URLSearchParams(queryParams)))
            window.open(url, '_blank')
          }}>Export</Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/backend/todos/create">Create</Link>
          </Button>
        </>
      )}
      columns={columns}
      data={todosWithOrgNames}
      // Built-in FilterBar with dynamic custom fields
      searchValue={title}
      onSearchChange={(v) => { setTitle(v); setPage(1) }}
      searchAlign="right"
      filters={[{ id: 'is_done', label: 'Done', type: 'checkbox' }, { id: 'created_at', label: 'Created Date', type: 'dateRange' }]}
      filterValues={values}
      onFiltersApply={(vals: FilterValues) => { setValues(vals); setPage(1) }}
      onFiltersClear={() => handleReset()}
      entityId="example:todo"
      sortable 
      sorting={sorting} 
      onSortingChange={handleSortingChange}
      rowActions={(row) => (
        <RowActions
          items={[
            { label: 'Edit', href: `/backend/todos/${row.id}/edit` },
            {
              label: 'Delete',
              destructive: true,
              onSelect: async () => {
                if (!window.confirm('Delete this todo?')) return
                await deleteCrud('example/todos', row.id).catch((e) => { alert(e?.message || 'Failed to delete') })
                flash('Todo deleted', 'success')
                // refresh list
                queryClient.invalidateQueries({ queryKey: ['todos'] })
              },
            },
          ]}
        />
      )}
      pagination={{
        page,
        pageSize: 50,
        total: todosData?.total || 0,
        totalPages: todosData?.totalPages || 0,
        onPageChange: setPage,
      }}
      isLoading={isLoading}
    />
  )
}
