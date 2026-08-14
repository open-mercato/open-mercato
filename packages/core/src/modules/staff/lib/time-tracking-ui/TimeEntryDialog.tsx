"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DurationInput } from './DurationInput'
import { formatDuration } from '../time-tracking/duration'
import { parseClock } from '../time-tracking/interval'
import { applicableRate, entryAmount } from '../time-tracking/cost'
import { roundMinutes, DEFAULT_ROUNDING_SETTINGS, type RoundingSettings } from '../time-tracking/rounding'
import {
  combineDateAndClock,
  createIntervalState,
  describeTaskOption,
  reduceIntervalState,
  resetIntervalState,
  readRowItems,
  readRowString,
  shiftIsoDate,
  todayIsoDate,
  toOverlapEntry,
  toProjectOption,
  toTaskOption,
  toTimeEntryRecord,
  type OverlapEntry,
  type ProjectOption,
  type TaskOption,
  type TimeEntryRecord,
  type TimeIntervalState,
} from './timeEntryDialogState'

const logger = createLogger('staff').child({ component: 'TimeEntryDialog' })

export const TIME_ENTRY_DIALOG_MUTATION_CONTEXT_ID = 'staff.time_tracking.entryDialog'
export const RATES_FEATURE = 'staff.timesheets.rates.view'
export const ENTRIES_LIST_PATH = '/backend/staff/time-tracking/entries'
export const REPORTS_PATH = '/backend/staff/time-tracking/reports'

const DIALOG_QUERY_ROOT = ['staff', 'time-tracking', 'entry-dialog'] as const
const DIRECTORY_PAGE_SIZE = 100

export type TimeEntryDialogDefaults = {
  date?: string
  taskId?: string | null
  timeProjectId?: string | null
  durationMinutes?: number | null
  startClock?: string | null
  endClock?: string | null
  description?: string | null
  isBillable?: boolean | null
  tagIds?: string[]
}

export type TimeEntryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present → edit that entry; absent → a brand new one. */
  entryId?: string | null
  /** Seed values for a new entry: a stopped timer, a grid cell, a board card. */
  defaults?: TimeEntryDialogDefaults
  /** Sub-title line, e.g. "Created from a stopped timer · 01:14:02". */
  headerHint?: string | null
  /** Fired after every successful write, including "save and add another". */
  onSaved?: (result: { id: string | null; keptOpen: boolean }) => void
  /** "Show that entry" on the overlap warning; falls back to the entries list. */
  onShowEntry?: (entryId: string) => void
}

type SettingsPayload = {
  rounding: RoundingSettings
  defaults: { billable: boolean; chainStartFromPreviousEnd: boolean }
  warnings: { overlap: boolean }
}

const FALLBACK_SETTINGS: SettingsPayload = {
  rounding: { ...DEFAULT_ROUNDING_SETTINGS },
  defaults: { billable: true, chainStartFromPreviousEnd: true },
  warnings: { overlap: true },
}

function readSettings(payload: unknown): SettingsPayload {
  const source = (payload ?? {}) as Record<string, unknown>
  const rounding = (source.rounding ?? {}) as Record<string, unknown>
  const defaults = (source.defaults ?? {}) as Record<string, unknown>
  const warnings = (source.warnings ?? {}) as Record<string, unknown>
  return {
    rounding: {
      unitMinutes:
        rounding.unitMinutes === 5 || rounding.unitMinutes === 10 || rounding.unitMinutes === 15
          ? rounding.unitMinutes
          : 0,
      direction: rounding.direction === 'nearest' ? 'nearest' : 'up',
    },
    defaults: {
      billable: typeof defaults.billable === 'boolean' ? defaults.billable : true,
      chainStartFromPreviousEnd:
        typeof defaults.chainStartFromPreviousEnd === 'boolean' ? defaults.chainStartFromPreviousEnd : true,
    },
    warnings: { overlap: typeof warnings.overlap === 'boolean' ? warnings.overlap : true },
  }
}

