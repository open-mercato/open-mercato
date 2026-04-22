"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveTodoHref } from './detail/utils'

type CustomerTodoItem = {
  id: string
  todoId: string
  todoSource: string
  todoTitle: string | null
  todoIsDone: boolean | null
  todoPriority?: number | null
  todoSeverity?: string | null
  todoDescription?: string | null
  todoDueAt?: string | null
  todoCustomValues?: Record<string, unknown> | null
  todoOrganizationId: string | null
  organizationId: string
  tenantId: string
  createdAt: string
  externalHref?: string | null
  _integrations?: Record<string, unknown>
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
const CUSTOMER_TASKS_API_PATH = '/api/customers/interactions/tasks'

function buildCustomerHref(item: CustomerTodoItem): string | null {
  const customerId = item.customer?.id
  if (!customerId) return null
  const kind = (item.customer?.kind ?? '').toLowerCase()
  const base =
    kind === 'company'
      ? `/backend/customers/companies-v2/${customerId}`
      : `/backend/customers/people-v2/${customerId}`
  return `${base}?${TASKS_TAB_QUERY}`
}

function buildCustomerTasksQueryString(input: {
  page: number
  pageSize: number
  search: string
  all?: boolean
}): string {
  const usp = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
  })
  if (input.search.trim().length > 0) usp.set('search', input.search.trim())
  if (input.all) usp.set('all', 'true')
  return usp.toString()
}

function readValueAtPath(record: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.').filter((segment) => segment.length > 0)
  let current: unknown = record
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[segment]
  }
  return current ?? null
}

export function CustomerTodosTable(): React.JSX.Element {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()

  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)

  const params = React.useMemo(() => buildCustomerTasksQueryString({
    page,
    pageSize,
    search,
  }), [page, pageSize, search])

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
        const todoHref = row.original.externalHref ?? resolveTodoHref(row.original.todoSource, row.original.todoId)
        if (!todoHref) return <span className="text-muted-foreground">{title}</span>
        return (
          <Link href={todoHref} className="underline-offset-2 hover:underline">
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

  const buildPreparedExport = React.useCallback((
    exportRows: CustomerTodoItem[],
    exportColumns: Array<{ field: string; header: string }>,
  ): PreparedExport => ({
    columns: exportColumns.map((col) => ({ field: col.field, header: col.header })),
    rows: exportRows.map((row) => {
      const record = row as Record<string, unknown>
      return Object.fromEntries(
        exportColumns.map((col) => [col.field, readValueAtPath(record, col.field)]),
      )
    }),
  }), [])

  const fetchTasks = React.useCallback(async (queryString: string): Promise<CustomerTodosResponse> => {
    return readApiResultOrThrow<CustomerTodosResponse>(
      `${CUSTOMER_TASKS_API_PATH}?${queryString}`,
      undefined,
      { errorMessage: t('customers.workPlan.customerTodos.table.error.load') },
    )
  }, [t])

  const { data, isLoading, error, refetch, isFetching } = useQuery<CustomerTodosResponse>({
    queryKey: ['customers-interactions-tasks', params, scopeVersion],
    queryFn: async () => fetchTasks(params),
    placeholderData: keepPreviousData,
  })

  const rows = data?.items ?? []

  const exportConfig = React.useMemo(() => ({
    view: {
      description: t('customers.workPlan.customerTodos.table.export.view'),
      prepare: async (): Promise<{ prepared: PreparedExport; filename: string }> => {
        return {
          prepared: buildPreparedExport(rows, viewExportColumns),
          filename: 'customer_todos_view',
        }
      },
    },
    full: {
      description: t('customers.workPlan.customerTodos.table.export.full'),
      prepare: async (_format: DataTableExportFormat): Promise<{ prepared: PreparedExport; filename: string }> => {
        const fullData = await fetchTasks(buildCustomerTasksQueryString({
          page: 1,
          pageSize,
          search,
          all: true,
        }))
        return {
          prepared: buildPreparedExport(fullData.items, viewExportColumns),
          filename: 'customer_todos_full',
        }
      },
    },
  }), [buildPreparedExport, fetchTasks, pageSize, rows, search, t, viewExportColumns])

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

  const errorMessage = error ? (error instanceof Error ? error.message : t('customers.workPlan.customerTodos.table.error.load')) : null
  const emptyStateMessage = !isLoading && !errorMessage && rows.length === 0
    ? (search ? t('customers.workPlan.customerTodos.table.state.noMatches') : t('customers.workPlan.customerTodos.table.state.empty'))
    : undefined

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
      rowActions={(row) => {
        const customerLink = buildCustomerHref(row)
        const todoHref = row.externalHref ?? resolveTodoHref(row.todoSource, row.todoId)
        const items = [
          customerLink ? {
            id: 'open-customer',
            label: t('customers.workPlan.customerTodos.table.actions.openCustomer'),
            href: customerLink,
          } : null,
          todoHref ? {
            id: 'open-task',
            label: t('customers.workPlan.customerTodos.table.actions.openTask'),
            href: todoHref,
          } : null,
        ].filter((item): item is { id: string; label: string; href: string } => !!item)
        if (!items.length) return null
        return <RowActions items={items} />
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
      error={errorMessage}
      emptyState={emptyStateMessage}
    />
  )
}

export default CustomerTodosTable
