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
  return (
    <div className={cn('space-y-3', className)}>
      {title ? <p className="text-sm font-semibold">{title}</p> : null}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={item.key} className="flex flex-col gap-1 rounded-md border border-border/60 bg-background/50 p-3">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</span>
              <PriceWithCurrency
                amount={item.amount}
                currency={currency}
                className={cn(
                  'text-sm',
                  item.emphasize ? 'font-semibold text-foreground' : 'text-foreground'
                )}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
