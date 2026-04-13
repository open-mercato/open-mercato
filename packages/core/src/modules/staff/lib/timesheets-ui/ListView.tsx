'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ProjectColorDot } from './ProjectColorDot'

type TimeEntry = {
  id: string
  date: string
  durationMinutes: number
  projectId: string
  projectName: string
  projectCode: string | null
  projectColor: string | null
  notes: string | null
  source: string
  startedAt: string | null
  endedAt: string | null
}

type ListViewProps = {
  entries: TimeEntry[]
  onEntryUpdated?: () => void
}

function getLocalDateStr(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDayLabel(dateStr: string, translate: TranslateFn): string {
  const today = new Date()
  const todayStr = getLocalDateStr(today)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = getLocalDateStr(yesterday)

  if (dateStr === todayStr) return translate('staff.timesheets.my.list.today', 'Today')
  if (dateStr === yesterdayStr) return translate('staff.timesheets.my.list.yesterday', 'Yesterday')

  const date = new Date(dateStr + 'T00:00:00')
  const dayName = date.toLocaleDateString(undefined, { weekday: 'short' })
  const day = date.getDate()
  const month = date.toLocaleDateString(undefined, { month: 'short' })

  return `${dayName}, ${day} ${month}`
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}m`
}

function formatTimeRange(startedAt: string, endedAt: string): string {
  const start = new Date(startedAt)
  const end = new Date(endedAt)

  const format = (date: Date) =>
    date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

  return `${format(start)} - ${format(end)}`
}

function InlineDescription({
  entryId,
  initialValue,
  placeholder,
  onSaved,
}: {
  entryId: string
  initialValue: string | null
  placeholder: string
  onSaved?: () => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(initialValue ?? '')
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  const save = React.useCallback(async () => {
    const trimmed = value.trim()
    if (trimmed === (initialValue ?? '')) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await apiCall(`/api/staff/timesheets/time-entries`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entryId, notes: trimmed || null }),
      })
      onSaved?.()
    } catch {
      // silent
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }, [entryId, value, initialValue, onSaved])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`text-sm text-left cursor-pointer hover:underline ${
          initialValue ? '' : 'text-muted-foreground italic'
        }`}
      >
        {initialValue || placeholder}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { void save() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { void save() }
        if (e.key === 'Escape') { setValue(initialValue ?? ''); setEditing(false) }
      }}
      placeholder={placeholder}
      className="text-sm w-full bg-transparent border-b border-primary/40 outline-none py-0.5 placeholder:text-muted-foreground/50"
    />
  )
}

export function ListView({ entries, onEntryUpdated }: ListViewProps) {
  const t = useT()

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t('staff.timesheets.my.list.noEntries', 'No entries for this period.')}
      </div>
    )
  }

  const grouped = new Map<string, TimeEntry[]>()
  for (const entry of entries) {
    const existing = grouped.get(entry.date)
    if (existing) {
      existing.push(entry)
    } else {
      grouped.set(entry.date, [entry])
    }
  }

  const sortedDays = [...grouped.keys()].sort((a, b) => b.localeCompare(a))

  return (
    <div>
      {sortedDays.map((dateStr) => {
        const dayEntries = grouped.get(dateStr)!
        const dailyTotal = dayEntries.reduce(
          (sum, entry) => sum + entry.durationMinutes,
          0,
        )

        return (
          <div key={dateStr} className="rounded-lg border mb-4">
            <div className="flex justify-between items-center p-4 border-b bg-muted/30 font-medium text-sm">
              <span>{formatDayLabel(dateStr, t)}</span>
              <span className="font-mono tabular-nums">
                {formatDuration(dailyTotal)}
              </span>
            </div>

            {dayEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between p-3 border-b last:border-0 hover:bg-muted/20"
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1 mr-4">
                  <InlineDescription
                    entryId={entry.id}
                    initialValue={entry.notes}
                    placeholder={t('staff.timesheets.my.list.addDescription', 'Add description')}
                    onSaved={onEntryUpdated}
                  />
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <ProjectColorDot colorKey={entry.projectColor} projectName={entry.projectName} size="xs" />
                    {entry.projectName}
                  </span>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  {entry.source === 'timer' &&
                  entry.startedAt &&
                  entry.endedAt ? (
                    <span className="text-xs text-muted-foreground">
                      {formatTimeRange(entry.startedAt, entry.endedAt)}
                    </span>
                  ) : null}
                  <span className="text-sm font-mono tabular-nums">
                    {formatDuration(entry.durationMinutes)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
