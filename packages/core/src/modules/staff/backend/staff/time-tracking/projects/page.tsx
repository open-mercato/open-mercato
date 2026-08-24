"use client"

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { groupBulkDeleteFailures, runBulkDelete } from '@open-mercato/ui/backend/utils/bulkDelete'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { formatCurrency, formatDate } from '@open-mercato/ui/utils/format'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { ProjectColorDot } from '../../../../lib/timesheets-ui/ProjectColorDot'
import { resolveProjectColorHex } from '../../../../lib/timesheets-ui/colors'
import { formatDuration } from '../../../../lib/time-tracking/duration'
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
import { ProjectBudgetCell } from '../../../../lib/timesheets-projects-ui/ProjectBudgetCell'
import { ProjectsBulkActionsBar } from '../../../../lib/timesheets-projects-ui/ProjectsBulkActionsBar'
import {
  AssignMembersDialog,
  type AssignMembersSubmitInput,
} from '../../../../lib/timesheets-projects-ui/AssignMembersDialog'
import { computeBudgetBurn, type ProjectBudgetKind } from '../../../../lib/timesheets-projects/budgetBurn'
import { resolveReportSelection } from '../../../../lib/timesheets-projects/reportSelection'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

const PAGE_SIZE = 50
const INCLUDE_FIELDS = 'hoursWeek,hoursTrend,members,myRole'
const MANAGE_FEATURE = 'staff.timesheets.projects.manage'
const RATES_FEATURE = 'staff.timesheets.rates.view'
const REPORTS_FEATURES = ['staff.timesheets.reports.view', 'staff.timesheets.reports.manage']
const REPORTS_HREF = '/backend/staff/time-tracking/reports'

type ProjectBudgetPayload = {
  kind?: unknown
  value?: unknown
  warnAtPercent?: unknown
}

type StaffEnrichment = {
  hoursWeek?: number
  hoursTrend?: number[]
  myRole?: string | null
  members?: AvatarMember[]
  memberCount?: number
  customerName?: string | null
  totalMinutes?: number
  billableMinutes?: number
  budget?: ProjectBudgetPayload
  hourlyRate?: number | null
  cost?: number | null
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
  currencyCode: string | null
  hoursWeek: number
  hoursTrend: number[]
  myRole: string | null
  members: AvatarMember[]
  memberCount: number
  totalMinutes: number
  hourlyRate: number | null
  cost: number | null
  budgetKind: ProjectBudgetKind
  budgetValue: number | null
  budgetWarnAtPercent: number | null
}

type ProjectsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type KpisResponse = PmKpis | CollabKpis

const STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  active: 'success',
  on_hold: 'warning',
  completed: 'neutral',
}

