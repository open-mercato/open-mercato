'use client'

import * as React from 'react'
import Link from 'next/link'
import { X, ShoppingBag } from 'lucide-react'
import { useCart } from '@/lib/CartContext'
import { CartLineItem } from './CartLineItem'

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

export function CartSidebar() {
  const { cart, isOpen, closeCart } = useCart()

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={closeCart}
          aria-hidden="true"
        />
      )}

      {/* Slide-over panel */}
      <div
        className={[
          'fixed right-0 top-0 z-50 h-full w-full max-w-sm bg-white shadow-xl transition-transform duration-300',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
            <h2 className="text-base font-medium text-gray-900">
              Cart {cart && cart.itemCount > 0 ? `(${cart.itemCount})` : ''}
            </h2>
            <button
              onClick={closeCart}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close cart"
            >
              <X size={20} />
            </button>
          </div>

          {/* Lines */}
          <div className="flex-1 overflow-y-auto px-4">
            {!cart || cart.lines.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <ShoppingBag size={40} className="text-gray-200" />
                <p className="text-sm text-gray-500">Your cart is empty</p>
                <button
                  onClick={closeCart}
                  className="text-sm font-medium text-gray-900 underline underline-offset-2"
                >
                  Continue shopping
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {cart.lines.map((line) => (
                  <CartLineItem key={line.id} line={line} />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {cart && cart.lines.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium text-gray-900">
                  {formatPrice(cart.subtotalGross, cart.currencyCode, cart.locale ?? undefined) ?? '—'}
                </span>
              </div>

              <Link
                href="/cart"
                onClick={closeCart}
                className="block w-full rounded border border-gray-200 py-2.5 text-center text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
              >
                View Cart
              </Link>

              <Link
                href="/checkout"
                onClick={closeCart}
                className="block w-full rounded bg-gray-900 py-2.5 text-center text-sm font-medium text-white hover:bg-gray-800 transition-colors"
              >
                Checkout
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
