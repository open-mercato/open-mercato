"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FilterBar, type FilterDef, type FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { BooleanIcon, EnumBadge, severityPreset } from '@open-mercato/ui/backend/ValueIcons'
import { Button } from '@open-mercato/ui/primitives/button'
import Link from 'next/link'

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
  cf_labels?: string[] | null
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
  const [title, setTitle] = React.useState('')
  const [severity, setSeverity] = React.useState<string[]>([])
  const [done, setDone] = React.useState<boolean | undefined>(undefined)
  const [blocked, setBlocked] = React.useState<boolean | undefined>(undefined)
  const [labels, setLabels] = React.useState<string[]>([])
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'title', desc: false }])
  const [page, setPage] = React.useState(1)
  const [createdFrom, setCreatedFrom] = React.useState<string | undefined>(undefined)
  const [createdTo, setCreatedTo] = React.useState<string | undefined>(undefined)

  // Build query parameters
  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: '50',
      sortField: sorting[0]?.id || 'title',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })

    if (title) params.set('title', title)
    if (severity && severity.length) params.set('severityIn', severity.join(','))
    if (done !== undefined) params.set('isDone', done.toString())
    if (blocked !== undefined) params.set('isBlocked', blocked.toString())
    if (labels && labels.length) params.set('labelsIn', labels.join(','))
    if (createdFrom) params.set('createdFrom', createdFrom)
    if (createdTo) params.set('createdTo', createdTo)
    // organization and tenant filters removed per request
    
    return params.toString()
  }, [page, sorting, title, severity, labels, done, blocked, createdFrom, createdTo])

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
    setSeverity([])
    setDone(undefined)
    setBlocked(undefined)
    setCreatedFrom(undefined)
    setCreatedTo(undefined)
    setLabels([])
    setPage(1)
  }

  const filterDefs: FilterDef[] = [
    { id: 'severity', label: 'Severity', type: 'select', multiple: true, options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ] },
    { id: 'is_done', label: 'Done', type: 'checkbox' },
    { id: 'cf_blocked', label: 'Blocked', type: 'checkbox' },
    { id: 'labels', label: 'Labels', type: 'select', multiple: true, options: [
      { value: 'frontend', label: 'Frontend' },
      { value: 'backend', label: 'Backend' },
      { value: 'ops', label: 'Ops' },
      { value: 'bug', label: 'Bug' },
      { value: 'feature', label: 'Feature' },
    ] },
    // Example extra filter type: date range wired to backend
    { id: 'created_at', label: 'Created Date', type: 'dateRange' },
  ]

  const toolbar = (
    <FilterBar
      searchValue={title}
      onSearchChange={(v) => { setTitle(v); setPage(1) }}
      searchAlign="right"
      filters={filterDefs}
      values={{
        severity,
        labels,
        is_done: done,
        cf_blocked: blocked,
        ...(createdFrom || createdTo ? { created_at: { from: createdFrom, to: createdTo } } : {}),
      }}
      onApply={(vals: FilterValues) => {
        const sev = Array.isArray(vals.severity)
          ? vals.severity
          : vals.severity
            ? [vals.severity]
            : []
        setSeverity(sev)
        const lbls = Array.isArray(vals.labels)
          ? vals.labels
          : vals.labels
            ? [vals.labels]
            : []
        setLabels(lbls)
        setDone(vals.is_done === true ? true : undefined)
        setBlocked(vals.cf_blocked === true ? true : undefined)
        setCreatedFrom(vals.created_at?.from)
        setCreatedTo(vals.created_at?.to)
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
      title="Todos"
      actions={(
        <>
          <Button variant="outline" size="sm" onClick={() => {
            const url = `/api/example/todos?${queryParams}&format=csv`
            window.open(url, '_blank')
          }}>Export</Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/backend/todos/create">Create</Link>
          </Button>
        </>
      )}
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