function parseRateText(value: string): number | null {
  const trimmed = value.trim().replace(',', '.')
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function readErrorCode(error: unknown): string | null {
  const body = (error as { body?: { code?: unknown; error?: unknown } } | null)?.body
  if (body && typeof body.code === 'string') return body.code
  if (body && typeof body.error === 'string') return body.error
  return null
}

/**
 * The full time entry form of screen 8, plus the two edge states of screen 9.
 * Every surface of the module funnels through it — the entries list, the
 * timesheet, the board and the task drawer — so it takes an entry id (edit) or a
 * set of defaults (create) and owns nothing else about its host.
 *
 * Four decisions carry the design intent:
 *
 *  1. **The 2-of-3 arithmetic lives in one reducer, not in the render path.**
 *     `reduceIntervalState` calls `deriveInterval` with exactly the two anchor
 *     fields and stores which one came back computed, so the `wyliczone` badge is
 *     read off the state rather than recomputed. `start` is the preferred anchor,
 *     which is what makes editing the end restate the duration (note 1).
 *  2. **The duration field is never rewritten while it is being typed.**
 *     `DurationInput` keeps unparseable text on its own; the dialog only remounts
 *     it — via `durationEpoch` — when the *derived* duration changed, i.e. when
 *     the user was editing some other field.
 *  3. **Overlap is advisory.** The probe is a plain `apiCall`; a non-200, a
 *     throw or an empty list all mean "no warning", and Save never observes it.
 *     Only an unparseable duration disables Save (screen 9 notes 2 and 4).
 *  4. **A locked entry opens read-only.** Every write path answers
 *     `409 entry_locked`, so the form shows the lock and a way to the report that
 *     closed it instead of letting someone compose a request that cannot succeed.
 */
export function TimeEntryDialog({
  open,
  onOpenChange,
  entryId,
  defaults,
  headerHint,
  onSaved,
  onShowEntry,
}: TimeEntryDialogProps): React.ReactElement {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload } = useBackendChrome()
  const canSeeMoney = hasFeature(payload?.grantedFeatures, RATES_FEATURE)
  const isEdit = typeof entryId === 'string' && entryId.length > 0

  const [taskId, setTaskId] = React.useState<string | null>(null)
  const [description, setDescription] = React.useState('')
  const [date, setDate] = React.useState(() => todayIsoDate())
  const [interval, setIntervalState] = React.useState<TimeIntervalState>(() => createIntervalState({}))
  const [isBillable, setIsBillable] = React.useState(true)
  const [rateOverrideEnabled, setRateOverrideEnabled] = React.useState(false)
  const [rateText, setRateText] = React.useState('')
  const [tagIds, setTagIds] = React.useState<string[]>([])
  const [overlaps, setOverlaps] = React.useState<OverlapEntry[]>([])
  const [saving, setSaving] = React.useState(false)

  const seedKeyRef = React.useRef<string | null>(null)
  const billableDefaultRef = React.useRef<string | null>(null)
  const versionRef = React.useRef<string | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: TIME_ENTRY_DIALOG_MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.time_tracking.entryDialog.errors.save', 'Could not save the time entry.'),
  })

  const settingsQuery = useQuery<SettingsPayload>({
    queryKey: [...DIALOG_QUERY_ROOT, 'settings', `scope:${scopeVersion}`],
    enabled: open,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>('/api/staff/timesheets/settings')
      return call.ok ? readSettings(call.result) : FALLBACK_SETTINGS
    },
  })
  const settings = settingsQuery.data ?? FALLBACK_SETTINGS

  const selfQuery = useQuery<{ id: string; displayName: string } | null>({
    queryKey: [...DIALOG_QUERY_ROOT, 'self', `scope:${scopeVersion}`],
    enabled: open,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<{ member?: { id?: string; displayName?: string } | null }>(
        '/api/staff/team-members/self',
      )
      const member = call.ok ? call.result?.member ?? null : null
      if (!member?.id) return null
      return { id: member.id, displayName: member.displayName ?? '' }
    },
  })

  const tasksQuery = useQuery<TaskOption[]>({
    queryKey: [...DIALOG_QUERY_ROOT, 'tasks', `scope:${scopeVersion}`],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/tasks?page=1&pageSize=${DIRECTORY_PAGE_SIZE}&sortField=title&sortDir=asc`,
      )
      if (!call.ok) return []
      return readRowItems(call.result)
        .map(toTaskOption)
        .filter((task): task is TaskOption => task !== null)
    },
  })

  const projectsQuery = useQuery<ProjectOption[]>({
    queryKey: [...DIALOG_QUERY_ROOT, 'projects', `scope:${scopeVersion}`],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      // Best effort: a consultant without `projects.view` still gets the task
      // picker, only without the customer and project suffix on each option.
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/time-projects?page=1&pageSize=${DIRECTORY_PAGE_SIZE}&sortField=name&sortDir=asc`,
      )
      if (!call.ok) return []
      return readRowItems(call.result)
        .map(toProjectOption)
        .filter((project): project is ProjectOption => project !== null)
    },
  })

  const tagsQuery = useQuery<{ id: string; label: string }[]>({
    queryKey: [...DIALOG_QUERY_ROOT, 'tags', `scope:${scopeVersion}`],
    enabled: open,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/tags?page=1&pageSize=${DIRECTORY_PAGE_SIZE}&sortField=label&sortDir=asc`,
      )
      if (!call.ok) return []
      return readRowItems(call.result)
        .map((row) => {
          const id = readRowString(row, 'id')
          return id ? { id, label: readRowString(row, 'label') ?? id } : null
        })
        .filter((tag): tag is { id: string; label: string } => tag !== null)
    },
  })

  const entryQuery = useQuery<TimeEntryRecord | null>({
    queryKey: [...DIALOG_QUERY_ROOT, 'entry', `scope:${scopeVersion}`, entryId ?? 'new'],
    enabled: open && isEdit,
    staleTime: 0,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId as string)}&pageSize=1`,
      )
      if (!call.ok) throw new Error('[internal] time entry request failed')
      const row = readRowItems(call.result)[0]
      return row ? toTimeEntryRecord(row) : null
    },
  })

  const entry = entryQuery.data ?? null
  const locked = !!entry?.isLocked
  const lockedReportId = entry?.lockedReportId ?? null
  const tasks = React.useMemo(() => tasksQuery.data ?? [], [tasksQuery.data])
  const projects = React.useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const tagOptions = React.useMemo(() => tagsQuery.data ?? [], [tagsQuery.data])

  const projectById = React.useMemo(() => {
    const map = new Map<string, ProjectOption>()
    for (const project of projects) map.set(project.id, project)
    return map
  }, [projects])

  const selectedTask = React.useMemo(
    () => tasks.find((task) => task.id === taskId) ?? null,
    [taskId, tasks],
  )

  const projectId = selectedTask?.timeProjectId ?? entry?.timeProjectId ?? defaults?.timeProjectId ?? null
  const project = projectId ? projectById.get(projectId) ?? null : null

  const resetForm = React.useCallback(
    (seed: {
      taskId: string | null
      description: string
      date: string
      start: string | null
      end: string | null
      durationMinutes: number | null
      isBillable: boolean
      rateOverrideAmount: number | null
      tagIds: string[]
    }) => {
      setTaskId(seed.taskId)
      setDescription(seed.description)
      setDate(seed.date || todayIsoDate())
      setIntervalState((current) =>
        resetIntervalState(current, {
          start: seed.start,
          end: seed.end,
          durationMinutes: seed.durationMinutes,
        }),
      )
      setIsBillable(seed.isBillable)
      setRateOverrideEnabled(seed.rateOverrideAmount !== null)
      setRateText(seed.rateOverrideAmount !== null ? String(seed.rateOverrideAmount) : '')
      setTagIds(seed.tagIds)
      setOverlaps([])
    },
    [],
  )

  React.useEffect(() => {
    if (!open) {
      seedKeyRef.current = null
      billableDefaultRef.current = null
      return
    }
    if (isEdit && !entry) return
    const key = isEdit ? `edit:${entry?.id ?? entryId}:${entry?.updatedAt ?? ''}` : 'create'
    if (seedKeyRef.current === key) return
    seedKeyRef.current = key
    versionRef.current = entry?.updatedAt ?? null
    if (entry) {
      resetForm({
        taskId: entry.taskId,
        description: entry.description,
        date: entry.date,
        start: entry.startText,
        end: entry.endText,
        durationMinutes: entry.durationMinutes,
        isBillable: entry.isBillable,
        rateOverrideAmount: entry.rateOverrideAmount,
        tagIds: entry.tagIds,
      })
      return
    }
    resetForm({
      taskId: defaults?.taskId ?? null,
      description: defaults?.description ?? '',
      date: defaults?.date ?? todayIsoDate(),
      start: defaults?.startClock ?? null,
      end: defaults?.endClock ?? null,
      durationMinutes: defaults?.durationMinutes ?? null,
      isBillable: defaults?.isBillable ?? true,
      rateOverrideAmount: null,
      tagIds: defaults?.tagIds ?? [],
    })
  }, [defaults, entry, entryId, isEdit, open, resetForm])

  /**
   * The tenant's billable default lands separately, and only on the one field it
   * owns. Seeding the whole form once the settings request answers would race the
   * first keystrokes and wipe them, which is exactly what this split avoids.
   */
  React.useEffect(() => {
    if (!open || isEdit || settingsQuery.isPending) return
    if (defaults?.isBillable !== undefined && defaults?.isBillable !== null) return
    if (billableDefaultRef.current === seedKeyRef.current) return
    billableDefaultRef.current = seedKeyRef.current
    setIsBillable(settings.defaults.billable)
  }, [defaults?.isBillable, isEdit, open, settings.defaults.billable, settingsQuery.isPending])

  const durationMinutes = interval.durationMinutes
  const startClock = interval.startText
  const endClock = interval.endText

  /**
   * Advisory overlap probe. Every failure mode — a non-200, a throw, a partial
   * span — lands on "no warning", because the endpoint may not answer and the
   * form must still save.
   */
  React.useEffect(() => {
    if (!open || locked || !settings.warnings.overlap) {
      setOverlaps([])
      return
    }
    if (!date || parseClock(startClock) === null || !durationMinutes) {
      setOverlaps([])
      return
    }
    let cancelled = false
    const params = new URLSearchParams({
      date,
      startedAt: startClock,
      durationMinutes: String(durationMinutes),
    })
    if (parseClock(endClock) !== null) params.set('endedAt', endClock)
    if (isEdit && entryId) params.set('excludeId', entryId)
    void apiCall<Record<string, unknown>>(`/api/staff/timesheets/time-entries/overlaps?${params.toString()}`)
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setOverlaps([])
          return
        }
        setOverlaps(
          readRowItems(call.result)
            .map(toOverlapEntry)
            .filter((item): item is OverlapEntry => item !== null),
        )
      })
      .catch(() => {
        if (!cancelled) setOverlaps([])
      })
    return () => {
      cancelled = true
    }
  }, [date, durationMinutes, endClock, entryId, isEdit, locked, open, settings.warnings.overlap, startClock])

  const rateOverrideAmount = rateOverrideEnabled ? parseRateText(rateText) : null
  const currencyCode = project?.currencyCode ?? entry?.currencyCode ?? null
  const roundedMinutes = roundMinutes(durationMinutes ?? 0, settings.rounding)
  const rate = applicableRate({ rateOverrideAmount }, { hourlyRate: project?.hourlyRate ?? null })
  const cost = entryAmount(
    { isBillable, roundedMinutes, rateOverrideAmount },
    { hourlyRate: project?.hourlyRate ?? null },
  )

  const computedBadge = (field: 'start' | 'end' | 'duration' | 'cost') => (
    <Badge variant="neutral" data-testid={`entry-dialog-computed-${field}`}>
      {t('staff.time_tracking.entryDialog.computed', 'computed')}
    </Badge>
  )

  const midnightEndDate = interval.crossesMidnight ? shiftIsoDate(date, 1) : null
  const canSave = !locked && !!taskId && !interval.durationInvalid && !!durationMinutes && !saving

  const buildPayload = React.useCallback(() => {
    const startedAt = parseClock(startClock) !== null ? combineDateAndClock(date, startClock) : null
    const endedAt =
      parseClock(endClock) !== null ? combineDateAndClock(date, endClock, interval.crossesMidnight ? 1 : 0) : null
    return {
      date,
      durationMinutes: durationMinutes ?? 0,
      startedAt,
      endedAt,
      taskId,
      timeProjectId: projectId,
      description: description.trim() ? description.trim() : null,
      isBillable,
      tagIds,
      rateOverrideAmount: canSeeMoney ? rateOverrideAmount : undefined,
    }
  }, [
    canSeeMoney,
    date,
    description,
    durationMinutes,
    endClock,
    interval.crossesMidnight,
    isBillable,
    projectId,
    rateOverrideAmount,
    startClock,
    tagIds,
    taskId,
  ])

  const reportFailure = React.useCallback(
    (error: unknown) => {
      if (surfaceRecordConflict(error, t)) return
      if (readErrorCode(error) === 'entry_locked') {
        flash(
          t(
            'staff.time_tracking.entryDialog.locked.notice',
            'This entry is closed in a report, so it can no longer be edited.',
          ),
          'error',
        )
        return
      }
      logger.error('staff.time_tracking entry dialog save failed', { err: error })
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('staff.time_tracking.entryDialog.errors.save', 'Could not save the time entry.'),
        'error',
      )
    },
    [t],
  )

  const submit = React.useCallback(
    async (mode: 'close' | 'again') => {
      if (!canSave) return
      const staffMemberId = selfQuery.data?.id ?? null
      if (!isEdit && !staffMemberId) {
        flash(
          t(
            'staff.time_tracking.entryDialog.errors.noStaffMember',
            'Your account is not linked to a staff member, so time cannot be logged.',
          ),
          'error',
        )
        return
      }
      const body = buildPayload()
      setSaving(true)
      try {
        const saved = await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(
              isEdit ? buildOptimisticLockHeader(versionRef.current) : {},
              () =>
                apiCallOrThrow<Record<string, unknown>>(
                  '/api/staff/timesheets/time-entries',
                  {
                    method: isEdit ? 'PUT' : 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(
                      isEdit ? { id: entryId, ...body } : { staffMemberId, source: 'manual', ...body },
                    ),
                  },
                  {
                    errorMessage: t(
                      'staff.time_tracking.entryDialog.errors.save',
                      'Could not save the time entry.',
                    ),
                  },
                ),
            ),
          context: {
            formId: TIME_ENTRY_DIALOG_MUTATION_CONTEXT_ID,
            resourceKind: 'staff.timesheets.time_entry',
            resourceId: entryId ?? 'new',
            retryLastMutation,
          },
        })
        const savedId = typeof saved?.result?.id === 'string' ? saved.result.id : entryId ?? null
        flash(t('staff.time_tracking.entryDialog.saved', 'Time entry saved.'), 'success')
        if (mode === 'again') {
          // Note 3: the dialog stays open, the description and the times clear,
          // and the next entry starts where this one ended.
          const chain = settings.defaults.chainStartFromPreviousEnd
          const nextDate = interval.crossesMidnight && midnightEndDate ? midnightEndDate : date
          seedKeyRef.current = 'create'
          setDescription('')
          setDate(nextDate)
          setIntervalState((current) =>
            resetIntervalState(current, { start: chain ? endClock || null : null }),
          )
          setOverlaps([])
          onSaved?.({ id: savedId, keptOpen: true })
          return
        }
        onSaved?.({ id: savedId, keptOpen: false })
        onOpenChange(false)
      } catch (error) {
        reportFailure(error)
      } finally {
        setSaving(false)
      }
    },
    [
      buildPayload,
      canSave,
      date,
      endClock,
      entryId,
      interval.crossesMidnight,
      isEdit,
      midnightEndDate,
      onOpenChange,
      onSaved,
      reportFailure,
      retryLastMutation,
      runMutation,
      selfQuery.data?.id,
      settings.defaults.chainStartFromPreviousEnd,
      t,
    ],
  )

  const handleShowOverlap = React.useCallback(
    (overlap: OverlapEntry) => {
      if (onShowEntry) {
        onShowEntry(overlap.id)
        return
      }
      window.open(`${ENTRIES_LIST_PATH}?ids=${encodeURIComponent(overlap.id)}`, '_blank', 'noopener')
    },
    [onShowEntry],
  )

  const overlap = overlaps[0] ?? null
  const availableTags = React.useMemo(
    () => tagOptions.filter((tag) => !tagIds.includes(tag.id)),
    [tagIds, tagOptions],
  )
  const assignedTags = React.useMemo(() => {
    const labels = new Map(tagOptions.map((tag) => [tag.id, tag.label]))
    return tagIds.map((id) => ({ id, label: labels.get(id) ?? id }))
  }, [tagIds, tagOptions])

  const rateLabel = rate !== null ? formatCurrency(rate, currencyCode) ?? String(rate) : null
  const projectRateLabel =
    project?.hourlyRate !== null && project?.hourlyRate !== undefined
      ? formatCurrency(project.hourlyRate, currencyCode) ?? String(project.hourlyRate)
      : null

  const body = (() => {
    if (isEdit && entryQuery.isLoading) {
      return <LoadingMessage label={t('staff.time_tracking.entryDialog.loading', 'Loading the time entry…')} />
    }
    if (isEdit && entryQuery.isError) {
      return <ErrorMessage label={t('staff.time_tracking.entryDialog.errors.load', 'Could not load the time entry.')} />
    }
    if (isEdit && !entry) {
      return <ErrorMessage label={t('staff.time_tracking.entryDialog.errors.notFound', 'Time entry not found or not accessible.')} />
    }

    return (
      <div className="flex flex-col gap-4">
        {locked ? (
          <Alert status="warning" data-testid="entry-dialog-locked">
            <AlertTitle className="flex items-center gap-2">
              <Lock className="size-3.5" aria-hidden="true" />
              {t('staff.time_tracking.entryDialog.locked.badge', 'Locked')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'staff.time_tracking.entryDialog.locked.notice',
                'This entry is closed in a report, so it can no longer be edited.',
              )}
            </AlertDescription>
            {lockedReportId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                data-testid="entry-dialog-locked-report"
                onClick={() =>
                  window.open(`${REPORTS_PATH}?id=${encodeURIComponent(lockedReportId)}`, '_blank', 'noopener')
                }
              >
                {t('staff.time_tracking.entryDialog.locked.showReport', 'Show the report')}
              </Button>
            ) : null}
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-dialog-task">
            {t('staff.time_tracking.entryDialog.task', 'Task')}
            <span aria-hidden="true"> *</span>
          </Label>
          <Select
            value={taskId ?? undefined}
            disabled={locked}
            onValueChange={(next) => setTaskId(next || null)}
          >
            <SelectTrigger id="entry-dialog-task" data-testid="entry-dialog-task">
              <SelectValue placeholder={t('staff.time_tracking.entryDialog.taskPlaceholder', 'Pick a task')} />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  {describeTaskOption(task, task.timeProjectId ? projectById.get(task.timeProjectId) : null)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t(
              'staff.time_tracking.entryDialog.taskHint',
              'The project and the customer follow from the task — you do not pick them separately.',
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-dialog-description">
            {t('staff.time_tracking.entryDialog.description', 'Description')}
          </Label>
          <Input
            id="entry-dialog-description"
            value={description}
            disabled={locked}
            onChange={(event) => setDescription(event.target.value)}
            data-testid="entry-dialog-description"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-dialog-date">{t('staff.time_tracking.entryDialog.date', 'Date')}</Label>
            <Input
              id="entry-dialog-date"
              type="date"
              value={date}
              disabled={locked}
              onChange={(event) => setDate(event.target.value)}
              data-testid="entry-dialog-date"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-dialog-duration" className="flex items-center gap-2">
              {t('staff.time_tracking.entryDialog.duration', 'Duration')}
              {interval.computed === 'duration' ? computedBadge('duration') : null}
            </Label>
            <DurationInput
              key={`entry-dialog-duration-${interval.durationEpoch}`}
              id="entry-dialog-duration"
              value={durationMinutes}
              disabled={locked}
              ariaLabel={t('staff.time_tracking.entryDialog.duration', 'Duration')}
              onChange={(minutes, state) =>
                setIntervalState((current) =>
                  reduceIntervalState(current, {
                    field: 'duration',
                    minutes,
                    invalid: state.status === 'invalid',
                  }),
                )
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-dialog-start" className="flex items-center gap-2">
              {t('staff.time_tracking.entryDialog.start', 'Start')}
              {interval.computed === 'start' ? computedBadge('start') : null}
            </Label>
            <Input
              id="entry-dialog-start"
              value={startClock}
              disabled={locked}
              inputClassName="font-mono tabular-nums"
              placeholder="15:10"
              onChange={(event) =>
                setIntervalState((current) =>
                  reduceIntervalState(current, { field: 'start', value: event.target.value }),
                )
              }
              data-testid="entry-dialog-start"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-dialog-end" className="flex items-center gap-2">
              {t('staff.time_tracking.entryDialog.end', 'End')}
              {interval.computed === 'end' ? computedBadge('end') : null}
            </Label>
            <Input
              id="entry-dialog-end"
              value={endClock}
              disabled={locked}
              inputClassName="font-mono tabular-nums"
              placeholder="16:25"
              onChange={(event) =>
                setIntervalState((current) =>
                  reduceIntervalState(current, { field: 'end', value: event.target.value }),
                )
              }
              data-testid="entry-dialog-end"
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'staff.time_tracking.entryDialog.endHint',
                'Change this field and the duration recalculates itself.',
              )}
            </p>
          </div>
        </div>

        {midnightEndDate ? (
          <p className="text-xs text-muted-foreground" data-testid="entry-dialog-midnight">
            {t('staff.time_tracking.entryDialog.midnight', 'This entry ends the next day, {date}.', {
              date: midnightEndDate,
            })}
          </p>
        ) : null}

        {overlap ? (
          <Alert status="warning" data-testid="entry-dialog-overlap">
            <AlertTitle>
              {t('staff.time_tracking.entryDialog.overlap.title', 'This time overlaps another entry')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'staff.time_tracking.entryDialog.overlap.body',
                '{start} – {end} · „{task}” · {project} ({duration}). Overlapping is allowed — if it is intentional, just save.',
                {
                  start: overlap.startText,
                  end: overlap.endText,
                  task:
                    overlap.taskTitle ??
                    overlap.description ??
                    t('staff.time_tracking.entryDialog.overlap.noTask', 'no task'),
                  project:
                    overlap.projectName ??
                    t('staff.time_tracking.entryDialog.overlap.noProject', 'no project'),
                  duration: formatDuration(overlap.durationMinutes, 'clock'),
                },
              )}
            </AlertDescription>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleShowOverlap(overlap)}
                data-testid="entry-dialog-overlap-show"
              >
                {t('staff.time_tracking.entryDialog.overlap.show', 'Show that entry')}
              </Button>
              {overlap.endText ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() =>
                    setIntervalState((current) =>
                      reduceIntervalState(current, { field: 'snapStart', value: overlap.endText }),
                    )
                  }
                  data-testid="entry-dialog-overlap-snap"
                >
                  {t('staff.time_tracking.entryDialog.overlap.snap', 'Snap start to {time}', {
                    time: overlap.endText,
                  })}
                </Button>
              ) : null}
            </div>
          </Alert>
        ) : null}

        <Separator />

        <div className="flex items-center gap-3">
          <Switch
            checked={isBillable}
            disabled={locked}
            onCheckedChange={(next) => setIsBillable(next)}
            aria-label={t('staff.time_tracking.entryDialog.billable', 'Billable')}
            data-testid="entry-dialog-billable"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">
              {t('staff.time_tracking.entryDialog.billable', 'Billable')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('staff.time_tracking.entryDialog.billableHint', 'On by default for this project.')}
            </span>
          </div>
          {canSeeMoney && rateLabel ? (
            <Badge variant="success" data-testid="entry-dialog-rate-badge">
              {t('staff.time_tracking.entryDialog.ratePerHour', '{amount}/h', { amount: rateLabel })}
            </Badge>
          ) : null}
        </div>

        {canSeeMoney ? (
          <>
            <div className="flex items-center gap-3">
              <Switch
                checked={rateOverrideEnabled}
                disabled={locked}
                onCheckedChange={(next) => setRateOverrideEnabled(next)}
                aria-label={t('staff.time_tracking.entryDialog.rateOverride', 'Custom rate for this entry')}
                data-testid="entry-dialog-rate-override"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground">
                  {t('staff.time_tracking.entryDialog.rateOverride', 'Custom rate for this entry')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(
                    'staff.time_tracking.entryDialog.rateOverrideHint',
                    'Overrides the project rate here only.',
                  )}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {rateOverrideEnabled ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="entry-dialog-rate">
                    {t('staff.time_tracking.entryDialog.rate', 'Rate')}
                  </Label>
                  <Input
                    id="entry-dialog-rate"
                    value={rateText}
                    disabled={locked}
                    inputMode="decimal"
                    onChange={(event) => setRateText(event.target.value)}
                    data-testid="entry-dialog-rate"
                  />
                  {projectRateLabel ? (
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'staff.time_tracking.entryDialog.rateHint',
                        'Defaults to {amount} (the project rate).',
                        { amount: projectRateLabel },
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="entry-dialog-cost" className="flex items-center gap-2">
                  {t('staff.time_tracking.entryDialog.cost', 'Cost')}
                  {computedBadge('cost')}
                </Label>
                <Input
                  id="entry-dialog-cost"
                  readOnly
                  disabled
                  value={cost === null ? '' : formatCurrency(cost, currencyCode) ?? String(cost)}
                  inputClassName="font-mono tabular-nums"
                  data-testid="entry-dialog-cost"
                />
                {rateLabel && durationMinutes ? (
                  <p className="text-xs text-muted-foreground" data-testid="entry-dialog-cost-hint">
                    {t(
                      'staff.time_tracking.entryDialog.costHint',
                      '{raw} rounded to {rounded} × {rate}',
                      {
                        raw: formatDuration(durationMinutes, 'clock'),
                        rounded: formatDuration(roundedMinutes, 'clock'),
                        rate: rateLabel,
                      },
                    )}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="entry-dialog-money-hidden">
            {t(
              'staff.time_tracking.entryDialog.moneyHidden',
              'Rates and cost are hidden — your permissions do not cover money on time entries.',
            )}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('staff.time_tracking.entryDialog.tags', 'Tags')}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {assignedTags.map((tag) => (
              <Badge key={tag.id} variant="neutral" className="gap-1">
                {tag.label}
                {locked ? null : (
                  <button
                    type="button"
                    aria-label={t('staff.time_tracking.entryDialog.removeTag', 'Remove tag {label}', {
                      label: tag.label,
                    })}
                    onClick={() => setTagIds((current) => current.filter((id) => id !== tag.id))}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                )}
              </Badge>
            ))}
            {!locked && availableTags.length > 0 ? (
              <Select
                key={tagIds.join(',')}
                onValueChange={(value) => setTagIds((current) => [...current, value])}
              >
                <SelectTrigger
                  size="sm"
                  className="w-40"
                  aria-label={t('staff.time_tracking.entryDialog.addTag', 'Add tag')}
                  data-testid="entry-dialog-tag-select"
                >
                  <SelectValue placeholder={t('staff.time_tracking.entryDialog.addTag', 'Add tag')} />
                </SelectTrigger>
                <SelectContent>
                  {availableTags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        <Alert status="information" data-testid="entry-dialog-creator">
          <AlertDescription>
            {selfQuery.data?.displayName
              ? t(
                  'staff.time_tracking.entryDialog.creator',
                  'Entry author: {name} — assigned automatically and not editable.',
                  { name: selfQuery.data.displayName },
                )
              : t(
                  'staff.time_tracking.entryDialog.creatorUnknown',
                  'The entry author is assigned automatically and is not editable.',
                )}
          </AlertDescription>
        </Alert>
      </div>
    )
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        data-testid="entry-dialog"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit('close')
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onOpenChange(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('staff.time_tracking.entryDialog.titleEdit', 'Time entry')
              : t('staff.time_tracking.entryDialog.titleCreate', 'New time entry')}
          </DialogTitle>
          {headerHint ? <span className="text-xs text-muted-foreground">{headerHint}</span> : null}
        </DialogHeader>

        {body}

        <DialogFooter>
          <span className="mr-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
            {t('staff.time_tracking.entryDialog.shortcutSave', 'save')}
            <span aria-hidden="true">·</span>
            <Kbd>esc</Kbd>
            {t('staff.time_tracking.entryDialog.shortcutCancel', 'cancel')}
          </span>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {locked
              ? t('staff.time_tracking.entryDialog.close', 'Close')
              : t('staff.time_tracking.entryDialog.cancel', 'Cancel')}
          </Button>
          {locked ? null : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={!canSave}
                onClick={() => void submit('again')}
                data-testid="entry-dialog-save-again"
              >
                {t('staff.time_tracking.entryDialog.saveAndNew', 'Save and add another')}
              </Button>
              <Button
                type="button"
                disabled={!canSave}
                onClick={() => void submit('close')}
                data-testid="entry-dialog-save"
              >
                {t('staff.time_tracking.entryDialog.save', 'Save')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default TimeEntryDialog
