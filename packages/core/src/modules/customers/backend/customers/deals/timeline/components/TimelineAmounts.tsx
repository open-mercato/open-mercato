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

export function formatFullAmount(amount: number, currency: string, locale?: string): string {
  if (!currency) {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount)
    } catch {
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount)
    }
  }
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
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

type AmountLine = { key: 'open' | 'weighted' | 'won'; label: string; value: string; fullValue: string }

export type TimelineAmountsLayout = 'inline' | 'stacked'

export function timelineAmountLines(
  t: Translator,
  entry: DealTimelineCurrencyTotal,
  showWon: boolean,
  locale?: string,
  capped = false,
): AmountLine[] {
  const withCap = (value: string) =>
    capped ? translateWithFallback(t, 'customers.deals.timeline.partialCount', '{count}+', { count: value }) : value
  const format = (amount: number) => withCap(formatCompactAmount(amount, entry.currency, locale))
  const formatFull = (amount: number) => withCap(formatFullAmount(amount, entry.currency, locale))
  const lines: AmountLine[] = [
    {
      key: 'open',
      label: translateWithFallback(t, 'customers.deals.timeline.amounts.open', 'Open'),
      value: format(entry.open),
      fullValue: formatFull(entry.open),
    },
    {
      key: 'weighted',
      label: translateWithFallback(t, 'customers.deals.timeline.amounts.weighted', 'Weighted'),
      value: format(entry.weighted),
      fullValue: formatFull(entry.weighted),
    },
  ]
  if (showWon) {
    lines.push({
      key: 'won',
      label: translateWithFallback(t, 'customers.deals.timeline.amounts.won', 'Won'),
      value: format(entry.won),
      fullValue: formatFull(entry.won),
    })
  }
  return lines
}

function AmountLines({ lines, layout = 'inline' }: { lines: AmountLine[]; layout?: TimelineAmountsLayout }): React.ReactElement {
  return (
    <dl className="flex w-full min-w-0 flex-col text-xs leading-normal">
      {lines.map((line) => (
        <div
          key={line.key}
          className={layout === 'stacked' ? 'flex min-w-0 flex-col' : 'flex min-w-0 items-baseline justify-between gap-2'}
          data-amount-line={line.key}
        >
          <dt className={layout === 'stacked' ? 'truncate text-muted-foreground' : 'shrink-0 text-muted-foreground'}>{line.label}</dt>
          <dd className="min-w-0 truncate font-medium tabular-nums text-foreground" title={line.fullValue}>
            <span aria-hidden="true">{line.value}</span>
            <span className="sr-only">{line.fullValue}</span>
          </dd>
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
  layout?: TimelineAmountsLayout
}

export function TimelineAmounts({
  amounts,
  showWon,
  scopeLabel,
  capped = false,
  layout = 'inline',
}: TimelineAmountsProps): React.ReactElement | null {
  const t = useT()
  const locale = useLocale()
  const entries = React.useMemo(() => visibleTimelineAmounts(amounts, showWon), [amounts, showWon])
  if (!entries.length) return null
  const [first, ...rest] = entries
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5" data-testid="timeline-amounts">
      <AmountLines lines={timelineAmountLines(t, first, showWon, locale, capped)} layout={layout} />
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
