"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { ProjectColorDot } from '../../../../lib/timesheets-ui/ProjectColorDot'
import { resolveProjectColorHex } from '../../../../lib/timesheets-ui/colors'
import {
  ProjectsKpiStrip,
  type PmKpis,
  type CollabKpis,
} from '../../../../lib/timesheets-projects-ui/ProjectsKpiStrip'
import { SavedViewTabs } from '../../../../lib/timesheets-projects-ui/SavedViewTabs'
import { HoursSparkline } from '../../../../lib/timesheets-projects-ui/HoursSparkline'
import {
  ProjectMembersAvatarStack,
  type AvatarMember,
} from '../../../../lib/timesheets-projects-ui/ProjectMembersAvatarStack'
import { ViewModeToggle } from '../../../../lib/timesheets-projects-ui/ViewModeToggle'
import {
  useProjectsViewMode,
  type ProjectsViewMode,
} from '../../../../lib/timesheets-projects-ui/useProjectsViewMode'
import {
  ProjectCard,
  type ProjectCardData,
  type ProjectCardLabels,
} from '../../../../lib/timesheets-projects-ui/ProjectCard'

const PAGE_SIZE = 50
const INCLUDE_FIELDS = 'hoursWeek,hoursTrend,members,myRole'

type StaffEnrichment = {
  hoursWeek?: number
  hoursTrend?: number[]
  myRole?: string | null
  members?: AvatarMember[]
  memberCount?: number
}

type ProjectRow = {
  id: string
  name: string
  code: string | null
  customerId: string | null
  customerName: string | null
  status: string
  projectType: string | null
  color: string | null
  startDate: string | null
  updatedAt: string | null
  hoursWeek: number
  hoursTrend: number[]
  myRole: string | null
  members: AvatarMember[]
  memberCount: number
}

type ProjectsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type KpisResponse = PmKpis | CollabKpis

function formatRelativeTime(iso: string | null, fallback: string): string {
  if (!iso) return fallback
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return fallback
  const diffMs = Date.now() - parsed.getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return formatDateTime(iso) ?? fallback
}

function mapApiProject(item: Record<string, unknown>): ProjectRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : id
  const code = typeof item.code === 'string' && item.code.trim().length ? item.code.trim() : null
  const customerId =
    typeof item.customerId === 'string'
      ? item.customerId
      : typeof item.customer_id === 'string'
        ? item.customer_id
        : null
  const customerName =
    typeof item.customerName === 'string'
      ? item.customerName
      : typeof item.customer_name === 'string'
        ? item.customer_name
        : null
  const status = typeof item.status === 'string' ? item.status : 'active'
  const projectType =
    typeof item.projectType === 'string'
      ? item.projectType
      : typeof item.project_type === 'string'
        ? item.project_type
        : null
  const color = typeof item.color === 'string' ? item.color : null
  const startDate =
    typeof item.startDate === 'string'
      ? item.startDate
      : typeof item.start_date === 'string'
        ? item.start_date
        : null
  const updatedAt =
    typeof item.updatedAt === 'string'
      ? item.updatedAt
      : typeof item.updated_at === 'string'
        ? item.updated_at
        : null
  const enrichment =
    (item as { _staff?: StaffEnrichment })._staff ?? ({} as StaffEnrichment)
  const hoursWeek = typeof enrichment.hoursWeek === 'number' ? enrichment.hoursWeek : 0
  const hoursTrend = Array.isArray(enrichment.hoursTrend)
    ? enrichment.hoursTrend.filter((v): v is number => typeof v === 'number')
    : []
  const members = Array.isArray(enrichment.members)
    ? enrichment.members
        .filter((m): m is AvatarMember => !!m && typeof m === 'object' && typeof (m as AvatarMember).id === 'string')
        .map((m) => ({
          id: m.id,
          name: m.name ?? '',
          initials: m.initials ?? '',
          avatarUrl: m.avatarUrl ?? null,
        }))
    : []
  const memberCount = typeof enrichment.memberCount === 'number' ? enrichment.memberCount : members.length
  const myRole = typeof enrichment.myRole === 'string' ? enrichment.myRole : null

  return withDataTableNamespaces(
    {
      id,
      name,
      code,
      customerId,
      customerName,
      status,
      projectType,
      color,
      startDate,
      updatedAt,
      hoursWeek,
      hoursTrend,
      myRole,
      members,
      memberCount,
    },
    item,
  )
}

