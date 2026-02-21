'use client'

import * as React from 'react'
import Image from 'next/image'
import { X, Plus, Minus } from 'lucide-react'
import type { CartLine } from '@/lib/types'
import { useCart } from '@/lib/CartContext'

type CartLineItemProps = {
  line: CartLine
  locale?: string
}

function formatPrice(amount: string | null, currencyCode: string | null, locale?: string) {
  if (!amount || !currencyCode) return null
  try {
    return new Intl.NumberFormat(locale ?? 'en', {
      style: 'currency',
      currency: currencyCode,
    }).format(parseFloat(amount))
  } catch {
    return `${currencyCode} ${amount}`
  }
}

export function CartLineItem({ line, locale }: CartLineItemProps) {
  const { updateLine, removeLine, isLoading } = useCart()

  const displayPrice = line.unitPriceGross ?? line.unitPriceNet
  const formattedPrice = displayPrice ? formatPrice(displayPrice, line.currencyCode, locale) : null
  const lineTotal = displayPrice
    ? formatPrice((parseFloat(displayPrice) * line.quantity).toFixed(4), line.currencyCode, locale)
    : null

  return (
    <div className="flex gap-3 py-4">
      <div className="relative h-16 w-16 flex-none overflow-hidden rounded bg-gray-100">
        {line.imageUrlSnapshot ? (
          <Image
            src={line.imageUrlSnapshot}
            alt={line.titleSnapshot ?? 'Product'}
            fill
            className="object-cover"
            sizes="64px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-300 text-xs">
            No image
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">
            {line.titleSnapshot ?? 'Product'}
          </p>
          <button
            onClick={() => removeLine(line.id)}
            disabled={isLoading}
            className="flex-none p-1 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Remove item"
          >
            <X size={14} />
          </button>
        </div>

        {line.skuSnapshot && (
          <p className="text-xs text-gray-400">SKU: {line.skuSnapshot}</p>
        )}

        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1 rounded border border-gray-200">
            <button
              onClick={() => updateLine(line.id, line.quantity - 1)}
              disabled={isLoading}
              className="px-2 py-1 text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-50"
              aria-label="Decrease quantity"
            >
              <Minus size={12} />
            </button>
            <span className="px-2 py-1 text-sm tabular-nums">{line.quantity}</span>
            <button
              onClick={() => updateLine(line.id, line.quantity + 1)}
              disabled={isLoading}
              className="px-2 py-1 text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-50"
              aria-label="Increase quantity"
            >
              <Plus size={12} />
            </button>
          </div>

          <div className="text-right">
            {lineTotal && (
              <p className="text-sm font-medium text-gray-900">{lineTotal}</p>
            )}
            {line.quantity > 1 && formattedPrice && (
              <p className="text-xs text-gray-400">{formattedPrice} each</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
