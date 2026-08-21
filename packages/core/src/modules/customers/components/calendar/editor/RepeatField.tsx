"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import type { EditorRepeatEndType, EditorRepeatFreq } from '../../../lib/calendar/editorPayload'
import { DateControl, LABEL_CLASS } from './inputs'
import { SegmentGroup } from './SegmentGroup'

const DAY_LABEL_KEYS = [
  { letterKey: 'customers.calendar.editor.repeat.days.mon', letterFallback: 'M', ariaKey: 'customers.calendar.day.mon', ariaFallback: 'MON' },
  { letterKey: 'customers.calendar.editor.repeat.days.tue', letterFallback: 'T', ariaKey: 'customers.calendar.day.tue', ariaFallback: 'TUE' },
  { letterKey: 'customers.calendar.editor.repeat.days.wed', letterFallback: 'W', ariaKey: 'customers.calendar.day.wed', ariaFallback: 'WED' },
  { letterKey: 'customers.calendar.editor.repeat.days.thu', letterFallback: 'T', ariaKey: 'customers.calendar.day.thu', ariaFallback: 'THU' },
  { letterKey: 'customers.calendar.editor.repeat.days.fri', letterFallback: 'F', ariaKey: 'customers.calendar.day.fri', ariaFallback: 'FRI' },
  { letterKey: 'customers.calendar.editor.repeat.days.sat', letterFallback: 'S', ariaKey: 'customers.calendar.day.sat', ariaFallback: 'SAT' },
  { letterKey: 'customers.calendar.editor.repeat.days.sun', letterFallback: 'S', ariaKey: 'customers.calendar.day.sun', ariaFallback: 'SUN' },
]

export function RepeatField({
  freq,
  days,
  endType,
  count,
  untilDate,
  locale,
  onFreqChange,
  onToggleDay,
  onEndTypeChange,
  onCountChange,
  onUntilDateChange,
}: {
  freq: EditorRepeatFreq
  days: boolean[]
  endType: EditorRepeatEndType
  count: number
  untilDate: string
  locale: string
  onFreqChange(next: EditorRepeatFreq): void
  onToggleDay(index: number): void
  onEndTypeChange(next: EditorRepeatEndType): void
  onCountChange(next: number): void
  onUntilDateChange(next: string): void
}) {
  const t = useT()
  const freqLabel = t('customers.calendar.editor.repeat.label', 'Repeat')
  return (
    <div className="flex w-full flex-col gap-2.5">
      <span className={LABEL_CLASS}>{freqLabel}</span>
      <Select
        value={freq}
        onValueChange={(value) => onFreqChange(value as EditorRepeatFreq)}
      >
        <SelectTrigger aria-label={freqLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('customers.calendar.editor.repeat.freq.none', 'Does not repeat')}</SelectItem>
          <SelectItem value="daily">{t('customers.calendar.editor.repeat.freq.daily', 'Daily')}</SelectItem>
          <SelectItem value="weekly">{t('customers.calendar.editor.repeat.freq.weekly', 'Weekly')}</SelectItem>
        </SelectContent>
      </Select>
      {freq === 'weekly' ? (
        <div className="flex items-start gap-1.5">
          {DAY_LABEL_KEYS.map((day, index) => {
            const isActive = Boolean(days[index])
            return (
              <Button
                key={day.ariaKey}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                aria-pressed={isActive}
                aria-label={t(day.ariaKey, day.ariaFallback)}
                onClick={() => onToggleDay(index)}
                className={cn(
                  'size-9 px-0 text-xs font-medium',
                  !isActive && 'text-muted-foreground',
                )}
              >
                {t(day.letterKey, day.letterFallback)}
              </Button>
            )
          })}
        </div>
      ) : null}
      {freq !== 'none' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={LABEL_CLASS}>{t('customers.calendar.editor.repeat.ends', 'Ends')}</span>
          <SegmentGroup
            ariaLabel={t('customers.calendar.editor.repeat.ends', 'Ends')}
            value={endType}
            onChange={onEndTypeChange}
            options={[
              { value: 'never', label: t('customers.calendar.editor.repeat.never', 'Never') },
              { value: 'date', label: t('customers.calendar.editor.repeat.onDate', 'On date') },
              { value: 'count', label: t('customers.calendar.editor.repeat.after', 'After') },
            ]}
          />
          {endType === 'date' ? (
            <DateControl
              className="w-44"
              value={untilDate || ''}
              onChange={onUntilDateChange}
              ariaLabel={t('customers.calendar.editor.repeat.onDate', 'On date')}
              locale={locale}
            />
          ) : null}
          {endType === 'count' ? (
            <span className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={365}
                value={count}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (Number.isInteger(next) && next >= 1) onCountChange(next)
                }}
                aria-label={t('customers.calendar.editor.repeat.after', 'After')}
                className="h-9 w-20"
              />
              <span className={LABEL_CLASS}>{t('customers.calendar.editor.repeat.times', 'times')}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
