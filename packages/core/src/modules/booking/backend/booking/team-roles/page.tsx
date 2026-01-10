"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

const PAGE_SIZE = 50

type TeamRoleRow = {
  kind: 'team' | 'role'
  id: string
  teamId: string | null
  name: string
  description: string | null
  updatedAt: string | null
}

type TeamRolesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function BookingTeamRolesPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<TeamRoleRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const labels = React.useMemo(() => ({
    title: t('booking.teamRoles.page.title', 'Team roles'),
    description: t('booking.teamRoles.page.description', 'Define roles that can be assigned to team members.'),
    table: {
      name: t('booking.teamRoles.table.name', 'Name'),
      description: t('booking.teamRoles.table.description', 'Description'),
      updatedAt: t('booking.teamRoles.table.updatedAt', 'Updated'),
      empty: t('booking.teamRoles.table.empty', 'No team roles yet.'),
      search: t('booking.teamRoles.table.search', 'Search roles...'),
    },
    groups: {
      unassigned: t('booking.teamRoles.group.unassigned', 'Unassigned'),
    },
    actions: {
      add: t('booking.teamRoles.actions.add', 'Add team role'),
      edit: t('booking.teamRoles.actions.edit', 'Edit'),
      delete: t('booking.teamRoles.actions.delete', 'Delete'),
      deleteConfirm: t('booking.teamRoles.actions.deleteConfirm', 'Delete team role "{{name}}"?'),
      refresh: t('booking.teamRoles.actions.refresh', 'Refresh'),
    },
    messages: {
      deleted: t('booking.teamRoles.messages.deleted', 'Team role deleted.'),
    },
    errors: {
      load: t('booking.teamRoles.errors.load', 'Failed to load team roles.'),
      delete: t('booking.teamRoles.errors.delete', 'Failed to delete team role.'),
    },
  }), [t])

  const columns = React.useMemo<ColumnDef<TeamRoleRow>[]>(() => [
    {
      accessorKey: 'name',
      header: labels.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className={`${row.original.kind === 'team' ? 'font-semibold' : 'font-medium pl-6'}`}>{row.original.name}</span>
          {row.original.kind === 'team' ? null : row.original.description ? (
            <span className="text-xs text-muted-foreground pl-6">{row.original.description}</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: labels.table.description,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.kind === 'team'
        ? <span className="text-xs text-muted-foreground">-</span>
        : row.original.description
          ? <span className="text-sm">{row.original.description}</span>
          : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.kind === 'team'
        ? <span className="text-xs text-muted-foreground">-</span>
        : row.original.updatedAt
          ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
          : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [labels.table.description, labels.table.name, labels.table.updatedAt])

  const loadTeamRoles = React.useCallback(async () => {
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
      const payload = await readApiResultOrThrow<TeamRolesResponse>(
        `/api/booking/team-roles?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(buildTeamRoleRows(items.map(mapApiTeamRole), labels.groups.unassigned))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('booking.team-roles.list', error)
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [labels.errors.load, labels.groups, page, search, sorting])

  React.useEffect(() => {
    void loadTeamRoles()
  }, [loadTeamRoles, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: TeamRoleRow) => {
    if (entry.kind !== 'role') return
    const message = labels.actions.deleteConfirm.replace('{{name}}', entry.name)
    if (typeof window !== 'undefined' && !window.confirm(message)) return
    try {
      await deleteCrud('booking/team-roles', entry.id, { errorMessage: labels.errors.delete })
      flash(labels.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      console.error('booking.team-roles.delete', error)
      flash(labels.errors.delete, 'error')
    }
  }, [handleRefresh, labels.actions.deleteConfirm, labels.errors.delete, labels.messages.deleted])

  return (
    <Page>
      <PageBody>
        <DataTable<TeamRoleRow>
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
              <Link href="/backend/booking/team-roles/create">
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
          rowActions={(row) => row.kind === 'role' ? (
            <RowActions
              items={[
                { label: labels.actions.edit, onSelect: () => { router.push(`/backend/booking/team-roles/${row.id}/edit`) } },
                { label: labels.actions.delete, destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          ) : null}
        />
      </PageBody>
    </Page>
  )
}

type TeamRoleApiRow = {
  id: string
  name: string
  description: string | null
  updatedAt: string | null
  teamId: string | null
  teamName: string | null
}

function mapApiTeamRole(item: Record<string, unknown>): TeamRoleApiRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : id
  const description = typeof item.description === 'string' && item.description.trim().length ? item.description.trim() : null
  const updatedAt = typeof item.updatedAt === 'string'
    ? item.updatedAt
    : typeof item.updated_at === 'string'
      ? item.updated_at
      : null
  const teamId = typeof item.teamId === 'string'
    ? item.teamId
    : typeof item.team_id === 'string'
      ? item.team_id
      : null
  const team = item.team && typeof item.team === 'object'
    ? item.team as { name?: unknown }
    : null
  const teamName = typeof team?.name === 'string' ? team.name : null
  return { id, name, description, updatedAt, teamId, teamName }
}

function buildTeamRoleRows(items: TeamRoleApiRow[], unassignedLabel: string): TeamRoleRow[] {
  const groups = new Map<string, { teamId: string | null; name: string; roles: TeamRoleApiRow[] }>()
  for (const role of items) {
    const key = role.teamId ?? 'unassigned'
    const label = role.teamName ?? unassignedLabel
    const group = groups.get(key) ?? { teamId: role.teamId ?? null, name: label, roles: [] }
    group.roles.push(role)
    groups.set(key, group)
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))
  const rows: TeamRoleRow[] = []
  for (const group of sortedGroups) {
    rows.push({
      kind: 'team',
      id: `team:${group.teamId ?? 'unassigned'}`,
      teamId: group.teamId,
      name: group.name,
      description: null,
      updatedAt: null,
    })
    const sortedRoles = [...group.roles].sort((a, b) => a.name.localeCompare(b.name))
    for (const role of sortedRoles) {
      rows.push({
        kind: 'role',
        id: role.id,
        teamId: role.teamId,
        name: role.name,
        description: role.description,
        updatedAt: role.updatedAt,
      })
    }
  }
  return rows
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}
