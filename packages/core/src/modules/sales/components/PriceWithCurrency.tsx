"use client"

import * as React from 'react'
import { useOptionalLocale } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatCurrency } from '@open-mercato/ui/utils/format'

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
  if (amount == null || Number.isNaN(Number(amount))) return fallback
  const code = currency && /^[a-z]{3}$/i.test(currency) ? currency : null
  return formatCurrency(amount, code, locale, code ? undefined : 2) ?? fallback
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
