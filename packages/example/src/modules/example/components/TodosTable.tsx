"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import type { TodoListItem } from '@open-mercato/example/modules/example/types'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { BooleanIcon, EnumBadge, useSeverityPreset } from '@open-mercato/ui/backend/ValueIcons'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList, buildCrudExportUrl, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useCustomFieldDefs, type CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { applyCustomFieldVisibility } from '@open-mercato/ui/backend/utils/customFieldColumns'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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

const EMPTY_CUSTOM_FIELD_DEFS: CustomFieldDefDto[] = []

function buildBaseColumns(t: (key: string, params?: Record<string, string | number>) => string, severityPreset: ReturnType<typeof useSeverityPreset>): ColumnDef<TodoRow>[] {
  return [
    { accessorKey: 'title', header: t('example.todos.table.column.title'), meta: { priority: 1 } },
    { accessorKey: 'organization_name', header: t('example.todos.table.column.organization'), enableSorting: false, meta: { priority: 3 } },
    {
      accessorKey: 'is_done',
      header: t('example.todos.table.column.done'),
      meta: { priority: 2 },
      cell: ({ getValue }) => <BooleanIcon value={!!getValue()} />,
    },
    { accessorKey: 'cf_priority', header: t('example.todos.table.column.priority'), meta: { priority: 4 } },
    {
      accessorKey: 'cf_severity',
      header: t('example.todos.table.column.severity'),
      cell: ({ getValue }) => {
        const raw = getValue()
        return <EnumBadge value={typeof raw === 'string' ? raw : null} map={severityPreset} />
      },
      meta: { priority: 5 },
    },
    {
      accessorKey: 'cf_blocked',
      header: t('example.todos.table.column.blocked'),
      meta: { priority: 6 },
      cell: ({ getValue }) => <BooleanIcon value={!!getValue()} />,
    },
    {
      accessorKey: 'cf_labels',
      header: t('example.todos.table.column.labels'),
      cell: ({ getValue }) => {
        const raw = getValue()
        const vals = Array.isArray(raw) ? raw.map((value) => String(value)) : []
        if (vals.length === 0) return <span className="text-xs text-muted-foreground">—</span>
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
}

export default function TodosTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const severityPreset = useSeverityPreset()
  const [title, setTitle] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'title', desc: false }])
  const [page, setPage] = React.useState(1)
  const scopeVersion = useOrganizationScopeVersion()

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: '50',
      sortField: sorting[0]?.id || 'title',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })

    if (title) params.set('title', title)

    Object.entries(values).forEach(([k, v]) => {
      if (k === 'created_at' && v && typeof v === 'object') {
        const range = v as { from?: string; to?: string }
        if (range.from) params.set('createdFrom', range.from)
        if (range.to) params.set('createdTo', range.to)
        return
      }
      if (k === 'is_done') {
        if (v === true || v === false) params.set('isDone', String(v))
        return
      }
      if (k.startsWith('cf_')) {
        if (Array.isArray(v)) params.set(k, v.map((value) => String(value)).join(','))
        else if (v != null && v !== '') params.set(k, String(v))
      }
    })

    return params.toString()
  }, [page, sorting, title, values])

  const { data: rawCfDefs } = useCustomFieldDefs('example:todo', {
    keyExtras: [scopeVersion],
  })
  const cfDefs = rawCfDefs ?? EMPTY_CUSTOM_FIELD_DEFS

  const [columns, setColumns] = React.useState<ColumnDef<TodoRow>[]>([])

  const computedColumns = React.useMemo(() => {
    const base = buildBaseColumns(t, severityPreset)
    if (!cfDefs.length) return base
    return applyCustomFieldVisibility(base, cfDefs)
  }, [cfDefs, t])

  React.useEffect(() => {
    setColumns(computedColumns)
  }, [computedColumns])

  const viewExportColumns = React.useMemo(() => {
    const sourceColumns = columns.length ? columns : computedColumns
    return sourceColumns
      .map((col) => {
        const accessorKey = (col as any).accessorKey
        if (!accessorKey || typeof accessorKey !== 'string') return null
        if ((col as any).meta?.hidden) return null
        const header = typeof col.header === 'string'
          ? col.header
          : accessorKey.startsWith('cf_')
            ? accessorKey.slice(3)
            : accessorKey
        return { field: accessorKey, header }
      })
      .filter((col): col is { field: string; header: string } => !!col)
  }, [columns, computedColumns])

  const fullExportParams = React.useMemo(() => {
    const params: Record<string, string> = { exportScope: 'full', all: 'true' }
    const sort = sorting[0]
    if (sort?.id) {
      params.sortField = sort.id
      params.sortDir = sort.desc ? 'desc' : 'asc'
    }
    return params
  }, [sorting])

  const effectiveColumns = columns.length ? columns : computedColumns

  const { data: todosData, isLoading, error } = useQuery<TodosResponse>({
    queryKey: ['todos', queryParams, scopeVersion],
    queryFn: async () => fetchCrudList<TodoListItem>('example/todos', Object.fromEntries(new URLSearchParams(queryParams))),
  })

  const organizationIds = React.useMemo(() => {
    if (!todosData?.items) return []
    const ids = todosData.items
      .map((todo) => todo.organization_id)
      .filter((id): id is string => id != null)
    return [...new Set(ids)]
  }, [todosData?.items])

  const { data: orgsData } = useQuery<OrganizationsResponse>({
    queryKey: ['organizations', organizationIds],
    queryFn: async () => {
      if (organizationIds.length === 0) return { items: [] }
      return readApiResultOrThrow<OrganizationsResponse>(
        `/api/example/organizations?ids=${organizationIds.join(',')}`,
        undefined,
        { errorMessage: t('example.todos.table.error.generic', 'Failed to fetch organizations') },
      )
    },
    enabled: organizationIds.length > 0,
  })

  const orgMap = React.useMemo(() => {
    if (!orgsData?.items) return {}
    return orgsData.items.reduce((acc, org) => {
      acc[org.id] = org.name
      return acc
    }, {} as Record<string, string>)
  }, [orgsData?.items])

  const todosWithOrgNames = React.useMemo(() => {
    if (!todosData?.items) return []
    return todosData.items.map((todo) => ({
      ...todo,
      organization_name: todo.organization_id
        ? orgMap[todo.organization_id] || t('example.todos.table.organization.unknown')
        : t('example.todos.table.organization.none'),
    }))
  }, [orgMap, t, todosData?.items])

  const exportConfig = React.useMemo(() => ({
    view: {
      description: t('example.todos.table.export.view'),
      prepare: async (): Promise<{ prepared: PreparedExport; filename: string }> => {
        const rows = todosWithOrgNames.map((row) => {
          const out: Record<string, unknown> = {}
          for (const col of viewExportColumns) {
            out[col.field] = (row as Record<string, unknown>)[col.field]
          }
          return out
        })
        const prepared: PreparedExport = {
          columns: viewExportColumns.map((col) => ({ field: col.field, header: col.header })),
          rows,
        }
        return { prepared, filename: 'todos_view' }
      },
    },
    full: {
      description: t('example.todos.table.export.full'),
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('example/todos', fullExportParams, format),
      filename: () => 'todos_full',
    },
  }), [fullExportParams, viewExportColumns, t, todosWithOrgNames])

  const handleSortingChange = (newSorting: SortingState) => {
    setSorting(newSorting)
    setPage(1)
  }

  const handleReset = () => {
    setTitle('')
    setValues({})
    setPage(1)
  }

  if (error) {
    return <div className="text-sm text-destructive">{t('example.todos.table.error.generic')}</div>
  }

  return (
    <DataTable
      title={t('example.todos.table.title')}
      actions={(
        <Button asChild>
          <Link href="/backend/todos/create">{t('example.todos.table.actions.create')}</Link>
        </Button>
      )}
      columns={effectiveColumns}
      data={todosWithOrgNames}
      exporter={exportConfig}
      searchValue={title}
      onSearchChange={(v) => {
        setTitle(v)
        setPage(1)
      }}
      searchAlign="right"
      filters={[
        { id: 'is_done', label: t('example.todos.table.filters.done'), type: 'checkbox' },
        { id: 'created_at', label: t('example.todos.table.filters.createdAt'), type: 'dateRange' },
      ]}
      filterValues={values}
      onFiltersApply={(vals: FilterValues) => {
        setValues(vals)
        setPage(1)
      }}
      onFiltersClear={() => handleReset()}
      entityId="example:todo"
      sortable
      sorting={sorting}
      onSortingChange={handleSortingChange}
      perspective={{ tableId: 'example.todos.list' }}
      rowActions={(row) => (
        <RowActions
          items={[
            { label: t('example.todos.table.actions.edit'), href: `/backend/todos/${row.id}/edit` },
            {
              label: t('example.todos.table.actions.delete'),
              destructive: true,
              onSelect: async () => {
                if (!window.confirm(t('example.todos.table.confirm.delete'))) return
                try {
                  await deleteCrud('example/todos', row.id)
                  flash(t('example.todos.form.flash.deleted'), 'success')
                  queryClient.invalidateQueries({ queryKey: ['todos'] })
                } catch (err) {
                  const message =
                    err instanceof Error && err.message
                      ? err.message
                      : t('example.todos.table.error.delete')
                  flash(message, 'error')
                }
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
      onRowClick={(row) => router.push(`/backend/todos/${row.id}/edit`)}
    />
  )
}
