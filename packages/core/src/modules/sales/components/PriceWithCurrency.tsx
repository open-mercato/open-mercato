"use client"

import * as React from 'react'
import { useOptionalLocale } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Pass `locale` to format in the application locale (`useLocale()` in client components).
 * Omitting it keeps the runtime default, which varies per machine and is therefore not
 * assertable in tests.
 */
export function formatPriceWithCurrency(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
  fallback = '—',
  locale?: string
): string {
  if (amount === null || amount === undefined) return fallback
  const parsed = typeof amount === 'string' ? Number(amount) : amount
  if (Number.isNaN(parsed)) return fallback
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(parsed)
    } catch {
      // fall through to plain number formatting
    }
  }
  return parsed.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type PriceWithCurrencyProps = {
  amount: number | string | null | undefined
  currency: string | null | undefined
  fallback?: string
  className?: string
}

export function PriceWithCurrency({ amount, currency, fallback = '—', className }: PriceWithCurrencyProps) {
  // `useOptionalLocale` rather than `useLocale`: this component is deep-importable and had no i18n
  // dependency at all before it started formatting in the app locale, so making it throw outside
  // `I18nProvider` would narrow its mounting contract. Without a provider it falls back to the
  // runtime default, which is exactly the behaviour it had before.
  const locale = useOptionalLocale()
  const label = React.useMemo(
    () => formatPriceWithCurrency(amount, currency, fallback, locale),
    [amount, currency, fallback, locale]
  )
  return <span className={cn('font-mono text-sm text-foreground', className)}>{label}</span>
}
