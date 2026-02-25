'use client'

import * as React from 'react'
import Link from 'next/link'
import { ShoppingBag, ArrowLeft } from 'lucide-react'
import { useCart } from '@/lib/CartContext'
import { CartLineItem } from '@/components/CartLineItem'

function formatPrice(amount: string | null, currencyCode: string, locale?: string) {
  if (!amount) return null
  try {
    return new Intl.NumberFormat(locale ?? 'en', {
      style: 'currency',
      currency: currencyCode,
    }).format(parseFloat(amount))
  } catch {
    return `${currencyCode} ${amount}`
  }
}

export default function CartPage() {
  const { cart } = useCart()

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <ShoppingBag size={48} className="mx-auto mb-4 text-gray-200" />
        <h1 className="text-2xl font-light text-gray-900 mb-2">Your cart is empty</h1>
        <p className="text-gray-500 mb-8">Add some products to get started.</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-900 underline underline-offset-2"
        >
          <ArrowLeft size={16} />
          Continue Shopping
        </Link>
      </div>
    )
  }

  const subtotal = formatPrice(cart.subtotalGross, cart.currencyCode, cart.locale ?? undefined)

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-light tracking-tight text-gray-900 mb-8">Cart</h1>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Lines */}
        <div className="lg:col-span-2">
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            {cart.lines.map((line) => (
              <CartLineItem key={line.id} line={line} />
            ))}
          </div>

          <div className="mt-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={14} />
              Continue Shopping
            </Link>
          </div>
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-1">
          <div className="rounded-lg border border-gray-200 p-5 space-y-4">
            <h2 className="text-base font-medium text-gray-900">Order Summary</h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Items ({cart.itemCount})</span>
                <span className="text-gray-900">{subtotal ?? '—'}</span>
              </div>
              <div className="flex justify-between border-t border-gray-100 pt-2">
                <span className="font-medium text-gray-900">Subtotal</span>
                <span className="font-medium text-gray-900">{subtotal ?? '—'}</span>
              </div>
            </div>

            <Link
              href="/checkout"
              className="block w-full rounded bg-gray-900 py-3 text-center text-sm font-medium text-white hover:bg-gray-800 transition-colors"
            >
              Proceed to Checkout
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
