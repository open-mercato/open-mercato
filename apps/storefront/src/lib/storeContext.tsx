'use client'

import * as React from 'react'
import type { StorefrontContext } from './types'

type StoreContextValue = {
  context: StorefrontContext | null
  isLoading: boolean
}

const StoreContext = React.createContext<StoreContextValue>({
  context: null,
  isLoading: true,
})

export function StoreContextProvider({
  children,
  initialContext,
}: {
  children: React.ReactNode
  initialContext: StorefrontContext | null
}) {
  return (
    <StoreContext.Provider value={{ context: initialContext, isLoading: false }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStoreContext(): StoreContextValue {
  return React.useContext(StoreContext)
}

export function useStoreName(): string {
  const { context } = useStoreContext()
  return context?.store.name ?? 'Store'
}

export function useStoreCurrency(): string {
  const { context } = useStoreContext()
  return context?.store.defaultCurrencyCode ?? 'USD'
}
