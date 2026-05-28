"use client"

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export type CurrencyBreakdownRow = {
  currency: string
  total: number
  count: number
}

type CurrencyBreakdownTableProps = {
  rows: CurrencyBreakdownRow[]
  baseCurrencyCode: string | null
  /** Currencies with no FX rate to base — surfaced with a warning icon next to the code. */
  missingRateCurrencies: string[]
}

/**
 * Read-only currency breakdown body shared between `LaneCurrencyBreakdown` and any future
 * informational popover. Matches the SPEC-048 Figma node 1251:610 currency table:
 *   - Column header row: "Currency · Native total · Deals" (overline gray)
 *   - Divider line
 *   - Per-currency rows with thin bottom dividers; BASE pill on the base-currency row
 *
 * The interactive filter variant (`CurrencyFilterPopover`) does NOT use this table — its rows
 * are radio selectors with different highlighting — but it reuses the same outer chrome from
 * `LaneCurrencyBreakdown`. Keeping them visually consistent is the responsibility of the
 * Figma source of truth, not of this component.
 */
export function CurrencyBreakdownTable({
  rows,
  baseCurrencyCode,
  missingRateCurrencies,
}: CurrencyBreakdownTableProps): React.ReactElement {
  const t = useT()
  const base = baseCurrencyCode?.toUpperCase() ?? null

  return (
    <div className="flex flex-col bg-card px-6">
      <div className="flex items-center gap-1 pt-5 pb-2">
        <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
          {translateWithFallback(t, 'customers.deals.kanban.currencyBreakdown.colCurrency', 'Currency')}
        </span>
        <span className="flex-1" aria-hidden="true" />
        <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
          {translateWithFallback(
            t,
            'customers.deals.kanban.currencyBreakdown.colNativeTotal',
            'Native total',
          )}
        </span>
        <span className="pl-6 text-overline font-semibold uppercase tracking-wider text-muted-foreground">
          {translateWithFallback(t, 'customers.deals.kanban.currencyBreakdown.colDeals', 'Deals')}
        </span>
      </div>
      <div className="border-b border-border" aria-hidden="true" />

      <ul className="flex flex-col">
        {rows.map((row) => {
          const code = row.currency.toUpperCase()
          const isBase = base !== null && code === base
          const isMissingRate = missingRateCurrencies.includes(row.currency)
          return (
            <li
              key={row.currency}
              className="flex items-center gap-1 border-b border-border py-2.5 last:border-b-0"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold leading-normal text-foreground">
                {isMissingRate ? (
                  <AlertTriangle
                    className="size-3.5 text-status-warning-icon"
                    aria-hidden="true"
                  />
                ) : null}
                <span>{code}</span>
                {isBase ? (
                  // text-[9px] is an intentional Figma exception for the BASE badge (node 1251:671).
                  // See CurrencyFilterPopover for the same rationale — both share the badge.
                  <span className="inline-flex items-center rounded-sm bg-brand-violet/10 px-1.5 py-px text-[9px] font-bold uppercase leading-normal tracking-wider text-brand-violet">
                    {translateWithFallback(t, 'customers.deals.kanban.currencyBreakdown.basePill', 'BASE')}
                  </span>
                ) : null}
              </span>
              <span className="flex-1" aria-hidden="true" />
              <span className="text-sm font-semibold leading-normal text-foreground tabular-nums">
                {formatAmount(row.total)}
              </span>
              <span className="pl-6 text-sm font-normal leading-normal text-muted-foreground tabular-nums">
                {row.count}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'decimal',
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Math.round(amount))
}

export default CurrencyBreakdownTable
