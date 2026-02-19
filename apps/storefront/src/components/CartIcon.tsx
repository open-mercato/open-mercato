'use client'

import { ShoppingBag } from 'lucide-react'
import { useCart } from '@/lib/CartContext'

export function CartIcon() {
  const { itemCount, openCart } = useCart()

  return (
    <button
      onClick={openCart}
      className="relative p-2 text-gray-600 hover:text-gray-900 transition-colors"
      aria-label={`Open cart${itemCount > 0 ? ` — ${itemCount} item${itemCount !== 1 ? 's' : ''}` : ''}`}
    >
      <ShoppingBag size={22} />
      {itemCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[11px] font-medium text-white">
          {itemCount > 99 ? '99+' : itemCount}
        </span>
      )}
    </button>
  )
}
