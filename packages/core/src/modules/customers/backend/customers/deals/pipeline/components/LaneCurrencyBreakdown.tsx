"use client"

import * as React from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { CurrencyBreakdownTable, type CurrencyBreakdownRow } from './CurrencyBreakdownTable'

type LaneCurrencyBreakdownProps = {
  /** Per-currency breakdown rows (already sorted desc by total in the API response). */
  rows: CurrencyBreakdownRow[]
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
  /**
   * Heading shown above the table (e.g. lane stage label or `"PIPELINE"` for the
   * board-level breakdown). Rendered in overline style above the headline total.
   */
  headingLabel: string
  /** Total deal count shown next to the heading label (e.g. `"49 deals"`). */
  headingCount: number
}

/**
 * Read-only per-currency breakdown popover.
 *
 * Reused by:
 *   - lane header `+N` chip (lane-scoped)
 *   - page-level Breakdown button (pipeline-scoped)
 *
 * Visual design from SPEC-048 Figma node 1251:610 — bordered white header bar with bold title +
 * close button, overline heading + large total amount, currency table with thin row dividers,
 * BASE pill on the base-currency row, and a muted "NBP mid rate · {date}" footer credit.
 *
 * The body (column header + currency rows + BASE pill + footer credit) lives in
 * `CurrencyBreakdownTable` so the filter variant (`CurrencyFilterPopover`) can reuse the same
 * row composition without duplicating styling.
 */
export function LaneCurrencyBreakdown({
  rows,
  baseCurrencyCode,
  totalInBaseCurrency,
  convertedAll,
  missingRateCurrencies,
  triggerLabel,
  triggerClassName,
  headingLabel,
  headingCount,
}: LaneCurrencyBreakdownProps): React.ReactElement {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const closeLabel = translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')
  const titleLabel = translateWithFallback(
    t,
    'customers.deals.kanban.currencyBreakdown.title',
    'Lane breakdown',
  )
  const headingCountLabel = translateWithFallback(
    t,
    'customers.deals.kanban.currencyBreakdown.headingCount',
    '({count} deals)',
    { count: headingCount },
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          aria-label={translateWithFallback(
            t,
            'customers.deals.kanban.lane.currencyBreakdown.trigger',
            'Show per-currency breakdown ({count} currencies)',
            { count: rows.length },
          )}
          className={
            triggerClassName ??
            'inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-1 text-xs font-bold leading-normal text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          }
        >
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 rounded-2xl border-border bg-transparent p-0 shadow-xl"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {/*
          Solid `bg-card` (no opacity modifier) on the outer wrapper: floating overlays must not
          let underlying card content bleed through. Round-2 UX review item 33 — same class of
          bug as item 6 in the shared FilterPopoverShell, but in popovers that hand-roll their
          chrome instead of using the shell.
        */}
        <div className="flex flex-col overflow-hidden rounded-2xl bg-card">
          <div className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
            <span className="text-base font-bold leading-normal text-foreground">{titleLabel}</span>
            <IconButton
              variant="ghost"
              size="xs"
              onClick={() => setOpen(false)}
              aria-label={closeLabel}
              className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <X className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>

          <div className="flex flex-col gap-1.5 bg-card px-6 pt-3.5 pb-2">
            <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {headingLabel} {headingCountLabel}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold leading-normal text-foreground">
                {formatAmount(totalInBaseCurrency)}
              </span>
              {baseCurrencyCode ? (
                <span className="text-sm font-normal leading-normal text-muted-foreground">
                  {baseCurrencyCode}
                </span>
              ) : null}
            </div>
          </div>

          <CurrencyBreakdownTable
            rows={rows}
            baseCurrencyCode={baseCurrencyCode}
            missingRateCurrencies={missingRateCurrencies}
          />

          <div className="bg-card px-6 pt-3 pb-3.5">
            <p className="text-xs font-normal leading-normal text-muted-foreground">
              {translateWithFallback(
                t,
                'customers.deals.kanban.currencyBreakdown.footerCredit',
                'NBP mid rate · {date}',
                { date: formatToday() },
              )}
            </p>
            {!convertedAll && missingRateCurrencies.length > 0 ? (
              <p className="mt-2 text-xs leading-normal text-muted-foreground">
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.lane.currencyBreakdown.missingRatesHint',
                  'Missing FX rates for {currencies} — excluded from total. Configure exchange rates to see the full converted value.',
                  { currencies: missingRateCurrencies.join(', ') },
                )}
              </p>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'decimal',
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Math.round(amount))
}

function formatToday(): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date())
}

export default LaneCurrencyBreakdown
