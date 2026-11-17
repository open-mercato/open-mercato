"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import type { DealTimelineCurrencyTotal } from '../../../../../lib/dealsTimelineTypes'

type Translator = ReturnType<typeof useT>

function formatCompactNumber(amount: number, locale?: string): string {
  const options: Intl.NumberFormatOptions = { notation: 'compact', maximumFractionDigits: 1 }
  try {
    return new Intl.NumberFormat(locale, options).format(amount)
  } catch {
    return new Intl.NumberFormat(undefined, options).format(amount)
  }
}

export function formatCompactAmount(amount: number, currency: string, locale?: string): string {
  if (!currency) return formatCompactNumber(amount, locale)
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }
  try {
    return new Intl.NumberFormat(locale, options).format(amount)
  } catch {
    try {
      return new Intl.NumberFormat(undefined, options).format(amount)
    } catch {
      return `${formatCompactNumber(amount, locale)} ${currency}`
    }
  }
}

export function visibleTimelineAmounts(
  amounts: DealTimelineCurrencyTotal[] | null | undefined,
  showWon: boolean,
): DealTimelineCurrencyTotal[] {
  return (amounts ?? [])
    .filter((entry) => entry.open !== 0 || entry.weighted !== 0 || (showWon && entry.won !== 0))
    .sort((left, right) => right.open - left.open || left.currency.localeCompare(right.currency))
}

type AmountLine = { key: 'open' | 'weighted' | 'won'; label: string; value: string }

export function timelineAmountLines(
  t: Translator,
  entry: DealTimelineCurrencyTotal,
  showWon: boolean,
  locale?: string,
  capped = false,
): AmountLine[] {
  const format = (amount: number) => {
    const value = formatCompactAmount(amount, entry.currency, locale)
    return capped ? translateWithFallback(t, 'customers.deals.timeline.partialCount', '{count}+', { count: value }) : value
  }
  const lines: AmountLine[] = [
    {
      key: 'open',
      label: translateWithFallback(t, 'customers.deals.timeline.amounts.open', 'Open'),
      value: format(entry.open),
    },
    {
      key: 'weighted',
      label: translateWithFallback(t, 'customers.deals.timeline.amounts.weighted', 'Weighted'),
      value: format(entry.weighted),
    },
  ]
  if (showWon) {
    lines.push({
      key: 'won',
      label: translateWithFallback(t, 'customers.deals.timeline.amounts.won', 'Won'),
      value: format(entry.won),
    })
  }
  return lines
}

function AmountLines({ lines }: { lines: AmountLine[] }): React.ReactElement {
  return (
    <dl className="flex flex-col text-xs leading-normal">
      {lines.map((line) => (
        <div key={line.key} className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">{line.label}</dt>
          <dd className="font-medium tabular-nums text-foreground">{line.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export type TimelineAmountsProps = {
  amounts: DealTimelineCurrencyTotal[] | null | undefined
  showWon: boolean
  scopeLabel: string
  capped?: boolean
}

export function TimelineAmounts({ amounts, showWon, scopeLabel, capped = false }: TimelineAmountsProps): React.ReactElement | null {
  const t = useT()
  const locale = useLocale()
  const entries = React.useMemo(() => visibleTimelineAmounts(amounts, showWon), [amounts, showWon])
  if (!entries.length) return null
  const [first, ...rest] = entries
  return (
    <div className="flex flex-col gap-0.5" data-testid="timeline-amounts">
      <AmountLines lines={timelineAmountLines(t, first, showWon, locale, capped)} />
      {rest.length ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto self-start p-0 text-xs"
              aria-label={translateWithFallback(
                t,
                'customers.deals.timeline.amounts.allCurrenciesLabel',
                'Show totals in all currencies for {scope}',
                { scope: scopeLabel },
              )}
            >
              {translateWithFallback(t, 'customers.deals.timeline.amounts.moreCurrencies', 'Other currencies ({count})', {
                count: rest.length,
              })}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <p className="mb-2 text-sm font-semibold text-foreground">{scopeLabel}</p>
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => (
                <li key={entry.currency} className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    {entry.currency || translateWithFallback(t, 'customers.deals.timeline.amounts.noCurrency', 'No currency')}
                  </span>
                  <AmountLines lines={timelineAmountLines(t, entry, showWon, locale, capped)} />
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}
