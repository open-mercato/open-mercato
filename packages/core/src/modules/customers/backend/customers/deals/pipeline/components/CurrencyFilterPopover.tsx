"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { ChipButton } from './ChipButton'

export type CurrencyFilterRow = {
  currency: string
  total: number
  count: number
}

type CurrencyFilterPopoverProps = {
  /** Per-currency rows scoped to the current pipeline filter context. */
  rows: CurrencyFilterRow[]
  /** Tenant base currency code, or `null` when none is configured. */
  baseCurrencyCode: string | null
  /** Aggregate total across all currencies in `rows`, expressed in `baseCurrencyCode`. */
  totalInBaseCurrency: number
  /** Stage / pipeline label shown in the subtitle (e.g. `"PIPELINE"`). */
  headingLabel: string
  /** Total deal count surfaced in the subtitle. */
  headingCount: number
  /** Currently-applied currency filter (`null` means "All currencies"). */
  selectedCurrency: string | null
  /** Called when the operator presses "Apply filter". `null` clears the filter. */
  onApply: (currency: string | null) => void
}

/**
 * Currency filter popover anchored to a "Currency" chip on the kanban filter bar.
 *
 * Matches SPEC-048 Figma node 1251:699 — header + subtitle + radio rows + Apply filter footer.
 * Selecting a row narrows the kanban board to deals whose `valueCurrency` equals the chosen
 * code; the "All currencies" sentinel clears the filter. The selected row uses the
 * brand-violet tinted background to mirror the Figma highlight.
 *
 * Chrome (rounded-2xl outer, bordered header w/ close, muted footer) matches
 * `LaneCurrencyBreakdown` so the two popovers feel like a family.
 */
export function CurrencyFilterPopover({
  rows,
  baseCurrencyCode,
  totalInBaseCurrency,
  headingLabel,
  headingCount,
  selectedCurrency,
  onApply,
}: CurrencyFilterPopoverProps): React.ReactElement {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<string | null>(selectedCurrency)

  React.useEffect(() => {
    if (open) setDraft(selectedCurrency)
  }, [open, selectedCurrency])

  const base = baseCurrencyCode?.toUpperCase() ?? null
  const chipLabel = translateWithFallback(t, 'customers.deals.kanban.currencyFilter.chipLabel', 'Currency')
  const chipValue = selectedCurrency
    ? selectedCurrency.toUpperCase()
    : translateWithFallback(t, 'customers.deals.kanban.filter.all', 'All')
  const closeLabel = translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')
  const applyLabel = translateWithFallback(
    t,
    'customers.deals.kanban.currencyFilter.apply',
    'Apply filter',
  )

  const handleApply = () => {
    onApply(draft)
    setOpen(false)
  }

  // Cmd/Ctrl+Enter parity with other kanban filter popovers (`AGENTS.md` UI Interaction rules).
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleApply()
    }
  }

  const headingCountLabel = translateWithFallback(
    t,
    'customers.deals.kanban.currencyBreakdown.headingCount',
    '({count} deals)',
    { count: headingCount },
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton
          label={chipLabel}
          value={chipValue}
          active={selectedCurrency !== null}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-96 rounded-2xl border-border bg-transparent p-0 shadow-xl"
        onKeyDown={handleKeyDown}
      >
        {/*
          Solid `bg-card` (no opacity modifier) on the outer wrapper — round-2 UX review item 33.
          Floating overlays must not let underlying card content bleed through; the previous
          `bg-muted/30` allowed card titles/badges to show through this popover.
        */}
        <div className="flex flex-col overflow-hidden rounded-2xl bg-card">
          <div className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
            <span className="text-base font-bold leading-normal text-foreground">
              {translateWithFallback(
                t,
                'customers.deals.kanban.currencyFilter.title',
                'Filter kanban by currency',
              )}
            </span>
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

          <div className="flex flex-col bg-card pt-3.5">
            <div className="px-6 pb-2">
              <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.currencyFilter.subtitle',
                  '{label} · {count} deals · {total} {currency}',
                  {
                    label: headingLabel,
                    count: headingCount,
                    total: formatAmount(totalInBaseCurrency),
                    currency: baseCurrencyCode ?? '',
                  },
                )}
              </span>
            </div>

            <div className="flex flex-col">
              <CurrencyRow
                isAllCurrencies
                selected={draft === null}
                onClick={() => setDraft(null)}
                label={translateWithFallback(
                  t,
                  'customers.deals.kanban.currencyFilter.allCurrencies',
                  'All currencies',
                )}
                amount={totalInBaseCurrency}
                amountCurrency={baseCurrencyCode ?? ''}
                count={headingCount}
              />
              {rows.map((row) => {
                const code = row.currency.toUpperCase()
                const isBase = base !== null && code === base
                const isSelected = draft === code
                return (
                  <CurrencyRow
                    key={row.currency}
                    selected={isSelected}
                    onClick={() => setDraft(code)}
                    label={code}
                    showBasePill={isBase}
                    amount={row.total}
                    amountCurrency={code}
                    count={row.count}
                  />
                )
              })}
            </div>

            <div className="px-6 pt-3 pb-3.5">
              <p className="text-xs font-normal leading-normal text-muted-foreground">
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.currencyFilter.footerCredit',
                  'NBP mid conversion rate · {date}',
                  { date: formatToday() },
                )}
              </p>
            </div>
          </div>

          {/* Footer uses solid `bg-muted` (no opacity modifier) — round-2 UX review item 33. */}
          <div className="flex items-center justify-end border-t border-border bg-muted px-5 py-3.5">
            <Button
              type="button"
              onClick={handleApply}
              className="h-auto rounded-lg bg-foreground px-5 py-2 text-sm font-semibold text-background hover:bg-foreground/90"
            >
              {applyLabel}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type CurrencyRowProps = {
  /** Marks the row as the "All currencies" sentinel so we suppress the per-row currency suffix. */
  isAllCurrencies?: boolean
  selected: boolean
  onClick: () => void
  label: string
  showBasePill?: boolean
  amount: number
  amountCurrency: string
  count: number
}

