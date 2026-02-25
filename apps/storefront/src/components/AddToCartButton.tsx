'use client'

import * as React from 'react'
import { ShoppingBag } from 'lucide-react'
import { useCart } from '@/lib/CartContext'

type AddToCartButtonProps = {
  productId: string
  variantId?: string | null
  disabled?: boolean
}

export function AddToCartButton({ productId, variantId, disabled }: AddToCartButtonProps) {
  const { addLine, isLoading } = useCart()
  const [adding, setAdding] = React.useState(false)
  const [added, setAdded] = React.useState(false)

  async function handleClick() {
    if (adding || isLoading) return
    setAdding(true)
    try {
      await addLine(productId, variantId ?? null, 1)
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
    } catch {
      // Silently fail — cart context may show an error state
    } finally {
      setAdding(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled || adding || isLoading}
      className={[
        'flex w-full items-center justify-center gap-2 rounded py-3 px-6 text-sm font-medium transition-colors',
        added
          ? 'bg-green-600 text-white'
          : 'bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed',
      ].join(' ')}
    >
      <ShoppingBag size={16} />
      {adding ? 'Adding…' : added ? 'Added!' : 'Add to Cart'}
    </button>
  )
}
