"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { PriceWithCurrency } from '../PriceWithCurrency'

export type DocumentTotalItem = {
  key: string
  label: string
  amount: number | string | null | undefined
  emphasize?: boolean
}

type DocumentTotalsProps = {
  title?: string
  currency: string | null | undefined
  items: DocumentTotalItem[]
  className?: string
}

export function DocumentTotals({ title, currency, items, className }: DocumentTotalsProps) {
  if (!items.length) return null
  const emphasizedRows = items.filter((item) => item.emphasize)
  const heading = title ?? null
  const [expanded, setExpanded] = React.useState(false)
  const collapsedItems = React.useMemo(() => {
    if (emphasizedRows.length) return emphasizedRows
    return items.slice(0, 3)
  }, [emphasizedRows, items])
  const visibleItems = expanded ? items : collapsedItems
  const hiddenCount = items.length - visibleItems.length

  return (
    <div className={cn('space-y-3', className)}>
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
          {heading ? (
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heading}</span>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Totals</span>
          )}
          {currency ? (
            <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs font-semibold tracking-wide text-foreground">
              {currency}
            </span>
          ) : null}
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border/80">
            {visibleItems
              .filter((item) => !item.emphasize)
              .map((item) => (
                <tr key={item.key} className="bg-background/60 transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-foreground/90">{item.label}</td>
                  <td className="px-4 py-3 text-right">
                    <PriceWithCurrency amount={item.amount} currency={currency} className="font-mono text-base" />
                  </td>
                </tr>
              ))}
          </tbody>
          {visibleItems.some((item) => item.emphasize) ? (
            <tfoot className="border-t-2 border-primary/40 bg-primary/5">
              {visibleItems
                .filter((item) => item.emphasize)
                .map((item) => (
                  <tr key={item.key}>
                    <td className="px-4 py-3 font-semibold uppercase tracking-wide text-foreground">
                      {item.label}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <PriceWithCurrency
                        amount={item.amount}
                        currency={currency}
                        className="font-mono text-lg font-semibold text-foreground"
                      />
                    </td>
                  </tr>
                ))}
            </tfoot>
          ) : null}
        </table>
        {hiddenCount > 0 ? (
          <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {expanded
                ? 'Showing all totals'
                : `Showing key totals${hiddenCount > 0 ? ` · ${hiddenCount} more` : ''}`}
            </span>
            <button
              type="button"
              className="text-xs font-semibold text-primary transition-colors hover:text-primary/80"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
