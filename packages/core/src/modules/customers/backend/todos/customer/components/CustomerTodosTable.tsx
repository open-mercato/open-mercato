"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { Button } from '@open-mercato/ui/primitives/button'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import Link from 'next/link'

type CustomerTodoItem = {
  id: string
  todoId: string
  todoSource: string
  todoTitle: string | null
  todoIsDone: boolean | null
  todoOrganizationId: string | null
  organizationId: string
  tenantId: string
  createdAt: string
  customer: {
    id: string | null
    displayName: string | null
    kind: string | null
  }
}

type CustomerTodosResponse = {
  items: CustomerTodoItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function buildCustomerHref(item: CustomerTodoItem): string | null {
  if (!item.customer?.id) return null
  const kind = (item.customer.kind ?? '').toLowerCase()
  if (kind === 'person') return `/backend/customers/people/${item.customer.id}`
  if (kind === 'company') return `/backend/customers/companies/${item.customer.id}`
  return `/backend/customers/people/${item.customer.id}`
}

export function CustomerTodosTable(): JSX.Element {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [filters, setFilters] = React.useState<FilterValues>({})

  const params = React.useMemo(() => {
    const usp = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (search.trim().length > 0) usp.set('search', search.trim())
    const doneValue = filters.is_done
    if (doneValue === 'true' || doneValue === 'false') usp.set('isDone', doneValue)
    return usp.toString()
  }, [page, pageSize, search, filters])

  const { data, isLoading, error, refetch, isFetching } = useQuery<CustomerTodosResponse>({
    queryKey: ['customers-todos', params, scopeVersion],
    queryFn: async () => {
      const response = await apiFetch(`/api/customers/todos?${params}`)
      if (!response.ok) {
        let message = t('customers.workPlan.customerTodos.table.error.load')
        try {
          const parsed = await response.json()
          if (parsed?.error && typeof parsed.error === 'string') {
            message = parsed.error
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(message)
      }
      return response.json() as Promise<CustomerTodosResponse>
    },
  })

  const columns = React.useMemo<ColumnDef<CustomerTodoItem>[]>(() => [
    {
      accessorKey: 'todoTitle',
      header: t('customers.workPlan.customerTodos.table.column.todo'),
      cell: ({ row }) => {
        const todoId = row.original.todoId
        if (!todoId) return <span className="text-muted-foreground">—</span>
        return (
          <Link href={`/backend/todos/${todoId}/edit`} className="underline-offset-2 hover:underline">
            {row.original.todoTitle ?? t('customers.workPlan.customerTodos.table.column.todo.unnamed')}
          </Link>
        )
      },
      meta: { priority: 1 },
    },
    {
      accessorKey: 'customer.displayName',
      header: t('customers.workPlan.customerTodos.table.column.customer'),
      cell: ({ row }) => {
        const name = row.original.customer?.displayName
        if (!name) return <span className="text-muted-foreground">—</span>
        const href = buildCustomerHref(row.original)
        if (!href) return name
        return (
          <Link href={href} className="underline-offset-2 hover:underline">
            {name}
          </Link>
        )
      },
      meta: { priority: 2 },
    },
    {
      accessorKey: 'todoIsDone',
      header: t('customers.workPlan.customerTodos.table.column.done'),
      cell: ({ row }) => <BooleanIcon value={row.original.todoIsDone === true} />,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'createdAt',
      header: t('customers.workPlan.customerTodos.table.column.createdAt'),
      cell: ({ row }) => <span>{formatDateTime(row.original.createdAt)}</span>,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'todoSource',
      header: t('customers.workPlan.customerTodos.table.column.source'),
      meta: { priority: 5 },
    },
  ], [t])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'is_done',
      label: t('customers.workPlan.customerTodos.table.filters.done'),
      type: 'select',
      options: [
        { label: t('customers.workPlan.customerTodos.table.filters.doneOption.any'), value: '' },
        { label: t('customers.workPlan.customerTodos.table.filters.doneOption.open'), value: 'false' },
        { label: t('customers.workPlan.customerTodos.table.filters.doneOption.completed'), value: 'true' },
      ],
    },
  ], [t])

  const onFiltersApply = React.useCallback((next: FilterValues) => {
    const nextValue = next?.is_done
    setFilters((prev) => {
      if (prev.is_done === nextValue) return prev
      return { is_done: nextValue }
    })
    setPage(1)
  }, [])

  const onFiltersClear = React.useCallback(() => {
    setFilters({})
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(async () => {
    try {
      await refetch()
      flash(t('customers.workPlan.customerTodos.table.flash.refreshed'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.workPlan.customerTodos.table.error.load')
      flash(message, 'error')
    }
  }, [refetch, t])

  const rows = data?.items ?? []

  return (
    <DataTable
      title={t('customers.workPlan.customerTodos.table.title')}
      actions={(
        <Button
          variant="outline"
          onClick={() => { void handleRefresh() }}
          disabled={isFetching}
        >
          {t('customers.workPlan.customerTodos.table.actions.refresh')}
        </Button>
      )}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      filters={filterDefs}
      filterValues={filters}
      onFiltersApply={onFiltersApply}
      onFiltersClear={onFiltersClear}
      rowActions={(row) => {
        const actions = []
        if (row.todoId) {
          actions.push({
            label: t('customers.workPlan.customerTodos.table.actions.openTask'),
            href: `/backend/todos/${row.todoId}/edit`,
          })
        }
        const customerLink = buildCustomerHref(row)
        if (customerLink) {
          actions.push({
            label: t('customers.workPlan.customerTodos.table.actions.openCustomer'),
            href: customerLink,
          })
        }
        if (actions.length === 0) return null
        return <RowActions items={actions} />
      }}
      pagination={{
        page,
        pageSize,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        onPageChange: setPage,
      }}
      isLoading={isLoading}
      emptyState={(
        <div className="py-8 text-sm text-muted-foreground">
          {search || filters.is_done
            ? t('customers.workPlan.customerTodos.table.state.noMatches')
            : t('customers.workPlan.customerTodos.table.state.empty')}
        </div>
      )}
      error={error ? (error instanceof Error ? error.message : t('customers.workPlan.customerTodos.table.error.load')) : null}
    />
  )
}

export default CustomerTodosTable
