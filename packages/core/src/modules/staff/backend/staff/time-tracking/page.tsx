"use client"

/**
 * Screen 1 — My work, the Team Member's landing page (T5.6).
 *
 * Everything on it comes from one request (`GET …/timesheets/my-work`), so the
 * four KPIs, today's entries and the project budget bars can never disagree with
 * each other the way six independent list calls could.
 *
 * The mockup's five notes:
 *
 *  1. The running-timer pill lives in the top bar and is contributed by the
 *     `timer-sidebar-indicator` injection widget, not by this page.
 *  2. **TL-only navigation is absent, not disabled** — the sidebar is built from
 *     page metadata whose `requireFeatures` are evaluated per user, so a TM never
 *     receives the Projects / Reports / Settings entries at all (confirmed at
 *     `nav.ts`: an unmet feature `continue`s past the entry).
 *  3. The quick-entry row uses the same duration parser as the rest of the module
 *     and saves with `⌘↵`.
 *  4. Budget bars come from the project's own budget; a project without one shows
 *     hours and no bar. An `amount` budget is money, so it is absent for a caller
 *     without `staff.timesheets.rates.view` rather than rendered at zero.
 *  5. "Copy yesterday" duplicates the previous day's entries as drafts to correct
 *     (US-D6), and reports what it skipped — a locked entry is skipped, never
 *     silently dropped.
 *
 * Screen 2 (no assignments) is the same page with `projects: []`: it renders
 * `NoTimeProjectAssignments`, which already carries the copy and the single
 * available action.
 */

import * as React from 'react'
import Link from 'next/link'
import { CalendarDays, Copy, Lock, Pencil, Plus } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { hasFeature } from '@open-mercato/shared/security/features'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DurationInput } from '../../../lib/time-tracking-ui/DurationInput'
import {
  EntryDetailsFields,
  emptyEntryDetails,
  type EntryDetailsValue,
} from '../../../lib/time-tracking-ui/EntryDetailsFields'
import { buildEntryClocks } from '../../../lib/time-tracking-ui/taskDrawerData'
import { slugifyProjectName } from '../../../lib/time-tracking/projectCode'
import type { TagOption } from '../../../lib/time-tracking-ui/timeEntryDialogState'
import { TimeEntryDialog } from '../../../lib/time-tracking-ui/TimeEntryDialog'
import { NoTimeProjectAssignments } from '../../../lib/time-tracking-ui/NoProjectAccess'
import { formatDuration } from '../../../lib/time-tracking/duration'
import { formatLongDayLabel, todayIso } from '../../../lib/time-tracking-ui/timesheetPeriod'
import { buildLogTargets, parseTargetKey, targetLabel } from '../../../lib/time-tracking-ui/timesheetTargets'
import { isEntryLockedError } from '../../../lib/time-tracking-ui/timeEntryListData'

const logger = createLogger('staff').child({ component: 'time-tracking/my-work' })

const MY_WORK_ENDPOINT = '/api/staff/timesheets/my-work'
const ENTRIES_API_PATH = 'staff/timesheets/time-entries'
const MANAGE_OWN_FEATURE = 'staff.timesheets.manage_own'
const MUTATION_CONTEXT_ID = 'staff.time_tracking.myWork'
const TIMESHEET_HREF = '/backend/staff/time-tracking/timesheet'
const ENTRIES_HREF = '/backend/staff/time-tracking/entries'

type MyWorkEntry = {
  id: string
  date: string
  taskId: string | null
  taskTitle: string | null
  timeProjectId: string | null
  projectName: string | null
  description: string | null
  startedAt: string | null
  endedAt: string | null
  durationMinutes: number
  isBillable: boolean
  isLocked: boolean
}

type MyWorkProject = {
  id: string
  name: string
  code: string | null
  color: string | null
  customerName: string | null
  myMinutes: number
  totalMinutes: number
  hourlyRate?: number | null
  currencyCode?: string | null
  budget: {
    kind: 'hours' | 'amount'
    budgetValue: number
    usedValue: number
    percent: number
    barPercent: number
    tone: string
  } | null
}

type MyWorkTask = {
  id: string
  title: string
  timeProjectId: string
  projectName: string | null
}

