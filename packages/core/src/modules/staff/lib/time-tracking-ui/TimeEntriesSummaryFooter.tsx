"use client"

import * as React from 'react'
import { z } from 'zod'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { opaqueProp } from '../time-tracking/componentContracts'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDuration } from '../time-tracking/duration'
import type { TimeEntriesSummary } from './timeEntryListData'

/**
 * The mockup's table footer: `Razem (5 z 23 wpisów) · 15:15 · 4 315,00 PLN`.
 *
 * The money half is deliberately conditional. When the visible rows carry more
 * than one currency there is no such thing as "the total", so the footer prints
 * each currency's subtotal side by side instead of a single figure. Adding
 * 1 000 PLN to 200 EUR produces a number that is arithmetically defensible and
 * financially false, and a footer is exactly where somebody would trust it.
 */
export type TimeEntriesSummaryFooterProps = {
  summary: TimeEntriesSummary
  totalCount: number
  canSeeMoney: boolean
}

function DefaultTimeEntriesSummaryFooter({ summary, totalCount, canSeeMoney }: TimeEntriesSummaryFooterProps) {
  const t = useT()
  const money = canSeeMoney ? summary.money : []

  return (
    <div
      className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm"
      data-testid="entries-summary-footer"
    >
      <span className="text-muted-foreground">
        {t('staff.time_tracking.entries.summary.count', 'Total ({visible} of {total} entries)', {
          visible: summary.visibleCount,
          total: totalCount,
        })}
      </span>
      <span className="font-mono font-semibold tabular-nums text-foreground" data-testid="entries-summary-duration">
        {formatDuration(summary.totalMinutes, 'clock')}
      </span>
      {money.length > 1 ? (
        <span
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
          data-testid="entries-summary-money-multi"
          title={t(
            'staff.time_tracking.entries.summary.multiCurrencyHint',
            'These entries are billed in more than one currency, so they are shown separately instead of added up.',
          )}
        >
          {money.map((subtotal) => (
            <span
              key={subtotal.currencyCode ?? 'unknown'}
              className="font-mono tabular-nums text-foreground"
              data-testid="entries-summary-money"
            >
              {formatCurrency(subtotal.amount, subtotal.currencyCode) ?? String(subtotal.amount)}
            </span>
          ))}
        </span>
      ) : money.length === 1 ? (
        <span className="font-mono tabular-nums text-foreground" data-testid="entries-summary-money">
          {formatCurrency(money[0].amount, money[0].currencyCode) ?? String(money[0].amount)}
        </span>
      ) : null}
    </div>
  )
}

const timeEntriesSummaryFooterPropsSchema: z.ZodType<TimeEntriesSummaryFooterProps> = z.object({
  summary: opaqueProp<TimeEntriesSummary>(),
  totalCount: z.number(),
  canSeeMoney: z.boolean(),
})

registerComponent<TimeEntriesSummaryFooterProps>({
  id: extensionPoints.hosts.entriesSummaryFooterComponent.componentId,
  component: DefaultTimeEntriesSummaryFooter,
  metadata: {
    module: 'staff',
    description: 'Totals footer under the time-entries table.',
    propsSchema: timeEntriesSummaryFooterPropsSchema,
  },
})

export function TimeEntriesSummaryFooter(props: TimeEntriesSummaryFooterProps) {
  const Resolved = useRegisteredComponent<TimeEntriesSummaryFooterProps>(
    extensionPoints.hosts.entriesSummaryFooterComponent.componentId,
    DefaultTimeEntriesSummaryFooter,
  )
  return <Resolved {...props} />
}
