"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FilterBar, type FilterDef, type FilterValues } from '@open-mercato/ui/backend/FilterBar'

type TodoRow = {
  id: string
  title: string
  is_done?: boolean
  tenant_id?: string | null
  organization_id?: string | null
  organization_name?: string
  cf_priority?: number | null
  cf_severity?: string | null
  cf_blocked?: boolean | null
}

type TodosResponse = {
  items: TodoRow[]
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
  { accessorKey: 'organization_name', header: 'Organization', meta: { priority: 3 } },
  { accessorKey: 'is_done', header: 'Done', meta: { priority: 2 } },
  { accessorKey: 'cf_priority', header: 'Priority', meta: { priority: 4 } },
  { accessorKey: 'cf_severity', header: 'Severity', meta: { priority: 5 } },
  { accessorKey: 'cf_blocked', header: 'Blocked', meta: { priority: 6 } },
]

export default function TodosTable() {
  const [title, setTitle] = React.useState('')
  const [severity, setSeverity] = React.useState<string | undefined>(undefined)
  const [done, setDone] = React.useState<boolean | undefined>(undefined)
  const [blocked, setBlocked] = React.useState<boolean | undefined>(undefined)
  const [orgId, setOrgId] = React.useState<string>('')
  const [tenantId, setTenantId] = React.useState<string>('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'title', desc: false }])
  const [page, setPage] = React.useState(1)

  // Build query parameters
  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: '50',
      sortField: sorting[0]?.id || 'title',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })

    if (title) params.set('title', title)
    if (severity) params.set('severity', severity)
    if (done !== undefined) params.set('isDone', done.toString())
    if (blocked !== undefined) params.set('isBlocked', blocked.toString())
    if (orgId) params.set('organizationId', orgId)
    if (tenantId) params.set('tenantId', tenantId)

    return params.toString()
  }, [page, sorting, title, severity, done, blocked, orgId, tenantId])

  // Fetch todos
  const { data: todosData, isLoading, error } = useQuery<TodosResponse>({
    queryKey: ['todos', queryParams],
    queryFn: async () => {
      const response = await fetch(`/api/example/todos?${queryParams}`)
      if (!response.ok) {
        throw new Error('Failed to fetch todos')
      }
      return response.json()
    },
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
      const response = await fetch(`/api/example/organizations?ids=${organizationIds.join(',')}`)
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
    setSeverity(undefined)
    setDone(undefined)
    setBlocked(undefined)
    setOrgId('')
    setTenantId('')
    setPage(1)
  }

  const filterDefs: FilterDef[] = [
    { id: 'severity', label: 'Severity', type: 'select', options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ] },
    { id: 'is_done', label: 'Done', type: 'checkbox' },
    { id: 'cf_blocked', label: 'Blocked', type: 'checkbox' },
    { id: 'organization_id', label: 'Organization ID', type: 'text', placeholder: 'org_…' },
    { id: 'tenant_id', label: 'Tenant ID', type: 'text', placeholder: 'ten_…' },
  ]

  const toolbar = (
    <FilterBar
      searchValue={title}
      onSearchChange={(v) => { setTitle(v); setPage(1) }}
      filters={filterDefs}
      values={{ severity, is_done: done, cf_blocked: blocked, organization_id: orgId, tenant_id: tenantId }}
      onApply={(vals: FilterValues) => {
        setSeverity(vals.severity)
        setDone(vals.is_done === true ? true : undefined)
        setBlocked(vals.cf_blocked === true ? true : undefined)
        setOrgId(vals.organization_id || '')
        setTenantId(vals.tenant_id || '')
        setPage(1)
      }}
      onClear={() => handleReset()}
    />
  )

  if (error) {
    return <div>Error: {error.message}</div>
  }

  return (
    <DataTable 
      columns={columns} 
      data={todosWithOrgNames} 
      toolbar={toolbar} 
      sortable 
      sorting={sorting} 
      onSortingChange={handleSortingChange}
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
