'use client'

import * as React from 'react'
import { Copy, Lock, Pencil, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DurationInput } from '../time-tracking-ui/DurationInput'
import { formatDuration } from '../time-tracking/duration'
import {
  loadPercent,
  suggestNextStartClock,
  type TimesheetDay,
  type TimesheetEntry,
} from '../time-tracking-ui/timesheetData'
import { formatDayLabel, formatLongDayLabel } from '../time-tracking-ui/timesheetPeriod'
import { targetLabel, type TimesheetLogTarget } from '../time-tracking-ui/timesheetTargets'

/**
 * Screen 12 — the period as a stack of days (T5.3).
 *
 * Four notes on the mockup, four rules here:
 *
 *  1. **The author is on the line only when the view is showing more than one
 *     person** (note 1). A Team Member filtered to themselves does not need to
 *     be told, on every row, that they logged it.
 *  2. **Exactly one day starts expanded — the one that deviates from the
 *     target** (note 2), chosen by `pickDefaultExpandedDay`. Every bar is
 *     clickable, so any other day is one click away, and the expansion is a
 *     controlled prop so the page can re-derive it when the period changes.
 *  3. **The quick-add row's third field is the start time, prefilled with the
 *     end of the previous entry of that day** (note 3). The suggestion is
 *     recomputed from the day's entries rather than remembered, so adding a
 *     second entry immediately offers the end of the first.
 *  4. **A weekend is greyed and contributes no target** but still shows any time
 *     logged on it (note 4). It reads `—`, never `0:00`: nothing was logged, a
 *     zero-length day was not worked.
 */

export type ListViewQuickAdd = {
  date: string
  targetKey: string
  durationMinutes: number
  startClock: string | null
}

export type ListViewProps = {
  days: readonly TimesheetDay[]
  scaleMinutes: number | null
  /** Per-day target in minutes; `null` when the tenant cleared `targets.dailyHours`. */
  dailyTargetMinutes: number | null
  expandedDate: string | null
  onExpandedDateChange: (date: string | null) => void
  targets: readonly TimesheetLogTarget[]
  showAuthor: boolean
  authorNames: ReadonlyMap<string, string>
  canManage: boolean
  onQuickAdd: (input: ListViewQuickAdd) => Promise<void> | void
  onEditEntry: (entry: TimesheetEntry) => void
  onDuplicateEntry: (entry: TimesheetEntry) => void
  /** Fired after a successful inline description save, so the page can refetch. */
  onEntryUpdated?: () => void
  locale?: string
}

const ENTRIES_ENDPOINT = '/api/staff/timesheets/time-entries'
const DESCRIPTION_CONTEXT_ID = 'staff.time_tracking.timesheet.list.description'

/**
 * The description of a row, editable in place — carried over from the previous
 * list view, which is where the one-word note that makes an entry readable is
 * normally typed. Its three rules are regression-tested and predate this
 * redesign:
 *
 *  * a failed PUT is NOT success — the editor stays open, an error is flashed and
 *    the caller is not told the row changed;
 *  * a 2xx closes the editor and notifies the caller;
 *  * a 409 raises the shared conflict bar instead of a generic error.
 *
 * The write now also carries the record's version (`buildOptimisticLockHeader`),
 * which the old inline editor did not, so two people editing the same entry's
 * description get a conflict rather than a silent last-write-wins.
 */
function InlineDescription({
  entry,
  placeholder,
  onSaved,
}: {
  entry: TimesheetEntry
  placeholder: string
  onSaved?: () => void
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(entry.description ?? '')
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: DESCRIPTION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  const save = React.useCallback(async () => {
    const trimmed = value.trim()
    if (trimmed === (entry.description ?? '')) {
      setEditing(false)
      return
    }
    const payload = { id: entry.id, notes: trimmed || null }
    setSaving(true)
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(entry.updatedAt), () =>
            apiCallOrThrow(ENTRIES_ENDPOINT, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          ),
        context: {
          formId: DESCRIPTION_CONTEXT_ID,
          resourceKind: 'staff.timesheets.time_entry',
          resourceId: entry.id,
          retryLastMutation,
        },
        mutationPayload: payload,
      })
      setSaving(false)
      setEditing(false)
      onSaved?.()
    } catch (error) {
      setSaving(false)
      if (!surfaceRecordConflict(error, t)) {
        flash(
          t('staff.timesheets.my.list.saveError', 'Failed to save description. Please try again.'),
          'error',
        )
      }
    }
  }, [entry.description, entry.id, entry.updatedAt, onSaved, retryLastMutation, runMutation, t, value])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          'text-left text-xs hover:underline',
          entry.description ? 'text-muted-foreground' : 'italic text-muted-foreground/70',
        )}
      >
        {entry.description || placeholder}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      disabled={saving}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        void save()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void save()
        if (event.key === 'Escape') {
          setValue(entry.description ?? '')
          setEditing(false)
        }
      }}
      placeholder={placeholder}
      className="w-full border-b border-primary/40 bg-transparent py-0.5 text-xs outline-none placeholder:text-muted-foreground/50"
    />
  )
}

