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

type TeamMemberRow = {
  id: string
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
    actions: {
      add: t('booking.teamMembers.actions.add', 'Add team member'),
      edit: t('booking.teamMembers.actions.edit', 'Edit'),
      delete: t('booking.teamMembers.actions.delete', 'Delete'),
      deleteConfirm: t('booking.teamMembers.actions.deleteConfirm', 'Delete team member "{{name}}"?'),
      refresh: t('booking.teamMembers.actions.refresh', 'Refresh'),
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
        <div className="flex flex-col">
          <span className="font-medium">{row.original.displayName}</span>
          {row.original.description ? (
            <span className="text-xs text-muted-foreground line-clamp-2">{row.original.description}</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'userEmail',
      header: labels.table.user,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.userEmail
        ? <span className="text-sm">{row.original.userEmail}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'roleNames',
      header: labels.table.roles,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.roleNames.length
        ? <span className="text-sm">{row.original.roleNames.join(', ')}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'tags',
      header: labels.table.tags,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.tags.length
        ? <span className="text-xs text-muted-foreground">{row.original.tags.join(', ')}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'isActive',
      header: labels.table.active,
      meta: { priority: 5 },
      cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 6 },
      cell: ({ row }) => row.original.updatedAt
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
      const payload = await readApiResultOrThrow<TeamMembersResponse>(
        `/api/booking/team-members?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiTeamMember))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('booking.team-members.list', error)
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [labels.errors.load, page, search, sorting])

  React.useEffect(() => {
    void loadTeamMembers()
  }, [loadTeamMembers, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: TeamMemberRow) => {
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
          rowActions={(row) => (
            <RowActions
              items={[
                { label: labels.actions.edit, onSelect: () => { router.push(`/backend/booking/team-members/${row.original.id}`) } },
                { label: labels.actions.delete, destructive: true, onSelect: () => { void handleDelete(row.original) } },
              ]}
            />
          )}
        />
      </PageBody>
    </Page>
  )
}

function mapApiTeamMember(item: Record<string, unknown>): TeamMemberRow {
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
  return {
    id,
    displayName,
    description,
    userEmail,
    roleNames,
    tags,
    isActive,
    updatedAt,
  }
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}
