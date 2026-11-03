'use client'

import { useSyncExternalStore } from 'react'
import { getBrandStyle, subscribeBrandStyle } from './brand-style'

const serverSnapshot = () => null

export function useBrandStyle() {
  return useSyncExternalStore(subscribeBrandStyle, getBrandStyle, serverSnapshot)
}
