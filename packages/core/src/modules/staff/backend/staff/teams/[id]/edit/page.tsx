"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TeamForm, type TeamFormValues, buildTeamPayload } from '@open-mercato/core/modules/staff/components/TeamForm'
import { buildRecordInjectionContext, useSetCurrentRecordInjectionContext } from '@open-mercato/ui/backend/injection/recordContext'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Plus } from 'lucide-react'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

const TEAM_MEMBERS_PAGE_SIZE = 50

type TeamRecord = {
  id: string
  name: string
  description?: string | null
  isActive?: boolean
  is_active?: boolean
  updatedAt?: string | null
  updated_at?: string | null
} & Record<string, unknown>

type TeamResponse = {
  items?: TeamRecord[]
}

type TeamMemberRow = {
  id: string
  displayName: string
  description: string | null
  userEmail: string | null
  roleNames: string[]
  tags: string[]
  isActive: boolean
  updatedAt: string | null
  teamId: string | null
}

type TeamMembersResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function StaffTeamEditPage({ params }: { params?: { id?: string } }) {
  const teamId = params?.id
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const [initialValues, setInitialValues] = React.useState<TeamFormValues | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<'details' | 'members'>('details')
  const [memberRows, setMemberRows] = React.useState<TeamMemberRow[]>([])
  const [memberPage, setMemberPage] = React.useState(1)
  const [memberTotal, setMemberTotal] = React.useState(0)
  const [memberTotalPages, setMemberTotalPages] = React.useState(1)
  const [memberSorting, setMemberSorting] = React.useState<SortingState>([{ id: 'displayName', desc: false }])
  const [memberSearch, setMemberSearch] = React.useState('')
  const [membersLoading, setMembersLoading] = React.useState(false)
  const [memberReloadToken, setMemberReloadToken] = React.useState(0)

  const memberLabels = React.useMemo(() => ({
    title: t('staff.teams.tabs.members', 'Team members'),
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
    actions: {
      add: t('staff.teamMembers.actions.add', 'Add team member'),
      edit: t('staff.teamMembers.actions.edit', 'Edit'),
      unassign: t('staff.teamMembers.actions.unassign', 'Unassign'),
      refresh: t('staff.teamMembers.actions.refresh', 'Refresh'),
    },
    messages: {
      unassigned: t('staff.teamMembers.messages.unassigned', 'Team member unassigned.'),
    },
    errors: {
      load: t('staff.teamMembers.errors.load', 'Failed to load team members.'),
      unassign: t('staff.teamMembers.errors.unassign', 'Failed to unassign team member.'),
    },
    tabs: {
      details: t('staff.teams.tabs.details', 'Details'),
      members: t('staff.teams.tabs.members', 'Team members'),
      label: t('staff.teams.tabs.label', 'Team sections'),
    },
  }), [t])

  const memberColumns = React.useMemo<ColumnDef<TeamMemberRow>[]>(() => [
    {
      accessorKey: 'displayName',
      header: memberLabels.table.name,
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
      header: memberLabels.table.user,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.userEmail
        ? <span className="text-sm">{row.original.userEmail}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'roleNames',
      header: memberLabels.table.roles,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.roleNames.length
        ? <span className="text-sm">{row.original.roleNames.join(', ')}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'tags',
      header: memberLabels.table.tags,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.tags.length
        ? <span className="text-xs text-muted-foreground">{row.original.tags.join(', ')}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'isActive',
      header: memberLabels.table.active,
      meta: { priority: 5 },
      cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
    },
    {
      accessorKey: 'updatedAt',
      header: memberLabels.table.updatedAt,
      meta: { priority: 6 },
      cell: ({ row }) => row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [
    memberLabels.table.active,
    memberLabels.table.name,
    memberLabels.table.roles,
    memberLabels.table.tags,
    memberLabels.table.updatedAt,
    memberLabels.table.user,
  ])

  React.useEffect(() => {
    if (!teamId) return
    const teamIdValue = teamId
    let cancelled = false
    async function loadTeam() {
      if (!cancelled) {
        setError(null)
        setIsNotFound(false)
      }
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: teamIdValue })
        const payload = await readApiResultOrThrow<TeamResponse>(
          `/api/staff/teams?${params.toString()}`,
          undefined,
          { errorMessage: t('staff.teams.errors.load', 'Failed to load team.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const customFields = extractCustomFieldEntries(record)
        const isActive = typeof record.isActive === 'boolean'
          ? record.isActive
          : typeof record.is_active === 'boolean'
            ? record.is_active
            : true
        if (!cancelled) {
          setInitialValues({
            id: record.id,
            name: record.name ?? '',
            description: record.description ?? '',
            isActive,
            updatedAt: typeof record.updatedAt === 'string'
              ? record.updatedAt
              : typeof record.updated_at === 'string'
                ? record.updated_at
                : null,
            ...customFields,
          })
        }
      } catch (err) {
        if (!cancelled) {
          if ((err as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            const message = err instanceof Error ? err.message : t('staff.teams.errors.load', 'Failed to load team.')
            setError(message)
          }
        }
      }
    }
    loadTeam()
    return () => { cancelled = true }
  }, [teamId, t])

  React.useEffect(() => {
    if (!searchParams) return
    const tabParam = searchParams.get('tab')
    if (tabParam === 'members') {
      setActiveTab('members')
    }
  }, [searchParams])

  const loadTeamMembers = React.useCallback(async () => {
    if (!teamId) return
    setMembersLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(memberPage),
        pageSize: String(TEAM_MEMBERS_PAGE_SIZE),
        teamId,
      })
      const sort = memberSorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      if (memberSearch.trim()) params.set('search', memberSearch.trim())
      const payload = await readApiResultOrThrow<TeamMembersResponse>(
        `/api/staff/team-members?${params.toString()}`,
        undefined,
        { errorMessage: memberLabels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setMemberRows(items.map(mapApiTeamMember))
      setMemberTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setMemberTotalPages(
        typeof payload.totalPages === 'number'
          ? payload.totalPages
          : Math.max(1, Math.ceil(items.length / TEAM_MEMBERS_PAGE_SIZE)),
      )
    } catch (error) {
      logger.error('staff.teams.team-members.list', { err: error })
      flash(memberLabels.errors.load, 'error')
    } finally {
      setMembersLoading(false)
    }
  }, [memberLabels.errors.load, memberPage, memberSearch, memberSorting, teamId])

  React.useEffect(() => {
    if (activeTab !== 'members') return
    void loadTeamMembers()
  }, [activeTab, loadTeamMembers, memberReloadToken, scopeVersion])

  const handleMemberSearchChange = React.useCallback((value: string) => {
    setMemberSearch(value)
    setMemberPage(1)
  }, [])

  const handleMemberRefresh = React.useCallback(() => {
    setMemberReloadToken((token) => token + 1)
  }, [])

  const handleUnassignMember = React.useCallback(async (entry: TeamMemberRow) => {
    if (!teamId || entry.teamId !== teamId) return
    try {
      const headers = buildOptimisticLockHeader(entry.updatedAt)
      await withScopedApiRequestHeaders(headers, () => (
        updateCrud('staff/team-members', { id: entry.id, teamId: null }, { errorMessage: memberLabels.errors.unassign })
      ))
      flash(memberLabels.messages.unassigned, 'success')
      handleMemberRefresh()
    } catch (error) {
      logger.error('staff.teams.team-members.unassign', { err: error })
      flash(memberLabels.errors.unassign, 'error')
    }
  }, [handleMemberRefresh, memberLabels.errors.unassign, memberLabels.messages.unassigned, teamId])

  const handleSubmit = React.useCallback(async (values: TeamFormValues) => {
    if (!teamId) return
    const payload = buildTeamPayload(values, { id: teamId })
    await updateCrud('staff/teams', payload, {
      errorMessage: t('staff.teams.errors.save', 'Failed to save team.'),
    })
    flash(t('staff.teams.messages.saved', 'Team saved.'), 'success')
  }, [teamId, t])

  const handleDelete = React.useCallback(async () => {
    if (!teamId) return
    await deleteCrud('staff/teams', teamId, {
      errorMessage: t('staff.teams.errors.delete', 'Failed to delete team.'),
    })
    router.push('/backend/staff/teams')
  }, [teamId, router, t])

  // Publish page-load record context to the AppShell-owned `backend:record:current`
  // mount so the enterprise record_locks widget resolves `staff.team` + id explicitly.
  // The resourceKind mirrors the TeamForm `versionHistory` so the held lock matches
  // the save-time conflict surface for the same team.
  useSetCurrentRecordInjectionContext(
    buildRecordInjectionContext({
      resourceKind: 'staff.team',
      resourceId: teamId || null,
      updatedAt: initialValues?.updatedAt ?? null,
      data: initialValues as Record<string, unknown> | null,
      path: pathname,
    }),
  )

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('staff.teams.errors.notFound', 'Team not found.')}
            backHref="/backend/staff/teams"
            backLabel={t('staff.teams.actions.backToList', 'Back to teams')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error && !initialValues) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as 'details' | 'members')}
            variant="underline"
          >
            <TabsList className="w-full flex-wrap" aria-label={memberLabels.tabs.label}>
              {[
                { id: 'details', label: memberLabels.tabs.details },
                { id: 'members', label: memberLabels.tabs.members },
              ].map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {activeTab === 'details' ? (
            <TeamForm
              title={t('staff.teams.form.editTitle', 'Edit team')}
              backHref="/backend/staff/teams"
              cancelHref="/backend/staff/teams"
              initialValues={initialValues ?? { name: '', description: '', isActive: true }}
              onSubmit={handleSubmit}
              onDelete={handleDelete}
              isLoading={!initialValues}
              loadingMessage={t('staff.teams.form.loading', 'Loading team...')}
              extraActions={teamId ? (
                <SendObjectMessageDialog
                  object={{
                    entityModule: 'staff',
                    entityType: 'team',
                    entityId: teamId,
                    previewData: { title: initialValues?.name ?? ''},
                  }}
                  viewHref={`/backend/staff/teams/${teamId}/edit`}
                />
              ) : undefined}
            />
          ) : (
            <DataTable<TeamMemberRow>
              title={memberLabels.title}
              data={memberRows}
              columns={memberColumns}
              isLoading={membersLoading}
              searchValue={memberSearch}
              onSearchChange={handleMemberSearchChange}
              searchPlaceholder={memberLabels.table.search}
              emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{memberLabels.table.empty}</p>}
              actions={(
                <Button asChild size="sm">
                  <Link href={`/backend/staff/team-members/create?teamId=${encodeURIComponent(teamId ?? '')}`}>
                    <Plus className="mr-2 h-4 w-4" aria-hidden />
                    {memberLabels.actions.add}
                  </Link>
                </Button>
              )}
              refreshButton={{
                label: memberLabels.actions.refresh,
                onRefresh: handleMemberRefresh,
                isRefreshing: membersLoading,
              }}
              sortable
              sorting={memberSorting}
              onSortingChange={setMemberSorting}
              pagination={{
                page: memberPage,
                pageSize: TEAM_MEMBERS_PAGE_SIZE,
                total: memberTotal,
                totalPages: memberTotalPages,
                onPageChange: setMemberPage,
              }}
              rowActions={(row) => (
                <RowActions
                  items={[
                    { id: 'edit', label: memberLabels.actions.edit, onSelect: () => { router.push(`/backend/staff/team-members/${row.id}`) } },
                    { id: 'unassign', label: memberLabels.actions.unassign, onSelect: () => { void handleUnassignMember(row) } },
                  ]}
                />
              )}
            />
          )}
        </div>
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
  const teamId = typeof item.teamId === 'string'
    ? item.teamId
    : typeof item.team_id === 'string'
      ? item.team_id
      : null
  return withDataTableNamespaces({
    id,
    displayName,
    description,
    userEmail,
    roleNames,
    tags,
    isActive,
    updatedAt,
    teamId,
  }, item)
}
