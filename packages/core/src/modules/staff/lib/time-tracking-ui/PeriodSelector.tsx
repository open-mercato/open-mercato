"use client"

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  TIMESHEET_PERIOD_KINDS,
  formatPeriodLabel,
  shiftPeriodAnchor,
  todayIso,
  type TimesheetPeriodKind,
} from './timesheetPeriod'

/**
 * Screens 11 and 12, top-left: `Rok · Kwartał · Miesiąc · Tydzień` plus the
 * prev / label / next / today cluster (T5.1).
 *
 * The component is fully controlled and owns no date maths — it hands the anchor
 * to `shiftPeriodAnchor` and renders whatever comes back. That is what makes
 * US-E1 ("switching week↔month stays around now") a property of
 * `timesheetPeriod.ts` rather than of a React callback nobody can test.
 */

export type PeriodSelectorProps = {
  periodKind: TimesheetPeriodKind
  anchorDate: string
  onPeriodKindChange: (kind: TimesheetPeriodKind) => void
  onAnchorDateChange: (anchor: string) => void
  locale?: string
}

export function PeriodSelector({
  periodKind,
  anchorDate,
  onPeriodKindChange,
  onAnchorDateChange,
  locale,
}: PeriodSelectorProps) {
  const t = useT()

  const kindLabels: Record<TimesheetPeriodKind, string> = {
    year: t('staff.time_tracking.timesheet.period.year', 'Year'),
    quarter: t('staff.time_tracking.timesheet.period.quarter', 'Quarter'),
    month: t('staff.time_tracking.timesheet.period.month', 'Month'),
    week: t('staff.time_tracking.timesheet.period.week', 'Week'),
  }

  const label = React.useMemo(
    () => formatPeriodLabel(periodKind, anchorDate, locale),
    [anchorDate, locale, periodKind],
  )

  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        value={periodKind}
        onValueChange={(value) => {
          // The anchor is untouched on purpose — US-E1.
          if (value !== periodKind) onPeriodKindChange(value as TimesheetPeriodKind)
        }}
        aria-label={t('staff.time_tracking.timesheet.period.label', 'Period')}
        className="shrink-0"
      >
        {TIMESHEET_PERIOD_KINDS.map((kind) => (
          <SegmentedControlItem key={kind} value={kind}>
            {kindLabels[kind]}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>

      <div className="flex items-center gap-1">
        <IconButton
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('staff.time_tracking.timesheet.period.previous', 'Previous period')}
          onClick={() => onAnchorDateChange(shiftPeriodAnchor(periodKind, anchorDate, -1))}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <span className="min-w-48 whitespace-nowrap px-1 text-center text-sm font-semibold">{label}</span>
        <IconButton
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('staff.time_tracking.timesheet.period.next', 'Next period')}
          onClick={() => onAnchorDateChange(shiftPeriodAnchor(periodKind, anchorDate, 1))}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </IconButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => onAnchorDateChange(todayIso())}>
          {t('staff.time_tracking.timesheet.period.today', 'Today')}
        </Button>
      </div>
    </div>
  )
}

export type TimesheetSelectOption = {
  value: string
  label: string
}

/**
 * The project and person pickers of screens 11/12 (US-E2). A Team Member is
 * handed a single-option person list naming themselves (screen 11 note 5); a
 * Team Leader is handed everyone they may see. The component itself makes no
 * access decision — the page passes only options the caller is allowed.
 */
export function TimesheetFilterSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled,
}: {
  value: string
  options: readonly TimesheetSelectOption[]
  onChange: (next: string) => void
  ariaLabel: string
  className?: string
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className ?? 'w-auto min-w-44'} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
