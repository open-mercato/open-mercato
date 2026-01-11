"use client"

import * as React from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { PluggableList } from 'unified'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Pencil, Users } from 'lucide-react'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

const PAGE_SIZE = 50
const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'
const MARKDOWN_CLASSNAME =
  'text-sm text-foreground break-words [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs'

type MarkdownPreviewProps = { children: string; className?: string; remarkPlugins?: PluggableList }

const MarkdownPreview: React.ComponentType<MarkdownPreviewProps> = isTestEnv
  ? ({ children, className }) => <div className={className}>{children}</div>
  : (dynamic(() => import('react-markdown').then((mod) => mod.default as React.ComponentType<MarkdownPreviewProps>), {
      ssr: false,
      loading: () => null,
    }) as unknown as React.ComponentType<MarkdownPreviewProps>)

let markdownPluginsPromise: Promise<PluggableList> | null = null

async function loadMarkdownPlugins(): Promise<PluggableList> {
  if (isTestEnv) return []
  if (!markdownPluginsPromise) {
    markdownPluginsPromise = import('remark-gfm')
      .then((mod) => [mod.default ?? mod] as PluggableList)
      .catch(() => [])
  }
  return markdownPluginsPromise
}

type TeamRoleRow = {
  kind: 'team' | 'role'
  id: string
  teamId: string | null
  name: string
  description: string | null
  updatedAt: string | null
  memberCount: number
}

type TeamRolesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type TeamsResponse = {
  items?: Array<{ id?: string; name?: string }>
}

export default function BookingTeamRolesPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<TeamRoleRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [markdownPlugins, setMarkdownPlugins] = React.useState<PluggableList>([])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [teamFilterOptions, setTeamFilterOptions] = React.useState<Array<{ value: string; label: string }>>([])

  React.useEffect(() => {
    void loadMarkdownPlugins().then((plugins) => setMarkdownPlugins(plugins))
  }, [])

  const labels = React.useMemo(() => ({
    title: t('booking.teamRoles.page.title', 'Team roles'),
    description: t('booking.teamRoles.page.description', 'Define roles that can be assigned to team members.'),
    table: {
      name: t('booking.teamRoles.table.name', 'Name'),
      description: t('booking.teamRoles.table.description', 'Description'),
      members: t('booking.teamRoles.table.members', 'Team members'),
      updatedAt: t('booking.teamRoles.table.updatedAt', 'Updated'),
      empty: t('booking.teamRoles.table.empty', 'No team roles yet.'),
      search: t('booking.teamRoles.table.search', 'Search roles...'),
    },
    groups: {
      unassigned: t('booking.teamRoles.group.unassigned', 'Unassigned'),
    },
    filters: {
      team: t('booking.teamRoles.filters.team', 'Team'),
    },
    actions: {
      add: t('booking.teamRoles.actions.add', 'Add team role'),
      edit: t('booking.teamRoles.actions.edit', 'Edit'),
      showMembers: t('booking.teamRoles.actions.showMembers', 'Show team members ({{count}})'),
      delete: t('booking.teamRoles.actions.delete', 'Delete'),
      deleteConfirm: t('booking.teamRoles.actions.deleteConfirm', 'Delete team role "{{name}}"?'),
      refresh: t('booking.teamRoles.actions.refresh', 'Refresh'),
      editTeam: t('booking.teams.actions.edit', 'Edit'),
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
      cell: ({ row }) => {
        if (row.original.kind === 'team') {
          return (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {row.original.teamId ? <TeamsIcon className="h-4 w-4 text-muted-foreground" /> : null}
                <span className="font-semibold">{row.original.name}</span>
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
        }
        return (
          <div className="flex flex-col">
            <span className="font-medium pl-6">{row.original.name}</span>
            {row.original.description ? (
              <MarkdownPreview
                remarkPlugins={markdownPlugins}
                className={`${MARKDOWN_CLASSNAME} pl-6 text-xs text-muted-foreground line-clamp-2`}
              >
                {row.original.description}
              </MarkdownPreview>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'description',
      header: labels.table.description,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.kind === 'team'
        ? <span className="text-xs text-muted-foreground">-</span>
        : row.original.description
          ? (
            <MarkdownPreview remarkPlugins={markdownPlugins} className={MARKDOWN_CLASSNAME}>
              {row.original.description}
            </MarkdownPreview>
          )
          : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'memberCount',
      header: <span className="inline-block min-w-[250px]">{labels.table.members}</span>,
      meta: { priority: 3 },
      enableSorting: false,
      cell: ({ row }) => row.original.kind === 'role'
        ? (
          <Link
            className="inline-flex min-w-[220px] items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            href={`/backend/booking/team-members?roleId=${encodeURIComponent(row.original.id)}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Users className="h-4 w-4" aria-hidden />
            {labels.actions.showMembers.replace('{{count}}', String(row.original.memberCount))}
          </Link>
        )
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.kind === 'team'
        ? <span className="text-xs text-muted-foreground">-</span>
        : row.original.updatedAt
          ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
          : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [labels.actions.showMembers, labels.table.description, labels.table.members, labels.table.name, labels.table.updatedAt, markdownPlugins])

  const loadTeamRoles = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (search.trim()) params.set('search', search.trim())
      if (typeof filterValues.teamId === 'string' && filterValues.teamId.trim()) {
        params.set('teamId', filterValues.teamId)
      }
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
  }, [filterValues.teamId, labels.errors.load, labels.groups, page, search])

  React.useEffect(() => {
    void loadTeamRoles()
  }, [loadTeamRoles, scopeVersion, reloadToken])

  React.useEffect(() => {
    let cancelled = false
    async function loadFilters() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' })
        const response = await apiCall<TeamsResponse>(`/api/booking/teams?${params.toString()}`)
        const teamItems = Array.isArray(response.result?.items) ? response.result.items : []
        const teams = teamItems
          .map((team) => {
            const id = typeof team.id === 'string' ? team.id : null
            const name = typeof team.name === 'string' ? team.name : null
            if (!id || !name) return null
            return { value: id, label: name }
          })
          .filter((entry): entry is { value: string; label: string } => entry !== null)
        if (!cancelled) setTeamFilterOptions(teams)
      } catch {
        if (!cancelled) setTeamFilterOptions([])
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
  ], [labels.filters.team, teamFilterOptions])

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
  memberCount: number
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
  const memberCount = typeof item.memberCount === 'number' ? item.memberCount : 0
  return { id, name, description, updatedAt, teamId, teamName, memberCount }
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
      memberCount: 0,
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
        memberCount: role.memberCount,
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
