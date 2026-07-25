"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { EditorDateLabel } from '../../../lib/calendar/editorPayload'
import { multiDayEventSpan } from '../../../lib/calendar/labels'
import { AllDayToggle, DateControl, LABEL_CLASS, TimeControl } from './inputs'

const DATE_LABEL_TEXT: Record<EditorDateLabel, { key: string; fallback: string }> = {
  starts: { key: 'customers.calendar.editor.dates.starts', fallback: 'Starts' },
  when: { key: 'customers.calendar.editor.dates.when', fallback: 'When' },
  sent: { key: 'customers.calendar.editor.dates.sent', fallback: 'Sent' },
  logged: { key: 'customers.calendar.editor.dates.logged', fallback: 'Logged' },
  due: { key: 'customers.calendar.editor.dates.due', fallback: 'Due' },
}

function DateTimeRow({
  label,
  date,
  time,
  showTime,
  locale,
  onDateChange,
  onTimeChange,
}: {
  label: string
  date: string
  time: string
  showTime: boolean
  locale: string
  onDateChange(next: string): void
  onTimeChange(next: string): void
}) {
  return (
    <div className="flex w-full items-end gap-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className={LABEL_CLASS}>{label}</span>
        <DateControl value={date} onChange={onDateChange} ariaLabel={label} locale={locale} />
      </div>
      {showTime ? <TimeControl value={time} onChange={onTimeChange} ariaLabel={label} /> : null}
    </div>
  )
}

export function ScheduleSection({
  dateLabel,
  hasAllDay,
  hasEnd,
  allDay,
  date,
  startTime,
  endDate,
  endTime,
  locale,
  endsError,
  onAllDayChange,
  onDateChange,
  onStartTimeChange,
  onEndDateChange,
  onEndTimeChange,
}: {
  dateLabel: EditorDateLabel
  hasAllDay: boolean
  hasEnd: boolean
  allDay: boolean
  date: string
  startTime: string
  endDate: string
  endTime: string
  locale: string
  endsError?: string | null
  onAllDayChange(next: boolean): void
  onDateChange(next: string): void
  onStartTimeChange(next: string): void
  onEndDateChange(next: string): void
  onEndTimeChange(next: string): void
}) {
  const t = useT()
  const showTime = !(hasAllDay && allDay)
  const multiDaySpan = hasEnd && !endsError ? multiDayEventSpan(date, endDate) : 0
  return (
    <div className="flex w-full flex-col gap-2.5">
      {hasAllDay ? (
        <div className="flex w-full items-center justify-between">
          <span className={LABEL_CLASS}>{t('customers.calendar.editor.allDay', 'All day')}</span>
          <AllDayToggle checked={allDay} onCheckedChange={onAllDayChange} label={t('customers.calendar.editor.allDay', 'All day')} />
        </div>
      ) : null}
      <DateTimeRow
        label={t(DATE_LABEL_TEXT[dateLabel].key, DATE_LABEL_TEXT[dateLabel].fallback)}
        date={date}
        time={startTime}
        showTime={showTime}
        locale={locale}
        onDateChange={onDateChange}
        onTimeChange={onStartTimeChange}
      />
      {hasEnd ? (
        <DateTimeRow
          label={t('customers.calendar.editor.dates.ends', 'Ends')}
          date={endDate}
          time={endTime}
          showTime={showTime}
          locale={locale}
          onDateChange={onEndDateChange}
          onTimeChange={onEndTimeChange}
        />
      ) : null}
      {endsError ? <p className="text-xs text-status-error-text">{endsError}</p> : null}
      {multiDaySpan > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('customers.calendar.editor.multiDayHint', 'Multi-day event · {count} days', { count: multiDaySpan })}
        </p>
      ) : null}
    </div>
  )
}
