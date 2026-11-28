import { toSubmittedAmount } from '../../LinkTemplateForm'
import type { PayPagePricingProps, PayPageSummaryProps } from '../../PayPage'

export function legacySubmittedAmountPlusFee(value: string, locale: string): number {
  const amount: number | null = toSubmittedAmount(value, locale)
  return (amount ?? 0) + 1
}

const legacyFormatter = (value: number | null | undefined, currencyCode?: string | null): string =>
  `${currencyCode ?? ''} ${(value ?? 0).toFixed(2)}`

export const legacyPricingFormatter: PayPagePricingProps['formatAmount'] = legacyFormatter
export const legacySummaryFormatter: PayPageSummaryProps['formatAmount'] = legacyFormatter
