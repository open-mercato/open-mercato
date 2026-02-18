import * as React from 'react'
import { formatPrice, formatPriceRange } from '@/lib/formatPrice'
import type { ProductPricing, PriceRange } from '@/lib/types'

type PriceDisplayProps = {
  pricing?: ProductPricing | null
  priceRange?: PriceRange | null
  locale?: string
  className?: string
}

export function PriceDisplay({ pricing, priceRange, locale = 'en', className = '' }: PriceDisplayProps) {
  if (pricing) {
    const current = formatPrice(pricing.unitPriceGross, pricing.currencyCode, locale)
    const original = pricing.isPromotion && pricing.originalPrice
      ? formatPrice(pricing.originalPrice, pricing.currencyCode, locale)
      : null

    return (
      <div className={`flex items-baseline gap-2 ${className}`}>
        <span className="text-xl font-semibold tracking-tight">{current}</span>
        {original && (
          <span className="text-sm text-gray-400 line-through">{original}</span>
        )}
        {pricing.isPromotion && (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">Sale</span>
        )}
      </div>
    )
  }

  if (priceRange) {
    const formatted = formatPriceRange(priceRange.min, priceRange.max, priceRange.currencyCode, locale)
    return (
      <div className={`text-base font-medium text-gray-700 ${className}`}>
        {formatted}
      </div>
    )
  }

  return null
}