export default function TimesheetProjectsPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<ProjectRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updatedAt', desc: true }])
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const hasLoadedOnceRef = React.useRef(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [kpis, setKpis] = React.useState<KpisResponse | null>(null)
  const [isLoadingKpis, setIsLoadingKpis] = React.useState(true)

  const activeTab = searchParams.get('tab') ?? 'all'
  const urlViewMode = searchParams.get('view')
  const [viewMode, setViewMode] = useProjectsViewMode({
    userKey: null,
    urlOverride: urlViewMode,
  })

  const labels = React.useMemo(
    () => ({
      title: t('staff.timesheets.projects.page.title', 'Projects'),
      table: {
        name: t('staff.timesheets.projects.table.name', 'Project'),
        status: t('staff.timesheets.projects.table.status', 'Status'),
        type: t('staff.timesheets.projects.table.type', 'Type'),
        updatedAt: t('staff.timesheets.projects.table.updatedAt', 'Updated'),
        empty: t('staff.timesheets.projects.table.empty', 'No projects yet.'),
        search: t('staff.timesheets.projects.table.search', 'Search projects...'),
        team: t('staff.timesheets.projects.portfolio.team', 'Team'),
        myRole: t('staff.timesheets.projects.portfolio.myRole', 'My role'),
        hoursWeek: t('staff.timesheets.projects.portfolio.hoursWeek', 'Hours / week'),
        myHoursWeek: t('staff.timesheets.projects.portfolio.myHoursWeek', 'My hours / week'),
      },
      actions: {
        add: t('staff.timesheets.projects.actions.add', 'Add Project'),
        addFirst: t('staff.timesheets.projects.actions.addFirst', '+ Add first project'),
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
      tabs: {
        all: t('staff.timesheets.projects.portfolio.tabs.all', 'All'),
        active: t('staff.timesheets.projects.portfolio.tabs.active', 'Active'),
        onHold: t('staff.timesheets.projects.portfolio.tabs.onHold', 'On Hold'),
        completed: t('staff.timesheets.projects.portfolio.tabs.completed', 'Completed'),
        mine: t('staff.timesheets.projects.portfolio.tabs.mine', 'Mine'),
      },
      viewMode: {
        table: t('staff.timesheets.projects.portfolio.viewMode.table', 'Table'),
        cards: t('staff.timesheets.projects.portfolio.viewMode.cards', 'Cards'),
      },
      kpi: {
        totalProjects: t('staff.timesheets.projects.portfolio.kpi.totalProjects', 'Total Projects'),
        hoursWeek: t('staff.timesheets.projects.portfolio.kpi.hoursWeek', 'Hours this week'),
        hoursWeekSub: t('staff.timesheets.projects.portfolio.kpi.hoursWeekSub', 'vs previous week'),
        assignedToMe: t('staff.timesheets.projects.portfolio.kpi.assignedToMe', 'Assigned to me'),
        hoursMonth: t('staff.timesheets.projects.portfolio.kpi.hoursMonth', 'Hours this month'),
        hoursMonthSub: t('staff.timesheets.projects.portfolio.kpi.hoursMonthSub', 'vs previous month'),
        teamActive: t('staff.timesheets.projects.portfolio.kpi.teamActive', 'Active team'),
        teamActiveSub: t('staff.timesheets.projects.portfolio.kpi.teamActiveSub', 'Members with entries this month'),
        myProjects: t('staff.timesheets.projects.portfolio.kpi.myProjects', 'My projects'),
        myHoursWeek: t('staff.timesheets.projects.portfolio.kpi.myHoursWeek', 'My hours this week'),
        myHoursMonth: t('staff.timesheets.projects.portfolio.kpi.myHoursMonth', 'My hours this month'),
        deltaFlat: t('staff.timesheets.projects.portfolio.kpi.deltaFlat', 'no change'),
        noPrevious: t('staff.timesheets.projects.portfolio.kpi.noPrevious', 'no previous data'),
      },
      card: {
        hoursPanelPm: t('staff.timesheets.projects.portfolio.card.hoursPanelPm', 'Team hours · last 7w'),
        hoursPanelCollab: t('staff.timesheets.projects.portfolio.card.hoursPanelCollab', 'My hours · last 7w'),
        sparklineAria: t('staff.timesheets.projects.portfolio.sparkline.ariaLabel', 'Hours per week, last 7 weeks'),
        role: t('staff.timesheets.projects.portfolio.card.role', 'Role'),
      },
      emptyState: {
        noProjects: t('staff.timesheets.projects.portfolio.emptyState.noProjects', 'No projects yet.'),
        noAssignments: t(
          'staff.timesheets.projects.portfolio.emptyState.noAssignments',
          "You aren't assigned to any projects yet. Ask a PM to add you.",
        ),
        noMatches: t('staff.timesheets.projects.portfolio.emptyState.noMatches', 'No projects match these filters.'),
      },
    }),
    [t],
  )

  const kpiLabels = React.useMemo(
    () => ({
      totalProjects: labels.kpi.totalProjects,
      totalProjectsSub: ({ active, onHold }: { active: number; onHold: number }) =>
        `${active} ${labels.statuses.active.toLowerCase()} · ${onHold} ${labels.statuses.on_hold.toLowerCase()}`,
      hoursWeek: labels.kpi.hoursWeek,
      hoursWeekSub: labels.kpi.hoursWeekSub,
      assignedToMe: labels.kpi.assignedToMe,
      assignedToMeSub: (active: number) => `${active} ${labels.statuses.active.toLowerCase()}`,
      hoursMonth: labels.kpi.hoursMonth,
      hoursMonthSub: labels.kpi.hoursMonthSub,
      teamActive: labels.kpi.teamActive,
      teamActiveSub: labels.kpi.teamActiveSub,
      myProjects: labels.kpi.myProjects,
      myProjectsSub: (active: number) => `${active} ${labels.statuses.active.toLowerCase()}`,
      myHoursWeek: labels.kpi.myHoursWeek,
      myHoursMonth: labels.kpi.myHoursMonth,
      deltaUp: (pct: number) => `up ${pct}%`,
      deltaDown: (pct: number) => `down ${pct}%`,
      deltaFlat: labels.kpi.deltaFlat,
      noPrevious: labels.kpi.noPrevious,
    }),
    [labels],
  )

  const isPmRole = kpis?.role === 'pm'

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: labels.table.status,
        type: 'select',
        options: [
          { value: 'active', label: labels.statuses.active },
          { value: 'on_hold', label: labels.statuses.on_hold },
          { value: 'completed', label: labels.statuses.completed },
        ],
      },
    ],
    [labels.table.status, labels.statuses],
  )

  const tabs = React.useMemo(() => {
    const base = [
      { id: 'all', label: labels.tabs.all },
      { id: 'active', label: labels.tabs.active },
    ]
    if (isPmRole) {
      base.push({ id: 'on_hold', label: labels.tabs.onHold })
    }
    base.push({ id: 'completed', label: labels.tabs.completed })
    if (isPmRole) {
      base.push({ id: 'mine', label: labels.tabs.mine })
    }
    return base
  }, [labels.tabs, isPmRole])

  const statusFromTab = (tabId: string): string | null => {
    if (tabId === 'active' || tabId === 'on_hold' || tabId === 'completed') return tabId
    return null
  }
  const mineFromTab = (tabId: string): boolean => tabId === 'mine' || !isPmRole

  const loadKpis = React.useCallback(async () => {
    setIsLoadingKpis(true)
    try {
      const payload = await readApiResultOrThrow<KpisResponse>(
        '/api/staff/timesheets/projects/kpis',
        undefined,
        {
          errorMessage: labels.errors.load,
          fallback: null as unknown as KpisResponse,
        },
      )
      setKpis(payload)
    } catch {
      setKpis(null)
    } finally {
      setIsLoadingKpis(false)
    }
  }, [labels.errors.load])

  const loadProjects = React.useCallback(async () => {
    if (hasLoadedOnceRef.current) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        include: INCLUDE_FIELDS,
      })
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      if (search.trim()) params.set('q', search.trim())
      const tabStatus = statusFromTab(activeTab)
      if (tabStatus) params.set('status', tabStatus)
      else if (typeof filterValues.status === 'string' && filterValues.status.length > 0) {
        params.set('status', filterValues.status)
      }
      if (mineFromTab(activeTab)) params.set('mine', '1')

      const payload = await readApiResultOrThrow<ProjectsResponse>(
        `/api/staff/timesheets/time-projects?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiProject))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(
        typeof payload.totalPages === 'number'
          ? payload.totalPages
          : Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
      )
    } catch (error) {
      console.error('staff.timesheets.projects.list', error)
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
      hasLoadedOnceRef.current = true
    }
  }, [labels.errors.load, page, search, sorting, filterValues.status, activeTab, isPmRole])

  React.useEffect(() => {
    void loadKpis()
  }, [loadKpis, scopeVersion, reloadToken])

  React.useEffect(() => {
    void loadProjects()
  }, [loadProjects, scopeVersion, reloadToken])

  const handleTabSelect = React.useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (id === 'all') params.delete('tab')
      else params.set('tab', id)
      router.replace(`?${params.toString()}`)
      setPage(1)
    },
    [router, searchParams],
  )

  const handleViewModeChange = React.useCallback(
    (next: ProjectsViewMode) => {
      setViewMode(next)
      const params = new URLSearchParams(searchParams.toString())
      if (next === 'table') params.delete('view')
      else params.set('view', next)
      router.replace(`?${params.toString()}`)
    },
    [router, searchParams, setViewMode],
  )

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

  const handleDelete = React.useCallback(
    async (entry: ProjectRow) => {
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
    },
    [confirm, handleRefresh, labels.actions.deleteConfirm, labels.actions.delete, labels.errors.delete, labels.messages.deleted],
  )

  const columns = React.useMemo<ColumnDef<ProjectRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: labels.table.name,
        meta: { priority: 1, sticky: true },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <ProjectColorDot colorKey={row.original.color} projectName={row.original.name} size="sm" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{row.original.name}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {row.original.code ?? '—'}
                {row.original.customerName ? ` · ${row.original.customerName}` : ''}
              </span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: labels.table.status,
        meta: { priority: 2 },
        cell: ({ row }) => {
          const badgeClass =
            row.original.status === 'active'
              ? 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300'
              : row.original.status === 'on_hold'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-muted text-muted-foreground'
          const statusLabel =
            labels.statuses[row.original.status as keyof typeof labels.statuses] ?? row.original.status
          return (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}
            >
              {statusLabel}
            </span>
          )
        },
      },
      {
        accessorKey: 'projectType',
        header: labels.table.type,
        meta: { priority: 3 },
        cell: ({ row }) =>
          row.original.projectType ? (
            <span className="text-sm text-foreground">{row.original.projectType}</span>
          ) : (
            <span className="text-xs text-muted-foreground/70">—</span>
          ),
      },
      isPmRole
        ? {
            accessorKey: 'members',
            id: 'members',
            header: labels.table.team,
            enableSorting: false,
            meta: { priority: 4 },
            cell: ({ row }) => (
              <ProjectMembersAvatarStack
                members={row.original.members}
                total={row.original.memberCount}
                peopleCountLabel={`${row.original.memberCount}`}
              />
            ),
          }
        : {
            accessorKey: 'myRole',
            header: labels.table.myRole,
            enableSorting: false,
            meta: { priority: 4 },
            cell: ({ row }) =>
              row.original.myRole ? (
                <span className="text-sm text-foreground">{row.original.myRole}</span>
              ) : (
                <span className="text-xs text-muted-foreground/70">—</span>
              ),
          },
      {
        accessorKey: 'hoursWeek',
        header: isPmRole ? labels.table.hoursWeek : labels.table.myHoursWeek,
        enableSorting: false,
        meta: { priority: 5 },
        cell: ({ row }) => {
          const stripe = resolveProjectColorHex(row.original.color, row.original.name)
          return (
            <div className="flex items-center justify-end gap-2">
              <HoursSparkline
                values={row.original.hoursTrend}
                color={stripe}
                ariaLabel={labels.card.sparklineAria}
              />
              <span className="text-xs font-medium tabular-nums text-foreground">
                {row.original.hoursWeek > 0 ? `${row.original.hoursWeek}h` : '—'}
              </span>
            </div>
          )
        },
      },
      {
        accessorKey: 'updatedAt',
        header: labels.table.updatedAt,
        meta: { priority: 6 },
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(row.original.updatedAt, '—')}
          </span>
        ),
      },
    ],
    [labels.table, labels.statuses, labels.card.sparklineAria, isPmRole],
  )

  const cardLabels = React.useMemo<ProjectCardLabels>(
    () => ({
      hoursPanelPm: labels.card.hoursPanelPm,
      hoursPanelCollab: labels.card.hoursPanelCollab,
      sparklineAria: labels.card.sparklineAria,
      peopleCount: (count: number) => `${count}`,
      role: labels.card.role,
      noCustomer: '—',
      statuses: labels.statuses,
    }),
    [labels.card, labels.statuses],
  )

  const canManage = isPmRole

  const emptyStateCopy = React.useMemo(() => {
    const hasFiltersApplied = activeTab !== 'all' || search.trim().length > 0 || Object.values(filterValues).some(Boolean)
    if (hasFiltersApplied) return labels.emptyState.noMatches
    if (!canManage) return labels.emptyState.noAssignments
    return labels.emptyState.noProjects
  }, [activeTab, search, filterValues, canManage, labels.emptyState])

  const cardsData: ProjectCardData[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    customerName: row.customerName,
    color: row.color,
    status: row.status,
    hoursWeek: row.hoursWeek,
    hoursTrend: row.hoursTrend,
    members: row.members,
    memberCount: row.memberCount,
    myRole: row.myRole,
    updatedAt: row.updatedAt,
  }))

  return (
    <Page>
      <PageBody>
        <div className="mb-4">
          <ProjectsKpiStrip kpis={kpis} labels={kpiLabels} isLoading={isLoadingKpis} />
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SavedViewTabs tabs={tabs} activeId={activeTab} onSelect={handleTabSelect} />
          <ViewModeToggle
            mode={viewMode}
            onChange={handleViewModeChange}
            tableLabel={labels.viewMode.table}
            cardsLabel={labels.viewMode.cards}
          />
        </div>

        {viewMode === 'cards' ? (
          <div>
            {isLoading ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
                <p className="text-sm text-muted-foreground">{emptyStateCopy}</p>
                {canManage ? (
                  <div className="mt-3">
                    <Button asChild size="sm">
                      <Link href="/backend/staff/timesheets/projects/create">
                        {labels.actions.addFirst}
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {cardsData.map((card) => (
                  <ProjectCard
                    key={card.id}
                    data={card}
                    labels={cardLabels}
                    showTeam={isPmRole}
                    href={`/backend/staff/timesheets/projects/${card.id}`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <DataTable<ProjectRow>
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
            emptyState={
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground mb-4">{emptyStateCopy}</p>
                {canManage ? (
                  <Button asChild size="sm">
                    <Link href="/backend/staff/timesheets/projects/create">{labels.actions.addFirst}</Link>
                  </Button>
                ) : null}
              </div>
            }
            actions={
              canManage ? (
                <Button asChild size="sm">
                  <Link href="/backend/staff/timesheets/projects/create">{labels.actions.add}</Link>
                </Button>
              ) : undefined
            }
            refreshButton={{
              label: labels.actions.refresh,
              onRefresh: handleRefresh,
              isRefreshing: isLoading || isRefreshing,
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
                  {
                    id: 'view',
                    label: labels.actions.viewDetails,
                    href: `/backend/staff/timesheets/projects/${row.id}`,
                  },
                  ...(canManage
                    ? [
                        {
                          id: 'delete',
                          label: labels.actions.delete,
                          destructive: true,
                          onSelect: () => {
                            void handleDelete(row)
                          },
                        },
                      ]
                    : []),
                ]}
              />
            )}
            onRowClick={(row) => router.push(`/backend/staff/timesheets/projects/${row.id}`)}
          />
        )}
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
