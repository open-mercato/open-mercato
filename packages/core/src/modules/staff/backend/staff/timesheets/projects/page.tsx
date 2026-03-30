"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'

const PAGE_SIZE = 50

type ProjectRow = {
  id: string
  name: string
  code: string | null
  customerId: string | null
  status: string
  projectType: string | null
  startDate: string | null
  description: string | null
  costCenter: string | null
  updatedAt: string | null
}

type ProjectsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type StatusTab = { key: string; label: string; value: string | undefined }

const STATUS_BADGE_CLASSES: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  on_hold: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-gray-100 text-gray-800',
}

export default function TimesheetProjectsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<ProjectRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<string | undefined>(undefined)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [canManageProjects, setCanManageProjects] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<{ ok: boolean; granted: string[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['staff.timesheets.projects.manage'] }),
        })
        if (!cancelled) {
          setCanManageProjects(new Set(res.result?.granted ?? []).has('staff.timesheets.projects.manage'))
        }
      } catch {
        // default: no manage access
      }
    })()
    return () => { cancelled = true }
  }, [])

  const labels = React.useMemo(() => ({
    title: t('staff.timesheets.projects.page.title', 'Projects'),
    description: t('staff.timesheets.projects.page.description', 'Manage time tracking projects.'),
    table: {
      name: t('staff.timesheets.projects.table.name', 'Name'),
      status: t('staff.timesheets.projects.table.status', 'Status'),
      type: t('staff.timesheets.projects.table.type', 'Type'),
      startDate: t('staff.timesheets.projects.table.startDate', 'Start Date'),
      updatedAt: t('staff.timesheets.projects.table.updatedAt', 'Updated'),
      empty: t('staff.timesheets.projects.table.empty', 'No projects yet.'),
      search: t('staff.timesheets.projects.table.search', 'Search projects...'),
    },
    actions: {
      add: t('staff.timesheets.projects.actions.add', 'Add Project'),
      viewDetails: t('staff.timesheets.projects.actions.viewDetails', 'View Details'),
      delete: t('staff.timesheets.projects.actions.delete', 'Delete'),
      deleteConfirm: t('staff.timesheets.projects.actions.deleteConfirm', 'Delete project "{{name}}"?'),
      refresh: t('staff.timesheets.projects.actions.refresh', 'Refresh'),
    },
    messages: {
      deleted: t('staff.timesheets.projects.messages.deleted', 'Project deleted.'),
    },
    errors: {
      load: t('staff.timesheets.projects.errors.load', 'Failed to load projects.'),
      delete: t('staff.timesheets.projects.errors.delete', 'Failed to delete project.'),
    },
    statuses: {
      all: t('staff.timesheets.projects.statuses.all', 'All'),
      active: t('staff.timesheets.projects.statuses.active', 'Active'),
      on_hold: t('staff.timesheets.projects.statuses.onHold', 'On Hold'),
      completed: t('staff.timesheets.projects.statuses.completed', 'Completed'),
    },
    stats: {
      total: t('staff.timesheets.projects.stats.total', 'Total Projects'),
      active: t('staff.timesheets.projects.stats.active', 'Active Projects'),
      onHold: t('staff.timesheets.projects.stats.onHold', 'On Hold'),
    },
  }), [t])

  const statusTabs: StatusTab[] = React.useMemo(() => [
    { key: 'all', label: labels.statuses.all, value: undefined },
    { key: 'active', label: labels.statuses.active, value: 'active' },
    { key: 'on_hold', label: labels.statuses.on_hold, value: 'on_hold' },
    { key: 'completed', label: labels.statuses.completed, value: 'completed' },
  ], [labels.statuses])

  const stats = React.useMemo(() => {
    const totalCount = rows.length
    const activeCount = rows.filter((row) => row.status === 'active').length
    const onHoldCount = rows.filter((row) => row.status === 'on_hold').length
    return { totalCount, activeCount, onHoldCount }
  }, [rows])

  const columns = React.useMemo<ColumnDef<ProjectRow>[]>(() => [
    {
      accessorKey: 'name',
      header: labels.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.code ? (
            <span className="text-xs text-muted-foreground">{row.original.code}</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: labels.table.status,
      meta: { priority: 2 },
      cell: ({ row }) => {
        const badgeClass = STATUS_BADGE_CLASSES[row.original.status] ?? 'bg-gray-100 text-gray-800'
        const statusLabel = labels.statuses[row.original.status as keyof typeof labels.statuses] ?? row.original.status
        return (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}>
            {statusLabel}
          </span>
        )
      },
    },
    {
      accessorKey: 'projectType',
      header: labels.table.type,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.projectType
        ? <span className="text-sm">{row.original.projectType}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'startDate',
      header: labels.table.startDate,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.startDate
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.startDate)}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 5 },
      cell: ({ row }) => row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [labels.table, labels.statuses])

  const loadProjects = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      if (search.trim()) params.set('q', search.trim())
      if (statusFilter) params.set('status', statusFilter)
      const payload = await readApiResultOrThrow<ProjectsResponse>(
        `/api/staff/timesheets/time-projects?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiProject))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('staff.timesheets.projects.list', error)
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [labels.errors.load, page, search, sorting, statusFilter])

  React.useEffect(() => {
    void loadProjects()
  }, [loadProjects, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleStatusChange = React.useCallback((value: string | undefined) => {
    setStatusFilter(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: ProjectRow) => {
    const message = labels.actions.deleteConfirm.replace('{{name}}', entry.name)
    const confirmed = await confirm({
      title: labels.actions.delete,
      text: message,
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await deleteCrud('staff/timesheets/time-projects', entry.id, { errorMessage: labels.errors.delete })
      flash(labels.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      console.error('staff.timesheets.projects.delete', error)
      flash(labels.errors.delete, 'error')
    }
  }, [confirm, handleRefresh, labels.actions.deleteConfirm, labels.actions.delete, labels.errors.delete, labels.messages.deleted])

  return (
    <Page>
      <PageBody>
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{labels.stats.total}</p>
            <p className="text-2xl font-semibold">{total}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{labels.stats.active}</p>
            <p className="text-2xl font-semibold">{stats.activeCount}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{labels.stats.onHold}</p>
            <p className="text-2xl font-semibold">{stats.onHoldCount}</p>
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleStatusChange(tab.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === tab.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <DataTable<ProjectRow>
          title={labels.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={labels.table.search}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{labels.table.empty}</p>}
          actions={canManageProjects ? (
            <Button asChild size="sm">
              <Link href="/backend/staff/timesheets/projects/create">
                {labels.actions.add}
              </Link>
            </Button>
          ) : undefined}
          refreshButton={{
            label: labels.actions.refresh,
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'view', label: labels.actions.viewDetails, href: `/backend/staff/timesheets/projects/${row.id}` },
                ...(canManageProjects ? [{ id: 'delete', label: labels.actions.delete, destructive: true, onSelect: () => { void handleDelete(row) } }] : []),
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/staff/timesheets/projects/${row.id}`)}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}

function mapApiProject(item: Record<string, unknown>): ProjectRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : id
  const code = typeof item.code === 'string' && item.code.trim().length ? item.code.trim() : null
  const customerId = typeof item.customerId === 'string'
    ? item.customerId
    : typeof item.customer_id === 'string'
      ? item.customer_id
      : null
  const status = typeof item.status === 'string' ? item.status : 'active'
  const projectType = typeof item.projectType === 'string'
    ? item.projectType
    : typeof item.project_type === 'string'
      ? item.project_type
      : null
  const startDate = typeof item.startDate === 'string'
    ? item.startDate
    : typeof item.start_date === 'string'
      ? item.start_date
      : null
  const description = typeof item.description === 'string' && item.description.trim().length ? item.description.trim() : null
  const costCenter = typeof item.costCenter === 'string'
    ? item.costCenter
    : typeof item.cost_center === 'string'
      ? item.cost_center
      : null
  const updatedAt = typeof item.updatedAt === 'string'
    ? item.updatedAt
    : typeof item.updated_at === 'string'
      ? item.updated_at
      : null
  return withDataTableNamespaces({ id, name, code, customerId, status, projectType, startDate, description, costCenter, updatedAt }, item)
}
