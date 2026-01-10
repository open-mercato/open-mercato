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
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import { Pencil } from 'lucide-react'

const PAGE_SIZE = 50

type TeamMemberRow = {
  kind: 'team' | 'member'
  id: string
  teamId: string | null
  teamName: string | null
  roleLabel: string | null
  displayName: string
  description: string | null
  userEmail: string | null
  roleNames: string[]
  tags: string[]
  isActive: boolean
  updatedAt: string | null
}

type TeamMembersResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type TeamsResponse = {
  items?: Array<{ id?: string; name?: string }>
}

type TeamRolesResponse = {
  items?: Array<{ id?: string; name?: string }>
}

export default function BookingTeamMembersPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<TeamMemberRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'displayName', desc: false }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [teamFilterOptions, setTeamFilterOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [roleFilterOptions, setRoleFilterOptions] = React.useState<Array<{ value: string; label: string }>>([])

  const labels = React.useMemo(() => ({
    title: t('booking.teamMembers.page.title', 'Team members'),
    description: t('booking.teamMembers.page.description', 'Manage the people assigned to bookings.'),
    table: {
      name: t('booking.teamMembers.table.name', 'Name'),
      user: t('booking.teamMembers.table.user', 'User'),
      roles: t('booking.teamMembers.table.roles', 'Roles'),
      tags: t('booking.teamMembers.table.tags', 'Tags'),
      active: t('booking.teamMembers.table.active', 'Active'),
      updatedAt: t('booking.teamMembers.table.updatedAt', 'Updated'),
      empty: t('booking.teamMembers.table.empty', 'No team members yet.'),
      search: t('booking.teamMembers.table.search', 'Search team members...'),
    },
    groups: {
      unassignedTeam: t('booking.teamMembers.group.unassignedTeam', 'Unassigned team'),
      unassignedRole: t('booking.teamMembers.group.unassignedRole', 'Unassigned role'),
      multipleRoles: t('booking.teamMembers.group.multipleRoles', 'Multiple roles'),
    },
    filters: {
      team: t('booking.teamMembers.filters.team', 'Team'),
      role: t('booking.teamMembers.filters.role', 'Role'),
    },
    actions: {
      add: t('booking.teamMembers.actions.add', 'Add team member'),
      edit: t('booking.teamMembers.actions.edit', 'Edit'),
      delete: t('booking.teamMembers.actions.delete', 'Delete'),
      deleteConfirm: t('booking.teamMembers.actions.deleteConfirm', 'Delete team member "{{name}}"?'),
      refresh: t('booking.teamMembers.actions.refresh', 'Refresh'),
      editTeam: t('booking.teams.actions.edit', 'Edit'),
    },
    messages: {
      deleted: t('booking.teamMembers.messages.deleted', 'Team member deleted.'),
    },
    errors: {
      load: t('booking.teamMembers.errors.load', 'Failed to load team members.'),
      delete: t('booking.teamMembers.errors.delete', 'Failed to delete team member.'),
    },
  }), [t])

  const columns = React.useMemo<ColumnDef<TeamMemberRow>[]>(() => [
    {
      accessorKey: 'displayName',
      header: labels.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => (
        row.original.kind === 'team'
          ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {row.original.teamId ? <TeamsIcon className="h-4 w-4 text-muted-foreground" /> : null}
                <span className="font-semibold">{row.original.displayName}</span>
              </div>
              {row.original.teamId ? (
                <Button
                  asChild
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title={labels.actions.editTeam}
                  aria-label={labels.actions.editTeam}
                >
                  <Link href={`/backend/booking/teams/${encodeURIComponent(row.original.teamId)}/edit`}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
          )
          : (
            <div className="flex flex-col">
              <span className="font-medium pl-6">{row.original.displayName}</span>
              {row.original.description ? (
                <span className="text-xs text-muted-foreground line-clamp-2 pl-6">{row.original.description}</span>
              ) : null}
            </div>
          )
      ),
    },
    {
      accessorKey: 'userEmail',
      header: labels.table.user,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.kind === 'member' && row.original.userEmail
        ? <span className="text-sm">{row.original.userEmail}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'roleNames',
      header: labels.table.roles,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.kind === 'member'
        ? renderLabelPills(row.original.roleNames)
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'tags',
      header: labels.table.tags,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.kind === 'member'
        ? renderLabelPills(row.original.tags)
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'isActive',
      header: labels.table.active,
      meta: { priority: 5 },
      cell: ({ row }) => row.original.kind === 'member'
        ? <BooleanIcon value={row.original.isActive} />
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 6 },
      cell: ({ row }) => row.original.kind === 'member' && row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [labels.table.active, labels.table.name, labels.table.roles, labels.table.tags, labels.table.updatedAt, labels.table.user])

  const loadTeamMembers = React.useCallback(async () => {
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
      if (filterValues.teamId) params.set('teamId', String(filterValues.teamId))
      if (filterValues.roleId) params.set('roleId', String(filterValues.roleId))
      const payload = await readApiResultOrThrow<TeamMembersResponse>(
        `/api/booking/team-members?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      const mappedItems = items.map(mapApiTeamMember)
      const roleFilterId = typeof filterValues.roleId === 'string' ? filterValues.roleId : null
      const filteredItems = roleFilterId
        ? mappedItems.filter((member) => member.roleIds.includes(roleFilterId))
        : mappedItems
      const roleFilterApplied = roleFilterId != null && filteredItems.length !== mappedItems.length
      setRows(buildTeamMemberRows(filteredItems, labels.groups))
      const resolvedTotal = roleFilterApplied
        ? filteredItems.length
        : typeof payload.total === 'number'
          ? payload.total
          : items.length
      setTotal(resolvedTotal)
      setTotalPages(roleFilterApplied
        ? 1
        : typeof payload.totalPages === 'number'
          ? payload.totalPages
          : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('booking.team-members.list', error)
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [filterValues.roleId, filterValues.teamId, labels.errors.load, labels.groups, page, search, sorting])

  React.useEffect(() => {
    void loadTeamMembers()
  }, [loadTeamMembers, scopeVersion, reloadToken])

  React.useEffect(() => {
    let cancelled = false
    async function loadFilters() {
      try {
        const teamParams = new URLSearchParams({ page: '1', pageSize: '100' })
        const roleParams = new URLSearchParams({ page: '1', pageSize: '100' })
        const [teamsCall, rolesCall] = await Promise.all([
          apiCall<TeamsResponse>(`/api/booking/teams?${teamParams.toString()}`),
          apiCall<TeamRolesResponse>(`/api/booking/team-roles?${roleParams.toString()}`),
        ])
        const teamItems = Array.isArray(teamsCall.result?.items) ? teamsCall.result.items : []
        const roleItems = Array.isArray(rolesCall.result?.items) ? rolesCall.result.items : []
        const teams = teamItems
          .map((team) => {
            const id = typeof team.id === 'string' ? team.id : null
            const name = typeof team.name === 'string' ? team.name : null
            if (!id || !name) return null
            return { value: id, label: name }
          })
          .filter((entry): entry is { value: string; label: string } => entry !== null)
        const roles = roleItems
          .map((role) => {
            const id = typeof role.id === 'string' ? role.id : null
            const name = typeof role.name === 'string' ? role.name : null
            if (!id || !name) return null
            return { value: id, label: name }
          })
          .filter((entry): entry is { value: string; label: string } => entry !== null)
        if (!cancelled) {
          setTeamFilterOptions(teams)
          setRoleFilterOptions(roles)
        }
      } catch {
        if (!cancelled) {
          setTeamFilterOptions([])
          setRoleFilterOptions([])
        }
      }
    }
    loadFilters()
    return () => { cancelled = true }
  }, [scopeVersion])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'teamId',
      label: labels.filters.team,
      type: 'select',
      options: teamFilterOptions,
      placeholder: labels.filters.team,
    },
    {
      id: 'roleId',
      label: labels.filters.role,
      type: 'select',
      options: roleFilterOptions,
      placeholder: labels.filters.role,
    },
  ], [labels.filters.role, labels.filters.team, roleFilterOptions, teamFilterOptions])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: TeamMemberRow) => {
    if (entry.kind !== 'member') return
    const message = labels.actions.deleteConfirm.replace('{{name}}', entry.displayName)
    if (typeof window !== 'undefined' && !window.confirm(message)) return
    try {
      await deleteCrud('booking/team-members', entry.id, { errorMessage: labels.errors.delete })
      flash(labels.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      console.error('booking.team-members.delete', error)
      flash(labels.errors.delete, 'error')
    }
  }, [handleRefresh, labels.actions.deleteConfirm, labels.errors.delete, labels.messages.deleted])

  return (
    <Page>
      <PageBody>
        <DataTable<TeamMemberRow>
          title={labels.title}
          description={labels.description}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={labels.table.search}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{labels.table.empty}</p>}
          actions={(
            <Button asChild size="sm">
              <Link href="/backend/booking/team-members/create">
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
          rowActions={(row) => row.kind === 'member' ? (
            <RowActions
              items={[
                { label: labels.actions.edit, onSelect: () => { router.push(`/backend/booking/team-members/${row.id}`) } },
                { label: labels.actions.delete, destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          ) : null}
        />
      </PageBody>
    </Page>
  )
}

type TeamMemberApiRow = {
  id: string
  displayName: string
  description: string | null
  userEmail: string | null
  roleNames: string[]
  roleIds: string[]
  tags: string[]
  isActive: boolean
  updatedAt: string | null
  teamId: string | null
  teamName: string | null
}

function mapApiTeamMember(item: Record<string, unknown>): TeamMemberApiRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const displayName = typeof item.displayName === 'string'
    ? item.displayName
    : typeof item.display_name === 'string'
      ? item.display_name
      : id
  const description = typeof item.description === 'string' && item.description.trim().length
    ? item.description.trim()
    : null
  const user = item.user && typeof item.user === 'object' ? item.user as { email?: unknown } : null
  const userEmail = user && typeof user.email === 'string' && user.email.length ? user.email : null
  const roleNames = Array.isArray(item.roleNames) ? item.roleNames.filter((value): value is string => typeof value === 'string') : []
  const roleIds = Array.isArray(item.roleIds)
    ? item.roleIds.filter((value): value is string => typeof value === 'string')
    : Array.isArray(item.role_ids)
      ? item.role_ids.filter((value): value is string => typeof value === 'string')
      : []
  const tags = Array.isArray(item.tags) ? item.tags.filter((value): value is string => typeof value === 'string') : []
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
  const teamId = typeof item.teamId === 'string'
    ? item.teamId
    : typeof item.team_id === 'string'
      ? item.team_id
      : null
  const team = item.team && typeof item.team === 'object' ? item.team as { name?: unknown } : null
  const teamName = typeof team?.name === 'string' ? team.name : null
  return {
    id,
    displayName,
    description,
    userEmail,
    roleNames,
    roleIds,
    tags,
    isActive,
    updatedAt,
    teamId,
    teamName,
  }
}

function buildTeamMemberRows(
  items: TeamMemberApiRow[],
  labels: { unassignedTeam: string; unassignedRole: string; multipleRoles: string },
): TeamMemberRow[] {
  const teamGroups = new Map<string, { teamId: string | null; name: string; members: TeamMemberApiRow[] }>()
  for (const member of items) {
    const key = member.teamId ?? 'unassigned'
    const name = member.teamName ?? labels.unassignedTeam
    const group = teamGroups.get(key) ?? { teamId: member.teamId ?? null, name, members: [] }
    group.members.push(member)
    teamGroups.set(key, group)
  }
  const sortedTeams = Array.from(teamGroups.values()).sort((a, b) => a.name.localeCompare(b.name))
  const rows: TeamMemberRow[] = []
  for (const team of sortedTeams) {
    rows.push({
      kind: 'team',
      id: `team:${team.teamId ?? 'unassigned'}`,
      teamId: team.teamId,
      teamName: team.name,
      roleLabel: null,
      displayName: team.name,
      description: null,
      userEmail: null,
      roleNames: [],
      tags: [],
      isActive: true,
      updatedAt: null,
    })
    const sortedMembers = [...team.members].sort((a, b) => a.displayName.localeCompare(b.displayName))
    for (const member of sortedMembers) {
      rows.push({
        kind: 'member',
        id: member.id,
        teamId: member.teamId,
        teamName: member.teamName,
        roleLabel: member.roleNames.length
          ? member.roleNames.join(', ')
          : labels.unassignedRole,
        displayName: member.displayName,
        description: member.description,
        userEmail: member.userEmail,
        roleNames: member.roleNames,
        tags: member.tags,
        isActive: member.isActive,
        updatedAt: member.updatedAt,
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

function renderLabelPills(values: string[]): React.ReactNode {
  if (!values.length) return <span className="text-xs text-muted-foreground">-</span>
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span key={value} className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium">
          {value}
        </span>
      ))}
    </div>
  )
}

function TeamsIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M3 20c0-3 3-5 5-5" />
      <path d="M21 20c0-3-3-5-5-5" />
    </svg>
  )
}
