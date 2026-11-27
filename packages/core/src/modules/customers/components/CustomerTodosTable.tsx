"use client"

import * as React from 'react'
import { extensionPoints } from '@open-mercato/core/modules/customers/extension-points'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { FilterOption } from '@open-mercato/ui/backend/FilterOverlay'
import type { PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import {
  buildOptimisticLockHeader,
  extractOptimisticLockConflict,
  extractRecordLockConflict,
} from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { resolveTodoHref } from './detail/utils'
import { TaskDialog } from './detail/TaskDialog'
import { buildCanonicalTaskUpdatePayload, buildTaskFormInitialValues } from './detail/taskFormValues'
import type { TaskFormPayload } from './detail/hooks/usePersonTasks'
import { useCanManageInteractions } from './detail/hooks/useCanManageInteractions'
import type { TodoLinkSummary } from './detail/types'
import { fetchAssignableStaffMembers } from '../lib/assignableStaff'
import { CUSTOMER_INTERACTION_TASK_SOURCE } from '../lib/interactionCompatibility'
import { isCanceledInteractionStatus } from '../lib/interactionStatus'

type CustomerTodoItem = {
  id: string
  todoId: string
  todoSource: string
  todoTitle: string | null
  todoIsDone: boolean | null
  todoStatus?: string | null
  todoPriority?: number | null
  todoSeverity?: string | null
  todoDescription?: string | null
  todoDueAt?: string | null
  todoCustomValues?: Record<string, unknown> | null
  todoOrganizationId: string | null
  todoUpdatedAt?: string | null
  todoOwnerUserId?: string | null
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
  totalIsCapped?: boolean
}

type TodosMutationContext = {
  formId: string
  resourceKind: string
  retryLastMutation: () => Promise<boolean>
}

const TASKS_TAB_QUERY = 'tab=tasks'
const CUSTOMER_TASKS_API_PATH = '/api/customers/interactions/tasks'
const INTERACTIONS_API_PATH = '/api/customers/interactions'
const COMPLETE_INTERACTION_API_PATH = '/api/customers/interactions/complete'
const MUTATION_CONTEXT_ID = 'customers-todos-table'
const OWNER_SELF_VALUE = 'me'
const DEFAULT_FILTER_VALUES: FilterValues = { status: 'open' }
const SORT_FIELD_BY_COLUMN: Record<string, 'dueAt' | 'priority'> = {
  todoDueAt: 'dueAt',
  todoPriority: 'priority',
}

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

function isCrmTask(item: CustomerTodoItem): boolean {
  return item.todoSource === CUSTOMER_INTERACTION_TASK_SOURCE
}

function resolveReadOnlyTaskHref(item: CustomerTodoItem): string | null {
  if (isCrmTask(item)) return buildCustomerHref(item)
  return item.externalHref ?? resolveTodoHref(item.todoSource, item.todoId)
}

function readStringFilter(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readPriorityFilter(value: unknown): string | null {
  const raw = readStringFilter(value)
  if (!raw || !/^\d{1,3}$/.test(raw)) return null
  const parsed = Number(raw)
  return parsed >= 0 && parsed <= 100 ? String(parsed) : null
}

function appendFilterParams(usp: URLSearchParams, filterValues: FilterValues): void {
  const status = readStringFilter(filterValues.status)
  if (status === 'open' || status === 'done') usp.set('status', status)
  const dueRange = filterValues.dueAt
  if (dueRange && typeof dueRange === 'object') {
    const dueFrom = readStringFilter((dueRange as Record<string, unknown>).from)
    const dueTo = readStringFilter((dueRange as Record<string, unknown>).to)
    if (dueFrom) usp.set('dueFrom', dueFrom)
    if (dueTo) usp.set('dueTo', dueTo)
  }
  const priorityMin = readPriorityFilter(filterValues.priorityMin)
  if (priorityMin) usp.set('priorityMin', priorityMin)
  const priorityMax = readPriorityFilter(filterValues.priorityMax)
  if (priorityMax) usp.set('priorityMax', priorityMax)
  const ownerUserId = readStringFilter(filterValues.ownerUserId)
  if (ownerUserId) usp.set('ownerUserId', ownerUserId)
}

function buildCustomerTasksQueryString(input: {
  page: number
  pageSize: number
  search: string
  filterValues: FilterValues
  sorting: SortingState
  all?: boolean
}): string {
  const usp = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
  })
  if (input.search.trim().length > 0) usp.set('search', input.search.trim())
  appendFilterParams(usp, input.filterValues)
  const primarySort = input.sorting[0]
  const sortField = primarySort ? SORT_FIELD_BY_COLUMN[primarySort.id] : undefined
  if (primarySort && sortField) {
    usp.set('sortField', sortField)
    usp.set('sortDir', primarySort.desc ? 'desc' : 'asc')
  }
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

function isRecordConflict(error: unknown): boolean {
  return Boolean(extractOptimisticLockConflict(error) || extractRecordLockConflict(error))
}

function mapItemToTaskSummary(item: CustomerTodoItem): TodoLinkSummary {
  return {
    id: item.id,
    todoId: item.todoId,
    todoSource: item.todoSource,
    createdAt: item.createdAt,
    title: item.todoTitle,
    isDone: item.todoIsDone,
    status: item.todoStatus ?? (item.todoIsDone ? 'done' : 'planned'),
    priority: item.todoPriority ?? null,
    description: item.todoDescription ?? null,
    dueAt: item.todoDueAt ?? null,
    todoOrganizationId: item.todoOrganizationId,
    updatedAt: item.todoUpdatedAt ?? null,
    customValues: item.todoCustomValues ?? null,
  }
}

export function CustomerTodosTable(): React.JSX.Element {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const canManageTasks = useCanManageInteractions()

  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [filterValues, setFilterValues] = React.useState<FilterValues>(DEFAULT_FILTER_VALUES)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [editingItem, setEditingItem] = React.useState<CustomerTodoItem | null>(null)
  const [isSavingTask, setIsSavingTask] = React.useState(false)
  const [pendingToggleId, setPendingToggleId] = React.useState<string | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<TodosMutationContext>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<TodosMutationContext>(() => ({
    formId: MUTATION_CONTEXT_ID,
    resourceKind: 'customers.interaction',
    retryLastMutation,
  }), [retryLastMutation])

  const params = React.useMemo(() => buildCustomerTasksQueryString({
    page,
    pageSize,
    search,
    filterValues,
    sorting,
  }), [filterValues, page, pageSize, search, sorting])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('customers.workPlan.customerTodos.table.filters.done'),
      type: 'select',
      options: [
        { value: 'open', label: t('customers.workPlan.customerTodos.table.filters.doneOption.open') },
        { value: 'done', label: t('customers.workPlan.customerTodos.table.filters.doneOption.completed') },
      ],
    },
    {
      id: 'dueAt',
      label: t('customers.workPlan.customerTodos.table.filters.dueAt'),
      type: 'dateRange',
    },
    {
      id: 'priorityMin',
      label: t('customers.workPlan.customerTodos.table.filters.priorityMin'),
      type: 'text',
      placeholder: '0-100',
    },
    {
      id: 'priorityMax',
      label: t('customers.workPlan.customerTodos.table.filters.priorityMax'),
      type: 'text',
      placeholder: '0-100',
    },
    {
      id: 'ownerUserId',
      label: t('customers.workPlan.customerTodos.table.filters.owner'),
      type: 'select',
      loadOptions: async (query?: string): Promise<FilterOption[]> => {
        const mine: FilterOption = {
          value: OWNER_SELF_VALUE,
          label: t('customers.workPlan.customerTodos.table.filters.ownerOption.mine'),
        }
        const members = await fetchAssignableStaffMembers(query ?? '')
        return [
          mine,
          ...members.map((member) => ({
            value: member.userId,
            label: member.email && member.email !== member.displayName
              ? `${member.displayName} (${member.email})`
              : member.displayName,
          })),
        ]
      },
    },
  ], [t])

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

  const rows = React.useMemo(() => data?.items ?? [], [data])

  const runTaskMutation = React.useCallback(
    async (item: CustomerTodoItem, request: () => Promise<unknown>, mutationPayload: Record<string, unknown>) => {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(item.todoUpdatedAt ?? null),
          request,
        ),
        mutationPayload: { id: item.todoId, ...mutationPayload },
        context: mutationContext,
      })
    },
    [mutationContext, runMutation],
  )

  const handleToggleDone = React.useCallback(async (item: CustomerTodoItem, nextIsDone: boolean) => {
    setPendingToggleId(item.id)
    try {
      await runTaskMutation(
        item,
        () => nextIsDone
          ? apiCallOrThrow(
            COMPLETE_INTERACTION_API_PATH,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: item.todoId }),
            },
            { errorMessage: t('customers.workPlan.customerTodos.table.error.update') },
          )
          : apiCallOrThrow(
            INTERACTIONS_API_PATH,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: item.todoId, status: 'planned' }),
            },
            { errorMessage: t('customers.workPlan.customerTodos.table.error.update') },
          ),
        { isDone: nextIsDone },
      )
      flash(
        nextIsDone
          ? t('customers.workPlan.customerTodos.table.flash.completed')
          : t('customers.workPlan.customerTodos.table.flash.reopened'),
        'success',
      )
    } catch (err) {
      if (!isRecordConflict(err)) {
        flash(err instanceof Error ? err.message : t('customers.workPlan.customerTodos.table.error.update'), 'error')
      }
    } finally {
      setPendingToggleId(null)
      await refetch()
    }
  }, [refetch, runTaskMutation, t])

  const handleEditSubmit = React.useCallback(async (payload: TaskFormPayload) => {
    const item = editingItem
    if (!item) return
    setIsSavingTask(true)
    try {
      await runTaskMutation(
        item,
        () => apiCallOrThrow(
          INTERACTIONS_API_PATH,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.todoId, ...buildCanonicalTaskUpdatePayload(payload) }),
          },
          { errorMessage: t('customers.workPlan.customerTodos.table.error.update') },
        ),
        { title: payload.base.title },
      )
      flash(t('customers.workPlan.customerTodos.table.flash.updated'), 'success')
      setEditingItem(null)
    } finally {
      setIsSavingTask(false)
      await refetch()
    }
  }, [editingItem, refetch, runTaskMutation, t])

  const columns = React.useMemo<ColumnDef<CustomerTodoItem>[]>(() => [
    {
      accessorKey: 'customer.displayName',
      header: t('customers.workPlan.customerTodos.table.column.customer'),
      enableSorting: false,
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
      enableSorting: false,
      cell: ({ row }) => {
        const title = row.original.todoTitle ?? t('customers.workPlan.customerTodos.table.column.todo.unnamed')
        if (canManageTasks && isCrmTask(row.original)) {
          return (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 font-normal text-foreground underline-offset-2"
              onClick={(event) => {
                event.stopPropagation()
                setEditingItem(row.original)
              }}
            >
              {title}
            </Button>
          )
        }
        const todoHref = resolveReadOnlyTaskHref(row.original)
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
      accessorKey: 'todoDueAt',
      header: t('customers.workPlan.customerTodos.table.column.dueAt'),
      cell: ({ row }) => formatDateTime(row.original.todoDueAt ?? null)
        ?? <span className="text-muted-foreground">—</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'todoPriority',
      header: t('customers.workPlan.customerTodos.table.column.priority'),
      cell: ({ row }) => typeof row.original.todoPriority === 'number'
        ? row.original.todoPriority
        : <span className="text-muted-foreground">—</span>,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'todoIsDone',
      header: t('customers.workPlan.customerTodos.table.column.done'),
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original
        const isDone = item.todoIsDone === true
        if (!canManageTasks || !isCrmTask(item)) return <BooleanIcon value={isDone} />
        return (
          <Checkbox
            checked={isDone}
            disabled={pendingToggleId === item.id || isCanceledInteractionStatus(item.todoStatus)}
            aria-label={isDone
              ? t('customers.workPlan.customerTodos.table.actions.reopen')
              : t('customers.workPlan.customerTodos.table.actions.markDone')}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => { void handleToggleDone(item, checked === true) }}
          />
        )
      },
      meta: { priority: 3 },
    },
  ], [canManageTasks, handleToggleDone, pendingToggleId, t])

  const viewExportColumns = React.useMemo(() => {
    return columns
      .map((col) => {
        const accessorKey = (col as { accessorKey?: unknown }).accessorKey
        if (!accessorKey || typeof accessorKey !== 'string') return null
        if ((col.meta as { hidden?: boolean } | undefined)?.hidden) return null
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
          filterValues,
          sorting,
          all: true,
        }))
        return {
          prepared: buildPreparedExport(fullData.items, viewExportColumns),
          filename: 'customer_todos_full',
        }
      },
    },
  }), [buildPreparedExport, fetchTasks, filterValues, pageSize, rows, search, sorting, t, viewExportColumns])

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

  const hasActiveFilters = Object.values(filterValues).some((value) => value !== undefined && value !== null && value !== '')
  const errorMessage = error ? (error instanceof Error ? error.message : t('customers.workPlan.customerTodos.table.error.load')) : null
  const emptyStateMessage = !isLoading && !errorMessage && rows.length === 0
    ? (search || hasActiveFilters ? t('customers.workPlan.customerTodos.table.state.noMatches') : t('customers.workPlan.customerTodos.table.state.empty'))
    : undefined

  return (
    <>
      <DataTable
        title={t('customers.workPlan.customerTodos.table.title')}
        titleHeadingLevel={1}
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
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(values) => {
          setFilterValues(values)
          setPage(1)
        }}
        onFiltersClear={() => {
          setFilterValues({})
          setPage(1)
        }}
        sortable
        manualSorting
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
        perspective={{ tableId: extensionPoints.hosts.todosTable.tableId }}
        rowActions={(row) => {
          const customerLink = buildCustomerHref(row)
          const crmTask = isCrmTask(row)
          const canEditTask = crmTask && canManageTasks
          const todoHref = crmTask ? null : row.externalHref ?? resolveTodoHref(row.todoSource, row.todoId)
          const isDone = row.todoIsDone === true
          const items = [
            customerLink ? {
              id: 'open-customer',
              label: t('customers.workPlan.customerTodos.table.actions.openCustomer'),
              href: customerLink,
            } : null,
            canEditTask ? {
              id: 'open-task',
              label: t('customers.workPlan.customerTodos.table.actions.openTask'),
              onSelect: () => setEditingItem(row),
            } : null,
            todoHref ? {
              id: 'open-task',
              label: t('customers.workPlan.customerTodos.table.actions.openTask'),
              href: todoHref,
            } : null,
            canEditTask && !isCanceledInteractionStatus(row.todoStatus) ? {
              id: isDone ? 'reopen-task' : 'complete-task',
              label: isDone
                ? t('customers.workPlan.customerTodos.table.actions.reopen')
                : t('customers.workPlan.customerTodos.table.actions.markDone'),
              onSelect: () => { void handleToggleDone(row, !isDone) },
            } : null,
          ].filter((item): item is NonNullable<typeof item> => !!item)
          if (!items.length) return null
          return <RowActions items={items} />
        }}
        onRowClick={handleNavigate}
        pagination={{
          page,
          pageSize,
          total: data?.total ?? 0,
          totalPages: data?.totalPages ?? 0,
          totalIsCapped: data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        error={errorMessage}
        emptyState={emptyStateMessage}
      />
      <TaskDialog
        open={editingItem !== null}
        mode="edit"
        onOpenChange={(next) => {
          if (!next) setEditingItem(null)
        }}
        initialValues={buildTaskFormInitialValues(editingItem ? mapItemToTaskSummary(editingItem) : null)}
        onSubmit={handleEditSubmit}
        isSubmitting={isSavingTask}
        useCanonicalInteractions
      />
    </>
  )
}

export default CustomerTodosTable
