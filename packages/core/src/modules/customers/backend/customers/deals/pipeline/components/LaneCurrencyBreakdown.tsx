"use client"

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

type CurrencyRow = { currency: string; total: number; count: number }

type LaneCurrencyBreakdownProps = {
  /** Per-currency breakdown rows (already sorted desc by total in the API response). */
  rows: CurrencyRow[]
  /** Tenant base currency code, or `null` when none is configured. */
  baseCurrencyCode: string | null
  /** Sum of `rows` converted to the base currency (only rows with a usable FX rate are included). */
  totalInBaseCurrency: number
  /** Whether every row in `rows` was either already base-currency or had an FX rate. */
  convertedAll: boolean
  /** Currencies in `rows` that have no FX rate to base — they are excluded from `totalInBaseCurrency`. */
  missingRateCurrencies: string[]
  /** Visible chip label shown in the lane header (e.g. "+3"). */
  triggerLabel: string
  /** Optional className for the trigger chip. */
  triggerClassName?: string
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: 'decimal', maximumFractionDigits: 0 }).format(
    Math.round(amount),
  )
}

/**
 * Breakdown popover that anchors to the lane-header `+N` chip.
 *
 * Why this exists: the lane header used to show a single currency total (e.g. `6.8M USD`) plus
 * a `+N` chip whose hover-tooltip joined every other currency on a single line with `·`. When
 * the tenant has no FX rates configured, the headline value is only the base-currency slice —
 * non-convertible currencies were silently excluded and operators couldn't tell from a glance.
 * This popover:
 *   - Renders each currency on its own row with raw amount + deal count
 *   - Shows the converted-to-base-currency total at the bottom with a "partial" indicator
 *     when at least one currency couldn't be converted
 *   - Names the specific missing-rate currencies so the operator knows what's excluded
 *
 * Triggered by click for sticky open (operator can read at leisure). Hover doesn't auto-open
 * because the lane header is already information-dense and we don't want a hover trap.
 */
export function LaneCurrencyBreakdown({
  rows,
  baseCurrencyCode,
  totalInBaseCurrency,
  convertedAll,
  missingRateCurrencies,
  triggerLabel,
  triggerClassName,
}: LaneCurrencyBreakdownProps): React.ReactElement {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const hasBase = !!baseCurrencyCode && totalInBaseCurrency > 0
  const showPartialWarning = !convertedAll && missingRateCurrencies.length > 0

  const closeLabel = translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={translateWithFallback(
            t,
            'customers.deals.kanban.lane.currencyBreakdown.trigger',
            'Show per-currency breakdown ({count} currencies)',
            { count: rows.length },
          )}
          className={
            triggerClassName ??
            'inline-flex shrink-0 items-center rounded-full bg-muted px-[8px] py-[3px] text-[12px] font-bold leading-[normal] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          }
        >
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[260px] p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">
            {translateWithFallback(
              t,
              'customers.deals.kanban.lane.currencyBreakdown.title',
              'Per-currency breakdown',
            )}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <ul className="flex flex-col gap-1 px-3 py-2 text-sm">
          {rows.map((row) => {
            const isMissingRate = missingRateCurrencies.includes(row.currency)
            return (
              <li
                key={row.currency}
                className="flex items-center justify-between gap-3"
                title={
                  isMissingRate
                    ? translateWithFallback(
                        t,
                        'customers.deals.kanban.lane.currencyBreakdown.missingRate',
                        'No FX rate to {base} — excluded from the converted total',
                        { base: baseCurrencyCode ?? '' },
                      )
                    : undefined
                }
              >
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  {isMissingRate ? (
                    <AlertTriangle
                      className="size-[14px] text-status-warning-icon"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span>{row.currency}</span>
                </span>
                <span className="flex items-baseline gap-2 text-muted-foreground">
                  <span className="font-mono text-foreground">{formatAmount(row.total)}</span>
                  <span className="text-xs">
                    {translateWithFallback(
                      t,
                      'customers.deals.kanban.lane.currencyBreakdown.count',
                      '({count})',
                      { count: row.count },
                    )}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
        {hasBase ? (
          <div className="border-t border-border px-3 py-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-foreground">
                {convertedAll
                  ? translateWithFallback(
                      t,
                      'customers.deals.kanban.lane.currencyBreakdown.total',
                      'Total',
                    )
                  : translateWithFallback(
                      t,
                      'customers.deals.kanban.lane.currencyBreakdown.partialTotal',
                      'Total (partial)',
                    )}
              </span>
              <span className="flex items-baseline gap-1.5 font-semibold text-foreground">
                {convertedAll ? null : (
                  <span className="text-muted-foreground" aria-hidden="true">
                    ~
                  </span>
                )}
                <span className="font-mono">{formatAmount(totalInBaseCurrency)}</span>
                <span className="text-xs text-muted-foreground">{baseCurrencyCode}</span>
              </span>
            </div>
            {showPartialWarning ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.lane.currencyBreakdown.missingRatesHint',
                  'Missing FX rates for {currencies} — excluded from total. Configure exchange rates to see the full converted value.',
                  { currencies: missingRateCurrencies.join(', ') },
                )}
              </p>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

export default LaneCurrencyBreakdown
