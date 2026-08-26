"use client"

/**
 * Screen 10 — the working list of time entries.
 *
 * The five notes on the mockup are the five decisions this page exists to make,
 * and none of them is decoration:
 *
 *  1. **The `Czas` cell edits in place** (US-D5). Correcting a duration is the
 *     single most common thing anybody does to a logged entry, so it costs one
 *     click, not a dialog round trip. The field is the shared `DurationInput`
 *     in its compact variant, so `1h 40m` means here exactly what it means in
 *     the entry dialog and the timesheet grid.
 *  2. **Delete is optimistic and reversible** (US-D5). The row leaves the table
 *     immediately and the platform's undo bar — fed by the `x-om-operation`
 *     header the command layer already attaches to the response — offers
 *     "Cofnij" for a few seconds. The restore is the command's own `undo`,
 *     never a row rebuilt from client state, which is why an entry restored
 *     this way comes back with its tags, its rounding and its audit trail
 *     intact. The page watches the operation store and refetches the moment its
 *     token is undone, so the row reappears from the server.
 *  3. **A rate override is visible on the row** (US-F2). Without the badge two
 *     rows with the same duration and different costs look like a bug.
 *  4. **A locked row is inert** (US-G3): no checkbox, no edit, no delete, a
 *     lock badge, and exactly one action — the report that froze it. Unlocking
 *     happens in the report (screen 15), not here.
 *  5. **`Koszt` is empty for a non-billable row, not `0,00`.** The list route
 *     already answers `null`; a zero would read as free work rather than as
 *     work that is out of scope.
 *
 * The page is also the landing spot for two deep links — the task drawer's
 * "show all entries" (`?taskId=`) and the entry dialog's jump to an overlapping
 * entry (`?ids=`). Either one replaces the default "my entries, this week"
 * seeding and shows up as a removable chip, because a list that quietly ignored
 * the link would answer a question nobody asked.
 *
 * Two things beyond the notes. Money columns exist only for a holder of
 * `staff.timesheets.rates.view` — the response has no `cost` for anybody else,
 * so the column is absent rather than blanked. And the footer never adds two
 * currencies together; see `summarizeTimeEntries`.
 */

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Copy, Lock, Plus } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import {
  EntryFilterChips,
  EntryFilterPresets,
  matchActivePreset,
  type AppliedFilterChip,
  type EntryFilterPreset,
} from '../../../../lib/time-tracking-ui/EntryFilterBar'
import {
  apiCall,
  apiCallOrThrow,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOperationStore } from '@open-mercato/ui/backend/operations/store'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { TimeEntryDialog } from '../../../../lib/time-tracking-ui/TimeEntryDialog'
import { TimeEntryDurationCell } from '../../../../lib/time-tracking-ui/TimeEntryDurationCell'
import { TimeEntriesSummaryFooter } from '../../../../lib/time-tracking-ui/TimeEntriesSummaryFooter'
import {
  collectDirectoryIds,
  currentWeekRange,
  formatEntryClockRange,
  formatEntryDay,
  isEntryLockedError,
  readCopyDayTargetConflict,
  summarizeTimeEntries,
  toTimeEntryListRow,
  type TimeEntryDirectory,
  type TimeEntryListRow,
} from '../../../../lib/time-tracking-ui/timeEntryListData'
import {
  readRowItems,
  shiftIsoDate,
  todayIsoDate,
  toProjectOption,
  toTaskOption,
} from '../../../../lib/time-tracking-ui/timeEntryDialogState'
import { formatDuration } from '../../../../lib/time-tracking/duration'

const logger = createLogger('staff').child({ component: 'time-tracking/entries' })

const PAGE_SIZE = 50
const DIRECTORY_PAGE_SIZE = 100
const ENTRIES_API_PATH = 'staff/timesheets/time-entries'
const ENTRIES_API = `/api/${ENTRIES_API_PATH}`
const RATES_FEATURE = 'staff.timesheets.rates.view'
const MANAGE_OWN_FEATURE = 'staff.timesheets.manage_own'
const MANAGE_ALL_FEATURE = 'staff.timesheets.manage_all'
/**
 * Query parameters other screens use to hand this list a question: the task
 * drawer's "show every entry for this task" (`?taskId=`) and the entry dialog's
 * jump to a conflicting entry (`?ids=`). Both are read once on mount and become
 * ordinary filter values, so they carry a removable chip like anything else.
 */
const DEEP_LINK_PARAMS = ['taskId', 'ids'] as const
const REPORTS_PATH = '/backend/staff/time-tracking/reports'
const MUTATION_CONTEXT_ID = 'staff.time_tracking.entriesList'
const RESOURCE_KIND = 'staff.timesheets.time_entry'

type EntriesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalIsCapped?: boolean
  totalPages?: number
}

