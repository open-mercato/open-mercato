"use client"

/**
 * Screens 11 and 12 — the timesheet (T5.1, T5.5).
 *
 * One period, one set of filters, three ways of looking at it:
 *
 *  * **Calendar** (screen 11) — a month at a time, for spotting gaps.
 *  * **List** (screen 12) — day by day, for closing out a week.
 *  * **Grid** (kept) — project × day cells, for typing a week in one pass.
 *
 * The page owns the period, the filters and the data; the three views are pure
 * renderers over the same day buckets, so a number can never differ between them.
 *
 * Two access rules are enforced here rather than left to a component:
 *
 *  * A Team Member's person picker contains exactly one option — themselves
 *    (screen 11 note 5, US-E2). The list of other people is built from project
 *    membership previews, which the projects enricher only returns to a holder of
 *    `staff.timesheets.projects.manage`, so a TM cannot even name a colleague.
 *  * **Somebody else's timesheet is read-only.** Every write path in this module
 *    resolves the caller's own staff member — the bulk endpoint included — so a
 *    Team Leader looking at a colleague's week gets the numbers without an
 *    editing affordance that could not work anyway.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { TimerBar } from '../../../../lib/timesheets-ui/TimerBar'
import { CreateProjectDialog } from '../../../../lib/timesheets-ui/CreateProjectDialog'
import { ListView } from '../../../../lib/timesheets-ui/ListView'
import { TimeEntryDialog } from '../../../../lib/time-tracking-ui/TimeEntryDialog'
import { PeriodSelector, TimesheetFilterSelect } from '../../../../lib/time-tracking-ui/PeriodSelector'
import { TimesheetViewSwitch } from '../../../../lib/time-tracking-ui/TimesheetViewSwitch'
import { TimesheetCalendar } from '../../../../lib/time-tracking-ui/TimesheetCalendar'
import { TimesheetPeriodFooter } from '../../../../lib/time-tracking-ui/TimesheetPeriodFooter'
import {
  ALL_OPTION_VALUE,
  resolveEffectiveView,
  usePersistedFilterValue,
  usePersistedPeriodKind,
  usePersistedView,
  viewsForPeriod,
  type TimesheetView,
} from '../../../../lib/time-tracking-ui/useTimesheetPreferences'
import {
  buildTimesheetDays,
  indexDaysByDate,
  pickDefaultExpandedDay,
  resolveLoadScaleMinutes,
  summarizeTimesheet,
  toTimesheetEntry,
  type TimesheetEntry,
} from '../../../../lib/time-tracking-ui/timesheetData'
import {
  eachDayIso,
  resolvePeriodRange,
  startOfMonthIso,
  todayIso,
  type TimesheetDateRange,
  type TimesheetPeriodKind,
} from '../../../../lib/time-tracking-ui/timesheetPeriod'
import {
  buildLogTargets,
  parseTargetKey,
  type TimesheetProjectRef,
  type TimesheetTaskRef,
} from '../../../../lib/time-tracking-ui/timesheetTargets'
import {
  combineDateAndClock,
  readRowItems,
  toProjectOption,
  toTaskOption,
} from '../../../../lib/time-tracking-ui/timeEntryDialogState'
import { deriveInterval } from '../../../../lib/time-tracking/interval'
import { GridView, type GridRowMode } from './GridView'

const logger = createLogger('staff').child({ component: 'time-tracking/timesheet' })

const PAGE_SIZE = 100
const MAX_ENTRY_PAGES = 5
const RATES_MANAGE_FEATURE = 'staff.timesheets.projects.manage'
const MANAGE_OWN_FEATURE = 'staff.timesheets.manage_own'
const ENTRIES_API_PATH = 'staff/timesheets/time-entries'
const MUTATION_CONTEXT_ID = 'staff.time_tracking.timesheet'

type MemberPreview = { id: string; name: string }

type LoadedData = {
  staffMemberId: string | null
  staffMemberMissing: boolean
  visibleProjectIds: string[]
  assignedProjectIds: string[]
  projects: TimesheetProjectRef[]
  tasks: TimesheetTaskRef[]
  entries: TimesheetEntry[]
  people: MemberPreview[]
  dailyHours: number | null
  truncated: boolean
}

const EMPTY_DATA: LoadedData = {
  staffMemberId: null,
  staffMemberMissing: false,
  visibleProjectIds: [],
  assignedProjectIds: [],
  projects: [],
  tasks: [],
  entries: [],
  people: [],
  dailyHours: null,
  truncated: false,
}

function readMemberPreviews(row: Record<string, unknown>): MemberPreview[] {
  const staffBag = row._staff
  if (!staffBag || typeof staffBag !== 'object') return []
  const members = (staffBag as { members?: unknown }).members
  if (!Array.isArray(members)) return []
  return members
    .map((member) => {
      if (!member || typeof member !== 'object') return null
      const id = (member as { id?: unknown }).id
      const name = (member as { name?: unknown }).name
      if (typeof id !== 'string' || typeof name !== 'string') return null
      return { id, name }
    })
    .filter((member): member is MemberPreview => member !== null)
}

async function loadEntryPages(params: URLSearchParams): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = []
  let truncated = false
  for (let page = 1; page <= MAX_ENTRY_PAGES; page += 1) {
    params.set('page', String(page))
    const payload = await readApiResultOrThrow<{ items?: Record<string, unknown>[]; totalPages?: number }>(
      `/api/${ENTRIES_API_PATH}?${params.toString()}`,
      undefined,
      { fallback: { items: [], totalPages: 1 } },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    rows.push(...items)
    const totalPages = typeof payload.totalPages === 'number' ? payload.totalPages : 1
    if (page >= totalPages) return { rows, truncated }
    if (page === MAX_ENTRY_PAGES) truncated = true
  }
  return { rows, truncated }
}

export default function TimesheetPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload } = useBackendChrome()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const canManageProjects = hasFeature(payload?.grantedFeatures, RATES_MANAGE_FEATURE)
  const canManageOwn = hasFeature(payload?.grantedFeatures, MANAGE_OWN_FEATURE)

  const [data, setData] = React.useState<LoadedData>(EMPTY_DATA)
  /**
   * `?period=` and `?view=` are the documented deep-link contract for screens 11
   * and 12, so the query string outranks the remembered preference: a link a
   * colleague pasted must open on the period and the view it names.
   *
   * The preference is scoped to the staff member the page has resolved, so two
   * people signing in from the same browser stop sharing one set of filters.
   */
  const periodParam = searchParams?.get('period') ?? null
  const viewParam = searchParams?.get('view') ?? null
  const userKey = data.staffMemberId

  const [periodKind, setPeriodKind] = usePersistedPeriodKind({ userKey, urlOverride: periodParam })
  const [anchorDate, setAnchorDate] = React.useState<string>(() => todayIso())
  const [storedView, setView] = usePersistedView(periodKind, { userKey, urlOverride: viewParam })
  const view = resolveEffectiveView(periodKind, storedView)
  const [projectFilter, setProjectFilter] = usePersistedFilterValue('project', { userKey })
  const [storedPersonFilter, setPersonFilter] = usePersistedFilterValue('person', { userKey })
  /**
   * A remembered colleague is only honoured while the caller may still look at
   * one. Losing the Team Leader feature must not leave the timesheet pinned to
   * somebody else's week (and quietly asking the API for it).
   */
  const personFilter = canManageProjects ? storedPersonFilter : ALL_OPTION_VALUE
  const [rowMode, setRowMode] = React.useState<GridRowMode>('projects')
  const [expandedDate, setExpandedDate] = React.useState<string | null>(null)
  const [expandedTouched, setExpandedTouched] = React.useState(false)

  const [isInitialLoad, setIsInitialLoad] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [entryDialog, setEntryDialog] = React.useState<{ open: boolean; entryId: string | null; date: string }>({
    open: false,
    entryId: null,
    date: todayIso(),
  })
  const hasLoadedOnceRef = React.useRef(false)

  const range: TimesheetDateRange = React.useMemo(
    () => resolvePeriodRange(periodKind, anchorDate),
    [anchorDate, periodKind],
  )

  /**
   * `router.replace` keeps the deep link truthful without pushing a history
   * entry per toggle — the same idiom the board and projects screens use.
   */
  const replaceSearchParam = React.useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set(name, value)
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const handlePeriodKindChange = React.useCallback(
    (next: TimesheetPeriodKind) => {
      setPeriodKind(next)
      replaceSearchParam('period', next)
    },
    [replaceSearchParam, setPeriodKind],
  )

  const handleViewChange = React.useCallback(
    (next: TimesheetView) => {
      setView(next)
      replaceSearchParam('view', next)
    },
    [replaceSearchParam, setView],
  )

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const loadError = t('staff.timesheets.my.errors.load', 'Failed to load timesheets.')

  const loadData = React.useCallback(async () => {
    if (hasLoadedOnceRef.current) setIsRefreshing(true)
    try {
      const selfPayload = await readApiResultOrThrow<{ member?: { id: string } | null }>(
        '/api/staff/team-members/self',
        undefined,
        { errorMessage: loadError, fallback: { member: null } },
      )
      const myStaffMemberId = selfPayload.member?.id ?? null
      if (!myStaffMemberId) {
        setData({ ...EMPTY_DATA, staffMemberMissing: true })
        return
      }

      const targetStaffMemberId = personFilter !== ALL_OPTION_VALUE ? personFilter : myStaffMemberId

      const assignmentsPayload = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(
        `/api/staff/timesheets/my-projects?pageSize=${PAGE_SIZE}`,
        undefined,
        { errorMessage: loadError, fallback: { items: [] } },
      )
      const assignments = Array.isArray(assignmentsPayload.items) ? assignmentsPayload.items : []
      const assignedProjectIds = assignments
        .map((item) => String(item.time_project_id ?? item.timeProjectId ?? ''))
        .filter((id) => id.length > 0)
      const visibleProjectIds = assignments
        .filter((item) => item.show_in_grid === true || item.showInGrid === true)
        .map((item) => String(item.time_project_id ?? item.timeProjectId ?? ''))
        .filter((id) => id.length > 0)

      const entryParams = new URLSearchParams({
        pageSize: String(PAGE_SIZE),
        from: range.from,
        to: range.to,
        staffMemberId: targetStaffMemberId,
        sortField: 'date',
        sortDir: 'asc',
      })
      if (projectFilter !== ALL_OPTION_VALUE) entryParams.set('projectId', projectFilter)
      const { rows: entryRows, truncated } = await loadEntryPages(entryParams)
      const entries = entryRows
        .map((row) => toTimesheetEntry(row))
        .filter((entry): entry is TimesheetEntry => entry !== null)

      const projectIds = Array.from(
        new Set([
          ...assignedProjectIds,
          ...entries.map((entry) => entry.timeProjectId ?? '').filter((id) => id.length > 0),
        ]),
      ).slice(0, PAGE_SIZE)
      const taskIds = Array.from(
        new Set(entries.map((entry) => entry.taskId ?? '').filter((id) => id.length > 0)),
      ).slice(0, PAGE_SIZE)

      const [projectsPayload, tasksPayload, entryTasksPayload, settingsPayload] = await Promise.all([
        projectIds.length > 0
          ? readApiResultOrThrow<Record<string, unknown>>(
              `/api/staff/timesheets/time-projects?ids=${projectIds.join(',')}&pageSize=${PAGE_SIZE}`,
              undefined,
              { allowNullResult: true },
            )
          : Promise.resolve({} as Record<string, unknown>),
        readApiResultOrThrow<Record<string, unknown>>(
          `/api/staff/timesheets/tasks?pageSize=${PAGE_SIZE}`,
          undefined,
          { allowNullResult: true },
        ).catch(() => ({}) as Record<string, unknown>),
        taskIds.length > 0
          ? readApiResultOrThrow<Record<string, unknown>>(
              `/api/staff/timesheets/tasks?ids=${taskIds.join(',')}&pageSize=${PAGE_SIZE}`,
              undefined,
              { allowNullResult: true },
            ).catch(() => ({}) as Record<string, unknown>)
          : Promise.resolve({} as Record<string, unknown>),
        readApiResultOrThrow<{ targets?: { dailyHours?: number | null } }>(
          '/api/staff/timesheets/settings',
          undefined,
          { fallback: { targets: { dailyHours: null } } },
        ).catch(() => ({ targets: { dailyHours: null } })),
      ])

      const projectRows = readRowItems(projectsPayload)
      const projects: TimesheetProjectRef[] = []
      const peopleById = new Map<string, MemberPreview>()
      for (const row of projectRows) {
        const option = toProjectOption(row)
        if (!option) continue
        projects.push({
          // The grid's first column has always shown the bare project name over
          // its code; the customer belongs to the projects screen, not here.
          id: option.id,
          name: option.name,
          code: typeof row.code === 'string' ? row.code : null,
          color: typeof row.color === 'string' ? row.color : null,
        })
        for (const member of readMemberPreviews(row)) peopleById.set(member.id, member)
      }

      const tasksById = new Map<string, TimesheetTaskRef>()
      for (const row of [...readRowItems(tasksPayload), ...readRowItems(entryTasksPayload)]) {
        const option = toTaskOption(row)
        if (!option || !option.timeProjectId) continue
        tasksById.set(option.id, { id: option.id, title: option.title, timeProjectId: option.timeProjectId })
      }

      const directory = {
        taskTitles: new Map(Array.from(tasksById.values()).map((task) => [task.id, task.title])),
        projectLabels: new Map(projects.map((project) => [project.id, project.name])),
      }
      const decoratedEntries = entryRows
        .map((row) => toTimesheetEntry(row, directory))
        .filter((entry): entry is TimesheetEntry => entry !== null)

      const dailyHours =
        typeof settingsPayload?.targets?.dailyHours === 'number' ? settingsPayload.targets.dailyHours : null

      setData({
        staffMemberId: myStaffMemberId,
        staffMemberMissing: false,
        visibleProjectIds,
        assignedProjectIds,
        projects,
        tasks: Array.from(tasksById.values()),
        entries: decoratedEntries,
        people: Array.from(peopleById.values()).sort((left, right) => left.name.localeCompare(right.name)),
        dailyHours,
        truncated,
      })
    } catch (error) {
      logger.error('staff.time_tracking.timesheet load failed', { err: error })
      flash(loadError, 'error')
    } finally {
      hasLoadedOnceRef.current = true
      setIsInitialLoad(false)
      setIsRefreshing(false)
    }
  }, [loadError, personFilter, projectFilter, range.from, range.to])

  React.useEffect(() => {
    void loadData()
  }, [loadData, scopeVersion])

  const viewingSelf = personFilter === ALL_OPTION_VALUE || personFilter === data.staffMemberId
  const readOnly = !viewingSelf

  const days = React.useMemo(() => buildTimesheetDays(range, data.entries), [data.entries, range])
  const dayIndex = React.useMemo(() => indexDaysByDate(days), [days])
  const summary = React.useMemo(() => summarizeTimesheet(days, range, data.dailyHours), [days, data.dailyHours, range])
  const scaleMinutes = React.useMemo(
    () => resolveLoadScaleMinutes(days, data.dailyHours),
    [days, data.dailyHours],
  )
  const dailyTargetMinutes = data.dailyHours !== null ? Math.round(data.dailyHours * 60) : null

  // The expanded day follows the period until the user picks one themselves.
  const autoExpanded = React.useMemo(
    () => pickDefaultExpandedDay(days, data.dailyHours, todayIso()),
    [days, data.dailyHours],
  )
  React.useEffect(() => {
    setExpandedTouched(false)
  }, [range.from, range.to, personFilter, projectFilter])
  React.useEffect(() => {
    if (expandedTouched) return
    setExpandedDate(autoExpanded)
  }, [autoExpanded, expandedTouched])

  const gridProjects = React.useMemo(() => {
    const referenced = new Set(data.entries.map((entry) => entry.timeProjectId ?? ''))
    if (!viewingSelf) {
      return data.projects.filter((project) => referenced.has(project.id))
    }
    const visible = new Set(data.visibleProjectIds)
    // A project with time in this period always gets a row, pinned or not. The
    // footer counts those hours, so a grid that shows only pinned rows tells the
    // reader two different things at once — "no rows" above "Period: 11:00".
    return data.projects.filter((project) => visible.has(project.id) || referenced.has(project.id))
  }, [data.entries, data.projects, data.visibleProjectIds, viewingSelf])

  const assignedProjects = React.useMemo(() => {
    const assigned = new Set(data.assignedProjectIds)
    return data.projects.filter((project) => assigned.has(project.id))
  }, [data.assignedProjectIds, data.projects])

  const logTargets = React.useMemo(
    () => buildLogTargets(gridProjects, data.tasks),
    [data.tasks, gridProjects],
  )

  const projectOptions = React.useMemo(
    () => [
      { value: ALL_OPTION_VALUE, label: t('staff.time_tracking.timesheet.filters.allProjects', 'All projects') },
      ...data.projects.map((project) => ({ value: project.id, label: project.name })),
    ],
    [data.projects, t],
  )

  const personOptions = React.useMemo(() => {
    const mine = {
      value: ALL_OPTION_VALUE,
      label: t('staff.time_tracking.timesheet.filters.me', 'Me'),
    }
    if (!canManageProjects) return [mine]
    return [
      mine,
      ...data.people
        .filter((person) => person.id !== data.staffMemberId)
        .map((person) => ({ value: person.id, label: person.name })),
    ]
  }, [canManageProjects, data.people, data.staffMemberId, t])

  const monthAnchors = React.useMemo(() => {
    const anchors: string[] = []
    for (const day of eachDayIso(range)) {
      const monthStart = startOfMonthIso(day)
      if (anchors[anchors.length - 1] !== monthStart) anchors.push(monthStart)
    }
    return anchors
  }, [range])

  const openEntryDialog = React.useCallback((date: string, entryId: string | null) => {
    setEntryDialog({ open: true, entryId, date })
  }, [])

  const handleQuickAdd = React.useCallback(
    async (input: { date: string; targetKey: string; durationMinutes: number; startClock: string | null }) => {
      const target = parseTargetKey(input.targetKey)
      /**
       * A start with no end would store the shape a running timer has (T4.9), so
       * the end is derived from the start and the duration through the shared
       * 2-of-3 helper — including the midnight crossing, where the entry keeps
       * the day it started on (D-8) and its end lands on the next one.
       */
      const derived = input.startClock
        ? deriveInterval({ start: input.startClock, durationMinutes: input.durationMinutes })
        : null
      const body = {
        staffMemberId: data.staffMemberId,
        date: input.date,
        timeProjectId: target.timeProjectId,
        taskId: target.taskId,
        durationMinutes: input.durationMinutes,
        startedAt: input.startClock ? combineDateAndClock(input.date, input.startClock) : undefined,
        endedAt:
          derived?.end != null
            ? combineDateAndClock(input.date, derived.end, derived.crossesMidnight ? 1 : 0)
            : undefined,
        source: 'manual',
      }
      try {
        await runMutation({
          operation: () =>
            createCrud(ENTRIES_API_PATH, body, {
              errorMessage: t('staff.timesheets.my.errors.save', 'Failed to save timesheets.'),
            }),
          context: {
            formId: MUTATION_CONTEXT_ID,
            resourceKind: 'staff.timesheets.time_entry',
            retryLastMutation,
          },
          mutationPayload: body as unknown as Record<string, unknown>,
        })
        await loadData()
      } catch (error) {
        logger.error('staff.time_tracking.timesheet quick add failed', { err: error })
        flash(t('staff.timesheets.my.errors.save', 'Failed to save timesheets.'), 'error')
      }
    },
    [data.staffMemberId, loadData, retryLastMutation, runMutation, t],
  )

  const handleDuplicate = React.useCallback(
    async (entry: TimesheetEntry) => {
      try {
        await runMutation({
          operation: () =>
            createCrud(`${ENTRIES_API_PATH}/${entry.id}/duplicate`, {}, {
              errorMessage: t('staff.time_tracking.entries.errors.duplicate', 'Could not duplicate the time entry.'),
            }),
          context: {
            formId: MUTATION_CONTEXT_ID,
            resourceKind: 'staff.timesheets.time_entry',
            retryLastMutation,
          },
          mutationPayload: { id: entry.id },
        })
        await loadData()
      } catch (error) {
        logger.error('staff.time_tracking.timesheet duplicate failed', { err: error })
        flash(t('staff.time_tracking.entries.errors.duplicate', 'Could not duplicate the time entry.'), 'error')
      }
    },
    [loadData, retryLastMutation, runMutation, t],
  )

  const handleVisibilityToggle = React.useCallback(
    async (project: TimesheetProjectRef, showInGrid: boolean) => {
      // optimistic-lock-exempt: this PATCH toggles the caller's own `showInGrid`
      // flag on the membership junction — per-user state with no second editor.
      const body = { showInGrid }
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow(`/api/staff/timesheets/my-projects/${project.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
          context: {
            formId: MUTATION_CONTEXT_ID,
            resourceKind: 'staff.timesheets.time_project_member',
            retryLastMutation,
          },
          mutationPayload: body,
        })
        await loadData()
      } catch (error) {
        logger.error('staff.time_tracking.timesheet grid visibility failed', { err: error })
        flash(t('staff.timesheets.my.addRow.error', 'Could not add the project. Please try again.'), 'error')
      }
    },
    [loadData, retryLastMutation, runMutation, t],
  )

  const handleRemoveProject = React.useCallback(
    async (project: TimesheetProjectRef) => {
      const confirmed = await confirm({
        title: t('staff.timesheets.my.removeRow', 'Remove from grid'),
        text: t(
          'staff.timesheets.my.removeRow.confirm',
          'Remove {projectName} from your timesheet grid? You can re-add it anytime via "+ Add row".',
        ).replace('{projectName}', project.name),
      })
      if (!confirmed) return
      await handleVisibilityToggle(project, false)
    },
    [confirm, handleVisibilityToggle, t],
  )

  if (isInitialLoad) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('staff.timesheets.my.loading', 'Loading timesheets...')} />
        </PageBody>
      </Page>
    )
  }

  if (data.staffMemberMissing) {
    return (
      <Page>
        <PageBody>
          <div className="py-12 text-center">
            <p className="text-lg font-semibold mb-2">
              {t('staff.timesheets.my.noProfile.title', 'Set up your profile to start tracking time')}
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              {t('staff.timesheets.my.noProfile', 'You need a Team Member profile to track time.')}
            </p>
            <Button asChild>
              <Link href="/backend/staff/profile/create">
                {t('staff.timesheets.my.createProfile', 'Create My Profile')}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <TimerBar
          projects={assignedProjects.map((project) => ({
            id: project.id,
            name: project.name,
            code: project.code,
            color: project.color,
          }))}
          staffMemberId={data.staffMemberId}
          onTimerStopped={() => {
            void loadData()
          }}
        />

        <div className="rounded-lg border bg-card">
          <div className="flex flex-col gap-3 border-b p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PeriodSelector
                periodKind={periodKind}
                anchorDate={anchorDate}
                onPeriodKindChange={handlePeriodKindChange}
                onAnchorDateChange={setAnchorDate}
              />
              {canManageOwn && viewingSelf ? (
                <Button type="button" onClick={() => openEntryDialog(todayIso(), null)}>
                  <Plus className="size-4" aria-hidden="true" />
                  {t('staff.time_tracking.entries.actions.add', 'Add entry')}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <TimesheetFilterSelect
                value={projectFilter}
                options={projectOptions}
                onChange={setProjectFilter}
                ariaLabel={t('staff.time_tracking.entries.filters.project', 'Project')}
                className="w-56"
              />
              <TimesheetFilterSelect
                value={personFilter}
                options={personOptions}
                onChange={setPersonFilter}
                ariaLabel={t('staff.time_tracking.timesheet.filters.person', 'Person')}
                className="w-44"
                disabled={personOptions.length <= 1}
              />
              <TimesheetViewSwitch
                view={view}
                views={viewsForPeriod(periodKind)}
                onViewChange={handleViewChange}
              />
            </div>
          </div>

          <div className={isRefreshing ? 'p-4 opacity-50 transition-opacity' : 'p-4 transition-opacity'}>
            {data.truncated ? (
              <p className="mb-3 text-xs text-muted-foreground">
                {t(
                  'staff.time_tracking.timesheet.truncated',
                  'Showing the first {count} entries of this period — narrow the period or the filters to see the rest.',
                  { count: String(MAX_ENTRY_PAGES * PAGE_SIZE) },
                )}
              </p>
            ) : null}

            {view === 'calendar' ? (
              <TimesheetCalendar
                monthAnchors={monthAnchors}
                days={dayIndex}
                scaleMinutes={scaleMinutes}
                todayDate={todayIso()}
                showMonthHeadings={monthAnchors.length > 1}
                onAddEntry={(date) => {
                  if (!canManageOwn || readOnly) return
                  openEntryDialog(date, null)
                }}
                onSelectEntry={(entry) => openEntryDialog(entry.date, entry.id)}
              />
            ) : null}

            {view === 'list' ? (
              <ListView
                days={days}
                scaleMinutes={scaleMinutes}
                dailyTargetMinutes={dailyTargetMinutes}
                expandedDate={expandedDate}
                onExpandedDateChange={(date) => {
                  setExpandedTouched(true)
                  setExpandedDate(date)
                }}
                targets={logTargets}
                showAuthor={!viewingSelf}
                authorNames={new Map(data.people.map((person) => [person.id, person.name]))}
                canManage={canManageOwn && !readOnly}
                onQuickAdd={handleQuickAdd}
                onEditEntry={(entry) => openEntryDialog(entry.date, entry.id)}
                onDuplicateEntry={(entry) => {
                  void handleDuplicate(entry)
                }}
              />
            ) : null}

            {view === 'grid' ? (
              <GridView
                days={eachDayIso(range)}
                projects={gridProjects}
                allAssignedProjects={assignedProjects}
                tasks={data.tasks}
                entries={data.entries}
                staffMemberId={data.staffMemberId}
                canManage={canManageOwn}
                canManageProjects={canManageProjects}
                readOnly={readOnly}
                rowMode={rowMode}
                onRowModeChange={setRowMode}
                onAddProject={(project) => handleVisibilityToggle(project, true)}
                onRemoveProject={handleRemoveProject}
                onCreateProject={() => setCreateDialogOpen(true)}
                onSaved={loadData}
              />
            ) : null}
          </div>

          <TimesheetPeriodFooter summary={summary} dailyHours={data.dailyHours} />
        </div>
      </PageBody>

      {ConfirmDialogElement}

      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onProjectCreated={() => {
          setCreateDialogOpen(false)
          void loadData()
        }}
      />

      <TimeEntryDialog
        open={entryDialog.open}
        onOpenChange={(open) => setEntryDialog((current) => ({ ...current, open }))}
        entryId={entryDialog.entryId}
        defaults={{ date: entryDialog.date }}
        onSaved={() => {
          void loadData()
        }}
      />
    </Page>
  )
}
