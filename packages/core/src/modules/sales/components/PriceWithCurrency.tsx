"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export function formatPriceWithCurrency(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
  fallback = '—'
): string {
  if (amount === null || amount === undefined) return fallback
  const parsed = typeof amount === 'string' ? Number(amount) : amount
  if (Number.isNaN(parsed)) return fallback
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(parsed)
    } catch {
      // fall through to plain number formatting
    }
  }
  return parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type PriceWithCurrencyProps = {
  amount: number | string | null | undefined
  currency: string | null | undefined
  fallback?: string
  className?: string
}

export function PriceWithCurrency({ amount, currency, fallback = '—', className }: PriceWithCurrencyProps) {
  const label = React.useMemo(
    () => formatPriceWithCurrency(amount, currency, fallback),
    [amount, currency, fallback]
  )
  return <span className={cn('font-mono text-sm text-foreground', className)}>{label}</span>
}
