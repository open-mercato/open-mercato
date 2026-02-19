'use client'

import * as React from 'react'
import type { CartDto } from './types'
import {
  getCart,
  createCart,
  addToCart as apiAddToCart,
  updateCartLine as apiUpdateCartLine,
  removeCartLine as apiRemoveCartLine,
} from './api'

const CART_TOKEN_KEY = 'om_cart_token'

type CartContextValue = {
  cart: CartDto | null
  cartToken: string | null
  itemCount: number
  isOpen: boolean
  isLoading: boolean
  addLine: (productId: string, variantId: string | null, quantity: number) => Promise<void>
  updateLine: (lineId: string, quantity: number) => Promise<void>
  removeLine: (lineId: string) => Promise<void>
  openCart: () => void
  closeCart: () => void
}

const CartContext = React.createContext<CartContextValue>({
  cart: null,
  cartToken: null,
  itemCount: 0,
  isOpen: false,
  isLoading: false,
  addLine: async () => {},
  updateLine: async () => {},
  removeLine: async () => {},
  openCart: () => {},
  closeCart: () => {},
})

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = React.useState<CartDto | null>(null)
  const [cartToken, setCartToken] = React.useState<string | null>(null)
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem(CART_TOKEN_KEY) : null
    if (token) {
      setCartToken(token)
      getCart(token).then((c) => {
        if (c) setCart(c)
      })
    }
  }, [])

  async function ensureToken(): Promise<string> {
    if (cartToken) return cartToken
    const { token, cart: newCart } = await createCart()
    localStorage.setItem(CART_TOKEN_KEY, token)
    setCartToken(token)
    setCart(newCart)
    return token
  }

  async function addLine(productId: string, variantId: string | null, quantity: number) {
    setIsLoading(true)
    try {
      const token = await ensureToken()
      const updatedCart = await apiAddToCart(token, productId, variantId, quantity)
      setCart(updatedCart)
      setIsOpen(true)
    } finally {
      setIsLoading(false)
    }
  }

  async function updateLine(lineId: string, quantity: number) {
    if (!cartToken) return
    setIsLoading(true)
    try {
      const updatedCart = await apiUpdateCartLine(cartToken, lineId, quantity)
      setCart(updatedCart)
    } finally {
      setIsLoading(false)
    }
  }

  async function removeLine(lineId: string) {
    if (!cartToken) return
    setIsLoading(true)
    try {
      const updatedCart = await apiRemoveCartLine(cartToken, lineId)
      setCart(updatedCart)
    } finally {
      setIsLoading(false)
    }
  }

  const itemCount = cart?.itemCount ?? 0

  return (
    <CartContext.Provider
      value={{
        cart,
        cartToken,
        itemCount,
        isOpen,
        isLoading,
        addLine,
        updateLine,
        removeLine,
        openCart: () => setIsOpen(true),
        closeCart: () => setIsOpen(false),
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  return React.useContext(CartContext)
}
