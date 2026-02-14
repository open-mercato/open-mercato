"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef, SortingFn, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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
  items?: Array<{ id?: string; name?: string; team?: { name?: string } | null }>
}

export default function StaffTeamMembersPage() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const scopeVersion = useOrganizationScopeVersion()
  const searchParams = useSearchParams()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
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
  const teamFilterParam = searchParams?.get('teamId')
  const roleFilterParam = searchParams?.get('roleId')
  const resolvedTeamId = typeof filterValues.teamId === 'string' && filterValues.teamId.length
    ? filterValues.teamId
    : teamFilterParam

  React.useEffect(() => {
    setPage(1)
  }, [teamFilterParam, roleFilterParam])

  React.useEffect(() => {
    if (!teamFilterParam) return
    setFilterValues((prev) => {
      if (prev.teamId === teamFilterParam) return prev
      if (typeof prev.teamId === 'string' && prev.teamId.length > 0) return prev
      return { ...prev, teamId: teamFilterParam }
    })
  }, [teamFilterParam])

  React.useEffect(() => {
    if (!roleFilterParam) return
    setFilterValues((prev) => {
      if (prev.roleId === roleFilterParam) return prev
      if (typeof prev.roleId === 'string' && prev.roleId.length > 0) return prev
      return { ...prev, roleId: roleFilterParam }
    })
  }, [roleFilterParam])

  const labels = React.useMemo(() => ({
    title: t('staff.teamMembers.page.title', 'Team members'),
    description: t('staff.teamMembers.page.description', 'Manage employees and their team assignments.'),
    table: {
      name: t('staff.teamMembers.table.name', 'Name'),
      user: t('staff.teamMembers.table.user', 'User'),
      roles: t('staff.teamMembers.table.roles', 'Roles'),
      tags: t('staff.teamMembers.table.tags', 'Tags'),
      active: t('staff.teamMembers.table.active', 'Active'),
      updatedAt: t('staff.teamMembers.table.updatedAt', 'Updated'),
      empty: t('staff.teamMembers.table.empty', 'No team members yet.'),
      search: t('staff.teamMembers.table.search', 'Search team members...'),
    },
    groups: {
      unassignedTeam: t('staff.teamMembers.group.unassignedTeam', 'Unassigned team'),
      unassignedRole: t('staff.teamMembers.group.unassignedRole', 'Unassigned role'),
      multipleRoles: t('staff.teamMembers.group.multipleRoles', 'Multiple roles'),
    },
    filters: {
      team: t('staff.teamMembers.filters.team', 'Team'),
      role: t('staff.teamMembers.filters.role', 'Role'),
    },
    actions: {
      add: t('staff.teamMembers.actions.add', 'Add team member'),
      edit: t('staff.teamMembers.actions.edit', 'Edit'),
      delete: t('staff.teamMembers.actions.delete', 'Delete'),
      deleteConfirm: t('staff.teamMembers.actions.deleteConfirm', 'Delete team member "{{name}}"?'),
      refresh: t('staff.teamMembers.actions.refresh', 'Refresh'),
      editTeam: t('staff.teams.actions.edit', 'Edit'),
    },
    messages: {
      deleted: t('staff.teamMembers.messages.deleted', 'Team member deleted.'),
    },
    errors: {
      load: t('staff.teamMembers.errors.load', 'Failed to load team members.'),
      delete: t('staff.teamMembers.errors.delete', 'Failed to delete team member.'),
    },
  }), [t])

  const groupedSortingFn = React.useCallback((field: GroupedSortField): SortingFn<TeamMemberRow> => {
    return (rowA, rowB) => compareGroupedRows(field, labels.groups, rowA.original, rowB.original)
  }, [labels.groups])

  const columns = React.useMemo<ColumnDef<TeamMemberRow>[]>(() => [
    {
      accessorKey: 'displayName',
      header: labels.table.name,
      meta: { priority: 1, sticky: true },
      sortingFn: groupedSortingFn('displayName'),
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
                  <Link href={`/backend/staff/teams/${encodeURIComponent(row.original.teamId)}/edit`}>
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
      sortingFn: groupedSortingFn('userEmail'),
      cell: ({ row }) => row.original.kind === 'member' && row.original.userEmail
        ? <span className="text-sm">{row.original.userEmail}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'roleNames',
      header: labels.table.roles,
      meta: { priority: 3 },
      sortingFn: groupedSortingFn('roleNames'),
      cell: ({ row }) => row.original.kind === 'member'
        ? renderLabelPills(row.original.roleNames)
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'tags',
      header: labels.table.tags,
      meta: { priority: 4 },
      sortingFn: groupedSortingFn('tags'),
      cell: ({ row }) => row.original.kind === 'member'
        ? renderLabelPills(row.original.tags)
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'isActive',
      header: labels.table.active,
      meta: { priority: 5 },
      sortingFn: groupedSortingFn('isActive'),
      cell: ({ row }) => row.original.kind === 'member'
        ? <BooleanIcon value={row.original.isActive} />
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 6 },
      sortingFn: groupedSortingFn('updatedAt'),
      cell: ({ row }) => row.original.kind === 'member' && row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [groupedSortingFn, labels.table.active, labels.table.name, labels.table.roles, labels.table.tags, labels.table.updatedAt, labels.table.user])

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
      if (resolvedTeamId) params.set('teamId', String(resolvedTeamId))
      if (filterValues.roleId) params.set('roleId', String(filterValues.roleId))
      const payload = await readApiResultOrThrow<TeamMembersResponse>(
        `/api/staff/team-members?${params.toString()}`,
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
      console.error('staff.team-members.list', error)
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [filterValues.roleId, labels.errors.load, labels.groups, page, resolvedTeamId, search, sorting])

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
          apiCall<TeamsResponse>(`/api/staff/teams?${teamParams.toString()}`),
          apiCall<TeamRolesResponse>(`/api/staff/team-roles?${roleParams.toString()}`),
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
            const teamName = role.team && typeof role.team === 'object' && typeof role.team.name === 'string'
              ? role.team.name
              : labels.groups.unassignedTeam
            if (!id || !name) return null
            return { value: id, label: `${teamName} - ${name}` }
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
  }, [pathname, router, searchParams])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)

    const params = new URLSearchParams(searchParams?.toString())
    const hasTeamId = typeof values.teamId === 'string' && values.teamId.length > 0
    if (!hasTeamId && params.has('teamId')) {
      params.delete('teamId')
    }
    const hasRoleId = typeof values.roleId === 'string' && values.roleId.length > 0
    if (!hasRoleId && params.has('roleId')) {
      params.delete('roleId')
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }, [pathname, router, searchParams])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)

    const params = new URLSearchParams(searchParams?.toString())
    if (params.has('teamId')) {
      params.delete('teamId')
    }
    if (params.has('roleId')) {
      params.delete('roleId')
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: TeamMemberRow) => {
    if (entry.kind !== 'member') return
    const message = labels.actions.deleteConfirm.replace('{{name}}', entry.displayName)
    const confirmed = await confirm({
      title: labels.actions.delete,
      text: message,
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await deleteCrud('staff/team-members', entry.id, { errorMessage: labels.errors.delete })
      flash(labels.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      console.error('staff.team-members.delete', error)
      flash(labels.errors.delete, 'error')
    }
  }, [confirm, handleRefresh, labels.actions.deleteConfirm, labels.actions.delete, labels.errors.delete, labels.messages.deleted])

  return (
    <Page>
      <PageBody>
        <DataTable<TeamMemberRow>
          title={labels.title}
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
              <Link href="/backend/staff/team-members/create">
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
                { id: 'edit', label: labels.actions.edit, onSelect: () => { router.push(`/backend/staff/team-members/${row.id}`) } },
                { id: 'delete', label: labels.actions.delete, destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          ) : null}
        />
      </PageBody>
      {ConfirmDialogElement}
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

type GroupedSortField = 'displayName' | 'userEmail' | 'roleNames' | 'tags' | 'isActive' | 'updatedAt'

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

function compareGroupedRows(
  field: GroupedSortField,
  labels: { unassignedTeam: string },
  left: TeamMemberRow,
  right: TeamMemberRow,
): number {
  const leftTeam = (left.teamName ?? labels.unassignedTeam).toLocaleLowerCase()
  const rightTeam = (right.teamName ?? labels.unassignedTeam).toLocaleLowerCase()
  const teamComparison = leftTeam.localeCompare(rightTeam)
  if (teamComparison !== 0) return teamComparison
  if (left.kind !== right.kind) return left.kind === 'team' ? -1 : 1
  if (left.kind === 'team' && right.kind === 'team') return 0
  switch (field) {
    case 'displayName':
      return left.displayName.localeCompare(right.displayName)
    case 'userEmail':
      return (left.userEmail ?? '').localeCompare(right.userEmail ?? '')
    case 'roleNames':
      return left.roleNames.join(', ').localeCompare(right.roleNames.join(', '))
    case 'tags':
      return left.tags.join(', ').localeCompare(right.tags.join(', '))
    case 'isActive':
      return Number(left.isActive) - Number(right.isActive)
    case 'updatedAt':
      return compareDateStrings(left.updatedAt, right.updatedAt)
  }
}

function compareDateStrings(left: string | null, right: string | null): number {
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return left.localeCompare(right)
  }
  return leftTime - rightTime
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