type MyWorkPayload = {
  staffMember: { id: string; displayName: string } | null
  today: string
  kpis: {
    todayMinutes: number
    weekMinutes: number
    monthMinutes: number
    monthNonBillableMinutes: number
    dailyTargetMinutes: number | null
    weekTargetMinutes: number | null
    monthTargetMinutes: number | null
    weekWorkingDays: number
    monthWorkingDays: number
    nonBillableSharePercent: number | null
  }
  entries: MyWorkEntry[]
  projects: MyWorkProject[]
  recentTasks: MyWorkTask[]
}

const EMPTY_PAYLOAD: MyWorkPayload = {
  staffMember: null,
  today: todayIso(),
  kpis: {
    todayMinutes: 0,
    weekMinutes: 0,
    monthMinutes: 0,
    monthNonBillableMinutes: 0,
    dailyTargetMinutes: null,
    weekTargetMinutes: null,
    monthTargetMinutes: null,
    weekWorkingDays: 0,
    monthWorkingDays: 0,
    nonBillableSharePercent: null,
  },
  entries: [],
  projects: [],
  recentTasks: [],
}

function formatClockRange(entry: MyWorkEntry, locale?: string): string | null {
  if (!entry.startedAt || !entry.endedAt) return null
  const format = (iso: string) => {
    const parsed = new Date(iso)
    if (Number.isNaN(parsed.getTime())) return ''
    try {
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(parsed)
    } catch {
      return ''
    }
  }
  const start = format(entry.startedAt)
  const end = format(entry.endedAt)
  return start && end ? `${start} – ${end}` : null
}

export default function TimeTrackingMyWorkPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chrome } = useBackendChrome()
  const canManageOwn = hasFeature(chrome?.grantedFeatures, MANAGE_OWN_FEATURE)

  const [data, setData] = React.useState<MyWorkPayload>(EMPTY_PAYLOAD)
  const [loadState, setLoadState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [dialog, setDialog] = React.useState<{ open: boolean; entryId: string | null }>({
    open: false,
    entryId: null,
  })
  const [quickTargetKey, setQuickTargetKey] = React.useState('')
  const [quickMinutes, setQuickMinutes] = React.useState<number | null>(null)
  const [quickEpoch, setQuickEpoch] = React.useState(0)
  const [quickDetails, setQuickDetails] = React.useState<EntryDetailsValue>(() => emptyEntryDetails(''))
  const [tagOptions, setTagOptions] = React.useState<TagOption[]>([])

  // The date defaults to the day the page is showing, once that is known.
  React.useEffect(() => {
    if (!data.today) return
    setQuickDetails((current) => (current.date ? current : { ...current, date: data.today }))
  }, [data.today])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await Promise.resolve(
          apiCall<{ items?: Array<Record<string, unknown>> }>('/api/staff/timesheets/tags?page=1&pageSize=100'),
        )
        if (cancelled || !res?.ok) return
        const items = Array.isArray(res.result?.items) ? res.result.items : []
        setTagOptions(
          items
            .map((row: Record<string, unknown>) => {
              const id = typeof row.id === 'string' ? row.id : null
              const label = typeof row.label === 'string' ? row.label : null
              return id && label
                ? { id, label, color: typeof row.color === 'string' ? row.color : null }
                : null
            })
            .filter((tag): tag is TagOption => tag !== null),
        )
      } catch {
        // A missing tag vocabulary leaves the picker empty rather than the page broken.
      }
    })()
    return () => { cancelled = true }
  }, [])

  const createTag = React.useCallback(
    async (label: string): Promise<TagOption | null> => {
      try {
        const created = await createCrud('/api/staff/timesheets/tags', {
          label,
          slug: slugifyProjectName(label).toLowerCase(),
        }, { errorMessage: t('staff.time_tracking.entryDialog.errors.createTag', 'Could not create the tag.') })
        const payload = created as unknown as Record<string, unknown> | null
        const raw = payload?.id ?? (payload?.result as Record<string, unknown> | undefined)?.id
        const id = typeof raw === 'string' ? raw : null
        if (!id) return null
        const tag: TagOption = { id, label, color: null }
        setTagOptions((current) => [...current, tag])
        return tag
      } catch (error) {
        logger.warn('staff.time_tracking.my-work tag create failed', { err: error })
        return null
      }
    },
    [t],
  )
  const [quickSaving, setQuickSaving] = React.useState(false)

  const loadError = t('staff.time_tracking.myWork.errors.load', 'Failed to load your work summary.')

  // A failed request leaves `data` at EMPTY_PAYLOAD, which reads as screen 2 — "no
  // assignments" — so the failure has to be a state of its own or the page reports a
  // server fault as an empty account.
  const load = React.useCallback(async () => {
    try {
      const result = await readApiResultOrThrow<MyWorkPayload>(MY_WORK_ENDPOINT, undefined, {
        errorMessage: loadError,
        fallback: EMPTY_PAYLOAD,
      })
      setData({ ...EMPTY_PAYLOAD, ...result })
      setLoadState('ready')
    } catch (error) {
      logger.error('staff.time_tracking.my-work load failed', { err: error })
      setLoadState('error')
    }
  }, [loadError])

  const retryLoad = React.useCallback(() => {
    setLoadState('loading')
    void load()
  }, [load])

  React.useEffect(() => {
    void load()
  }, [load, scopeVersion])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const mutationContext = React.useMemo(
    () => ({
      formId: MUTATION_CONTEXT_ID,
      resourceKind: 'staff.timesheets.time_entry',
      retryLastMutation,
    }),
    [retryLastMutation],
  )

  const quickTargets = React.useMemo(
    () =>
      buildLogTargets(
        data.projects.map((project) => ({
          id: project.id,
          name: project.name,
          code: project.code,
          color: project.color,
        })),
        data.recentTasks.map((task) => ({
          id: task.id,
          title: task.title,
          timeProjectId: task.timeProjectId,
        })),
      ),
    [data.projects, data.recentTasks],
  )

  React.useEffect(() => {
    if (quickTargetKey || quickTargets.length === 0) return
    setQuickTargetKey(quickTargets[0].key)
  }, [quickTargetKey, quickTargets])

  const todayTotal = data.entries.reduce((sum, entry) => sum + entry.durationMinutes, 0)

  const submitQuickEntry = React.useCallback(async () => {
    if (!quickTargetKey || quickMinutes === null || quickMinutes <= 0 || quickSaving) return
    const target = parseTargetKey(quickTargetKey)
    const body = {
      staffMemberId: data.staffMember?.id,
      date: quickDetails.date || data.today,
      timeProjectId: target.timeProjectId,
      taskId: target.taskId,
      durationMinutes: quickMinutes,
      description: quickDetails.description.trim() || null,
      isBillable: quickDetails.isBillable,
      tagIds: quickDetails.tagIds.length > 0 ? quickDetails.tagIds : undefined,
      // Paired or omitted — a lone start is how the list identifies a running
      // timer, and a manual entry has no segment to stop.
      ...buildEntryClocks({
        date: quickDetails.date || data.today,
        startClock: quickDetails.startClock || null,
        endClock: quickDetails.endClock || null,
        minutes: quickMinutes,
      }),
      source: 'manual',
    }
    setQuickSaving(true)
    try {
      await runMutation({
        operation: () =>
          createCrud(ENTRIES_API_PATH, body, {
            errorMessage: t('staff.timesheets.my.errors.save', 'Failed to save timesheets.'),
          }),
        context: mutationContext,
        mutationPayload: body as unknown as Record<string, unknown>,
      })
      setQuickMinutes(null)
      setQuickEpoch((epoch) => epoch + 1)
      // The date and the billable flag survive; the rest clears. Logging three
      // lines against yesterday should not mean re-picking yesterday each time.
      setQuickDetails((current) => ({
        ...emptyEntryDetails(current.date, current.isBillable),
      }))
      await load()
    } catch (error) {
      logger.error('staff.time_tracking.my-work quick entry failed', { err: error })
      flash(t('staff.timesheets.my.errors.save', 'Failed to save timesheets.'), 'error')
    } finally {
      setQuickSaving(false)
    }
  }, [data.staffMember?.id, data.today, load, mutationContext, quickDetails, quickMinutes, quickSaving, quickTargetKey, runMutation, t])

  const copyYesterday = React.useCallback(async () => {
    const today = new Date(`${data.today}T00:00:00.000Z`)
    const yesterday = new Date(today)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const body = {
      fromDate: yesterday.toISOString().slice(0, 10),
      toDate: data.today,
    }
    try {
      const result = await runMutation({
        operation: () =>
          createCrud<{ copied?: number; skipped?: unknown[] }>(`${ENTRIES_API_PATH}/copy-day`, body, {
            errorMessage: t('staff.time_tracking.entries.errors.copyDay', 'Could not copy the day.'),
          }),
        context: mutationContext,
        mutationPayload: body,
      })
      const copied = (result?.result as { copied?: number } | undefined)?.copied ?? 0
      flash(
        t('staff.time_tracking.myWork.copyDay.done', 'Copied {count} entries from yesterday.', {
          count: String(copied),
        }),
        'success',
      )
      await load()
    } catch (error) {
      if (isEntryLockedError(error)) {
        flash(
          t(
            'staff.time_tracking.entries.errors.entryLocked',
            'This time entry is locked in a closed report and cannot be changed. Unlock the report first.',
          ),
          'error',
        )
        return
      }
      logger.error('staff.time_tracking.my-work copy day failed', { err: error })
      flash(t('staff.time_tracking.entries.errors.copyDay', 'Could not copy the day.'), 'error')
    }
  }, [data.today, load, mutationContext, runMutation, t])

  if (loadState === 'loading') {
    return (
      <Page>
        <PageHeader title={t('staff.time_tracking.nav.my_work', 'My work')} />
        <PageBody>
          <LoadingMessage label={t('staff.timesheets.my.loading', 'Loading timesheets...')} />
        </PageBody>
      </Page>
    )
  }

  if (loadState === 'error') {
    return (
      <Page>
        <PageHeader title={t('staff.time_tracking.nav.my_work', 'My work')} />
        <PageBody>
          <ErrorMessage
            label={loadError}
            action={
              <Button type="button" variant="outline" size="sm" onClick={retryLoad}>
                {t('staff.time_tracking.myWork.errors.retry', 'Try again')}
              </Button>
            }
          />
        </PageBody>
      </Page>
    )
  }

  const subtitle = [formatLongDayLabel(data.today), data.staffMember?.displayName]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  const noAssignments = data.projects.length === 0 && data.entries.length === 0

  return (
    <Page>
      <PageHeader
        title={t('staff.time_tracking.nav.my_work', 'My work')}
        description={subtitle}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={TIMESHEET_HREF}>
                <CalendarDays className="size-4" aria-hidden="true" />
                {t('staff.time_tracking.nav.timesheet', 'Timesheet')}
              </Link>
            </Button>
            {canManageOwn && !noAssignments ? (
              <Button type="button" onClick={() => setDialog({ open: true, entryId: null })}>
                <Plus className="size-4" aria-hidden="true" />
                {t('staff.time_tracking.entries.actions.add', 'Add entry')}
              </Button>
            ) : null}
          </div>
        }
      />
      <PageBody>
        {noAssignments ? (
          <NoTimeProjectAssignments />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                title={t('staff.time_tracking.myWork.kpi.today', 'Today')}
                value={data.kpis.todayMinutes}
                formatValue={(value) => formatDuration(value, 'clock')}
                comparisonLabel={
                  data.kpis.dailyTargetMinutes !== null
                    ? t('staff.time_tracking.myWork.kpi.targetGap', 'target {target} — {gap} to go', {
                        target: formatDuration(data.kpis.dailyTargetMinutes, 'clock'),
                        gap: formatDuration(
                          Math.max(0, data.kpis.dailyTargetMinutes - data.kpis.todayMinutes),
                          'clock',
                        ),
                      })
                    : undefined
                }
              />
              <KpiCard
                title={t('staff.time_tracking.myWork.kpi.week', 'This week')}
                value={data.kpis.weekMinutes}
                formatValue={(value) => formatDuration(value, 'clock')}
                comparisonLabel={
                  data.kpis.weekTargetMinutes !== null
                    ? t('staff.time_tracking.myWork.kpi.ofTarget', 'of {target}', {
                        target: formatDuration(data.kpis.weekTargetMinutes, 'clock'),
                      })
                    : undefined
                }
              />
              <KpiCard
                title={t('staff.time_tracking.myWork.kpi.month', 'This month')}
                value={data.kpis.monthMinutes}
                formatValue={(value) => formatDuration(value, 'clock')}
                comparisonLabel={t('staff.time_tracking.myWork.kpi.workingDays', '{days} working days', {
                  days: String(data.kpis.monthWorkingDays),
                })}
              />
              <KpiCard
                title={t('staff.time_tracking.myWork.kpi.nonBillable', 'Non-billable')}
                value={data.kpis.monthNonBillableMinutes}
                formatValue={(value) => formatDuration(value, 'clock')}
                comparisonLabel={
                  data.kpis.nonBillableSharePercent !== null
                    ? t('staff.time_tracking.myWork.kpi.shareOfMonth', '{percent}% of the month', {
                        percent: String(data.kpis.nonBillableSharePercent),
                      })
                    : undefined
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <section className="rounded-lg border xl:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
                  <h2 className="text-sm font-semibold">
                    {t('staff.time_tracking.myWork.today.title', 'Today’s entries')}
                  </h2>
                  <div className="flex items-center gap-2">
                    {canManageOwn ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => void copyYesterday()}>
                        <Copy className="size-4" aria-hidden="true" />
                        {t('staff.time_tracking.myWork.today.copyYesterday', 'Copy yesterday')}
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" asChild>
                      <Link href={ENTRIES_HREF}>
                        {t('staff.time_tracking.myWork.today.allEntries', 'All entries')}
                      </Link>
                    </Button>
                  </div>
                </div>

                {data.entries.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    {t('staff.time_tracking.myWork.today.empty', 'Nothing logged today yet.')}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {data.entries.map((entry) => (
                        <tr key={entry.id} className="border-b last:border-0">
                          <td className="p-3 align-top">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">
                                {entry.taskTitle ??
                                  entry.description ??
                                  t('staff.time_tracking.entries.table.noTask', 'No task')}
                              </span>
                              {entry.isBillable ? null : (
                                <StatusBadge variant="neutral">
                                  {t('staff.time_tracking.entries.badges.nonBillable', 'non-billable')}
                                </StatusBadge>
                              )}
                              {entry.isLocked ? (
                                <StatusBadge variant="neutral">
                                  <Lock className="size-3" aria-hidden="true" />
                                  {t('staff.time_tracking.entries.badges.locked', 'locked')}
                                </StatusBadge>
                              ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {[entry.projectName, entry.taskTitle ? entry.description : null]
                                .filter((part): part is string => Boolean(part))
                                .join(' · ')}
                            </div>
                          </td>
                          <td className="w-32 p-3 align-top text-xs text-muted-foreground">
                            {formatClockRange(entry) ?? '—'}
                          </td>
                          <td className="w-20 p-3 text-right align-top font-mono font-semibold tabular-nums">
                            {formatDuration(entry.durationMinutes, 'clock')}
                          </td>
                          <td className="w-16 p-3 text-right align-top">
                            {canManageOwn && !entry.isLocked ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="2xs"
                                aria-label={t('staff.time_tracking.timesheet.list.edit', 'Edit')}
                                onClick={() => setDialog({ open: true, entryId: entry.id })}
                              >
                                <Pencil className="size-3.5" aria-hidden="true" />
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {canManageOwn && quickTargets.length > 0 ? (
                        <tr>
                          <td colSpan={4} className="p-3">
                            <div
                              className="flex flex-wrap items-start gap-2"
                              onKeyDown={(event) => {
                                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                  event.preventDefault()
                                  void submitQuickEntry()
                                }
                              }}
                            >
                              <Select value={quickTargetKey} onValueChange={setQuickTargetKey}>
                                <SelectTrigger
                                  className="w-72"
                                  aria-label={t('staff.time_tracking.myWork.quickEntry.target', 'Project or task')}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {quickTargets.map((target) => (
                                    <SelectItem key={target.key} value={target.key}>
                                      {targetLabel(target)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="w-32">
                                <DurationInput
                                  key={quickEpoch}
                                  variant="compact"
                                  value={quickMinutes}
                                  onChange={(minutes) => setQuickMinutes(minutes)}
                                  ariaLabel={t('staff.time_tracking.myWork.quickEntry.duration', 'Duration')}
                                />
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                disabled={quickSaving || quickMinutes === null || quickMinutes <= 0}
                                onClick={() => void submitQuickEntry()}
                              >
                                {t('staff.time_tracking.myWork.quickEntry.save', 'Save')}
                              </Button>
                              <span className="self-center text-xs text-muted-foreground">
                                {t('staff.time_tracking.entryDialog.shortcutSave', '⌘↵ to save')}
                              </span>
                              {/*
                                * The same block the task drawer offers, from the same
                                * component: a row that can log an hour but not say what
                                * it was for, or when, sends people to the full dialog
                                * for the one field they were missing.
                                */}
                              <div className="w-full">
                                <EntryDetailsFields
                                  idPrefix="my-work-quick"
                                  value={quickDetails}
                                  onChange={setQuickDetails}
                                  tagOptions={tagOptions}
                                  onCreateTag={createTag}
                                  disabled={quickSaving}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/40 font-medium">
                        <td className="p-3" colSpan={2}>
                          {t('staff.time_tracking.myWork.today.total', 'Total today')}
                        </td>
                        <td className="p-3 text-right font-mono tabular-nums">
                          {formatDuration(todayTotal, 'clock')}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                )}
              </section>

              <div className="flex flex-col gap-6">
                <section className="rounded-lg border">
                  <div className="flex items-center justify-between border-b p-4">
                    <h2 className="text-sm font-semibold">
                      {t('staff.time_tracking.myWork.projects.title', 'My projects')}
                    </h2>
                    <span className="text-xs text-muted-foreground">{data.projects.length}</span>
                  </div>
                  <div className="flex flex-col gap-4 p-4">
                    {data.projects.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t('staff.time_tracking.myWork.projects.empty', 'No projects assigned yet.')}
                      </p>
                    ) : (
                      data.projects.map((project) => (
                        <div key={project.id} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <Link
                              href={`/backend/staff/time-tracking/projects/${project.id}`}
                              className="min-w-0 truncate font-medium hover:underline"
                            >
                              {project.name}
                            </Link>
                            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                              {formatDuration(project.myMinutes, 'clock')}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {[
                              project.customerName,
                              project.hourlyRate != null && project.currencyCode
                                ? t('staff.time_tracking.myWork.projects.rate', '{rate}/h', {
                                    rate: formatCurrency(project.hourlyRate, project.currencyCode) ?? '',
                                  })
                                : null,
                            ]
                              .filter((part): part is string => Boolean(part))
                              .join(' · ')}
                          </p>
                          {project.budget ? (
                            <>
                              <Progress
                                value={project.budget.barPercent}
                                size="sm"
                                tone={
                                  project.budget.tone === 'destructive'
                                    ? 'destructive'
                                    : project.budget.tone === 'warning'
                                      ? 'warning'
                                      : 'accent'
                                }
                              />
                              <p className="text-xs text-muted-foreground">
                                {t('staff.time_tracking.myWork.projects.budget', '{percent}% of budget ({value})', {
                                  percent: String(project.budget.percent),
                                  value:
                                    project.budget.kind === 'hours'
                                      ? t('staff.time_tracking.myWork.projects.budgetHours', '{hours} h', {
                                          hours: String(project.budget.budgetValue),
                                        })
                                      : formatCurrency(project.budget.budgetValue, project.currencyCode ?? undefined) ??
                                        String(project.budget.budgetValue),
                                })}
                              </p>
                            </>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-lg border">
                  <div className="border-b p-4">
                    <h2 className="text-sm font-semibold">
                      {t('staff.time_tracking.myWork.recentTasks.title', 'Recent tasks')}
                    </h2>
                  </div>
                  <div className="flex flex-col gap-2 p-4">
                    {data.recentTasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t('staff.time_tracking.myWork.recentTasks.empty', 'No tasks logged against yet.')}
                      </p>
                    ) : (
                      data.recentTasks.map((task) => (
                        <Link
                          key={task.id}
                          href={`/backend/staff/time-tracking/projects/${task.timeProjectId}/board?task=${task.id}`}
                          className="flex items-center justify-between gap-2 truncate text-sm hover:underline"
                        >
                          <span className="truncate">{task.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{task.projectName}</span>
                        </Link>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}
      </PageBody>

      <TimeEntryDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        entryId={dialog.entryId}
        defaults={{ date: data.today }}
        onSaved={() => {
          void load()
        }}
      />
    </Page>
  )
}