function readString(item: Record<string, unknown>, camel: string, snake: string): string | null {
  const camelValue = item[camel]
  if (typeof camelValue === 'string') return camelValue
  const snakeValue = item[snake]
  return typeof snakeValue === 'string' ? snakeValue : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readBudgetKind(value: unknown): ProjectBudgetKind {
  return value === 'hours' || value === 'amount' ? value : 'none'
}

function formatRelativeTime(iso: string | null, fallback: string, t: TranslateFn): string {
  if (!iso) return fallback
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return fallback
  const diffMs = Date.now() - parsed.getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return t('staff.timesheets.projects.portfolio.relativeTime.justNow', 'just now')
  if (minutes < 60) return t('staff.timesheets.projects.portfolio.relativeTime.minutesAgo', '{minutes}m ago', { minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('staff.timesheets.projects.portfolio.relativeTime.hoursAgo', '{hours}h ago', { hours })
  const days = Math.round(hours / 24)
  if (days < 14) return t('staff.timesheets.projects.portfolio.relativeTime.daysAgo', '{days}d ago', { days })
  return formatDateTime(iso) ?? fallback
}

function mapApiProject(item: Record<string, unknown>): ProjectRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : id
  const code = typeof item.code === 'string' && item.code.trim().length ? item.code.trim() : null
  const customerId = readString(item, 'customerId', 'customer_id')
  const status = typeof item.status === 'string' ? item.status : 'active'
  const projectType = readString(item, 'projectType', 'project_type')
  const color = typeof item.color === 'string' ? item.color : null
  const startDate = readString(item, 'startDate', 'start_date')
  const updatedAt = readString(item, 'updatedAt', 'updated_at')
  const currencyCode = readString(item, 'currencyCode', 'currency_code')
  const enrichment = (item as { _staff?: StaffEnrichment })._staff ?? ({} as StaffEnrichment)
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
  const customerName =
    typeof enrichment.customerName === 'string' && enrichment.customerName.length > 0
      ? enrichment.customerName
      : readString(item, 'customerName', 'customer_name')

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
      currencyCode,
      hoursWeek,
      hoursTrend,
      myRole,
      members,
      memberCount,
      totalMinutes: typeof enrichment.totalMinutes === 'number' ? enrichment.totalMinutes : 0,
      hourlyRate: readNumber(enrichment.hourlyRate),
      cost: readNumber(enrichment.cost),
      budgetKind: readBudgetKind(enrichment.budget?.kind),
      budgetValue: readNumber(enrichment.budget?.value),
      budgetWarnAtPercent: readNumber(enrichment.budget?.warnAtPercent),
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
  const { payload: chromePayload } = useBackendChrome()

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
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [assignDialogOpen, setAssignDialogOpen] = React.useState(false)
  const [isAssigning, setIsAssigning] = React.useState(false)

  const activeTab = searchParams.get('tab') ?? 'all'
  const urlViewMode = searchParams.get('view')
  const [viewMode, setViewMode] = useProjectsViewMode({
    userKey: null,
    urlOverride: urlViewMode,
  })

  const grantedFeatures = React.useMemo(
    () => chromePayload?.grantedFeatures ?? [],
    [chromePayload?.grantedFeatures],
  )
  const canManageProjects = hasAllFeatures(grantedFeatures, [MANAGE_FEATURE])
  const canViewRates = hasAllFeatures(grantedFeatures, [RATES_FEATURE])
  const canCreateReports = hasAllFeatures(grantedFeatures, REPORTS_FEATURES)
  const canSelectRows = canManageProjects || canCreateReports

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
        customer: t('staff.time_tracking.projects.columns.customer', 'Customer'),
        rate: t('staff.time_tracking.projects.columns.rate', 'Rate'),
        hours: t('staff.time_tracking.projects.columns.hours', 'Hours'),
        cost: t('staff.time_tracking.projects.columns.cost', 'Cost'),
        budget: t('staff.time_tracking.projects.columns.budget', 'Budget'),
        selectRow: t('staff.time_tracking.projects.selection.selectRow', 'Select project'),
        selectAll: t('staff.time_tracking.projects.selection.selectAll', 'Select all projects on this page'),
      },
      actions: {
        add: t('staff.timesheets.projects.actions.add', 'Add Project'),
        addFirst: t('staff.timesheets.projects.actions.addFirst', '+ Add first project'),
        viewDetails: t('staff.timesheets.projects.actions.viewDetails', 'View Details'),
        delete: t('staff.timesheets.projects.actions.delete', 'Delete'),
        deleteConfirm: t('staff.timesheets.projects.actions.deleteConfirm', 'Delete project "{{name}}"?'),
        refresh: t('staff.timesheets.projects.actions.refresh', 'Refresh'),
        assignCustomer: t('staff.time_tracking.projects.actions.assignCustomer', 'Assign a customer'),
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
      budget: {
        none: t('staff.time_tracking.projects.budget.none', 'no budget'),
        aria: t('staff.time_tracking.projects.budget.ariaLabel', 'Budget usage'),
      },
      bulk: {
        report: t('staff.time_tracking.projects.bulk.report', 'Report from selected'),
        assignMembers: t('staff.time_tracking.projects.bulk.assignMembers', 'Assign members'),
        clear: t('staff.time_tracking.projects.bulk.clear', 'Clear'),
      },
      assign: {
        title: t('staff.time_tracking.projects.assignMembers.title', 'Assign members'),
        searchPlaceholder: t('staff.timesheets.projects.employees.searchEmployee', 'Search team members...'),
        empty: t('staff.timesheets.projects.employees.noResults', 'No team members found'),
        loadError: t(
          'staff.time_tracking.projects.assignMembers.loadError',
          'Could not load team members. Check your connection and try again.',
        ),
        loading: t('staff.timesheets.projects.employees.loading', 'Loading employees...'),
        role: t('staff.timesheets.projects.employees.roleOnProject', 'Role on Project'),
        rolePlaceholder: t('staff.timesheets.projects.employees.rolePlaceholder', 'e.g. Developer, Designer...'),
        startDate: t('staff.timesheets.projects.employees.assignmentStartDate', 'Assignment Start Date'),
        cancel: t('staff.timesheets.projects.form.actions.cancel', 'Cancel'),
        confirm: t('staff.time_tracking.projects.assignMembers.confirm', 'Assign'),
        error: t('staff.time_tracking.projects.assignMembers.error', 'Failed to assign members.'),
        progressName: t('staff.time_tracking.projects.assignMembers.progressName', 'Assign members to projects'),
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
      logger.error('staff.timesheets.projects.list', { err: error })
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

  React.useEffect(() => {
    setSelectedIds([])
  }, [page, activeTab, search, filterValues.status, scopeVersion])

  const selectedRows = React.useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds],
  )

  const reportSelection = React.useMemo(
    () =>
      resolveReportSelection(
        selectedRows.map((row) => ({
          id: row.id,
          name: row.name,
          customerId: row.customerId,
          customerName: row.customerName,
          currencyCode: row.currencyCode,
        })),
      ),
    [selectedRows],
  )

  const reportBlockedReason = React.useMemo(() => {
    if (reportSelection.ok) return null
    const offenders = reportSelection.offenders.join(', ')
    if (reportSelection.reason === 'multiple_customers') {
      return t(
        'staff.time_tracking.projects.bulk.reportBlocked.multipleCustomers',
        'A report always covers one customer. Selected: {customers}.',
        { customers: offenders },
      )
    }
    if (reportSelection.reason === 'multiple_currencies') {
      return t(
        'staff.time_tracking.projects.bulk.reportBlocked.multipleCurrencies',
        'A report always covers one currency. Selected: {currencies}.',
        { currencies: offenders },
      )
    }
    if (reportSelection.reason === 'missing_customer') {
      return t(
        'staff.time_tracking.projects.bulk.reportBlocked.missingCustomer',
        'These projects have no customer yet: {projects}.',
        { projects: offenders },
      )
    }
    return null
  }, [reportSelection, t])

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

  const projectsMutationContextId = 'staff-time-projects-list:assign-members'
  const { runMutation: runProjectsMutation, retryLastMutation: retryProjectsMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: projectsMutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

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
        await runProjectsMutation({
          operation: () =>
            withScopedApiRequestHeaders(
              buildOptimisticLockHeader(entry.updatedAt),
              () => deleteCrud('staff/timesheets/time-projects', entry.id, { errorMessage: labels.errors.delete }),
            ),
          context: {
            formId: projectsMutationContextId,
            resourceKind: 'staff.time_project',
            resourceId: entry.id,
            retryLastMutation: retryProjectsMutation,
          },
          mutationPayload: { id: entry.id },
        })
        flash(labels.messages.deleted, 'success')
        handleRefresh()
      } catch (error) {
        if (surfaceRecordConflict(error, t)) { handleRefresh(); return }
        logger.error('staff.timesheets.projects.delete', { err: error })
        flash(labels.errors.delete, 'error')
      }
    },
    [confirm, handleRefresh, projectsMutationContextId, retryProjectsMutation, runProjectsMutation, t, labels.actions.deleteConfirm, labels.actions.delete, labels.errors.delete, labels.messages.deleted],
  )

  const handleAssignMembers = React.useCallback(
    async (input: AssignMembersSubmitInput) => {
      const targets = selectedRows
      if (targets.length === 0 || input.staffMemberIds.length === 0) return
      setIsAssigning(true)
      try {
        const { succeeded, failures } = await runProjectsMutation({
          operation: () =>
            runBulkDelete(
              targets,
              async (row) => {
                for (const staffMemberId of input.staffMemberIds) {
                  await createCrud(
                    `staff/timesheets/time-projects/${row.id}/employees`,
                    {
                      timeProjectId: row.id,
                      staffMemberId,
                      role: input.role,
                      assignedStartDate: input.assignedStartDate,
                    },
                    { errorMessage: labels.assign.error },
                  )
                }
              },
              {
                fallbackErrorMessage: labels.assign.error,
                logTag: 'staff.timesheets.projects.assignMembers',
                progress: {
                  jobType: 'staff.timesheets.projects.bulk_assign_members',
                  name: labels.assign.progressName,
                },
              },
            ),
          context: {
            formId: projectsMutationContextId,
            resourceKind: 'staff.time_project_member',
            retryLastMutation: retryProjectsMutation,
          },
          mutationPayload: {
            projectIds: targets.map((row) => row.id),
            staffMemberIds: input.staffMemberIds,
          },
        })
        if (succeeded.length > 0) {
          flash(
            t('staff.time_tracking.projects.assignMembers.success', 'Members assigned to {count} projects.', {
              count: succeeded.length,
            }),
            'success',
          )
        }
        for (const group of groupBulkDeleteFailures(failures)) {
          flash(group.sampleMessage, 'error')
        }
        setAssignDialogOpen(false)
        setSelectedIds([])
        handleRefresh()
      } catch (error) {
        logger.error('staff.timesheets.projects.assignMembers', { err: error })
        flash(labels.assign.error, 'error')
      } finally {
        setIsAssigning(false)
      }
    },
    [
      projectsMutationContextId,
      handleRefresh,
      labels.assign.error,
      labels.assign.progressName,
      retryProjectsMutation,
      runProjectsMutation,
      selectedRows,
      t,
    ],
  )

  const handleReportFromSelected = React.useCallback(() => {
    if (!reportSelection.ok) return
    const params = new URLSearchParams({
      customerId: reportSelection.customerId,
      projectIds: reportSelection.projectIds.join(','),
    })
    router.push(`${REPORTS_HREF}?${params.toString()}`)
  }, [reportSelection, router])

  const toggleRowSelection = React.useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((value) => value !== id)))
  }, [])

  const toggleAllSelection = React.useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? rows.map((row) => row.id) : [])
    },
    [rows],
  )

  const allSelected = rows.length > 0 && selectedIds.length === rows.length
  const someSelected = selectedIds.length > 0 && !allSelected

  const columns = React.useMemo<ColumnDef<ProjectRow>[]>(() => {
    const rightHeader = (label: string) => () => <span className="block text-right">{label}</span>
    const defs: ColumnDef<ProjectRow>[] = []

    if (canSelectRows) {
      defs.push({
        id: 'select',
        accessorKey: 'id',
        header: () => (
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(checked) => toggleAllSelection(Boolean(checked))}
            aria-label={labels.table.selectAll}
          />
        ),
        enableSorting: false,
        meta: { priority: 1 },
        cell: ({ row }) => (
          <Checkbox
            checked={selectedIds.includes(row.original.id)}
            onCheckedChange={(checked) => toggleRowSelection(row.original.id, Boolean(checked))}
            onClick={(event) => event.stopPropagation()}
            aria-label={labels.table.selectRow}
          />
        ),
      })
    }

    defs.push({
      accessorKey: 'name',
      header: labels.table.name,
      meta: { priority: 1 },
      cell: ({ row }) => {
        const startDate = row.original.startDate ? formatDate(row.original.startDate) : null
        return (
          <div className="flex items-center gap-2.5">
            <ProjectColorDot colorKey={row.original.color} projectName={row.original.name} size="sm" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{row.original.name}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {row.original.code ?? '—'}
                {startDate ? ` · ${startDate}` : ''}
              </span>
            </div>
          </div>
        )
      },
    })

    defs.push({
      accessorKey: 'customerName',
      id: 'customerName',
      header: labels.table.customer,
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => {
        if (row.original.customerName) {
          return <span className="text-sm text-muted-foreground">{row.original.customerName}</span>
        }
        // Only a project that genuinely has no customer gets the call to action.
        // A row that carries the FK but no resolvable name (customer removed,
        // customers module absent) is unnamed, not unassigned — inviting an
        // assignment there would misstate the record.
        if (canManageProjects && !row.original.customerId) {
          return (
            <Link
              href={`/backend/staff/time-tracking/projects/${row.original.id}/edit`}
              className="text-sm text-primary underline-offset-2 hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {labels.actions.assignCustomer}
            </Link>
          )
        }
        return <span className="text-xs text-muted-foreground/70">—</span>
      },
    })

    defs.push({
      accessorKey: 'status',
      header: labels.table.status,
      meta: { priority: 3 },
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANTS[row.original.status] ?? 'neutral'} dot>
          {labels.statuses[row.original.status as keyof typeof labels.statuses] ?? row.original.status}
        </StatusBadge>
      ),
    })

    defs.push(
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
    )

    if (canViewRates) {
      defs.push({
        accessorKey: 'hourlyRate',
        id: 'hourlyRate',
        header: rightHeader(labels.table.rate),
        enableSorting: false,
        meta: { priority: 5 },
        cell: ({ row }) => (
          <span className="block text-right font-mono text-sm tabular-nums text-foreground">
            {formatCurrency(row.original.hourlyRate, row.original.currencyCode) ?? '—'}
          </span>
        ),
      })
    }

    defs.push({
      accessorKey: 'totalMinutes',
      id: 'totalMinutes',
      header: rightHeader(labels.table.hours),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm font-semibold tabular-nums text-foreground">
          {row.original.totalMinutes > 0 ? formatDuration(row.original.totalMinutes, 'clock') : '—'}
        </span>
      ),
    })

    if (canViewRates) {
      defs.push({
        accessorKey: 'cost',
        id: 'cost',
        header: rightHeader(labels.table.cost),
        enableSorting: false,
        meta: { priority: 5 },
        cell: ({ row }) => (
          <span className="block text-right font-mono text-sm tabular-nums text-foreground">
            {formatCurrency(row.original.cost, row.original.currencyCode) ?? '—'}
          </span>
        ),
      })
    }

    defs.push({
      accessorKey: 'budgetValue',
      id: 'budget',
      header: labels.table.budget,
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        if (row.original.budgetKind === 'amount' && !canViewRates) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        const burn = computeBudgetBurn({
          kind: row.original.budgetKind,
          budgetValue: row.original.budgetValue,
          warnAtPercent: row.original.budgetWarnAtPercent,
          totalMinutes: row.original.totalMinutes,
          cost: row.original.cost,
        })
        const budgetLabel = burn
          ? burn.kind === 'hours'
            ? t('staff.time_tracking.projects.budget.hoursValue', '{value} h', {
                value: Math.round(burn.budgetValue * 10) / 10,
              })
            : formatCurrency(burn.budgetValue, row.original.currencyCode) ?? `${burn.budgetValue}`
          : null
        return (
          <ProjectBudgetCell
            burn={burn}
            usageLabel={
              burn
                ? t('staff.time_tracking.projects.budget.usage', '{percent}% of {value}', {
                    percent: burn.percent,
                    value: budgetLabel ?? '',
                  })
                : null
            }
            noBudgetLabel={labels.budget.none}
            ariaLabel={labels.budget.aria}
          />
        )
      },
    })

    defs.push({
      accessorKey: 'hoursWeek',
      header: isPmRole ? labels.table.hoursWeek : labels.table.myHoursWeek,
      enableSorting: false,
      meta: { priority: 6 },
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
    })

    defs.push({
      accessorKey: 'projectType',
      header: labels.table.type,
      meta: { priority: 7 },
      cell: ({ row }) =>
        row.original.projectType ? (
          <span className="text-sm text-foreground">{row.original.projectType}</span>
        ) : (
          <span className="text-xs text-muted-foreground/70">—</span>
        ),
    })

    defs.push({
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 8 },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(row.original.updatedAt, '—', t)}
        </span>
      ),
    })

    return defs
  }, [
    allSelected,
    canManageProjects,
    canSelectRows,
    canViewRates,
    isPmRole,
    labels,
    selectedIds,
    someSelected,
    t,
    toggleAllSelection,
    toggleRowSelection,
  ])

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

  const emptyStateCopy = React.useMemo(() => {
    const hasFiltersApplied = activeTab !== 'all' || search.trim().length > 0 || Object.values(filterValues).some(Boolean)
    if (hasFiltersApplied) return labels.emptyState.noMatches
    if (!canManageProjects) return labels.emptyState.noAssignments
    return labels.emptyState.noProjects
  }, [activeTab, search, filterValues, canManageProjects, labels.emptyState])

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

  const tableToolbar = (
    <FilterBar
      searchValue={search}
      onSearchChange={handleSearchChange}
      searchPlaceholder={labels.table.search}
      filters={filters}
      values={filterValues}
      onApply={handleFiltersApply}
      onClear={handleFiltersClear}
      trailingItems={
        canSelectRows ? (
          <ProjectsBulkActionsBar
            selectedCount={selectedIds.length}
            labels={{
              selectedCount: t('staff.time_tracking.projects.bulk.selectedCount', '{count} selected', {
                count: selectedIds.length,
              }),
              report: labels.bulk.report,
              assignMembers: labels.bulk.assignMembers,
              clear: labels.bulk.clear,
            }}
            canReport={canCreateReports}
            canAssignMembers={canManageProjects}
            reportBlockedReason={reportBlockedReason}
            isBusy={isAssigning}
            onReport={handleReportFromSelected}
            onAssignMembers={() => setAssignDialogOpen(true)}
            onClear={() => setSelectedIds([])}
          />
        ) : null
      }
    />
  )

  return (
    <Page>
      <PageBody>
        <div className="mb-4">
          <ProjectsKpiStrip kpis={kpis} labels={kpiLabels} isLoading={isLoadingKpis} />
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SavedViewTabs
            tabs={tabs}
            activeId={activeTab}
            onSelect={handleTabSelect}
            ariaLabel={t('staff.timesheets.projects.portfolio.savedViews.ariaLabel', 'Saved views')}
          />
          <ViewModeToggle
            mode={viewMode}
            onChange={handleViewModeChange}
            tableLabel={labels.viewMode.table}
            cardsLabel={labels.viewMode.cards}
            ariaLabel={t('staff.timesheets.projects.portfolio.viewMode.ariaLabel', 'View mode')}
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
                {canManageProjects ? (
                  <div className="mt-3">
                    <Button asChild size="sm">
                      <Link href="/backend/staff/time-tracking/projects/create">
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
                    href={`/backend/staff/time-tracking/projects/${card.id}`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <DataTable<ProjectRow>
            extensionTableId={extensionPoints.hosts.timeProjectsTable.tableId}
            title={labels.title}
            data={rows}
            columns={columns}
            isLoading={isLoading}
            toolbar={tableToolbar}
            emptyState={
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground mb-4">{emptyStateCopy}</p>
                {canManageProjects ? (
                  <Button asChild size="sm">
                    <Link href="/backend/staff/time-tracking/projects/create">{labels.actions.addFirst}</Link>
                  </Button>
                ) : null}
              </div>
            }
            actions={
              canManageProjects ? (
                <Button asChild size="sm">
                  <Link href="/backend/staff/time-tracking/projects/create">{labels.actions.add}</Link>
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
            stickyActionsColumn
            rowActions={(row) => (
              <RowActions
                items={[
                  {
                    id: 'view',
                    label: labels.actions.viewDetails,
                    href: `/backend/staff/time-tracking/projects/${row.id}`,
                  },
                  ...(canManageProjects
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
            onRowClick={(row) => router.push(`/backend/staff/time-tracking/projects/${row.id}`)}
          />
        )}
      </PageBody>
      {canManageProjects ? (
        <AssignMembersDialog
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          isSaving={isAssigning}
          labels={{
            title: labels.assign.title,
            description: t(
              'staff.time_tracking.projects.assignMembers.description',
              'Selected projects: {count}.',
              { count: selectedIds.length },
            ),
            searchPlaceholder: labels.assign.searchPlaceholder,
            empty: labels.assign.empty,
            loadError: labels.assign.loadError,
            loading: labels.assign.loading,
            role: labels.assign.role,
            rolePlaceholder: labels.assign.rolePlaceholder,
            startDate: labels.assign.startDate,
            cancel: labels.assign.cancel,
            confirm: labels.assign.confirm,
          }}
          onConfirm={(input) => {
            void handleAssignMembers(input)
          }}
        />
      ) : null}
      {ConfirmDialogElement}
    </Page>
  )
}
