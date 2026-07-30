"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type UnlabelledAmountNoticeProps = {
  currency: string | null | undefined
  loading?: boolean
  error?: string | null
  className?: string
}

/**
 * Explains why a money widget renders bare numbers. Without it a missing currency label
 * is indistinguishable from a broken widget, which is the gap #4676 closes: the amounts
 * are unlabelled on purpose because the rows behind them do not share one currency.
 */
export const UnlabelledAmountNotice: React.FC<UnlabelledAmountNoticeProps> = ({
  currency,
  loading,
  error,
  className,
}) => {
  const t = useT()

  if (loading || error || currency) return null

  return (
    <p
      className={`mt-2 flex items-center gap-1 text-xs text-muted-foreground${className ? ` ${className}` : ''}`}
      title={t(
        'dashboards.analytics.currency.unlabelledHint',
        'The rows behind this figure do not all share the base currency, so labelling the total with one would misstate it.',
      )}
    >
      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {t('dashboards.analytics.currency.unlabelled', 'Amounts shown without a currency')}
    </p>
  )
}

export default UnlabelledAmountNotice
