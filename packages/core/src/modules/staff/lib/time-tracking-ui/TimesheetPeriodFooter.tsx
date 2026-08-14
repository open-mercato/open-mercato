"use client"

import * as React from 'react'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDuration } from '../time-tracking/duration'
import type { TimesheetSummary } from './timesheetData'

/**
 * The footer both timesheet views share — `Okres · Rozliczalne · Cel · delta`
 * (screens 11 and 12).
 *
 * The target and the delta disappear together when the tenant has no
 * `targets.dailyHours` (screen 11 note 6): a delta against nothing is not a
 * smaller number, it is a meaningless one. Time is the only quantity here; cost
 * belongs to the entries list and the report, which subtotal per currency.
 */
export function TimesheetPeriodFooter({
  summary,
  dailyHours,
}: {
  summary: TimesheetSummary
  dailyHours: number | null
}) {
  const t = useT()
  const targetLabel =
    dailyHours !== null
      ? t('staff.time_tracking.timesheet.footer.targetWithDays', 'Target ({days} d × {hours} h)', {
          days: String(summary.workingDays),
          hours: String(dailyHours),
        })
      : t('staff.time_tracking.timesheet.footer.target', 'Target')

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t px-4 py-3 text-sm">
      <span>
        <span className="text-muted-foreground">{t('staff.time_tracking.timesheet.footer.period', 'Period:')}</span>{' '}
        <b className="font-mono tabular-nums">{formatDuration(summary.totalMinutes, 'clock')}</b>
      </span>
      <span>
        <span className="text-muted-foreground">
          {t('staff.time_tracking.timesheet.footer.billable', 'Billable:')}
        </span>{' '}
        <b className="font-mono tabular-nums">{formatDuration(summary.billableMinutes, 'clock')}</b>
      </span>
      {summary.targetMinutes !== null ? (
        <>
          <span>
            <span className="text-muted-foreground">{targetLabel}:</span>{' '}
            <b className="font-mono tabular-nums">{formatDuration(summary.targetMinutes, 'clock')}</b>
          </span>
          {summary.deltaMinutes !== null && summary.deltaMinutes !== 0 ? (
            <StatusBadge variant={summary.deltaMinutes > 0 ? 'success' : 'warning'}>
              {summary.deltaMinutes > 0
                ? t('staff.time_tracking.timesheet.footer.overTarget', '+{duration} over target', {
                    duration: formatDuration(summary.deltaMinutes, 'clock'),
                  })
                : t('staff.time_tracking.timesheet.footer.underTarget', '−{duration} to target', {
                    duration: formatDuration(Math.abs(summary.deltaMinutes), 'clock'),
                  })}
            </StatusBadge>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