type CopyDayResponse = {
  copied?: number
  toDate?: string
  created?: Array<Record<string, unknown>>
  skipped?: Array<Record<string, unknown>>
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

function readUndoToken(response: Response | null | undefined): string | null {
  const header = response?.headers?.get?.('x-om-operation') ?? null
  return deserializeOperationMetadata(header)?.undoToken ?? null
}

async function loadDirectory(
  taskIds: readonly string[],
  projectIds: readonly string[],
): Promise<TimeEntryDirectory> {
  const taskTitles = new Map<string, string>()
  const projectLabels = new Map<string, string>()
  const requests: Array<Promise<void>> = []

  if (taskIds.length > 0) {
    const params = new URLSearchParams({ page: '1', pageSize: String(DIRECTORY_PAGE_SIZE), ids: taskIds.join(',') })
    requests.push(
      readApiResultOrThrow<Record<string, unknown>>(`/api/staff/timesheets/tasks?${params.toString()}`, undefined, {
        allowNullResult: true,
      }).then((payload) => {
        for (const row of readRowItems(payload)) {
          const option = toTaskOption(row)
          if (option) taskTitles.set(option.id, option.title)
        }
      }),
    )
  }

  if (projectIds.length > 0) {
    const params = new URLSearchParams({
      page: '1',
      pageSize: String(DIRECTORY_PAGE_SIZE),
      ids: projectIds.join(','),
    })
    requests.push(
      readApiResultOrThrow<Record<string, unknown>>(
        `/api/staff/timesheets/time-projects?${params.toString()}`,
        undefined,
        { allowNullResult: true },
      ).then((payload) => {
        for (const row of readRowItems(payload)) {
          const option = toProjectOption(row)
          if (!option) continue
          projectLabels.set(option.id, option.customerName ? `${option.customerName} — ${option.name}` : option.name)
        }
      }),
    )
  }

  await Promise.all(requests)
  return { taskTitles, projectLabels }
}

export default function TimeTrackingEntriesPage() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload } = useBackendChrome()
  const canSeeMoney = hasFeature(payload?.grantedFeatures, RATES_FEATURE)
  const canManage = hasFeature(payload?.grantedFeatures, MANAGE_OWN_FEATURE)
  // Reading somebody else's entries is `manage_all`, not `manage_own`: the list
  // route narrows every other caller back to their own rows, so offering them a
  // person filter promises a lookup the server will answer with nothing.
  const canManageAll = hasFeature(payload?.grantedFeatures, MANAGE_ALL_FEATURE)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const deepLinkTaskId = searchParams?.get('taskId')?.trim() ?? ''
  const deepLinkEntryIds = searchParams?.get('ids')?.trim() ?? ''

  const defaultRange = React.useMemo(() => currentWeekRange(), [])
  const [filterValues, setFilterValues] = React.useState<FilterValues>(() => {
    // A deep link is the entire question the reader arrived with, so it replaces
    // the default week instead of being intersected with it — an entry logged
    // last month would otherwise be filtered straight back out of the list the
    // link exists to show.
    if (deepLinkTaskId) return { taskId: deepLinkTaskId }
    if (deepLinkEntryIds) return { ids: deepLinkEntryIds }
    return { period: { from: defaultRange.from, to: defaultRange.to } }
  })
  // The list opens on your own timesheet. Someone holding `manage_all` sees every
  // entry in the organization otherwise, which is a page about other people.
  const [selfStaffMemberId, setSelfStaffMemberId] = React.useState<string | null>(null)
  const [projectOptions, setProjectOptions] = React.useState<{ value: string; label: string }[]>([])
  const [customerOptions, setCustomerOptions] = React.useState<{ value: string; label: string }[]>([])
  const [tagOptions, setTagOptions] = React.useState<{ value: string; label: string }[]>([])
  const [peopleOptions, setPeopleOptions] = React.useState<{ value: string; label: string }[]>([])
  // A deep link also outranks the "my entries" seeding the self lookup performs
  // once it resolves; the entry being pointed at is frequently someone else's.
  const personSeededRef = React.useRef(Boolean(deepLinkTaskId || deepLinkEntryIds))
  const [page, setPage] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'date', desc: true }])
  const [rows, setRows] = React.useState<TimeEntryListRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [savingEntryId, setSavingEntryId] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogEntryId, setDialogEntryId] = React.useState<string | null>(null)
  const hasLoadedOnceRef = React.useRef(false)

  const labels = React.useMemo(
    () => ({
      title: t('staff.time_tracking.entries.title', 'Time entries'),
      add: t('staff.time_tracking.entries.actions.add', 'Add entry'),
      copyDay: t('staff.time_tracking.entries.actions.copyDay', 'Copy yesterday'),
      duplicate: t('staff.time_tracking.entries.actions.duplicate', 'Duplicate'),
      delete: t('staff.time_tracking.entries.actions.delete', 'Delete'),
      showReport: t('staff.time_tracking.entries.actions.showReport', 'Show the report'),
      refresh: t('staff.time_tracking.entries.actions.refresh', 'Refresh'),
      columns: {
        date: t('staff.time_tracking.entries.columns.date', 'Date'),
        task: t('staff.time_tracking.entries.columns.task', 'Task / description'),
        project: t('staff.time_tracking.entries.columns.project', 'Project'),
        clock: t('staff.time_tracking.entries.columns.clock', 'Hours'),
        duration: t('staff.time_tracking.entries.columns.duration', 'Time'),
        cost: t('staff.time_tracking.entries.columns.cost', 'Cost'),
      },
      selectAll: t('staff.time_tracking.entries.table.selectAll', 'Select all entries'),
      selectRow: t('staff.time_tracking.entries.table.selectRow', 'Select entry'),
      durationAria: t('staff.time_tracking.entries.table.durationAria', 'Entry duration'),
      noTask: t('staff.time_tracking.entries.table.noTask', 'No task'),
      empty: t('staff.time_tracking.entries.empty', 'No time entries in this period.'),
      badges: {
        locked: t('staff.time_tracking.entries.badges.locked', 'locked'),
        nonBillable: t('staff.time_tracking.entries.badges.nonBillable', 'non-billable'),
      },
      filters: {
        period: t('staff.time_tracking.entries.filters.period', 'Period'),
        project: t('staff.time_tracking.entries.filters.project', 'Project'),
        customer: t('staff.time_tracking.entries.filters.customer', 'Customer'),
        person: t('staff.time_tracking.entries.filters.person', 'Person'),
        tag: t('staff.time_tracking.entries.filters.tag', 'Tag'),
        billable: t('staff.time_tracking.entries.filters.billable', 'Billable'),
        billableYes: t('staff.time_tracking.entries.filters.billableYes', 'Billable only'),
        billableNo: t('staff.time_tracking.entries.filters.billableNo', 'Non-billable only'),
        locked: t('staff.time_tracking.entries.filters.locked', 'Report status'),
        lockedYes: t('staff.time_tracking.entries.filters.lockedYes', 'Locked in a report'),
        lockedNo: t('staff.time_tracking.entries.filters.lockedNo', 'Not yet reported'),
        text: t('staff.time_tracking.entries.filters.text', 'Description contains'),
        task: t('staff.time_tracking.entries.filters.task', 'Task'),
        entry: t('staff.time_tracking.entries.filters.entry', 'Entry'),
        entrySelection: t('staff.time_tracking.entries.filters.entrySelection', '{count} entries'),
        clearAll: t('staff.time_tracking.entries.filters.clearAll', 'Clear all'),
        remove: t('staff.time_tracking.entries.filters.remove', 'Remove filter {name}'),
      },
      presets: {
        mineWeek: t('staff.time_tracking.entries.presets.mineWeek', 'Mine, this week'),
        unbilled: t('staff.time_tracking.entries.presets.unbilled', 'Unbilled'),
        nonBillable: t('staff.time_tracking.entries.presets.nonBillable', 'Non-billable'),
        thisMonth: t('staff.time_tracking.entries.presets.thisMonth', 'This month'),
      },
      errors: {
        load: t('staff.time_tracking.entries.errors.load', 'Could not load the time entries.'),
        save: t('staff.time_tracking.entries.errors.save', 'Could not save the time entry.'),
        delete: t('staff.time_tracking.entries.errors.delete', 'Could not delete the time entry.'),
        duplicate: t('staff.time_tracking.entries.errors.duplicate', 'Could not duplicate the time entry.'),
        copyDay: t('staff.time_tracking.entries.errors.copyDay', 'Could not copy the day.'),
        locked: t(
          'staff.time_tracking.entries.errors.entryLocked',
          'This time entry is locked in a closed report and cannot be changed. Unlock the report first.',
        ),
      },
    }),
    [t],
  )

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const reportFailure = React.useCallback(
    (error: unknown, fallbackMessage: string, logTag: string) => {
      if (surfaceRecordConflict(error, t)) return
      if (isEntryLockedError(error)) {
        flash(labels.errors.locked, 'error')
        return
      }
      logger.error(logTag, { err: error })
      flash(error instanceof Error && error.message ? error.message : fallbackMessage, 'error')
    },
    [labels.errors.locked, t],
  )

  const period = (filterValues.period ?? {}) as { from?: string; to?: string }
  const projectFilter = typeof filterValues.projectId === 'string' ? filterValues.projectId : ''

  // Filter vocabularies come from the API, not from the rows on screen: options
  // built from the loaded page can only narrow to what you can already see, which
  // makes the filter useless for finding anything that is not in front of you.
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      // `Promise.resolve` rather than `.catch` directly: a filter vocabulary that
      // fails to load must leave the page usable with a shorter list, and the
      // wrapper also tolerates a stub that returns nothing.
      const safeCall = async <T,>(url: string) => {
        try {
          return (await Promise.resolve(apiCall<T>(url))) ?? null
        } catch {
          return null
        }
      }
      const [selfRes, projectsRes, tagsRes, peopleRes] = await Promise.all([
        safeCall<{ member?: { id?: string } | null }>('/api/staff/team-members/self'),
        safeCall<{ items?: Array<Record<string, unknown>> }>('/api/staff/timesheets/time-projects?page=1&pageSize=100'),
        safeCall<{ items?: Array<Record<string, unknown>> }>('/api/staff/timesheets/tags?page=1&pageSize=100'),
        safeCall<{ items?: Array<Record<string, unknown>> }>('/api/staff/team-members?page=1&pageSize=100'),
      ])
      if (cancelled) return

      const selfId = selfRes?.ok ? (selfRes.result?.member?.id ?? null) : null
      if (selfId) {
        setSelfStaffMemberId(selfId)
        if (!personSeededRef.current) {
          personSeededRef.current = true
          setFilterValues((prev) => ({ ...prev, staffMemberId: selfId }))
        }
      }

      const projects = projectsRes?.ok && Array.isArray(projectsRes.result?.items) ? projectsRes.result.items : []
      const customers = new Map<string, string>()
      setProjectOptions(
        projects
          .map((row: Record<string, unknown>) => {
            const id = typeof row.id === 'string' ? row.id : null
            if (!id) return null
            const name = typeof row.name === 'string' ? row.name : id
            const code = typeof row.code === 'string' ? row.code : null
            const customerId = typeof row.customer_id === 'string' ? row.customer_id : null
            const snapshot = row.customer_snapshot as { name?: unknown } | null | undefined
            if (customerId && typeof snapshot?.name === 'string') customers.set(customerId, snapshot.name)
            return { value: id, label: code ? `${code} · ${name}` : name }
          })
          .filter((option): option is { value: string; label: string } => option !== null),
      )
      setCustomerOptions([...customers].map(([value, label]) => ({ value, label })))

      const tags = tagsRes?.ok && Array.isArray(tagsRes.result?.items) ? tagsRes.result.items : []
      setTagOptions(
        tags
          .map((row: Record<string, unknown>) => {
            const id = typeof row.id === 'string' ? row.id : null
            const label = typeof row.label === 'string' ? row.label : null
            return id && label ? { value: id, label } : null
          })
          .filter((option): option is { value: string; label: string } => option !== null),
      )

      const people = peopleRes?.ok && Array.isArray(peopleRes.result?.items) ? peopleRes.result.items : []
      setPeopleOptions(
        people
          .map((row: Record<string, unknown>) => {
            const id = typeof row.id === 'string' ? row.id : null
            const label = typeof row.display_name === 'string'
              ? row.display_name
              : typeof row.displayName === 'string'
                ? row.displayName
                : null
            return id && label ? { value: id, label } : null
          })
          .filter((option): option is { value: string; label: string } => option !== null),
      )
    })()
    return () => { cancelled = true }
  }, [scopeVersion])

  const presets = React.useMemo<EntryFilterPreset[]>(
    () => [
      {
        id: 'mine-week',
        label: labels.presets.mineWeek,
        build: ({ staffMemberId }) => ({
          period: { from: defaultRange.from, to: defaultRange.to },
          ...(staffMemberId ? { staffMemberId } : {}),
        }),
      },
      {
        id: 'unbilled',
        label: labels.presets.unbilled,
        build: () => ({ locked: 'false', billable: 'true' }),
      },
      { id: 'non-billable', label: labels.presets.nonBillable, build: () => ({ billable: 'false' }) },
      {
        id: 'this-month',
        label: labels.presets.thisMonth,
        build: ({ today }) => {
          const start = `${today.slice(0, 7)}-01`
          return { period: { from: start, to: today } }
        },
      },
    ],
    [defaultRange.from, defaultRange.to, labels.presets],
  )

  const presetContext = React.useMemo(
    () => ({ staffMemberId: selfStaffMemberId, today: new Date().toISOString().slice(0, 10) }),
    [selfStaffMemberId],
  )
  const activePresetId = React.useMemo(
    () => matchActivePreset(filterValues, presets, presetContext),
    [filterValues, presetContext, presets],
  )

  const applyPreset = React.useCallback(
    (preset: EntryFilterPreset) => {
      // A preset is a starting point, not a mode: it replaces what it sets and
      // leaves the rest, so narrowing further does not mean rebuilding it.
      setFilterValues((current) => ({ ...current, ...preset.build(presetContext) }))
      setPage(1)
    },
    [presetContext],
  )

  /**
   * A deep-link filter lives in two places — the filter state and the address
   * bar — so dropping the chip has to drop the parameter too, otherwise the next
   * render (or a reload) puts the narrowing straight back.
   */
  const dropDeepLinkParams = React.useCallback(
    (ids: readonly string[]) => {
      if (!searchParams) return
      const next = new URLSearchParams(searchParams.toString())
      let changed = false
      for (const id of ids) {
        if (!next.has(id)) continue
        next.delete(id)
        changed = true
      }
      if (!changed) return
      const query = next.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    },
    [pathname, router, searchParams],
  )

  const removeChip = React.useCallback(
    (id: string) => {
      setFilterValues((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setPage(1)
      dropDeepLinkParams([id])
    },
    [dropDeepLinkParams],
  )

  const clearAllFilters = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
    dropDeepLinkParams(DEEP_LINK_PARAMS)
  }, [dropDeepLinkParams])

  const loadEntries = React.useCallback(async () => {
    if (hasLoadedOnceRef.current) setIsRefreshing(true)
    else setIsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      const sort = sorting[0]
      params.set('sortField', sort?.id ?? 'date')
      params.set('sortDir', sort?.desc === false ? 'asc' : 'desc')
      if (period.from) params.set('from', period.from)
      if (period.to) params.set('to', period.to)
      if (projectFilter) params.set('projectId', projectFilter)
      const readFilter = (key: string): string =>
        typeof filterValues[key] === 'string' ? (filterValues[key] as string) : ''
      const person = readFilter('staffMemberId')
      if (person) params.set('staffMemberId', person)
      const billable = readFilter('billable')
      if (billable) params.set('billable', billable)
      const lockedFilter = readFilter('locked')
      if (lockedFilter) params.set('locked', lockedFilter)
      const customer = readFilter('customerId')
      if (customer) params.set('customerId', customer)
      const tag = readFilter('tagIds')
      if (tag) params.set('tagIds', tag)
      const text = readFilter('q')
      if (text.trim()) params.set('q', text.trim())
      const taskFilter = readFilter('taskId')
      if (taskFilter) params.set('taskId', taskFilter)
      const entryIdsFilter = readFilter('ids')
      if (entryIdsFilter) params.set('ids', entryIdsFilter)

      const listPayload = await readApiResultOrThrow<EntriesResponse>(
        `${ENTRIES_API}?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(listPayload.items) ? listPayload.items : []
      const bare = items
        .map((item) => toTimeEntryListRow(item))
        .filter((row): row is TimeEntryListRow => row !== null)
      const { taskIds, projectIds } = collectDirectoryIds(bare)
      let directory: TimeEntryDirectory = { taskTitles: new Map(), projectLabels: new Map() }
      try {
        directory = await loadDirectory(taskIds, projectIds)
      } catch (error) {
        logger.warn('staff.time_tracking.entries directory load failed', { err: error })
      }
      setRows(
        items
          .map((item) => toTimeEntryListRow(item, directory))
          .filter((row): row is TimeEntryListRow => row !== null),
      )
      setTotal(typeof listPayload.total === 'number' ? listPayload.total : items.length)
      setTotalIsCapped(listPayload.totalIsCapped === true)
      setTotalPages(
        typeof listPayload.totalPages === 'number'
          ? listPayload.totalPages
          : Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
      )
    } catch (error) {
      logger.error('staff.time_tracking.entries list failed', { err: error })
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
      hasLoadedOnceRef.current = true
    }
  }, [labels.errors.load, page, period.from, period.to, projectFilter, sorting, filterValues])

  React.useEffect(() => {
    void loadEntries()
  }, [loadEntries, scopeVersion, reloadToken])

  React.useEffect(() => {
    setSelectedIds([])
  }, [page, period.from, period.to, projectFilter, scopeVersion])

  /**
   * Note 2's other half. The undo bar is AppShell's, so the click that restores
   * an entry never reaches this page — the operation store is what does. When a
   * token this page deleted shows up in the store's `undone` list the row is
   * back on the server, so the list is refetched rather than reconstructed.
   */
  const undoneTokens = useOperationStore((state) => state.undone.map((entry) => entry.undoToken).join('|'))
  const pendingUndoTokensRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    if (pendingUndoTokensRef.current.size === 0) return
    const undone = new Set(undoneTokens.split('|').filter(Boolean))
    let restored = false
    for (const token of Array.from(pendingUndoTokensRef.current)) {
      if (!undone.has(token)) continue
      pendingUndoTokensRef.current.delete(token)
      restored = true
    }
    if (restored) handleRefresh()
  }, [handleRefresh, undoneTokens])

  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: labels.errors.save,
  })

  const mutationContext = React.useCallback(
    (resourceId: string): MutationContext => ({
      formId: MUTATION_CONTEXT_ID,
      resourceKind: RESOURCE_KIND,
      resourceId,
      retryLastMutation,
    }),
    [retryLastMutation],
  )

  const handleDurationCommit = React.useCallback(
    async (entry: TimeEntryListRow, durationMinutes: number) => {
      setSavingEntryId(entry.id)
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(entry.updatedAt), () =>
              updateCrud(
                ENTRIES_API_PATH,
                { id: entry.id, durationMinutes },
                { errorMessage: labels.errors.save },
              ),
            ),
          context: mutationContext(entry.id),
          mutationPayload: { id: entry.id, durationMinutes },
        })
        handleRefresh()
      } catch (error) {
        reportFailure(error, labels.errors.save, 'staff.time_tracking.entries inline duration save failed')
        handleRefresh()
      } finally {
        setSavingEntryId(null)
      }
    },
    [handleRefresh, labels.errors.save, mutationContext, reportFailure, runMutation],
  )

  const handleDelete = React.useCallback(
    async (entry: TimeEntryListRow) => {
      const previousRows = rows
      setRows((current) => current.filter((row) => row.id !== entry.id))
      setTotal((current) => Math.max(0, current - 1))
      setSelectedIds((current) => current.filter((id) => id !== entry.id))
      try {
        const call = await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(entry.updatedAt), () =>
              deleteCrud(ENTRIES_API_PATH, entry.id, { errorMessage: labels.errors.delete }),
            ),
          context: mutationContext(entry.id),
          mutationPayload: { id: entry.id },
        })
        const undoToken = readUndoToken(call.response)
        if (undoToken) pendingUndoTokensRef.current.add(undoToken)
        flash(
          t('staff.time_tracking.entries.messages.deleted', 'Deleted “{name}” ({duration}). Use Undo to restore it.', {
            name: entry.taskTitle ?? entry.description ?? labels.noTask,
            duration: formatDuration(entry.durationMinutes, 'clock'),
          }),
          'success',
        )
      } catch (error) {
        setRows(previousRows)
        setTotal((current) => current + 1)
        reportFailure(error, labels.errors.delete, 'staff.time_tracking.entries delete failed')
      }
    },
    [labels.errors.delete, labels.noTask, mutationContext, reportFailure, rows, runMutation, t],
  )

  const handleDuplicate = React.useCallback(
    async (entry: TimeEntryListRow) => {
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow<Record<string, unknown>>(
              `${ENTRIES_API}/${encodeURIComponent(entry.id)}/duplicate`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ tagIds: entry.tagIds }),
              },
              { errorMessage: labels.errors.duplicate },
            ),
          context: mutationContext(entry.id),
          mutationPayload: { id: entry.id },
        })
        flash(t('staff.time_tracking.entries.messages.duplicated', 'Entry duplicated.'), 'success')
        handleRefresh()
      } catch (error) {
        reportFailure(error, labels.errors.duplicate, 'staff.time_tracking.entries duplicate failed')
      }
    },
    [handleRefresh, labels.errors.duplicate, mutationContext, reportFailure, runMutation, t],
  )

  /**
   * "Kopiuj wczorajszy dzień" (screen 1 note 5). The copies are drafts to
   * review, so on success the period narrows to the target day: the user lands
   * on exactly the rows that were created instead of hunting for them.
   *
   * A non-empty target day answers `409 copy_day_target_not_empty` naming what
   * is already there. That is a question, not a dead end — the user is told the
   * count and offered the `allowDuplicates` path, which is the real case the
   * refusal would otherwise block (something already logged today, and
   * yesterday's set wanted on top).
   */
  const runCopyDay = React.useCallback(
    async (fromDate: string, toDate: string, allowDuplicates: boolean) =>
      runMutation({
        operation: () =>
          apiCallOrThrow<CopyDayResponse>(
            `${ENTRIES_API}/copy-day`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ fromDate, toDate, allowDuplicates }),
            },
            { errorMessage: labels.errors.copyDay },
          ),
        context: mutationContext(toDate),
        mutationPayload: { fromDate, toDate, allowDuplicates },
      }),
    [labels.errors.copyDay, mutationContext, runMutation],
  )

  const handleCopyDay = React.useCallback(async () => {
    const toDate = todayIsoDate()
    const fromDate = shiftIsoDate(toDate, -1)
    const announce = (result: CopyDayResponse | null) => {
      const copied = typeof result?.copied === 'number' ? result.copied : 0
      const skipped = Array.isArray(result?.skipped) ? result.skipped.length : 0
      if (copied === 0) {
        flash(t('staff.time_tracking.entries.copyDay.nothing', 'Yesterday has no entries to copy.'), 'info')
      } else {
        flash(
          t('staff.time_tracking.entries.copyDay.success', '{count} entries copied as drafts — review them.', {
            count: copied,
          }),
          'success',
        )
        setFilterValues((current) => ({ ...current, period: { from: toDate, to: toDate } }))
        setPage(1)
      }
      if (skipped > 0) {
        flash(
          t('staff.time_tracking.entries.copyDay.skipped', '{count} entries were skipped because they are locked.', {
            count: skipped,
          }),
          'warning',
        )
      }
      handleRefresh()
    }

    try {
      const call = await runCopyDay(fromDate, toDate, false)
      announce(call.result)
    } catch (error) {
      const conflict = readCopyDayTargetConflict(error)
      if (!conflict) {
        reportFailure(error, labels.errors.copyDay, 'staff.time_tracking.entries copy-day failed')
        return
      }
      const confirmed = await confirm({
        title: labels.copyDay,
        text: t(
          'staff.time_tracking.entries.copyDay.conflict',
          'Today already has {count} entries. Add yesterday’s copies on top of them?',
          { count: conflict.existingEntryCount },
        ),
        confirmText: t('staff.time_tracking.entries.copyDay.confirmDuplicates', 'Add copies anyway'),
      })
      if (!confirmed) return
      try {
        const retry = await runCopyDay(fromDate, toDate, true)
        announce(retry.result)
      } catch (retryError) {
        reportFailure(retryError, labels.errors.copyDay, 'staff.time_tracking.entries copy-day retry failed')
      }
    }
  }, [confirm, handleRefresh, labels.copyDay, labels.errors.copyDay, reportFailure, runCopyDay, t])

  const openCreate = React.useCallback(() => {
    setDialogEntryId(null)
    setDialogOpen(true)
  }, [])

  const openEdit = React.useCallback((entryId: string) => {
    setDialogEntryId(entryId)
    setDialogOpen(true)
  }, [])

  const selectableRows = React.useMemo(() => rows.filter((row) => !row.isLocked), [rows])
  const allSelected = selectableRows.length > 0 && selectedIds.length === selectableRows.length
  const someSelected = selectedIds.length > 0 && !allSelected

  const toggleRowSelection = React.useCallback((id: string, checked: boolean) => {
    setSelectedIds((current) => (checked ? Array.from(new Set([...current, id])) : current.filter((value) => value !== id)))
  }, [])

  const toggleAllSelection = React.useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? selectableRows.map((row) => row.id) : [])
    },
    [selectableRows],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      { id: 'period', label: labels.filters.period, type: 'dateRange' },
      { id: 'projectId', label: labels.filters.project, type: 'select', options: projectOptions },
      { id: 'customerId', label: labels.filters.customer, type: 'select', options: customerOptions },
      // Only offered when the caller can actually see somebody else's time; for
      // everyone else the route already scopes to their own entries and the
      // control would be a lever attached to nothing.
      ...(canManageAll && peopleOptions.length > 1
        ? [{ id: 'staffMemberId', label: labels.filters.person, type: 'select' as const, options: peopleOptions }]
        : []),
      { id: 'tagIds', label: labels.filters.tag, type: 'select', options: tagOptions },
      {
        id: 'billable',
        label: labels.filters.billable,
        type: 'select',
        options: [
          { value: 'true', label: labels.filters.billableYes },
          { value: 'false', label: labels.filters.billableNo },
        ],
      },
      {
        id: 'locked',
        label: labels.filters.locked,
        type: 'select',
        options: [
          { value: 'true', label: labels.filters.lockedYes },
          { value: 'false', label: labels.filters.lockedNo },
        ],
      },
      { id: 'q', label: labels.filters.text, type: 'text' },
    ],
    [labels.filters, canManageAll, projectOptions, customerOptions, peopleOptions, tagOptions],
  )

  /**
   * Filters that can be applied but own no control in the overlay: the self
   * filter, which is seeded for everyone but only steerable by a `manage_all`
   * holder, and the two deep-link narrowings. Naming them here is what keeps
   * their chips reading as words instead of as a parameter name and a uuid.
   */
  const unlistedFilters = React.useMemo<FilterDef[]>(
    () => [
      { id: 'staffMemberId', label: labels.filters.person, type: 'select', options: peopleOptions },
      { id: 'taskId', label: labels.filters.task, type: 'text' },
      { id: 'ids', label: labels.filters.entry, type: 'text' },
    ],
    [labels.filters, peopleOptions],
  )

  /** Applied filters, as the reader would say them out loud. */
  const appliedChips = React.useMemo<AppliedFilterChip[]>(() => {
    const defOf = (id: string) =>
      filters.find((filter) => filter.id === id) ?? unlistedFilters.find((filter) => filter.id === id)
    const label = (id: string) => defOf(id)?.label ?? id
    const optionLabel = (id: string, value: string) =>
      defOf(id)?.options?.find((option) => option.value === value)?.label ?? value
    const chips: AppliedFilterChip[] = []
    for (const [id, raw] of Object.entries(filterValues)) {
      if (raw === undefined || raw === null || raw === '') continue
      if (id === 'period') {
        const range = raw as { from?: string; to?: string }
        if (!range?.from && !range?.to) continue
        chips.push({ id, label: label(id), value: `${range.from ?? '…'} → ${range.to ?? '…'}` })
        continue
      }
      if (typeof raw !== 'string') continue
      // A deep link arrives as an id, so its chip reads the loaded rows back for
      // the task or the entry it names — a uuid on a chip explains nothing.
      if (id === 'taskId') {
        const first = raw.split(',')[0] ?? raw
        const match = rows.find((row) => row.taskId === first)
        chips.push({ id, label: label(id), value: match?.taskTitle ?? first })
        continue
      }
      if (id === 'ids') {
        const list = raw.split(',').map((value) => value.trim()).filter(Boolean)
        if (list.length === 0) continue
        const single = list.length === 1 ? rows.find((row) => row.id === list[0]) : undefined
        chips.push({
          id,
          label: label(id),
          value: single
            ? (single.taskTitle ?? single.description ?? labels.noTask)
            : labels.filters.entrySelection.replace('{count}', String(list.length)),
        })
        continue
      }
      chips.push({ id, label: label(id), value: optionLabel(id, raw) })
    }
    return chips
  }, [filterValues, filters, labels.filters.entrySelection, labels.noTask, rows, unlistedFilters])

  const columns = React.useMemo<ColumnDef<TimeEntryListRow>[]>(() => {
    const rightHeader = (label: string) => () => <span className="block text-right">{label}</span>
    const defs: ColumnDef<TimeEntryListRow>[] = []

    if (canManage) {
      defs.push({
        id: 'select',
        accessorKey: 'id',
        header: () => (
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(checked) => toggleAllSelection(Boolean(checked))}
            aria-label={labels.selectAll}
          />
        ),
        enableSorting: false,
        meta: { priority: 1 },
        cell: ({ row }) =>
          row.original.isLocked ? null : (
            <Checkbox
              checked={selectedIds.includes(row.original.id)}
              onCheckedChange={(checked) => toggleRowSelection(row.original.id, Boolean(checked))}
              onClick={(event) => event.stopPropagation()}
              aria-label={labels.selectRow}
            />
          ),
      })
    }

    defs.push({
      accessorKey: 'date',
      header: labels.columns.date,
      meta: { priority: 1 },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {formatEntryDay(row.original.date)}
        </span>
      ),
    })

    defs.push({
      id: 'task',
      accessorKey: 'taskTitle',
      header: labels.columns.task,
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => {
        const entry = row.original
        const rateOverrideLabel =
          canSeeMoney && entry.rateOverrideAmount !== null
            ? formatCurrency(entry.rateOverrideAmount, entry.currencyCode) ?? String(entry.rateOverrideAmount)
            : null
        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {entry.taskTitle ?? labels.noTask}
              </span>
              {!entry.isBillable ? (
                <StatusBadge variant="neutral">{labels.badges.nonBillable}</StatusBadge>
              ) : null}
              {rateOverrideLabel ? (
                <span data-testid="entry-rate-override">
                  <StatusBadge variant="info">
                    {t('staff.time_tracking.entries.badges.rateOverride', '{amount}/h', { amount: rateOverrideLabel })}
                  </StatusBadge>
                </span>
              ) : null}
              {entry.isLocked ? (
                <span data-testid="entry-locked-badge">
                  <StatusBadge variant="neutral">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    {labels.badges.locked}
                  </StatusBadge>
                </span>
              ) : null}
            </div>
            {entry.description ? (
              <span className="truncate text-xs text-muted-foreground">{entry.description}</span>
            ) : null}
          </div>
        )
      },
    })

    defs.push({
      id: 'project',
      accessorKey: 'projectLabel',
      header: labels.columns.project,
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) =>
        row.original.projectLabel ? (
          <span className="truncate text-sm text-muted-foreground">{row.original.projectLabel}</span>
        ) : (
          <span className="text-xs text-muted-foreground/70">—</span>
        ),
    })

    defs.push({
      id: 'clock',
      accessorKey: 'startText',
      header: labels.columns.clock,
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => {
        const range = formatEntryClockRange(row.original)
        return range ? (
          <span className="whitespace-nowrap font-mono text-sm tabular-nums text-muted-foreground">{range}</span>
        ) : (
          <span className="text-xs text-muted-foreground/70">—</span>
        )
      },
    })

    defs.push({
      id: 'durationMinutes',
      accessorKey: 'durationMinutes',
      header: rightHeader(labels.columns.duration),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <TimeEntryDurationCell
          value={row.original.durationMinutes}
          readOnly={row.original.isLocked || !canManage}
          saving={savingEntryId === row.original.id}
          ariaLabel={labels.durationAria}
          lockedTitle={row.original.isLocked ? labels.errors.locked : undefined}
          onCommit={(minutes) => handleDurationCommit(row.original, minutes)}
        />
      ),
    })

    if (canSeeMoney) {
      defs.push({
        id: 'cost',
        accessorKey: 'cost',
        header: rightHeader(labels.columns.cost),
        enableSorting: false,
        meta: { priority: 4 },
        cell: ({ row }) => {
          const formatted =
            row.original.cost === null ? null : formatCurrency(row.original.cost, row.original.currencyCode)
          return formatted ? (
            <span
              className="block text-right font-mono text-sm tabular-nums text-foreground"
              data-testid="entry-cost"
            >
              {formatted}
            </span>
          ) : (
            <span className="block text-right text-xs text-muted-foreground/70" data-testid="entry-cost-empty">
              —
            </span>
          )
        },
      })
    }

    return defs
  }, [
    allSelected,
    canManage,
    canSeeMoney,
    handleDurationCommit,
    labels,
    savingEntryId,
    selectedIds,
    someSelected,
    t,
    toggleAllSelection,
    toggleRowSelection,
  ])

  const summary = React.useMemo(() => summarizeTimeEntries(rows), [rows])

  return (
    <Page>
      <PageBody>
        <DataTable<TimeEntryListRow>
          extensionTableId={extensionPoints.hosts.timeEntriesTable.tableId}
          title={labels.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            setFilterValues(values)
            setPage(1)
            // The overlay does not carry the deep-link filters, so applying it
            // drops them — the address bar has to agree with what is on screen.
            dropDeepLinkParams(DEEP_LINK_PARAMS.filter((id) => !values[id]))
          }}
          onFiltersClear={clearAllFilters}
          activeFilterChips={
            <div className="flex flex-col gap-2">
              <EntryFilterPresets
                presets={presets}
                activePresetId={activePresetId}
                onApplyPreset={applyPreset}
              />
              <EntryFilterChips
                chips={appliedChips}
                onRemove={removeChip}
                onClearAll={clearAllFilters}
                clearAllLabel={labels.filters.clearAll}
                removeLabel={(name) => labels.filters.remove.replace('{name}', name)}
              />
            </div>
          }
          filterAwareEmptyState={{
            active: appliedChips.length > 0,
            entityNamePlural: labels.title,
            canRemoveLast: appliedChips.length > 0,
            onClearAll: clearAllFilters,
            onRemoveLast: () => {
              const last = appliedChips[appliedChips.length - 1]
              if (last) removeChip(last.id)
            },
          }}
          emptyState={<div className="py-12 text-center text-sm text-muted-foreground">{labels.empty}</div>}
          actions={
            canManage ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void handleCopyDay()}>
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {labels.copyDay}
                </Button>
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {labels.add}
                </Button>
              </div>
            ) : undefined
          }
          refreshButton={{
            label: labels.refresh,
            onRefresh: handleRefresh,
            isRefreshing: isLoading || isRefreshing,
          }}
          sortable
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalIsCapped,
            totalPages,
            onPageChange: setPage,
          }}
          stickyActionsColumn
          rowActions={(row) =>
            row.isLocked ? (
              <RowActions
                items={[
                  {
                    id: 'show-report',
                    label: labels.showReport,
                    href: row.lockedReportId
                      ? `${REPORTS_PATH}?id=${encodeURIComponent(row.lockedReportId)}`
                      : REPORTS_PATH,
                  },
                ]}
              />
            ) : canManage ? (
              <RowActions
                items={[
                  {
                    id: 'duplicate',
                    label: labels.duplicate,
                    onSelect: () => {
                      void handleDuplicate(row)
                    },
                  },
                  {
                    id: 'delete',
                    label: labels.delete,
                    destructive: true,
                    onSelect: () => {
                      void handleDelete(row)
                    },
                  },
                ]}
              />
            ) : null
          }
          onRowClick={(row) => {
            if (row.isLocked) return
            openEdit(row.id)
          }}
        />

        <TimeEntriesSummaryFooter summary={summary} totalCount={total} canSeeMoney={canSeeMoney} />

        {!canManage ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('staff.time_tracking.entries.readOnlyNotice', 'You can view these entries but not change them.')}
          </p>
        ) : null}
      </PageBody>

      <TimeEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entryId={dialogEntryId}
        onSaved={({ keptOpen }) => {
          handleRefresh()
          if (!keptOpen) setDialogOpen(false)
        }}
        onShowEntry={(entryId) => openEdit(entryId)}
      />
      {ConfirmDialogElement}
    </Page>
  )
}