export function ListView({
  days,
  scaleMinutes,
  dailyTargetMinutes,
  expandedDate,
  onExpandedDateChange,
  targets,
  showAuthor,
  authorNames,
  canManage,
  onQuickAdd,
  onEditEntry,
  onDuplicateEntry,
  onEntryUpdated,
  locale,
}: ListViewProps) {
  const t = useT()

  if (days.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t('staff.time_tracking.timesheet.list.empty', 'No days in this period.')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {days.map((day) => {
          const expanded = day.date === expandedDate
          const deviation =
            dailyTargetMinutes !== null && !day.isWeekend ? day.totalMinutes - dailyTargetMinutes : null
          return (
            <button
              key={day.date}
              type="button"
              aria-expanded={expanded}
              onClick={() => onExpandedDateChange(expanded ? null : day.date)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors',
                'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                expanded ? 'bg-muted/50' : null,
              )}
            >
              <span
                className={cn(
                  'w-32 shrink-0 text-sm',
                  day.isWeekend ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {formatDayLabel(day.date, locale)}
              </span>
              <span className="min-w-0 flex-1">
                <Progress value={loadPercent(day.totalMinutes, scaleMinutes)} size="sm" />
              </span>
              <span
                className={cn(
                  'w-16 shrink-0 text-right font-mono text-sm tabular-nums',
                  day.totalMinutes > 0 ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {day.totalMinutes > 0 ? formatDuration(day.totalMinutes, 'clock') : '—'}
              </span>
              {deviation !== null && deviation < 0 ? (
                <StatusBadge variant="warning">
                  {t('staff.time_tracking.timesheet.list.belowTarget', '{duration} below target', {
                    duration: formatDuration(Math.abs(deviation), 'clock'),
                  })}
                </StatusBadge>
              ) : null}
            </button>
          )
        })}
      </div>

      {expandedDate ? (
        <ExpandedDay
          day={days.find((day) => day.date === expandedDate) ?? null}
          dailyTargetMinutes={dailyTargetMinutes}
          targets={targets}
          showAuthor={showAuthor}
          authorNames={authorNames}
          canManage={canManage}
          onQuickAdd={onQuickAdd}
          onEditEntry={onEditEntry}
          onDuplicateEntry={onDuplicateEntry}
          onEntryUpdated={onEntryUpdated}
          locale={locale}
        />
      ) : null}
    </div>
  )
}

function ExpandedDay({
  day,
  dailyTargetMinutes,
  targets,
  showAuthor,
  authorNames,
  canManage,
  onQuickAdd,
  onEditEntry,
  onDuplicateEntry,
  onEntryUpdated,
  locale,
}: {
  day: TimesheetDay | null
  dailyTargetMinutes: number | null
  targets: readonly TimesheetLogTarget[]
  showAuthor: boolean
  authorNames: ReadonlyMap<string, string>
  canManage: boolean
  onQuickAdd: (input: ListViewQuickAdd) => Promise<void> | void
  onEditEntry: (entry: TimesheetEntry) => void
  onDuplicateEntry: (entry: TimesheetEntry) => void
  onEntryUpdated?: () => void
  locale?: string
}) {
  const t = useT()
  if (!day) return null
  const deviation = dailyTargetMinutes !== null && !day.isWeekend ? day.totalMinutes - dailyTargetMinutes : null

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {formatLongDayLabel(day.date, locale)} — {formatDuration(day.totalMinutes, 'clock')}
        </span>
        {deviation !== null && deviation !== 0 ? (
          <StatusBadge variant={deviation > 0 ? 'success' : 'warning'}>
            {deviation > 0
              ? t('staff.time_tracking.timesheet.list.aboveTarget', '{duration} above target', {
                  duration: formatDuration(deviation, 'clock'),
                })
              : t('staff.time_tracking.timesheet.list.belowTarget', '{duration} below target', {
                  duration: formatDuration(Math.abs(deviation), 'clock'),
                })}
          </StatusBadge>
        ) : null}
      </div>

      {day.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('staff.time_tracking.timesheet.list.noEntries', 'Nothing logged on this day yet.')}
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {day.entries.map((entry) => (
              <tr key={entry.id} className="border-b last:border-0">
                <td className="w-28 py-2 align-top text-xs text-muted-foreground">
                  {entry.startText && entry.endText ? `${entry.startText} – ${entry.endText}` : '—'}
                </td>
                <td className="py-2 align-top">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {entry.taskTitle ??
                        entry.description ??
                        t('staff.time_tracking.timesheet.list.noTask', 'No task')}
                    </span>
                    {entry.isBillable ? null : (
                      <StatusBadge variant="neutral">
                        {t('staff.time_tracking.timesheet.list.nonBillable', 'non-billable')}
                      </StatusBadge>
                    )}
                    {entry.isLocked ? (
                      <StatusBadge variant="neutral">
                        <Lock className="size-3" aria-hidden="true" />
                        {t('staff.time_tracking.timesheet.list.locked', 'locked')}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      entry.projectLabel,
                      showAuthor && entry.staffMemberId ? authorNames.get(entry.staffMemberId) ?? null : null,
                    ]
                      .filter((part): part is string => Boolean(part))
                      .join(' · ')}
                  </div>
                  {canManage && !entry.isLocked ? (
                    <InlineDescription
                      entry={entry}
                      placeholder={t('staff.timesheets.my.list.addDescription', 'Add description')}
                      onSaved={onEntryUpdated}
                    />
                  ) : entry.description ? (
                    <div className="text-xs text-muted-foreground">{entry.description}</div>
                  ) : null}
                </td>
                <td className="w-20 py-2 text-right align-top font-mono font-semibold tabular-nums">
                  {formatDuration(entry.durationMinutes, 'clock')}
                </td>
                <td className="w-24 py-2 text-right align-top">
                  {canManage ? (
                    <span className="inline-flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="2xs"
                        aria-label={t('staff.time_tracking.timesheet.list.duplicate', 'Duplicate')}
                        onClick={() => onDuplicateEntry(entry)}
                        disabled={entry.isLocked}
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="2xs"
                        aria-label={t('staff.time_tracking.timesheet.list.edit', 'Edit')}
                        onClick={() => onEditEntry(entry)}
                        disabled={entry.isLocked}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage && targets.length > 0 ? (
        <QuickAddRow key={day.date} day={day} targets={targets} onQuickAdd={onQuickAdd} />
      ) : null}
    </div>
  )
}

function QuickAddRow({
  day,
  targets,
  onQuickAdd,
}: {
  day: TimesheetDay
  targets: readonly TimesheetLogTarget[]
  onQuickAdd: (input: ListViewQuickAdd) => Promise<void> | void
}) {
  const t = useT()
  const [targetKey, setTargetKey] = React.useState<string>(() => targets[0]?.key ?? '')
  const [minutes, setMinutes] = React.useState<number | null>(null)
  const [durationEpoch, setDurationEpoch] = React.useState(0)
  const suggestedStart = suggestNextStartClock(day)
  const [startClock, setStartClock] = React.useState<string>(suggestedStart ?? '')
  const [submitting, setSubmitting] = React.useState(false)
  const suggestedRef = React.useRef(suggestedStart)

  // The suggestion follows the day's entries: saving one immediately offers its
  // end for the next. A start the user typed themselves is never overwritten.
  React.useEffect(() => {
    if (suggestedRef.current === suggestedStart) return
    const previousSuggestion = suggestedRef.current
    suggestedRef.current = suggestedStart
    setStartClock((current) => (current === (previousSuggestion ?? '') ? suggestedStart ?? '' : current))
  }, [suggestedStart])

  const submit = React.useCallback(async () => {
    if (!targetKey || minutes === null || minutes <= 0 || submitting) return
    setSubmitting(true)
    try {
      await onQuickAdd({
        date: day.date,
        targetKey,
        durationMinutes: minutes,
        startClock: startClock.trim() ? startClock.trim() : null,
      })
      setMinutes(null)
      setDurationEpoch((epoch) => epoch + 1)
    } finally {
      setSubmitting(false)
    }
  }, [day.date, minutes, onQuickAdd, startClock, submitting, targetKey])

  return (
    <div
      className="flex flex-wrap items-start gap-2"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          void submit()
        }
      }}
    >
      <Select value={targetKey} onValueChange={setTargetKey}>
        <SelectTrigger
          className="w-72"
          aria-label={t('staff.time_tracking.timesheet.list.quickAdd.target', 'Project or task')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {targets.map((target) => (
            <SelectItem key={target.key} value={target.key}>
              {targetLabel(target)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="w-32">
        <DurationInput
          key={durationEpoch}
          variant="compact"
          value={minutes}
          onChange={(next) => setMinutes(next)}
          ariaLabel={t('staff.time_tracking.timesheet.list.quickAdd.duration', 'Duration')}
          placeholder={t('staff.time_tracking.duration.placeholder', '1h 30m')}
        />
      </div>
      <Input
        size="sm"
        className="w-24"
        inputClassName="font-mono tabular-nums"
        value={startClock}
        onChange={(event) => setStartClock(event.target.value)}
        aria-label={t('staff.time_tracking.timesheet.list.quickAdd.start', 'Start time')}
        placeholder={t('staff.time_tracking.timesheet.list.quickAdd.startPlaceholder', '13:30')}
      />
      <Button
        type="button"
        size="sm"
        onClick={() => void submit()}
        disabled={submitting || minutes === null || minutes <= 0 || !targetKey}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t('staff.time_tracking.timesheet.list.quickAdd.submit', 'Add')}
      </Button>
    </div>
  )
}
