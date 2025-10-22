"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { buildCrudExportUrl } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

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

const TASKS_TAB_QUERY = 'tab=tasks'

function buildCustomerHref(item: CustomerTodoItem): string | null {
  const customerId = item.customer?.id
  if (!customerId) return null
  const kind = (item.customer?.kind ?? '').toLowerCase()
  const base =
    kind === 'company'
      ? `/backend/customers/companies/${customerId}`
      : `/backend/customers/people/${customerId}`
  return `${base}?${TASKS_TAB_QUERY}`
}

export function CustomerTodosTable(): JSX.Element {
  const t = useT()
  const router = useRouter()
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

  const columns = React.useMemo<ColumnDef<CustomerTodoItem>[]>(() => [
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
      meta: { priority: 1 },
    },
    {
      accessorKey: 'todoTitle',
      header: t('customers.workPlan.customerTodos.table.column.todo'),
      cell: ({ row }) => {
        const title = row.original.todoTitle ?? t('customers.workPlan.customerTodos.table.column.todo.unnamed')
        const todoId = row.original.todoId
        if (!todoId) return <span className="text-muted-foreground">{title}</span>
        return (
          <Link href={`/backend/todos/${todoId}/edit`} className="underline-offset-2 hover:underline">
            {title}
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
  ], [t])

  const viewExportColumns = React.useMemo(() => {
    return columns
      .map((col) => {
        const accessorKey = (col as any).accessorKey
        if (!accessorKey || typeof accessorKey !== 'string') return null
        if ((col as any).meta?.hidden) return null
        const header = typeof col.header === 'string'
          ? col.header
          : accessorKey
        return { field: accessorKey, header }
      })
      .filter((col): col is { field: string; header: string } => !!col)
  }, [columns])

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

  const rows = data?.items ?? []

  const exportConfig = React.useMemo(() => ({
    view: {
      description: t('customers.workPlan.customerTodos.table.export.view'),
      prepare: async (): Promise<{ prepared: PreparedExport; filename: string }> => {
        const rowsForExport = rows.map((row) => {
          const out: Record<string, unknown> = {}
          for (const col of viewExportColumns) {
            out[col.field] = (row as Record<string, unknown>)[col.field]
          }
          return out
        })
        const prepared: PreparedExport = {
          columns: viewExportColumns.map((col) => ({ field: col.field, header: col.header })),
          rows: rowsForExport,
        }
        return { prepared, filename: 'customer_todos_view' }
      },
    },
    full: {
      description: t('customers.workPlan.customerTodos.table.export.full'),
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('customers/todos', { exportScope: 'full', all: 'true' }, format),
      filename: () => 'customer_todos_full',
    },
  }), [rows, t, viewExportColumns])

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

  const handleNavigate = React.useCallback((item: CustomerTodoItem) => {
    const href = buildCustomerHref(item)
    if (!href) return
    router.push(href)
  }, [router])

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
      exporter={exportConfig}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      perspective={{ tableId: 'customers.todos.list' }}
      filters={filterDefs}
      filterValues={filters}
      onFiltersApply={onFiltersApply}
      onFiltersClear={onFiltersClear}
      rowActions={(row) => {
        const customerLink = buildCustomerHref(row)
        if (!customerLink) return null
        return (
          <RowActions
            items={[
              {
                label: t('customers.workPlan.customerTodos.table.actions.openCustomer'),
                href: customerLink,
              },
            ]}
          />
        )
      }}
      onRowClick={handleNavigate}
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
