"use client"

import * as React from 'react'
import { Info } from 'lucide-react'
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
 * are unlabelled on purpose because the service could not determine one reliably.
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
        'A reliable currency could not be determined, so the amount is shown without one.',
      )}
    >
      <Info className="size-3 shrink-0" aria-hidden="true" />
      {t('dashboards.analytics.currency.unlabelled', 'Amounts shown without a currency')}
    </p>
  )
}

export default UnlabelledAmountNotice
