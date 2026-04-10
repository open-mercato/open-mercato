"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

type CalendarPickerProps = {
  selectedWeekStart: Date
  onWeekSelect: (weekStart: Date) => void
}

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isSameWeek(a: Date, b: Date): boolean {
  return isSameDay(getMonday(a), getMonday(b))
}

function buildWeeks(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1)
  const start = getMonday(firstDay)
  const weeks: Date[][] = []
  const current = new Date(start)

  for (let w = 0; w < 6; w++) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    weeks.push(week)
    if (current.getMonth() !== month && w >= 3) break
  }
  return weeks
}

const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export function CalendarPicker({ selectedWeekStart, onWeekSelect }: CalendarPickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [viewYear, setViewYear] = React.useState(selectedWeekStart.getFullYear())
  const [viewMonth, setViewMonth] = React.useState(selectedWeekStart.getMonth())
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  React.useEffect(() => {
    setViewYear(selectedWeekStart.getFullYear())
    setViewMonth(selectedWeekStart.getMonth())
  }, [selectedWeekStart])

  const weeks = React.useMemo(() => buildWeeks(viewYear, viewMonth), [viewYear, viewMonth])

  const monthLabel = React.useMemo(() => {
    return new Date(viewYear, viewMonth, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })
  }, [viewYear, viewMonth])

  const today = React.useMemo(() => new Date(), [])

  const handleWeekClick = React.useCallback((monday: Date) => {
    onWeekSelect(monday)
    setOpen(false)
  }, [onWeekSelect])

  const goToPrevMonth = React.useCallback(() => {
    setViewMonth((prev) => {
      if (prev === 0) { setViewYear((y) => y - 1); return 11 }
      return prev - 1
    })
  }, [])

  const goToNextMonth = React.useCallback(() => {
    setViewMonth((prev) => {
      if (prev === 11) { setViewYear((y) => y + 1); return 0 }
      return prev + 1
    })
  }, [])

  return (
    <div ref={containerRef} className="relative inline-block">
      <IconButton
        variant="outline"
        size="sm"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t('staff.timesheets.my.calendar.open', 'Open calendar')}
      >
        <CalendarDays className="size-4" />
      </IconButton>

      {open && (
        <div className="absolute left-0 z-20 mt-1 w-[280px] rounded-lg border bg-popover p-3 shadow-lg">
          {/* Quick links */}
          <div className="mb-3 flex gap-2 border-b pb-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs"
              onClick={() => handleWeekClick(getMonday(new Date()))}
            >
              {t('staff.timesheets.my.calendar.thisWeek', 'This week')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs"
              onClick={() => {
                const d = new Date()
                d.setDate(d.getDate() - 7)
                handleWeekClick(getMonday(d))
              }}
            >
              {t('staff.timesheets.my.calendar.lastWeek', 'Last week')}
            </Button>
          </div>

          {/* Month navigation */}
          <div className="mb-2 flex items-center justify-between">
            <IconButton variant="ghost" size="xs" type="button" onClick={goToPrevMonth} aria-label="Previous month">
              <ChevronLeft className="size-3.5" />
            </IconButton>
            <span className="text-sm font-medium">{monthLabel}</span>
            <IconButton variant="ghost" size="xs" type="button" onClick={goToNextMonth} aria-label="Next month">
              <ChevronRight className="size-3.5" />
            </IconButton>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-[32px_repeat(7,1fr)] gap-0 mb-1">
            <div />
            {DAY_HEADERS.map((day) => (
              <div key={day} className="text-center text-[11px] font-medium text-muted-foreground py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Week rows */}
          {weeks.map((week) => {
            const monday = week[0]
            const weekNum = getWeekNumber(monday)
            const isSelected = isSameWeek(monday, selectedWeekStart)

            return (
              <button
                key={monday.toISOString()}
                type="button"
                className={`grid grid-cols-[32px_repeat(7,1fr)] gap-0 w-full rounded-md cursor-pointer transition-colors
                  ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                onClick={() => handleWeekClick(monday)}
              >
                <span className={`text-[10px] font-medium py-1.5 text-center ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                  {weekNum}
                </span>
                {week.map((date) => {
                  const inMonth = date.getMonth() === viewMonth
                  const isToday = isSameDay(date, today)
                  return (
                    <span
                      key={date.toISOString()}
                      className={`text-xs py-1.5 text-center
                        ${!inMonth && !isSelected ? 'text-muted-foreground/40' : ''}
                        ${isToday && !isSelected ? 'font-bold text-primary' : ''}
                        ${isToday && isSelected ? 'font-bold underline' : ''}`}
                    >
                      {date.getDate()}
                    </span>
                  )
                })}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
