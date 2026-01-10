"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

const PAGE_SIZE = 50

type TeamRow = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  updatedAt: string | null
}

type TeamsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function BookingTeamsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<TeamRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const labels = React.useMemo(() => ({
    title: t('booking.teams.page.title', 'Teams'),
    description: t('booking.teams.page.description', 'Group team members and roles.'),
    table: {
      name: t('booking.teams.table.name', 'Name'),
      description: t('booking.teams.table.description', 'Description'),
      active: t('booking.teams.table.active', 'Active'),
      updatedAt: t('booking.teams.table.updatedAt', 'Updated'),
      empty: t('booking.teams.table.empty', 'No teams yet.'),
      search: t('booking.teams.table.search', 'Search teams...'),
    },
    actions: {
      add: t('booking.teams.actions.add', 'Add team'),
      edit: t('booking.teams.actions.edit', 'Edit'),
      delete: t('booking.teams.actions.delete', 'Delete'),
      deleteConfirm: t('booking.teams.actions.deleteConfirm', 'Delete team "{{name}}"?'),
      refresh: t('booking.teams.actions.refresh', 'Refresh'),
    },
    messages: {
      deleted: t('booking.teams.messages.deleted', 'Team deleted.'),
    },
    errors: {
      load: t('booking.teams.errors.load', 'Failed to load teams.'),
      delete: t('booking.teams.errors.delete', 'Failed to delete team.'),
    },
  }), [t])

  const columns = React.useMemo<ColumnDef<TeamRow>[]>(() => [
    {
      accessorKey: 'name',
      header: labels.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description ? (
            <span className="text-xs text-muted-foreground line-clamp-2">{row.original.description}</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: labels.table.description,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.description
        ? <span className="text-sm">{row.original.description}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'isActive',
      header: labels.table.active,
      meta: { priority: 2 },
      cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [labels.table.active, labels.table.description, labels.table.name, labels.table.updatedAt])

  const loadTeams = React.useCallback(async () => {
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
      if (search.trim()) params.set('search', search.trim())
      const payload = await readApiResultOrThrow<TeamsResponse>(
        `/api/booking/teams?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiTeam))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('booking.teams.list', error)
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [labels.errors.load, page, search, sorting])

  React.useEffect(() => {
    void loadTeams()
  }, [loadTeams, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: TeamRow) => {
    const message = labels.actions.deleteConfirm.replace('{{name}}', entry.name)
    if (typeof window !== 'undefined' && !window.confirm(message)) return
    try {
      await deleteCrud('booking/teams', entry.id, { errorMessage: labels.errors.delete })
      flash(labels.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      console.error('booking.teams.delete', error)
      flash(labels.errors.delete, 'error')
    }
  }, [handleRefresh, labels.actions.deleteConfirm, labels.errors.delete, labels.messages.deleted])

  return (
    <Page>
      <PageBody>
        <DataTable<TeamRow>
          title={labels.title}
          description={labels.description}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={labels.table.search}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{labels.table.empty}</p>}
          actions={(
            <Button asChild size="sm">
              <Link href="/backend/booking/teams/create">
                {labels.actions.add}
              </Link>
            </Button>
          )}
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
                { label: labels.actions.edit, onSelect: () => { router.push(`/backend/booking/teams/${row.original.id}/edit`) } },
                { label: labels.actions.delete, destructive: true, onSelect: () => { void handleDelete(row.original) } },
              ]}
            />
          )}
        />
      </PageBody>
    </Page>
  )
}

function mapApiTeam(item: Record<string, unknown>): TeamRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : id
  const description = typeof item.description === 'string' && item.description.trim().length ? item.description.trim() : null
  const updatedAt = typeof item.updatedAt === 'string'
    ? item.updatedAt
    : typeof item.updated_at === 'string'
      ? item.updated_at
      : null
  const isActive = typeof item.isActive === 'boolean'
    ? item.isActive
    : typeof item.is_active === 'boolean'
      ? item.is_active
      : true
  return { id, name, description, isActive, updatedAt }
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}