function CurrencyRow({
  isAllCurrencies = false,
  selected,
  onClick,
  label,
  showBasePill = false,
  amount,
  amountCurrency,
  count,
}: CurrencyRowProps): React.ReactElement {
  const t = useT()
  const rowBg = selected ? 'bg-brand-violet/10' : 'bg-card hover:bg-muted'
  const codeColor = selected ? 'text-brand-violet' : 'text-foreground'
  const amountColor = selected ? 'text-brand-violet font-semibold' : 'text-foreground font-normal'
  const currencyColor = selected ? 'text-brand-violet/80' : 'text-muted-foreground'
  const countColor = selected ? 'text-brand-violet font-semibold' : 'text-foreground/80 font-normal'
  return (
    <Button
      type="button"
      variant="ghost"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`h-auto w-full justify-start gap-3 rounded-none px-6 py-2.5 text-left font-normal ${rowBg}`}
    >
      <RadioDot selected={selected} />
      <span className="flex items-center gap-1.5">
        <span className={`text-sm leading-normal ${codeColor} ${selected ? 'font-semibold' : 'font-normal'}`}>
          {label}
        </span>
        {showBasePill ? (
          // text-[9px] is an intentional Figma exception for the BASE badge (node 1251:671).
          // The DS scale bottoms out at text-xs (12px); this 9px is design-system tracked as
          // a tiny-badge exception and should not be migrated to text-overline.
          <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-px text-[9px] font-bold uppercase leading-normal tracking-wider text-muted-foreground">
            {translateWithFallback(t, 'customers.deals.kanban.currencyBreakdown.basePill', 'BASE')}
          </span>
        ) : null}
      </span>
      <span className="flex-1" aria-hidden="true" />
      <span className="flex items-baseline gap-1">
        <span className={`text-sm leading-normal tabular-nums ${amountColor}`}>
          {formatAmount(amount)}
        </span>
        {!isAllCurrencies || amountCurrency ? (
          <span className={`text-xs leading-normal ${currencyColor}`}>{amountCurrency}</span>
        ) : null}
      </span>
      <span className={`pl-5 text-xs leading-normal tabular-nums ${countColor}`}>{count}</span>
    </Button>
  )
}

function RadioDot({ selected }: { selected: boolean }): React.ReactElement {
  return (
    <span
      className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
        selected ? 'border-brand-violet' : 'border-input bg-card'
      }`}
      aria-hidden="true"
    >
      {selected ? <span className="size-2 rounded-full bg-brand-violet" /> : null}
    </span>
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

export default CurrencyFilterPopover
