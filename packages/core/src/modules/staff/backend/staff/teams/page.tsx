"use client"

import * as React from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { PluggableList } from 'unified'
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
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Users } from 'lucide-react'

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

type TeamRow = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  updatedAt: string | null
  memberCount: number
}

type TeamsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function StaffTeamsPage() {
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
  const [markdownPlugins, setMarkdownPlugins] = React.useState<PluggableList>([])

  React.useEffect(() => {
    void loadMarkdownPlugins().then((plugins) => setMarkdownPlugins(plugins))
  }, [])

  const labels = React.useMemo(() => ({
    title: t('staff.teams.page.title', 'Teams'),
    description: t('staff.teams.page.description', 'Group team members and roles.'),
    table: {
      name: t('staff.teams.table.name', 'Name'),
      description: t('staff.teams.table.description', 'Description'),
      active: t('staff.teams.table.active', 'Active'),
      members: t('staff.teams.table.members', 'Team members'),
      updatedAt: t('staff.teams.table.updatedAt', 'Updated'),
      empty: t('staff.teams.table.empty', 'No teams yet.'),
      search: t('staff.teams.table.search', 'Search teams...'),
    },
    actions: {
      add: t('staff.teams.actions.add', 'Add team'),
      edit: t('staff.teams.actions.edit', 'Edit'),
      delete: t('staff.teams.actions.delete', 'Delete'),
      deleteConfirm: t('staff.teams.actions.deleteConfirm', 'Delete team "{{name}}"?'),
      showMembers: t('staff.teams.actions.showMembers', 'Show team members ({{count}})'),
      refresh: t('staff.teams.actions.refresh', 'Refresh'),
    },
    messages: {
      deleted: t('staff.teams.messages.deleted', 'Team deleted.'),
    },
    errors: {
      load: t('staff.teams.errors.load', 'Failed to load teams.'),
      delete: t('staff.teams.errors.delete', 'Failed to delete team.'),
      deleteAssigned: t('staff.teams.errors.deleteAssigned', 'Team has assigned members and cannot be deleted.'),
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
            <MarkdownPreview
              remarkPlugins={markdownPlugins}
              className={`${MARKDOWN_CLASSNAME} text-xs text-muted-foreground line-clamp-2`}
            >
              {row.original.description}
            </MarkdownPreview>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: labels.table.description,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.description
        ? (
          <MarkdownPreview remarkPlugins={markdownPlugins} className={MARKDOWN_CLASSNAME}>
            {row.original.description}
          </MarkdownPreview>
        )
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'isActive',
      header: labels.table.active,
      meta: { priority: 2 },
      cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
    },
    {
      accessorKey: 'memberCount',
      header: () => <span className="inline-block min-w-[250px]">{labels.table.members}</span>,
      meta: { priority: 3 },
      enableSorting: false,
      cell: ({ row }) => (
        <Link
          className="inline-flex min-w-[220px] items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          href={`/backend/staff/team-members?teamId=${encodeURIComponent(row.original.id)}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Users className="h-4 w-4" aria-hidden />
          {labels.actions.showMembers.replace('{{count}}', String(row.original.memberCount))}
        </Link>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 5 },
      cell: ({ row }) => row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [
    labels.actions.showMembers,
    labels.table.active,
    labels.table.description,
    labels.table.members,
    labels.table.name,
    labels.table.updatedAt,
    markdownPlugins,
  ])

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
        `/api/staff/teams?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiTeam))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('staff.teams.list', error)
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
    if (entry.memberCount > 0) {
      flash(labels.errors.deleteAssigned, 'error')
      return
    }
    const message = labels.actions.deleteConfirm.replace('{{name}}', entry.name)
    if (typeof window !== 'undefined' && !window.confirm(message)) return
    try {
      await deleteCrud('staff/teams', entry.id, { errorMessage: labels.errors.delete })
      flash(labels.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      console.error('staff.teams.delete', error)
      flash(labels.errors.delete, 'error')
    }
  }, [handleRefresh, labels.actions.deleteConfirm, labels.errors.delete, labels.errors.deleteAssigned, labels.messages.deleted])

  return (
    <Page>
      <PageBody>
        <DataTable<TeamRow>
          title={labels.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={labels.table.search}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{labels.table.empty}</p>}
          actions={(
            <Button asChild size="sm">
              <Link href="/backend/staff/teams/create">
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
                { id: 'edit', label: labels.actions.edit, href: `/backend/staff/teams/${row.id}/edit` },
                ...(row.memberCount > 0
                  ? []
                  : [{ id: 'delete', label: labels.actions.delete, destructive: true, onSelect: () => { void handleDelete(row) } }]),
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/staff/teams/${row.id}/edit`)}
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
  const memberCount = typeof item.memberCount === 'number'
    ? item.memberCount
    : typeof item.member_count === 'number'
      ? item.member_count
      : 0
  return { id, name, description, isActive, updatedAt, memberCount }
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}
