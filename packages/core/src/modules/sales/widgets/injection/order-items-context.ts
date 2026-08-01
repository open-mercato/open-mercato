'use client'

import * as React from 'react'

export type OrderItemsInjectionContextValue = {
  documentId: string
  kind: 'order' | 'quote'
}

export const OrderItemsInjectionContext =
  React.createContext<OrderItemsInjectionContextValue | null>(null)

export function useOrderItemsInjectionContext(): OrderItemsInjectionContextValue | null {
  return React.useContext(OrderItemsInjectionContext)
}
